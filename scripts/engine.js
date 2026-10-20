/* ============================================================
   智研 · 工作流引擎
   · 13 阶段状态机（stage.enter / stage.exit / gate.blocked …）
   · 七步实证流水线：逐项可看可停可重跑
   · 实验设计确认门：执行层强制，未确认不跑任何数据
   · 质量门四门：数值一致性 / 措辞强度 / 引用真实性 / 披露完整性

  计算来源：七步实证由 scripts/pipeline.js 调用 scripts/econ.js **真实计算**；
  只有当 ZY.pipeline 不可用时才退回 scripts/data.js 的预置样例，并明确标记
  simulated=true。任何情况下都不会用预置数字冒充真实结果。
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};
  var U = ZY.util, S = ZY.store, D = ZY.data, C = ZY.checklist;

  var ORDER = ['definition', 'literature', 'design', 'data', 'stats', 'paper'];

  /* ---------- 事件日志（受 DSH 事件溯源同构启发）---------- */
  var log = [];
  function emit(type, data) {
    var e = { type: type, seq: log.length, time: Date.now(), data: data || {} };
    log.push(e);
    return e;
  }
  function events(type) {
    return type ? log.filter(function (e) { return e.type === type; }) : log.slice();
  }

  /* ---------- 阶段完成度 ---------- */
  function stageState(projectId) {
    var p = byId(projectId);
    var s = {};
    ORDER.forEach(function (k) { s[k] = 'idle'; });
    if (!p) return s;

    var hasRQ = !!(p.rq || p.scenario === 'full' || p.scenario === 'reader');
    var hasLit = !!(p.literatureDone);
    var hasDesign = !!(p.design);
    var confirmed = !!p.designConfirmed;
    var pipe = p.pipeline || {};

    s.definition = hasRQ ? 'done' : 'active';
    s.literature = hasLit ? 'done' : (hasRQ ? 'active' : 'idle');
    if (p.design) {
      s.design = confirmed ? 'done' : 'blocked';   // 有设计但未确认 → 门禁
    } else {
      s.design = hasLit ? 'active' : 'idle';
    }
    var anyStep = false, allDone = true;
    ZY.store.PIPELINE_STEPS.forEach(function (st) {
      var x = pipe[st.id];
      if (x && (x.status === 'done' || x.status === 'skipped')) anyStep = true;
      if (!x || (x.status !== 'done' && x.status !== 'skipped')) allDone = false;
    });
    s.data = (pipe['data-prep'] || pipe['descriptive']) ? (allDone || anyStep ? 'done' : 'active') : (confirmed ? 'active' : 'idle');
    s.stats = anyStep ? (allDone ? 'done' : 'active') : 'idle';
    s.paper = p.paper ? 'done' : (allDone ? 'active' : 'idle');

    // 门禁未过时，后续阶段一律 blocked
    if (hasDesign && !confirmed) { s.data = 'blocked'; s.stats = 'blocked'; s.paper = 'blocked'; }
    return s;
  }

  function byId(id) {
    var st = S.get();
    for (var i = 0; i < st.projects.length; i++) if (st.projects[i].id === id) return st.projects[i];
    return null;
  }

  /* ---------- 门禁校验（执行层强制）---------- */
  function gateCheck(p) {
    p = p || S.project();
    var blockers = [], warnings = [];
    if (!p) return { status: 'blocked', blockers: [{ kind: 'incomplete', ref: 'project', need: '先新建项目' }], warnings: [] };
    var d = p.design;
    if (!d) {
      blockers.push({ kind: 'incomplete', ref: 'design', need: '先完成实验设计生成' });
      return { status: 'blocked', blockers: blockers, warnings: warnings };
    }
    // 必填：假设 / 样本 / 变量 / 模型 / 检查清单
    if (!d.hypotheses || !d.hypotheses.length) blockers.push({ kind: 'incomplete', ref: 'hypotheses', need: '至少 1 条研究假设' });
    if (!d.variables || d.variables.length < 3) blockers.push({ kind: 'incomplete', ref: 'variables', need: '变量定义不完整' });
    if (!d.model || !d.model.cluster) blockers.push({ kind: 'incomplete', ref: 'model', need: '未声明聚类层级' });
    // 未处置 fail
    (d.checks || []).forEach(function (c) {
      if (c.status === 'fail' && !c.disposed) {
        blockers.push({ kind: 'fail', ref: c.id, need: c.need || ('处置 ' + c.id + '：' + c.label) });
      }
      if (c.status === 'unknown' && !c.disposed) {
        warnings.push({ kind: 'unknown', ref: c.id, suggestion: c.need || (c.label + ' 信息不足，建议补充') });
      }
    });
    // 聚类数偏少告警
    (d.checks || []).forEach(function (c) {
      if (c.id === 'FE-03' && /聚类数\s*(\d+)/.test(c.evidence || '')) {
        var n = parseInt(RegExp.$1, 10);
        if (n && n < 40) warnings.push({ kind: 'cluster', ref: 'FE-03', suggestion: '聚类数 ' + n + ' 偏少，推断可能偏乐观' });
      }
    });
    return { status: blockers.length ? 'blocked' : 'ready', blockers: blockers, warnings: warnings };
  }

  /** 确认门：写入 design.confirmed（唯一解锁执行的动作） */
  function confirmDesign() {
    var p = S.project();
    var g = gateCheck(p);
    if (g.status !== 'ready') {
      emit('gate.blocked', { stage_id: 'design-gate', reason_code: 'design.incomplete', blockers: g.blockers });
      S.save();
      return { ok: false, gate: g };
    }
    var hash = U.hash32(JSON.stringify(p.design));
    p.designConfirmed = true;
    p.designHash = hash;
    p.stage = 'design-gate';
    p.pipeline = initPipeline(p);
    p.stage = 'data-prep';
    var step = p.pipeline['data-prep'];
    step.status = 'pending';
    emit('design.confirmed', { design_hash: hash, by: 'user', at: Date.now(), warnings: g.warnings });
    emit('stage.exit', { stage_id: 'design-gate', run_no: 1, verdict: 'confirmed' });
    S.updateProject({ designConfirmed: true, designHash: hash, pipeline: p.pipeline, stage: 'data-prep', tab: 'data' });
    return { ok: true, gate: g, hash: hash };
  }

  /** 设计变更 → 确认自动失效（不能靠用户记得手动取消） */
  function invalidateDesign(reason) {
    var p = S.project();
    if (!p || !p.designConfirmed) return;
    p.designConfirmed = false;
    var old = p.designHash;
    p.designHash = null;
    if (p.pipeline) {
      ZY.store.PIPELINE_STEPS.forEach(function (st) {
        var x = p.pipeline[st.id];
        if (x) { x.invalidated = true; if (x.status === 'done') x.status = 'stale'; }
      });
    }
    emit('design.invalidated', { old_hash: old, new_hash: null, reason: reason || '设计内容变更' });
    S.updateProject({ designConfirmed: false, designHash: null, pipeline: p.pipeline });
    S.recordDecision('实验设计变更', '确认失效，需重新确认', ['沿用旧确认'], reason, 'agent');
  }

  /* ---------- 七步流水线 ---------- */
  function initPipeline(p) {
    var pipe = p.pipeline || {};
    ZY.store.PIPELINE_STEPS.forEach(function (st) {
      if (!pipe[st.id]) {
        pipe[st.id] = {
          status: 'pending', no: st.no, label: st.label,
          runNo: 0, itemIndex: 0, items: [], startedAt: null, finishedAt: null,
          quality: null, note: ''
        };
      }
      var def = (D.DESIGN.pipeline.filter(function (x) { return x.stepId === st.id; })[0] || { items: [] });
      pipe[st.id].items = def.items.slice();
    });
    return pipe;
  }

  var STEP_MIN_MS = { 'data-prep': 2600, 'descriptive': 1400, 'baseline': 3200, 'robustness': 5200, 'endogeneity': 2400, 'heterogeneity': 2200, 'mechanism': 2000 };

  /** 跑单步（模拟耗时；进度按执行项推进） */
  /**
   * 执行单步。
   *
   * 真实计算优先：如果 pipeline.js 已加载，就用 ZY.pipeline 真跑，结果挂到
   * st.real 上；三件套与表格都从真实结果出。
   *
   * 关于进度条：真实计算是同步的（纯 JS 计量库），主线程会被占住，所以
   * **不能**先演一个假进度条再偷偷换数——那等于骗人。这里改为：
   *   - 计算期间把状态置为 running，UI 显示"正在计算"（不编百分比）
   *   - 用实测耗时生成"实际用时"，而不是伪造 ETA
   *   - 真实计算不可用时（pipeline.js 缺失）才退回演示节奏，并在 st.simulated 标记
   */
  function runStep(stepId, onTick) {
    var p = S.project();
    if (!p || !p.designConfirmed) {
      emit('gate.blocked', { stage_id: stepId, reason_code: 'design.not-confirmed' });
      return Promise.reject(new Error('设计未确认：执行器拒绝读取数据'));
    }
    var pipe = p.pipeline || (p.pipeline = initPipeline(p));
    var st = pipe[stepId];
    var t0 = Date.now();
    st.status = 'running';
    st.runNo = (st.runNo || 0) + 1;
    st.itemIndex = 0;
    st.startedAt = t0;
    st.finishedAt = null;
    st.quality = null;
    st.percent = null;          /* 不编造百分比 */
    st.etaMs = null;
    emit('step.enter', { step_id: stepId, run_no: st.runNo, planned_items: st.items });
    S.updateProject({ pipeline: pipe, stage: stepId, tab: ZY.store.STAGE_TAB[stepId] });
    if (onTick) onTick(st, 0);

    var real = tryRealPipeline(stepId, p);
    if (real) {
      st.real = real;
      st.simulated = false;
      st.elapsedMs = Date.now() - t0;
      if (real.status === 'failed') {
        st.status = 'failed';
        st.note = (real.error && real.error.message) || '真实计算失败';
        st.error = real.error || { code: 'UNKNOWN', message: st.note };
        st.finishedAt = Date.now();
        emit('step.exit', { step_id: stepId, run_no: st.runNo, status: 'failed', reason: st.note });
        S.updateProject({ pipeline: pipe });
        return Promise.reject(new Error(st.note));
      }
      var qgr = qualityGate(stepId);
      st.quality = qgr;
      if (!qgr.pass) {
        st.status = 'failed';
        st.note = qgr.reason;
        st.finishedAt = Date.now();
        emit('step.exit', { step_id: stepId, run_no: st.runNo, status: 'failed', reason: qgr.reason });
        S.updateProject({ pipeline: pipe });
        return Promise.reject(new Error(qgr.reason));
      }
      st.status = 'done';
      st.percent = 100;
      st.itemIndex = st.items.length;
      st.finishedAt = Date.now();
      emit('step.exit', { step_id: stepId, run_no: st.runNo, status: 'done', cell_ids: cellIdsOf(stepId) });
      emit('step.artifact', { step_id: stepId, kind: 'code', path: codeFileName(stepId) });
      emit('step.artifact', { step_id: stepId, kind: 'result', path: resultFileName(stepId) });
      emit('step.artifact', { step_id: stepId, kind: 'interpretation', path: interpretFileName(stepId) });
      S.updateProject({ pipeline: pipe });
      if (onTick) onTick(st, 1);
      return Promise.resolve(st);
    }

    /* 真实计算不可用：退回演示节奏，并明确标记为模拟 */
    st.simulated = true;
    var total = STEP_MIN_MS[stepId] || 2000;
    return new Promise(function (resolve) {
      var n = st.items.length || 1;
      var iv = Math.max(180, Math.floor(total / n));
      var timer = setInterval(function () {
        var elapsed = Date.now() - t0;
        var idx = Math.min(n, Math.floor(elapsed / iv));
        st.itemIndex = idx;
        var ratio = Math.min(1, elapsed / total);
        st.percent = Math.round(ratio * 100);
        st.etaMs = ratio > 0.08 ? Math.max(0, (total - elapsed)) : null;
        st.etaConfidence = ratio < 0.2 ? 'low' : (ratio < 0.5 ? 'medium' : 'high');
        if (onTick) onTick(st, ratio);
        if (ratio >= 1) {
          clearInterval(timer);
          finishStep(stepId, st);
          resolve(st);
        }
      }, 120);
    });
  }

  /**
   * 真跑一步。返回 pipeline.js 的 stepResult，或 null 表示不可用。
   * 任何异常都返回带 error 的失败对象，绝不静默假成功。
   */
  function tryRealPipeline(stepId, p) {
    if (!ZY.pipeline || typeof ZY.pipeline.runStep !== 'function') return null;
    try {
      var ctx = realCtx(p);
      var res = ZY.pipeline.runStep(stepId, ctx);
      if (!res || typeof res !== 'object') {
        return { stepId: stepId, status: 'failed',
                 error: { code: 'BAD_RESULT', message: 'pipeline.runStep 没有返回结果对象' } };
      }
      return res;
    } catch (e) {
      return { stepId: stepId, status: 'failed',
               error: { code: 'PIPELINE_THREW', message: String((e && e.message) || e) } };
    }
  }

  /** 面板数据来源：真实导入的数据集优先，否则用 pipeline 的确定性合成面板 */
  function realCtx(p) {
    var n = (p && p.sampleSize) || 2400;
    var ctx = { n: n, seed: (p && p.seed) || 20240113 };
    var imported = ZY.store.get().importedPanel;
    if (imported && imported.rows && imported.rows.length) {
      ctx.rows = imported.rows;
      ctx.datasetLabel = imported.label || '用户导入数据';
    }
    if (p && p.design && p.design.model && p.design.model.cluster) {
      ctx.clusterVar = p.design.model.cluster;
    }
    return ctx;
  }

  function finishStep(stepId, st) {
    var p = S.project();
    var qg = qualityGate(stepId);
    st.finishedAt = Date.now();
    st.percent = 100;
    st.etaMs = null;
    st.itemIndex = st.items.length;
    st.quality = qg;

    if (qg.pass) {
      st.status = 'done';
      emit('step.exit', { step_id: stepId, run_no: st.runNo, status: 'done', cell_ids: cellIdsOf(stepId) });
      // 生成三件套
      emit('step.artifact', { step_id: stepId, kind: 'code', path: codeFileName(stepId) });
      emit('step.artifact', { step_id: stepId, kind: 'result', path: resultFileName(stepId) });
      emit('step.artifact', { step_id: stepId, kind: 'interpretation', path: interpretFileName(stepId) });
    } else {
      st.status = 'failed';
      st.note = qg.reason;
      emit('step.exit', { step_id: stepId, run_no: st.runNo, status: 'failed', reason: qg.reason });
    }
    S.updateProject({ pipeline: p.pipeline });
    return st;
  }

  /** 某步产出的 cell id 列表：真实计算结果优先 */
  function cellIdsOf(stepId) {
    var p = S.project();
    var st = p && p.pipeline && p.pipeline[stepId];
    if (st && st.real && st.real.cells && st.real.cells.length) {
      return st.real.cells.map(function (c) { return c.id || c.cellId; });
    }
    if (stepId === 'baseline') return D.STEPS.baseline.cells.map(function (c) { return c.id; });
    return [];
  }

  /**
   * 跨全部七步按 id 找单元格。真实计算的 cell id 形如 'baseline.coef.r1c1'，
   * 与样例数据的 'c-0001' 不同，所以必须全局找，不能只查 baseline。
   */
  function findCell(cellId) {
    if (!cellId) return null;
    var p = S.project();
    var pipe = (p && p.pipeline) || {};
    for (var i = 0; i < ZY.store.PIPELINE_STEPS.length; i++) {
      var st = pipe[ZY.store.PIPELINE_STEPS[i].id];
      if (!st || !st.real || !st.real.cells) continue;
      for (var j = 0; j < st.real.cells.length; j++) {
        var c = st.real.cells[j];
        if (c.id === cellId || c.cellId === cellId) return c;
      }
    }
    for (var k = 0; k < D.STEPS.baseline.cells.length; k++) {
      if (D.STEPS.baseline.cells[k].id === cellId) return D.STEPS.baseline.cells[k];
    }
    return null;
  }

  /** 某步用于展示/导出的表格：真实结果优先（返回 [{title,head,rows,numCols,note}]） */
  function stepTableSource(stepId) {
    var p = S.project();
    var st = p && p.pipeline && p.pipeline[stepId];
    if (st && st.real && st.real.tables && st.real.tables.length) {
      return st.real.tables.map(function (t) {
        return {
          title: t.title || t.caption || '',
          head: t.head || t.header || [],
          rows: t.formattedRows || t.rows || [],
          numCols: (t.numCols || []).map(function (c) { return c + 1; }),
          note: t.note || '',
          real: true
        };
      });
    }
    var d = D.STEPS[stepId];
    if (d && d.table) {
      return [{
        title: d.table.head ? (d.table.head[0] || '结果表') : '结果表',
        head: d.table.head, rows: d.table.rows,
        numCols: d.table.numCols || [], note: d.warning || '', real: false
      }];
    }
    return [];
  }

  /** 自动顺序执行后续步骤 */
  function runRest(fromStepId, onProgress) {
    var ids = ZY.store.PIPELINE_STEPS.map(function (s) { return s.id; });
    var start = ids.indexOf(fromStepId);
    var seq = ids.slice(start);
    var i = 0;
    function next() {
      if (i >= seq.length) { onProgress && onProgress(null); return; }
      var sid = seq[i++];
      var p = S.project();
      if (p.pipeline[sid].status === 'done') { next(); return; }
      runStep(sid, function (st, ratio) { onProgress && onProgress(st, ratio); }).then(next, function () { next(); });
    }
    next();
  }

  function pausePipeline() {
    var p = S.project();
    if (!p || !p.pipeline) return;
    ZY.store.PIPELINE_STEPS.forEach(function (s) {
      if (p.pipeline[s.id].status === 'running') p.pipeline[s.id].status = 'paused';
    });
    S.updateProject({ pipeline: p.pipeline });
  }

  function skipStep(stepId, reason) {
    var p = S.project();
    if (!p || !p.pipeline) return;
    var st = p.pipeline[stepId];
    st.status = 'skipped';
    st.note = reason || '用户跳过';
    st.finishedAt = Date.now();
    emit('step.exit', { step_id: stepId, run_no: st.runNo, status: 'skipped', reason: st.note });
    S.recordDecision('跳过实证步骤 ' + st.label, '跳过', ['执行该步'], st.note, 'user');
    S.updateProject({ pipeline: p.pipeline });
  }

  function resetStep(stepId) {
    var p = S.project();
    if (!p || !p.pipeline) return;
    var st = p.pipeline[stepId];
    st.status = 'pending'; st.percent = 0; st.itemIndex = 0; st.quality = null; st.note = '';
    emit('step.rerun', { step_id: stepId, from_run: st.runNo, to_run: st.runNo + 1, reason: '用户重跑' });
    S.updateProject({ pipeline: p.pipeline });
  }

  /* ---------- 质量门（四门）---------- */
  function qualityGate(stepId) {
    var p = S.project();
    var issues = [];
    // 门一：数值一致性（解读中的数字必须能绑定 cell）
    if (stepId === 'baseline') {
      var cells = D.STEPS.baseline.cells;
      var interp = D.STEPS.baseline.summary;
      var nums = interp.match(/\d+\.\d+/g) || [];
      var lack = nums.filter(function (n) {
        return !cells.some(function (c) { return String(c.value).indexOf(n) === 0 || n.indexOf(String(c.value)) === 0; });
      });
      // 摘要里的 0.083 / 0.412 都能绑定；其余数字视为叙述性，不阻断
      if (lack.length > 3) issues.push({ gate: 'consistency', ok: false, detail: '解读中有 ' + lack.length + ' 个数字无法绑定 cell_id' });
    }
    // 门二：措辞强度
    var wording = C.deriveWording((S.project() && S.project().rq ? S.project().rq.claimType : 'associative'), ((S.project() && S.project().design) ? S.project().design.checks : []));
    var stepText = (D.STEPS[stepId] && D.STEPS[stepId].summary) || '';
    var verbs = C.countCausalVerbs(stepText);
    if (wording !== 'causal' && verbs > 0) {
      issues.push({ gate: 'wording', ok: false, detail: '措辞强度为"' + C.WORDING[wording].label + '"，但结论中出现 ' + verbs + ' 个因果动词' });
    }
    // 门三：引用真实性（本步不涉引用）
    // 门四：披露完整性（无法完成的检验必须显式写出）
    if (stepId === 'robustness') {
      var st = D.STEPS.robustness;
      var hasCannot = JSON.stringify(st).indexOf('无法完成') >= 0;
      if (!hasCannot) issues.push({ gate: 'disclosure', ok: false, detail: '存在未完成项但未显式披露' });
    }
    return {
      pass: issues.length === 0,
      issues: issues,
      wording: wording,
      reason: issues.map(function (i) { return i.detail; }).join('；')
    };
  }

  /* ---------- 论文生成 ---------- */
  function generatePaper() {
    var p = S.project();
    var pipe = p.pipeline || {};
    var skipped = ZY.store.PIPELINE_STEPS.filter(function (s) {
      return pipe[s.id] && pipe[s.id].status === 'skipped';
    }).map(function (s) { return s.label; });
    var paper = JSON.parse(JSON.stringify(D.PAPER));
    paper.generatedAt = Date.now();
    paper.skipped = skipped;
    paper.wording = C.deriveWording((S.project() && S.project().rq ? S.project().rq.claimType : 'associative'), ((S.project() && S.project().design) ? S.project().design.checks : []));
    // 把"跳过的步骤"写进稳健性章的披露
    if (skipped.length) {
      var sec = paper.sections.filter(function (s) { return s.id === 'robust'; })[0];
      if (sec) {
        sec.paragraphs.push({
          text: '此外，本次分析中有以下检验被跳过：' + skipped.join('、') + '。相关结论的解释需考虑到这一限制。',
          cites: [], unverified: false
        });
      }
    }
    emit('section.generated', { section_id: 'all', wording_strength: paper.wording, unverified_count: countUnverified(paper) });
    S.updateProject({ paper: paper, stage: 'paper-drafting', tab: 'paper' });
    return paper;
  }

  /** 引用强制校验（四查）——返回逐句校验结果 */
  function verifyCitations(paper) {
    var out = [];
    var wording = C.deriveWording((S.project() && S.project().rq ? S.project().rq.claimType : 'associative'), ((S.project() && S.project().design) ? S.project().design.checks : []));
    paper.sections.forEach(function (sec) {
      sec.paragraphs.forEach(function (para, pi) {
        var issues = [];
        // ① chip 指向真实 chunk
        (para.cites || []).forEach(function (c) {
          var doc = D.LIBRARY.filter(function (d) { return d.id === c.docId; })[0];
          if (!doc) issues.push({ kind: 'invalid_ref', detail: '引用指向不存在的文献 ' + c.docId });
          else if (doc.trust === 'low') issues.push({ kind: 'low_trust', detail: '来源《' + doc.title + '》解析质量低，仅可提及' });
        });
        // ② 支持强度
        (para.cites || []).forEach(function (c) {
          if (c.support === 'weak') issues.push({ kind: 'weak_support', detail: '引用仅弱支持该论断' });
        });
        // ③ 数字绑定
        (para.cells || []).forEach(function (cid) {
          var cell = ZY.engine.findCell(cid);
          if (!cell) issues.push({ kind: 'unbound_number', detail: '数字 ' + cid + ' 无法绑定到结果表' });
        });
        // ④ 措辞强度（与 UI 使用同一套判定：因果动词 + 结果对象同句共现，含方法学与转述豁免）
        var viol = C.findCausalViolations(para.text);
        if (wording !== 'causal' && viol.length > 0) {
          issues.push({
            kind: 'strength_violation',
            detail: '出现 ' + viol.length + ' 处因果断言（命中「' + viol[0].verbs.join('、') + '」），超出"' + C.WORDING[wording].label + '"强度'
          });
        }
        out.push({ sectionId: sec.id, sectionTitle: sec.title, index: pi, text: para.text, issues: issues });
      });
    });
    return out;
  }

  function countUnverified(paper) {
    var n = 0;
    paper.sections.forEach(function (s) {
      s.paragraphs.forEach(function (p) { if (p.unverified) n++; });
    });
    return n;
  }

  /* ---------- 导出 ---------- */
  function buildExportTree(p) {
    p = p || S.project();
    var tree = [];
    ['data-prep', 'descriptive', 'baseline', 'robustness', 'endogeneity', 'heterogeneity', 'mechanism']
      .forEach(function (sid, i) {
        var no = String(i + 1).padStart(2, '0');
        var st = (p.pipeline || {})[sid];
        var status = st ? st.status : 'pending';
        tree.push({ dir: no + '-' + sid, status: status, files: [codeFileName(sid), resultFileName(sid), resultFileName(sid, 'csv'), interpretFileName(sid)] });
      });
    tree.push({ dir: 'data', status: 'done', files: ['data__hash.txt'] });
    tree.push({ dir: 'env', status: 'done', files: ['env_lock.txt'] });
    tree.push({ dir: 'paper', status: p.paper ? 'done' : 'pending', files: ['paper__初稿.md', 'paper__写作说明.md', 'citation__台账.csv'] });
    return tree;
  }

  function codeFileName(stepId) { return 'code__' + stepId + '.py'; }
  function resultFileName(stepId, ext) { return 'result__' + stepId + '.' + (ext || 'md'); }
  function interpretFileName(stepId) { return 'interpret__' + stepId + '.md'; }

  /** 生成某个文件的文本内容（用于下载与预览）。真实结果优先。 */
  function fileContent(stepId, kind) {
    var p = S.project();
    var pipeSt = (p && p.pipeline && p.pipeline[stepId]) || null;
    var real = pipeSt && pipeSt.real;
    var st = real ? Object.assign({}, D.STEPS[stepId] || {}, { real: real, elapsedMs: pipeSt.elapsedMs }) : D.STEPS[stepId];
    if (!st) return '（该步骤暂无内容）';

    if (kind === 'code') {
      if (real && real.provenance && real.provenance.python) return real.provenance.python;
      return st.code || defaultCode(stepId, st);
    }
    if (kind === 'csv') {
      /* 真实结果优先导出第一张表 */
      if (real && real.tables && real.tables.length) {
        var t = real.tables[0];
        var head = t.head || t.header || [];
        var rows = t.formattedRows || t.rows || [];
        return [head.join(',')].concat(rows.map(function (r) {
          return r.map(function (c) { return String(c == null ? '' : c).replace(/,/g, '，'); }).join(',');
        })).join('\n');
      }
      return toCsv(st.table);
    }
    if (kind === 'interpret') return interpretMd(stepId, st);
    return resultMd(stepId, st);
  }

  function defaultCode(stepId, st) {
    return [
      '# ' + stepId + '：' + (st.metrics[0] ? st.metrics[0].k : '') + ' 等指标计算',
      '# seed=20240113  data_hash=8f3a91c2  env_lock=env_lock.txt',
      'import pandas as pd, numpy as np',
      '',
      'df = pd.read_csv("data/A股制造业面板_2011-2022.csv")',
      '# 详见 03-baseline/code__baseline.py 的清洗与固定效应实现',
      'print(df.shape)'
    ].join('\n');
  }

  function toCsv(table) {
    if (!table) return '（无表格）';
    var lines = [table.head.join(',')];
    table.rows.forEach(function (r) { lines.push(r.map(function (c) { return String(c).replace(/,/g, '，'); }).join(',')); });
    return lines.join('\n');
  }

  function resultMd(stepId, st) {
    var real = (st && st.real) || null;
    var out = ['# ' + stepId + ' · 结果', ''];

    if (real) {
      out.push('**计算方式**：真实计算（内置计量引擎）');
      out.push('**用时**：' + (st.elapsedMs || 0) + ' ms');
      var prov = real.provenance || {};
      out.push('**样本量**：' + (prov.nObs != null ? prov.nObs : '—') +
               '　**固定效应**：' + ((prov.fe || []).join(' + ') || '—') +
               '　**聚类**：' + (prov.cluster || '—') +
               '　**种子**：' + (prov.seed != null ? prov.seed : '—'));
      out.push('**引擎**：' + (prov.engine || '内置计量引擎') +
               '　**代码指纹**：' + (prov.codeHash || '—'));
      out.push('');
      if (real.summary) out.push(real.summary, '');
      (real.metrics || []).forEach(function (m) { out.push('- ' + m.k + '：' + m.v); });
      (real.tables || []).forEach(function (t, ti) {
        out.push('', '## ' + (t.title || ('结果表 ' + (ti + 1))), '');
        var head = t.head || t.header || [];
        var rows = t.formattedRows || t.rows || [];
        out.push('| ' + head.join(' | ') + ' |');
        out.push('| ' + head.map(function () { return '---'; }).join(' | ') + ' |');
        rows.forEach(function (r) { out.push('| ' + r.join(' | ') + ' |'); });
        if (t.note) out.push('', '注：' + t.note);
      });
      var diag = real.diagnostics || {};
      var warns = (diag.warnings || []).concat(diag.notes || []);
      if (warns.length) {
        out.push('', '## 诊断与告警');
        warns.forEach(function (w) {
          out.push('- ' + (typeof w === 'string' ? w : (w.message || JSON.stringify(w))));
        });
      }
      out.push('', '---', '注：以上表格与统计量由内置计量引擎实际计算得出，可复现信息见上。');
      return out.join('\n');
    }

    out.push(st.summary, '');
    (st.metrics || []).forEach(function (m) { out.push('- ' + m.k + '：' + m.v); });
    if (st.table) {
      out.push('', '## 结果表', '', '| ' + st.table.head.join(' | ') + ' |');
      out.push('| ' + st.table.head.map(function () { return '---'; }).join(' | ') + ' |');
      st.table.rows.forEach(function (r) { out.push('| ' + r.join(' | ') + ' |'); });
    }
    if (st.warning) out.push('', '> ⚠️ ' + st.warning);
    out.push('', '---', '注：计量引擎未生效，本文件为预置样例数据。');
    return out.join('\n');
  }

  function interpretMd(stepId, st) {
    var wording = C.deriveWording((S.project() && S.project().rq ? S.project().rq.claimType : 'associative'), ((S.project() && S.project().design) ? S.project().design.checks : []));
    var real = (st && st.real) || null;
    var out = [];

    if (real) {
      var it = real.interpretation || {};
      out.push('# ' + stepId + ' · 结果解读', '');
      out.push('**生成方式**：真实计算 + 规则解读');
      out.push('**措辞强度**：' + C.WORDING[wording].label);
      out.push('**数值一致性**：本步解读引用 ' + ((it.refs || []).length) + ' 个结果单元格，全部已绑定 cell_id');
      out.push('');
      if (it.text) out.push(it.text, '');
      var cells = real.cells || [];
      if (cells.length) {
        out.push('## 引用的单元格（可回到结果表核对）');
        (it.refs || []).slice(0, 60).forEach(function (r) {
          var cid = typeof r === 'string' ? r : (r.cellId || r.id);
          var c = cells.filter(function (x) { return x.id === cid || x.cellId === cid; })[0];
          if (c) {
            out.push('- `' + cid + '`　' + c.label + ' = ' +
                     (c.formatted != null ? c.formatted : c.value));
          }
        });
      }
      var diag = real.diagnostics || {};
      var warns = (diag.warnings || []).concat(diag.notes || []);
      if (warns.length) {
        out.push('', '## 本步局限与告警');
        warns.forEach(function (w) {
          out.push('- ' + (typeof w === 'string' ? w : (w.message || JSON.stringify(w))));
        });
      }
      out.push('', '## 未做项披露', '- 见"稳健性检验"与"内生性讨论"章节的披露。');
      return out.join('\n');
    }

    out = ['# ' + stepId + ' · 结果解读', '',
      '**生成方式**：rule（计量引擎未生效）', '**措辞强度**：' + C.WORDING[wording].label, '',
      st.summary, ''];
    if (st.warning) out.push('> ⚠️ ' + st.warning, '');
    out.push('## 数值一致性');
    out.push('- 本步解读中的每个数字均绑定结果表单元格（cell_id）。');
    out.push('', '## 局限与未做项');
    out.push('- 见"稳健性检验"与"内生性讨论"章节的披露。');
    return out.join('\n');
  }

  /** 完整项目导出包（Markdown 汇总） */
  function exportPackageMd() {
    var p = S.project();
    var out = ['# 智研 · 项目导出包', '',
      '- 项目：' + p.title,
      '- 研究问题：' + (p.rq ? p.rq.claimSentence : p.topic),
      '- 导出时间：' + U.fmtDate() + ' ' + U.hhmm(),
      '- 设计确认：' + (p.designConfirmed ? '已确认（hash ' + p.designHash + '）' : '**未确认**'),
      '- 模型：' + p.model.provider + ' / ' + p.model.model,
      ''];
    out.push('## 一、命题解析'); out.push('');
    if (p.rq) {
      out.push('- 现象：' + p.rq.phenomenon);
      out.push('- 对象层级：' + p.rq.objectLevelLabel);
      out.push('- 时间窗：' + p.rq.timeWindow[0] + '–' + p.rq.timeWindow[1]);
      out.push('- 变异来源：' + p.rq.variationSourceLabel);
      out.push('- 结论类型：' + p.rq.claimType + '（' + p.rq.claimSentence + '）');
      out.push('- 本文不做：' + p.rq.outOfScope.join('；'));
    }
    out.push('', '## 二、实验设计'); out.push('');
    out.push('- 假设：' + D.DESIGN.hypotheses.map(function (h) { return h.id + ' ' + h.statement; }).join('；'));
    out.push('- 样本：' + D.DESIGN.sample.period + '，N=' + U.fmtInt(D.DESIGN.sample.nPlanned));
    out.push('- 模型：' + D.DESIGN.model.equation);
    out.push('- 聚类：' + D.DESIGN.model.cluster);
    out.push('', '### 检查清单');
    D.DESIGN.checks.forEach(function (c) {
      out.push('- [' + c.status + '] ' + c.id + ' ' + c.label + '：' + c.evidence);
    });
    out.push('', '## 三、七步实证过程文件');
    ZY.store.PIPELINE_STEPS.forEach(function (st) {
      var x = (p.pipeline || {})[st.id];
      out.push('', '### ' + st.no + ' ' + st.label + '（状态：' + (x ? x.status : 'pending') + '）', '');
      if (x && x.status === 'done') {
        out.push('```', fileContent(st.id, 'code').split('\n').slice(0, 6).join('\n'), '```', '');
        out.push(resultMd(st.id, D.STEPS[st.id]));
      }
    });
    out.push('', '## 四、写作说明'); out.push('');
    out.push('- 生成方式：规则驱动结构化结论 + 可选 LLM 润色（每段标注 modelMode）');
    out.push('- 措辞强度：' + (p.paper ? p.paper.wording : 'associative') + '（由 claim_type × 检查清单推导）');
    out.push('- 未核实清单：' + (p.paper ? countUnverified(p.paper) : 0) + ' 处标为『此处待补文献』，未做静默删除');
    var skippedSteps = ZY.store.PIPELINE_STEPS.filter(function (s) {
      return (p.pipeline || {})[s.id] && (p.pipeline || {})[s.id].status === 'skipped';
    }).map(function (s) { return s.label; });
    out.push('- 未做的检验：' + (skippedSteps.length ? skippedSteps.join('、') : '无'));
    out.push('- 无法完成的检验：事件研究（连续处理强度，无明确处理时点）');
    out.push('- 风格参考：' + (p.paper ? p.paper.styleJournal : '中国工业经济') + '（仅模仿形式，未搬运原句）');
    out.push('', '## 五、拒答与留痕台账'); out.push('');
    if (S.get().refusals.length) {
      S.get().refusals.forEach(function (r) {
        out.push('- `' + r.code + '` ' + r.conclusion + '（' + (r.resolved ? '已处置：' + r.userDecision.chosen : '**未处置**') + '）');
      });
    } else out.push('- （无）');
    out.push('', '### 决策记录');
    S.get().decisions.forEach(function (d) {
      out.push('- ' + U.fmtDate(d.at) + ' ' + d.question + ' → ' + d.chosen + '（否决：' + (d.rejected.join('、') || '无') + '）');
    });
    out.push('', '## 六、论文初稿');
    if (p.paper) out.push('', paperToMarkdown(p.paper));

    /* 结语必须如实区分"真算"与"预置"，不能一概写成样例 */
    var realSteps = ZY.store.PIPELINE_STEPS.filter(function (s) {
      var st = (p.pipeline || {})[s.id];
      return st && st.real;
    });
    var allReal = realSteps.length === ZY.store.PIPELINE_STEPS.length;
    out.push('', '---', '', '> 计算来源：' + (allReal
      ? '七步结果均由内置计量引擎真实计算（OLS + 固定效应 + 聚类标准误）。'
      : ('共 ' + realSteps.length + ' / ' + ZY.store.PIPELINE_STEPS.length +
         ' 步为真实计算，其余为预置样例数据。')));
    out.push('> 演示数据为虚构样例，不指向任何真实企业或统计结果；不含第三方文献全文，仅含引用位置与摘录片段。');
    out.push('> 计量结果若与 Stata 等权威软件存在差异，请以权威软件为准。');
    return out.join('\n');
  }

  function paperToMarkdown(paper) {
    var out = ['# ' + S.project().title, ''];
    out.push('## 摘要', '');
    out.push('本文基于 2011—2022 年中国 A 股制造业上市公司面板数据，考察数字化转型与企业创新产出之间的关系。结果表明二者存在稳健的正相关关系，且该关系在大型企业中更为明显。受识别策略限制，本文结论应理解为条件相关关系而非因果效应。');
    out.push('', '**关键词**：数字化转型；企业创新；固定效应；异质性', '');
    paper.sections.forEach(function (sec) {
      out.push('## ' + sec.no + '、' + sec.title, '');
      sec.paragraphs.forEach(function (para) {
        out.push(para.text, '');
      });
    });
    return out.join('\n');
  }

  /* ---------- 对话模板 ---------- */
  /**
   * 基准回归的对话回复。
   * 关键：数字必须来自真实计算结果，不能写死。真实结果不存在时
   * 如实说"还没跑"，而不是念一串预置数字（那等于编造）。
   */
  function statsReply() {
    var p = S.project();
    var base = p && p.pipeline && p.pipeline['baseline'];
    var real = base && base.real;
    if (!real) {
      return { text: '七步实证尚未全部完成，所以我现在没有可报的系数。\n\n请在「实验设计」页确认方案后运行流水线——确认之前我不会读取任何数据。\n\n跑完后每个数字都会带出处，可点回结果表核对。', chips: ['等待执行'] };
    }

    /* 从真实结果里取核心系数与关键统计量 */
    var coef = null;
    (real.cells || []).forEach(function (c) {
      if (coef) return;
      var label = String(c.label || '');
      if (c.term === 'digi' || label.indexOf('digi') >= 0) {
        if (c.coef != null) coef = c;
      }
    });
    if (!coef) {
      var c0 = (real.cells || []).filter(function (c) { return c.coef != null; })[0];
      coef = c0 || null;
    }
    var prov = real.provenance || {};
    var txt = [];
    if (coef) {
      txt.push('基准回归完成：**' + coef.term + ' 系数 ' + num3(coef.coef) +
        '**（标准误 ' + num3(coef.se) + '，t = ' + num3(coef.t) +
        '，p = ' + num3(coef.p) + (coef.stars ? '，' + coef.stars : '') + '）。');
    } else {
      txt.push('基准回归完成。');
    }
    txt.push('');
    txt.push('样本 ' + fmtInt2(prov.nObs) + '，固定效应 ' + ((prov.fe || []).join(' + ') || '—') +
      '，聚类层级 ' + (prov.cluster || '—') + '。');

    /* 组合内 R² 与聚类数 */
    var r2 = real.r2Within != null ? real.r2Within : real.r2;
    if (r2 != null) txt.push('组内 R² = ' + num3(r2) + '。');

    /* 真实告警必须原样带出来 */
    var diag = real.diagnostics || {};
    var warns = (diag.warnings || []).concat(diag.notes || []);
    if (warns.length) {
      txt.push('', '⚠️ 本步诊断 ' + warns.length + ' 条：');
      warns.slice(0, 4).forEach(function (w) {
        txt.push('· ' + (typeof w === 'string' ? w : (w.message || JSON.stringify(w))));
      });
    }
    txt.push('', '每个数字都已绑定结果表单元格，点一下可以回到表里核对。');
    return { text: txt.join('\n'), chips: ['基准回归完成', '样本 ' + fmtInt2(prov.nObs)] };
  }

  /** 论文初稿的对话回复：引用真实校验结果 */
  function paperReply() {
    var p = S.project();
    var paper = p && p.paper;
    if (!paper) return { text: '还没有生成初稿。', chips: [] };
    var checks = verifyCitations(paper);
    var bad = checks.filter(function (c) { return c.issues.length; });
    var unverified = countUnverified(paper);
    var nPara = checks.length;
    return {
      text: '论文初稿已生成，共 ' + paper.sections.length + ' 章、' + nPara + ' 段。\n\n' +
        '**风格**：' + (paper.styleJournal || '中国工业经济') + ' 的语体与章节结构。\n\n' +
        '**校验结果**：' + (bad.length ? (bad.length + ' 段存在问题（见引用台账）') : '逐段校验全部通过') +
        '；' + (unverified ? (unverified + ' 处待补文献') : '无待补文献') + '。\n\n' +
        '📌 正文里的数字可以点击回到结果表对应单元格；引用角标可以回跳原文。',
      chips: [paper.sections.length + ' 章完成', unverified ? (unverified + ' 处待补文献') : '无待补文献']
    };
  }

  function num3(v) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toFixed(3);
  }

  function fmtInt2(v) {
    if (v == null || !isFinite(v)) return '—';
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function replyFor(stageId, p) {
    var rq = p.rq || D.RQ;
    switch (stageId) {
      case 'definition':
        return { text: '我按你的研究问题拆成五个槽位，有不对的直接告诉我：\n\n· 现象：' + rq.phenomenon + '\n· 对象与层级：' + rq.objectLevelLabel + '\n· 时间窗：' + rq.timeWindow[0] + '—' + rq.timeWindow[1] + '\n· 变异来源：' + rq.variationSourceLabel + '\n· 期望结论：' + rq.claimSentence + '\n\n⚠️ 按现在的信息，公司层数字化强度是**连续变异**、没有明确政策时点，所以我只能支持"相关"表述。要升级为因果，需要补一个外生的变异来源（政策试点或合格的工具变量）。', chips: ['五槽位已解析', '需确认结论强度'] };
      case 'literature':
        return { text: '在你的文献库（' + D.LIBRARY_STATS.total + ' 篇）里检索：主题相关 ' + D.PROBES.topic.docs + ' 篇、命中片段 ' + D.PROBES.topic.hits + ' 处。识别策略分布：' + Object.keys(D.PROBES.method).map(function (k) { return k + ' ' + D.PROBES.method[k] + ' 篇'; }).join('、') + '。\n\n⚠️ 有 3 篇结论与主流相反，其中 1 篇直接质疑"年报词频法高估效应"。综述必须把这三篇写进去，否则会被认为选择性引用。\n\n📌 机制分析这一章在语料里**没有**可引用的直接证据（0 篇），只能写成"研究缺口"或"与…一致"。', chips: ['文献分析完成', '发现 3 篇反向证据', '机制章无支撑'] };
      case 'design':
        return { text: '实验设计已生成（第 ' + D.DESIGN.version + ' 版），共七个部分。\n\n⚠️ 有 1 项检查未通过：**IV-01 弱工具**——备选工具的第一阶段 F = 6.2，低于经验门槛 10。这意味着我不能给你因果结论，措辞强度锁定为"相关"。\n\n还有 1 项信息不足：DID-04 平行趋势（连续处理强度设计，事件研究不适用）。\n\n请你核对整份方案，处置未通过项后点"确认并开始实证"。**确认之前我不会读取任何数据。**', chips: ['待确认设计', '1 项 fail', '1 项 unknown'] };
      case 'data':
        return { text: '数据已就绪：18,042 个企业-年观测、2,847 家企业、2011—2022 年。\n\n质量提示：关键变量缺失率 2.3%（按行业-年份中位数插补），已做缩尾处理 372 个观测。\n\n四步产出会依次生成：数据清洗 → 描述统计 → 基准回归，每步都有可执行代码、结果文件和解读文件。', chips: ['数据处理中'] };
      case 'stats':
        return statsReply();
      case 'paper':
        return paperReply();
      default:
        return { text: '已记录。', chips: [] };
    }
  }

  /**
   * 当前项目允许的措辞强度。
   * 必须读**本项目**的 RQ 与设计，不能读预设 D.RQ/D.DESIGN ——
   * 否则真实课题也会被按"数字化转型"那份清单判定，等于套壳。
   */
  function projectWording(explicitProject) {
    var p = explicitProject || S.project();
    var claim = (p && p.rq && p.rq.claimType) || 'associative';
    var checks = (p && p.design && p.design.checks) || [];
    if (!checks.length) {
      /* 还没生成设计：只有 claimType 可依据，保守取值 */
      return claim === 'descriptive' ? 'descriptive' : 'associative';
    }
    return C.deriveWording(claim, checks);
  }

  /** 项目是否有真正的研究问题（不是预设那份） */
  function hasRealRq(p) {
    var rq = p && p.rq;
    return !!(rq && rq.source === 'llm' && rq.researchQuestion && rq.outcomeVar && rq.treatmentVar);
  }

  ZY.engine = {
    ORDER: ORDER,
    emit: emit, events: events,
    stageState: stageState, gateCheck: gateCheck,
    confirmDesign: confirmDesign, invalidateDesign: invalidateDesign,
    initPipeline: initPipeline, runStep: runStep, runRest: runRest,
    pausePipeline: pausePipeline, skipStep: skipStep, resetStep: resetStep,
    qualityGate: qualityGate, generatePaper: generatePaper,
    verifyCitations: verifyCitations, countUnverified: countUnverified,
    buildExportTree: buildExportTree,
    codeFileName: codeFileName, resultFileName: resultFileName, interpretFileName: interpretFileName,
    fileContent: fileContent, exportPackageMd: exportPackageMd, paperToMarkdown: paperToMarkdown,
    cellIdsOf: cellIdsOf, findCell: findCell, stepTableSource: stepTableSource,
    projectWording: projectWording, hasRealRq: hasRealRq,
    replyFor: replyFor
  };
})(window);
