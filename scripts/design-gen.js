/* ============================================================
   智研 · 实验设计的结构化生成

   与 rq.js 同样的理由：以前"生成实验设计"= 复制 D.DESIGN，
   于是任何课题的设计都是"数字化转型 / digi / 双向固定效应"。

   现在：设计必须由模型基于**该项目的 RQ**生成，再经本地校验
   （必须有变量、必须有模型式、必须有检查清单）。
   生成不出来就如实报错并让用户补信息，不拿预设顶上。
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};

  /** 生成设计的提示词 */
  function buildPrompt(rq, ctx) {
    ctx = ctx || {};
    var lines = [
      '你是经管实证研究的设计助手。请基于下面这个已经确定的研究问题，给出一份可执行的实验设计。',
      '',
      '研究问题：' + (rq.researchQuestion || '（未提供）'),
      '现象：' + (rq.phenomenon || '（未提供）'),
      '对象与层级：' + (rq.objectLevel || '（未提供）'),
      '时间窗：' + (rq.timeWindow ? (rq.timeWindow[0] + '—' + rq.timeWindow[1]) : '（未提供）'),
      '变异来源：' + (rq.variationSource || '（未提供）'),
      '结论类型：' + (rq.claimType || 'associative'),
      '被解释变量：' + (rq.outcomeVar || '（未提供）'),
      '核心解释变量：' + (rq.treatmentVar || '（未提供）'),
      '',
      '只输出一个 JSON 对象，不要解释文字，不要 markdown 围栏：',
      '{',
      '  "hypotheses": [{"id":"H1","statement":"假设陈述","direction":"+ 或 -","mechanism":"机制","outcomeVar":"变量名"}],',
      '  "sample": {"source":"数据来源","obsLevel":"观测层级","period":"样本期",',
      '             "nPlanned":数字或null,"nUnits":数字或null,"filter":"筛选条件","missingHandling":"缺失处理"},',
      '  "variables": [{"name":"变量英文名","role":"因变量|自变量|控制变量|固定效应|聚类",',
      '                 "construction":"变量度量：具体怎么算","why":"为什么用这个度量，不用别的",',
      '                 "source":"数据字段","missing":"缺失处理","sign":"预期符号","lit":"参考文献 id 或 作者(年)"}],',
      '  "model": {"equation":"计量模型式，用 LaTeX 风格","feTerms":["固定效应项"],',
      '            "cluster":"聚类层级","clusterNote":"为什么这样聚类","weights":"权重","estimator":"估计方法"},',
      '  "blocks": [{"id":"见下方固定 id 列表","title":"中文小标题","data":"采用的数据（具体到文件/表/字段）",',
      '              "why":"为什么这样选：这段设计的理由","items":["具体做法1","具体做法2"],',
      '              "refs":["这条设计依据的参考文献"]}],',
      '  "checks": [{"id":"CHK-01","label":"检查项名称","status":"pass|fail|unknown",',
      '              "evidence":"判定依据","need":"若为 fail/unknown，需要用户补什么"}],',
      '  "expected": {"sign":"预期符号","magnitude":"预期量级","significance":"预期显著性","fallback":"不符时的预案"},',
      '  "pipeline": [{"stepId":"data-prep","items":["该步要做的事"]}],',
      '  "identifierStrategy": "一句话说明识别策略"',
      '}',
      '',
      'blocks 必须**恰好包含下面 7 个 id，一个都不能少、顺序照抄**：',
      '  1. "data-prep"       数据处理',
      '  2. "window"          基础回归数据区间选择（为什么从这个年份开始、到那个年份结束）',
      '  3. "scope"           研究样本范围（行业/市场/剔除规则/观测层级）',
      '  4. "variables"       变量度量（因变量、自变量、控制变量）',
      '  5. "robustness"      稳健性设计方案',
      '  6. "heterogeneity"   异质性设计方案',
      '  7. "mechanism"       机制设计',
      '',
      '硬性要求：',
      '1. 变量表必须包含研究问题里的被解释变量与核心解释变量，名字要与上面一致。',
      '   每个变量都要给 construction（怎么度量）与 why（为什么用这个度量）。',
      '2. **每个 block 的 data 与 why 都不能空**：data 写清这份设计用的是哪份数据/哪些字段，',
      '   why 写清为什么这样选（而不是别的窗口、别的样本、别的度量）。',
      '3. 第 5/6/7 块（稳健性、异质性、机制）的 refs 必须给出这类设计通常依据的文献；',
      '   变量块的 refs 给出变量度量的文献来源。**不要编造不存在的文献**——',
      '   只能用研究问题里给出的文献，或写"待补文献"。',
      '4. 检查清单必须逐项独立判断，**不许全部写 pass**。常见检查项包括：',
      '   核心解释变量的变异是否外生、是否存在反向因果、样本选择偏误、',
      '   测量误差、遗漏变量、共同趋势、弱工具变量。',
      '5. 如果某项检查你不确定，写 unknown 并在 need 里写清需要用户补什么；',
      '   如果判定不通过，写 fail 并说明理由。**把问题暴露出来比给一个漂亮的假设计重要。**',
      '6. 结论类型是 associative 时，模型式与检查清单里不要出现因果识别策略；',
      '   是 causal 时必须有明确的外生识别策略。',
      '7. 不要编造学生没提供的具体数据量；nPlanned / nUnits 不确定就写 null。'
    ];
    if (ctx.datasetHint) {
      lines.push('');
      lines.push('用户已导入的数据：' + ctx.datasetHint);
    }
    if (ctx.dataCatalog) {
      lines.push('');
      lines.push('**可用的真实数据**（来自用户本机的数据目录，文件名与字段名都是真的）：');
      lines.push(ctx.dataCatalog);
      lines.push('');
      lines.push('关于数据的硬性要求：');
      lines.push('8. 每个 block 的 data 必须写**上面目录里真实存在的文件名**，不要自己编文件名；');
      lines.push('   变量的 source 必须写目录里真实存在的字段名。写不出来就说明"该数据里没有可用字段"，不要硬编。');
      lines.push('9. 变量的 missing 处理要说清是删样本还是插补；插补要说按什么分组插补。');
      if (ctx.pinnedDataset) {
        lines.push('10. 用户已经**选定**了数据文件：' + ctx.pinnedDataset + '。');
        lines.push('    data 与 source 都从这个文件里取；这个文件里没有的变量，要么换一种度量方式，');
        lines.push('    要么在 need 里写明"需要补哪份数据"，不要假装它在这个文件里。');
      }
    }
    return lines.join('\n');
  }

  var CHECK_STATUSES = ['pass', 'fail', 'unknown'];

  /* 实验设计必须齐备的七个组成部分（与 stages/design.js 的 BLOCK_ORDER 一致） */
  var BLOCK_KEYS = [
    { id: 'data-prep', no: '①', title: '数据处理' },
    { id: 'window', no: '②', title: '基础回归数据区间选择' },
    { id: 'scope', no: '③', title: '研究样本范围' },
    { id: 'variables', no: '④', title: '变量度量（因变量 / 自变量 / 控制变量）' },
    { id: 'robustness', no: '⑤', title: '稳健性设计方案' },
    { id: 'heterogeneity', no: '⑥', title: '异质性设计方案' },
    { id: 'mechanism', no: '⑦', title: '机制设计' }
  ];

  function str(v) { return v == null ? null : (String(v).trim() || null); }
  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function arr(v) { return Array.isArray(v) ? v : (v ? [v] : []); }

  /**
   * 校验并归一化模型给出的设计。
   * 失败时返回 errors，调用方**不得**退回预设设计。
   */
  function normalize(raw, rq) {
    var errors = [], warnings = [];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, design: null, errors: ['模型没有返回结构化的实验设计'], warnings: [] };
    }

    /* ---- 假设 ---- */
    var hypotheses = arr(raw.hypotheses).map(function (h, i) {
      if (typeof h === 'string') return { id: 'H' + (i + 1), statement: h, direction: '', mechanism: '', outcomeVar: '' };
      return {
        id: str(h.id) || ('H' + (i + 1)),
        statement: str(h.statement) || str(h.text) || null,
        direction: str(h.direction) || '',
        mechanism: str(h.mechanism) || '',
        outcomeVar: str(h.outcomeVar) || (rq && rq.outcomeVar) || ''
      };
    }).filter(function (h) { return h.statement; });

    /* ---- 样本 ---- */
    var s = raw.sample || {};
    var sample = {
      source: str(s.source) || null,
      obsLevel: str(s.obsLevel) || (rq && rq.objectLevel) || null,
      period: str(s.period) || (rq && rq.timeWindow ? (rq.timeWindow[0] + '—' + rq.timeWindow[1]) : null),
      nPlanned: num(s.nPlanned),
      nUnits: num(s.nUnits),
      filter: str(s.filter) || '',
      missingHandling: str(s.missingHandling) || ''
    };

    /* ---- 变量 ---- */
    var variables = arr(raw.variables).map(function (v) {
      if (typeof v === 'string') return { name: v, role: '', construction: '', why: '', source: '', missing: '', sign: '', lit: '' };
      return {
        name: str(v.name) || str(v.var) || null,
        role: str(v.role) || '',
        construction: str(v.construction) || '',
        why: str(v.why) || str(v.reason) || '',
        source: str(v.source) || '',
        missing: str(v.missing) || '',
        sign: str(v.sign) || '',
        lit: str(v.lit) || ''
      };
    }).filter(function (v) { return v.name; });

    /* ---- 设计的七个组成部分 ----
       这是本轮新增的硬要求：数据处理 / 区间选择 / 样本范围 / 变量度量 /
       稳健性 / 异质性 / 机制。每一块都必须给出「采用的数据」与「选择理由」，
       缺一块就报错，不拿预设或旧字段顶上。 */
    var blocksById = {};
    arr(raw.blocks).forEach(function (b) {
      if (!b) return;
      var id = str(b.id || b.key || b.stepId);
      if (!id) return;
      blocksById[id] = {
        id: id,
        title: str(b.title) || '',
        data: str(b.data) || str(b.dataset) || '',
        why: str(b.why) || str(b.reason) || str(b.rationale) || '',
        items: arr(b.items).map(str).filter(Boolean),
        refs: arr(b.refs).map(str).filter(Boolean)
      };
    });
    var blocks = BLOCK_KEYS.map(function (k) {
      var b = blocksById[k.id] || { id: k.id, title: '', data: '', why: '', items: [], refs: [] };
      return {
        id: k.id,
        title: b.title || k.title,
        data: b.data,
        why: b.why,
        items: b.items,
        refs: b.refs
      };
    });
    var missingBlocks = [], thinBlocks = [];
    BLOCK_KEYS.forEach(function (k, i) {
      var b = blocks[i];
      if (!blocksById[k.id]) { missingBlocks.push(k.no + ' ' + k.title); return; }
      if (!b.data || !b.why) {
        thinBlocks.push(k.title + '（缺' + (!b.data ? '采用的数据' : '') +
          (!b.data && !b.why ? '、' : '') + (!b.why ? '选择理由' : '') + '）');
      }
    });
    var blocksWithoutRefs = blocks.filter(function (b) {
      return ['robustness', 'heterogeneity', 'mechanism'].indexOf(b.id) >= 0 && !b.refs.length;
    }).map(function (b) { return b.title; });
    var varsWithoutWhy = variables.filter(function (v) { return v.name && !v.why; });

    /* ---- 模型 ---- */
    var m = raw.model || {};
    var model = {
      equation: str(m.equation) || null,
      feTerms: arr(m.feTerms).map(str).filter(Boolean),
      cluster: str(m.cluster) || null,
      clusterNote: str(m.clusterNote) || '',
      weights: str(m.weights) || '无',
      estimator: str(m.estimator) || 'OLS'
    };

    /* ---- 检查清单 ---- */
    var checks = arr(raw.checks).map(function (c, i) {
      var status = String(c.status || '').toLowerCase().trim();
      if (CHECK_STATUSES.indexOf(status) < 0) status = 'unknown';   /* 非枚举值一律视为 unknown */
      return {
        id: str(c.id) || ('CHK-' + String(i + 1).padStart(2, '0')),
        label: str(c.label) || str(c.name) || '未命名检查项',
        status: status,
        evidence: str(c.evidence) || '',
        need: str(c.need) || '',
        disposed: false
      };
    });

    /* ---- 预期结果 ---- */
    var e = raw.expected || {};
    var expected = {
      sign: str(e.sign) || '',
      magnitude: str(e.magnitude) || '',
      significance: str(e.significance) || '',
      fallback: str(e.fallback) || ''
    };

    /* ---- 校验：结构必须完整才允许往下走 ---- */
    if (!variables.length) {
      errors.push('设计里没有任何变量定义，无法执行实证。');
    }

    /* 被解释变量与核心解释变量必须能在变量表里对上号。
       判据分两层（避免两个方向的误判）：
         1) 先按名字匹配；
         2) 名字对不上时看角色变量 —— 但如果"研究问题里的变量名"根本不
            出现在设计的任何文本里，那才判定为串到了别的课题。
       为什么要第二层：模型常把中文变量写成短英文名（最低工资标准 → minwage），
       仅凭名字不等就报错会把正常设计误杀。 */
    if (rq) {
      var designText = JSON.stringify({
        v: variables, m: model, h: hypotheses, s: sample
      }).toLowerCase();
      function lower(x) { return String(x == null ? '' : x).toLowerCase().trim(); }
      function findByName(target) {
        var t = lower(target);
        if (!t) return null;
        var hit = variables.filter(function (v) {
          var n = lower(v.name);
          return n === t || n.indexOf(t) >= 0 || t.indexOf(n) >= 0;
        });
        return hit.length ? hit[0] : null;
      }
      function findByRole(re) {
        var hit = variables.filter(function (v) { return re.test(v.role || ''); });
        return hit.length ? hit[0] : null;
      }
      /* 研究问题里的变量名（或其英文形态）是否出现在设计文本里 */
      function mentioned(target) {
        var t = lower(target);
        if (!t) return true;
        if (designText.indexOf(t) >= 0) return true;
        /* 去掉中文修饰词后取核心词再试一次，例如"最低工资标准" → "最低工资" */
        var core = t.replace(/[的了吗呢]|标准|水平|程度|指标|变量|数据/g, '');
        if (core && core.length >= 2 && designText.indexOf(core) >= 0) return true;
        return false;
      }

      if (rq.outcomeVar) {
        var byNameO = findByName(rq.outcomeVar);
        var byRoleO = findByRole(/被解释|因变量|outcome|dependent/i);
        if (!byNameO && !byRoleO) {
          errors.push('变量表里找不到研究问题中的被解释变量「' + rq.outcomeVar + '」。');
        } else if (!byNameO && byRoleO && !mentioned(rq.outcomeVar)) {
          errors.push('设计的被解释变量是「' + byRoleO.name + '」，而研究问题里说的「' +
                      rq.outcomeVar + '」在整份设计里都没有出现——设计可能串到了别的课题。');
        }
      }

      if (rq.treatmentVar) {
        var byNameT = findByName(rq.treatmentVar);
        var byRoleT = findByRole(/核心解释|自变量|处理|treatment|关键/i);
        if (!byNameT && !byRoleT) {
          errors.push('变量表里找不到研究问题中的核心解释变量「' + rq.treatmentVar + '」。');
        } else if (!byNameT && byRoleT && !mentioned(rq.treatmentVar)) {
          errors.push('设计的核心解释变量是「' + byRoleT.name + '」，而研究问题里说的「' +
                      rq.treatmentVar + '」在整份设计里都没有出现——设计可能串到了别的课题。');
        }
      }
    }
    if (!model.equation) errors.push('没有给出计量模型式，无法生成可执行代码。');
    if (!checks.length) {
      errors.push('没有给出识别策略检查清单。清单是"能不能给因果结论"的依据，不能为空。');
    }

    /* 七个组成部分必须齐备，且每一块都要有「采用的数据」与「选择理由」。
       缺了就报错让人补 —— 不拿预设或旧字段顶上，那样等于假装设计是完整的。 */
    if (missingBlocks.length) {
      errors.push('实验设计缺少必要的组成部分：' + missingBlocks.join('、') +
        '。一份可执行的实验设计必须同时交代数据处理、数据区间、样本范围、变量度量、' +
        '稳健性、异质性与机制设计。');
    }
    if (thinBlocks.length) {
      errors.push('这些组成部分没有交代清楚：' + thinBlocks.join('、') +
        '。每一部分都要写明「采用的数据」和「为什么这样选」。');
    }
    if (blocksWithoutRefs.length) {
      warnings.push('这些部分没有给参考文献：' + blocksWithoutRefs.join('、') +
        '。没有文献依据的设计容易被审稿人质疑，建议补上。');
    }
    if (varsWithoutWhy.length) {
      warnings.push('这些变量只写了怎么算、没写为什么这样度量：' +
        varsWithoutWhy.map(function (v) { return v.name; }).join('、') + '。');
    }

    /* 保守：associative 不允许出现因果词 */
    if (rq && rq.claimType !== 'causal' && model.equation) {
      var causalish = /(\bIV\b|工具变量|2SLS|双重差分|DID|断点回归|RDD|平行趋势)/;
      if (causalish.test(model.equation)) {
        warnings.push('结论类型是「相关」，但模型式里出现了因果识别方法（' +
                      model.equation + '）。已保留你的设定，但措辞强度仍是「相关」——' +
                      '要用因果表述，请先把结论类型改成「因果」并补充识别依据。');
      }
    }

    /* 全部 pass 是可疑信号，明确提示 */
    if (checks.length >= 4 && checks.every(function (c) { return c.status === 'pass'; })) {
      warnings.push('检查清单全部通过。实证设计极少完全没有风险，' +
                    '请人工复核这几项：' + checks.map(function (c) { return c.label; }).join('、') + '。');
    }

    var design = {
      version: 1,
      source: 'llm',
      generatedAt: Date.now(),
      hypotheses: hypotheses,
      sample: sample,
      variables: variables,
      model: model,
      blocks: blocks,
      checks: checks,
      expected: expected,
      pipeline: arr(raw.pipeline),
      identifierStrategy: str(raw.identifierStrategy) || '',
      raw: raw
    };

    return { ok: errors.length === 0, design: design, errors: errors, warnings: warnings };
  }

  /** 依据检查清单推导允许的措辞强度（与 checklist.deriveWording 一致的口径） */
  function wordingOf(design, claimType) {
    if (!design) return 'associative';
    var hasFail = design.checks.some(function (c) { return c.status === 'fail'; });
    var hasUnknown = design.checks.some(function (c) { return c.status === 'unknown'; });
    var hasCausalEvidence = design.checks.some(function (c) {
      return c.status === 'pass' && /外生|工具变量|双重差分|断点|随机|政策|识别/i.test(c.label + ' ' + c.evidence);
    });
    if (claimType === 'causal' && !hasFail && !hasUnknown && hasCausalEvidence) return 'causal';
    if (claimType === 'descriptive') return 'descriptive';
    return 'associative';
  }

  ZY.designGen = {
    buildPrompt: buildPrompt, normalize: normalize, wordingOf: wordingOf
  };
})(window);
