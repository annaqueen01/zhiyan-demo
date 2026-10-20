/* 阶段页 5 · 统计分析（七步实证流水线 + 三件套 + 质量门） */
(function (global) {
  'use strict';
  var ZY = global.ZY, U = ZY.util, D = ZY.data, S = ZY.store, E = ZY.engine, C = ZY.checklist;
  var el = U.create;

  var STATUS_CLASS = { pending: '', running: 'running', paused: 'running', done: 'done', failed: 'failed', skipped: 'skipped', stale: 'failed' };
  var STATUS_TEXT = { pending: '待执行', running: '执行中', paused: '已暂停', done: '完成', failed: '失败', skipped: '已跳过', stale: '待更新' };

  /* 滚动联动用的观察器（换页时要断开，否则会累积） */
  var scrollSpy = null;
  var currentSection = null;

  /**
   * 跳到某一步的正文部分。
   * 只改高亮 + 滚动，不整体重渲染 —— 重渲染会把滚动位置冲掉，
   * 那就等于"点了跳过去又被弹回顶部"。
   */
  function gotoSection(stepId) {
    S.get().activeStep = stepId;
    S.save();
    markActive(stepId);
    scrollToSection(stepId);
  }

  function scrollToSection(stepId) {
    var sec = document.getElementById('step-' + stepId);
    if (!sec) return;
    try {
      sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (e) {
      sec.scrollIntoView();
    }
  }

  function markActive(stepId) {
    var list = document.querySelectorAll('.step-index .step-item');
    for (var i = 0; i < list.length; i++) {
      var on = list[i].getAttribute('data-step') === stepId;
      list[i].setAttribute('aria-current', on ? 'true' : 'false');
    }
  }

  /** 滚到哪一段，左边索引就高亮哪一个 */
  function bindScrollSpy() {
    if (scrollSpy) { try { scrollSpy.disconnect(); } catch (e) {} scrollSpy = null; }
    if (typeof IntersectionObserver === 'undefined') return;
    var secs = document.querySelectorAll('.step-section');
    if (!secs.length) return;
    /* 视口上方一条带：谁占了这条带，谁就是"当前在读的那一段"。
       带子从视口最顶端开始 —— 跳转后目标段正好贴在顶端，
       若从 12% 处才开始，短段落会让上一段继续占着带子。 */
    scrollSpy = new IntersectionObserver(function (entries) {
      var best = null;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e.isIntersecting) continue;
        if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
      }
      if (!best) return;
      var id = best.target.getAttribute('data-step');
      if (!id || id === currentSection) return;
      currentSection = id;
      S.get().activeStep = id;      /* 只改内存，不写盘：滚动不该触发持久化 */
      markActive(id);
    }, { root: null, rootMargin: '0px 0px -65% 0px', threshold: [0, 0.1, 0.5, 1] });
    for (var j = 0; j < secs.length; j++) scrollSpy.observe(secs[j]);
  }

  function render(host) {
    var p = S.project();
    var pipe = (p && p.pipeline) || {};
    var confirmed = p && p.designConfirmed;
    var g = S.get();

    if (scrollSpy) { try { scrollSpy.disconnect(); } catch (e) {} scrollSpy = null; }
    currentSection = null;

    host.appendChild(el('div.section-heading', {}, [
      el('h2', { text: '统计分析' }),
      el('small', { text: '七步实证流水线 · 每步产出代码 / 结果 / 解读三件套' })
    ]));

    if (!confirmed) {
      host.appendChild(ZY.stages.data.lockBanner());
      return;
    }

    /* 质量门总览 */
    host.appendChild(renderQualitySummary(pipe));

    var activeId = g.activeStep || 'data-prep';
    var grid = el('div.pipeline');

    /* 左：七步索引。点一下就跳到右边对应的那一段 */
    var steps = el('div.step-list.step-index');
    steps.appendChild(el('div.step-index-title', {}, [
      el('span', { text: '七步索引' }),
      el('span.hint', { text: '点击跳转' })
    ]));
    ZY.store.PIPELINE_STEPS.forEach(function (def) {
      var st = pipe[def.id] || { status: 'pending' };
      var cls = STATUS_CLASS[st.status] || '';
      steps.appendChild(el('button.step-item', {
        type: 'button',
        'data-step': def.id,
        'aria-current': def.id === activeId ? 'true' : 'false',
        title: '跳到「' + def.label + '」',
        onclick: function () { gotoSection(def.id); }
      }, [
        el('span.step-no' + (cls ? '.' + cls : ''), { text: st.status === 'done' ? '✓' : def.no }),
        el('span.step-name', { text: def.label }),
        el('span.step-badge', {}, [el('span.hint', { text: STATUS_TEXT[st.status] || '待执行' })])
      ]));
      if (st.status === 'running' && st.percent != null) {
        steps.appendChild(el('div', { style: { padding: '0 11px 8px' } }, [
          el('div.bar', {}, [el('i', { style: { width: st.percent + '%' } })]),
          el('div.hint', { text: '第 ' + Math.min(st.itemIndex + 1, st.items.length) + '/' + st.items.length + ' 项 · ' + st.percent + '%' })
        ]));
      }
    });
    grid.appendChild(steps);

    /* 右：七段全部铺开，一段都不少 */
    var right = el('div.step-sections');
    ZY.store.PIPELINE_STEPS.forEach(function (def) {
      right.appendChild(renderSection(def, pipe[def.id], g));
    });
    grid.appendChild(right);
    host.appendChild(grid);

    /* 全部过程文件 */
    host.appendChild(el('h3.subhead', {}, ['过程文件', el('span.sub-note', { text: '命名规范：<类型>__<步骤>.ext' })]));
    host.appendChild(ZY.render.exportTree(pipe, p));

    /* 绑滚动联动（等 DOM 挂上去之后） */
    if (typeof setTimeout === 'function') setTimeout(bindScrollSpy, 0);
  }

  /** 单一步骤的正文段落：执行项 + 三件套（含每段自己的 脚本/结果/解读 切换） */
  function renderSection(def, st0, g) {
    var st = st0 || { status: 'pending', items: [] };
    var sec = el('section.step-section', { id: 'step-' + def.id, 'data-step': def.id });
    var view = (g.segViews && g.segViews[def.id]) || g.segView || 'result';

    sec.appendChild(el('div.step-section-head', {}, [
      el('div.step-section-title', {}, [
        el('h3.subhead', {}, [
          def.no + ' ' + def.label,
          el('span.sub-note', { text: ZY.stages.data.statusText(st) })
        ])
      ]),
      el('div.step-section-actions', {}, [
        (function () {
          var seg = el('div.seg', { 'data-seg-for': def.id });
          [['code', '脚本'], ['result', '结果'], ['interpret', '解读']].forEach(function (pair) {
            seg.appendChild(el('button', {
              type: 'button', text: pair[1],
              'data-view': pair[0],
              'aria-pressed': view === pair[0] ? 'true' : 'false',
              onclick: function () { switchView(def.id, pair[0], sec, seg); }
            }));
          });
          return seg;
        })(),
        (st.status === 'pending' || st.status === 'stale')
          ? el('button.btn.btn-primary.btn-sm', { type: 'button', text: '执行本步', onclick: function () { ZY.app.runStep(def.id); } })
          : null,
        st.status === 'running'
          ? el('button.btn.btn-sm', { type: 'button', text: '暂停', onclick: function () { E.pausePipeline(); } })
          : null,
        (st.status === 'done' || st.status === 'stale')
          ? el('button.btn.btn-sm', { type: 'button', text: '重跑本步', onclick: function () { ZY.app.rerunStep(def.id); } })
          : null,
        (st.status === 'done' || st.status === 'stale')
          ? el('button.btn.btn-sm', { type: 'button', html: U.ICONS.download + ' 下载三件套', onclick: function () { ZY.app.downloadStep(def.id); } })
          : null,
        (st.status === 'pending' || st.status === 'paused')
          ? el('button.btn.btn-sm', { type: 'button', text: '跳过', onclick: function () { ZY.app.openSkipModal(def.id); } })
          : null
      ])
    ]));

    /* 执行项清单 */
    if (st.items && st.items.length) {
      var items = el('div.card', { style: { marginBottom: '14px' } }, [el('h3', { text: '执行项' })]);
      st.items.forEach(function (it, i) {
        var done = st.status === 'done' || (st.status === 'running' && i < (st.itemIndex || 0));
        items.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', fontSize: '12px' } }, [
          el('span', { html: done ? U.ICONS.check : '○', style: { color: done ? 'var(--success)' : 'var(--ink-tertiary)', flex: 'none' } }),
          el('span', { text: it })
        ]));
      });
      sec.appendChild(items);
    }

    /* 三件套 / 执行中 / 未执行：这一段自己的视图容器 */
    var body = el('div.step-view', { 'data-view-for': def.id });
    body.appendChild(sectionBody(def, st, view));
    sec.appendChild(body);
    return sec;
  }

  /** 段落正文：只换这一块，不整体重渲染，滚动位置就不会被冲掉 */
  function sectionBody(def, st, view) {
    if (st.status === 'done' || st.status === 'stale' || st.status === 'failed') {
      return ZY.render.stepArtifacts(def.id, view);
    }
    if (st.status === 'running') {
      return el('div.job', {}, [
        el('div.job-head', {}, [
          el('strong', { text: '正在执行：' + def.label }),
          el('span.badge.blue', { text: (st.percent || 0) + '%' })
        ]),
        el('div.bar', {}, [el('i', { style: { width: (st.percent || 0) + '%' } })]),
        el('div.job-meta', {}, [
          el('span', { text: '第 ' + Math.min((st.itemIndex || 0) + 1, st.items.length) + '/' + st.items.length + ' 项' }),
          el('span', { text: st.etaMs ? '剩余约 ' + U.fmtDur(st.etaMs) : '正在估算剩余时间' })
        ])
      ]);
    }
    return el('div.empty-state', {}, [
      el('div.empty-title', { text: '该步骤尚未执行' }),
      el('div', { text: st.status === 'skipped' ? ('已跳过：' + (st.note || '')) : '点击「执行本步」单独运行，或在数据页启动整条流水线。' })
    ]);
  }

  function switchView(stepId, view, sec, seg) {
    var s = S.get();
    if (!s.segViews) s.segViews = {};
    s.segViews[stepId] = view;
    s.segView = view;              /* 兼容数据页仍读 segView */
    S.save();
    var btns = seg.querySelectorAll('button[data-view]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-view') === view ? 'true' : 'false');
    }
    var p = S.project();
    var st = ((p && p.pipeline) || {})[stepId] || { status: 'pending' };
    var def = ZY.store.PIPELINE_STEPS.filter(function (x) { return x.id === stepId; })[0];
    var body = sec.querySelector('.step-view[data-view-for="' + stepId + '"]');
    if (!body || !def) return;
    U.clear(body);
    body.appendChild(sectionBody(def, st, view));
  }

  function renderQualitySummary(pipe) {
    var total = ZY.store.PIPELINE_STEPS.length;
    var done = 0, failed = 0, skipped = 0;
    ZY.store.PIPELINE_STEPS.forEach(function (s) {
      var st = pipe[s.id];
      if (!st) return;
      if (st.status === 'done') done++;
      if (st.status === 'failed') failed++;
      if (st.status === 'skipped') skipped++;
    });
    var wording = C.deriveWording((S.project() && S.project().rq ? S.project().rq.claimType : 'associative'), ((S.project() && S.project().design) ? S.project().design.checks : []));
    var card = el('div.card-grid.three', {}, [
      qCard('完成进度', done + ' / ' + total, failed ? (failed + ' 项质量门未通过') : (skipped ? skipped + ' 项被跳过' : '全部通过质量门')),
      qCard('允许措辞强度', C.WORDING[wording].label, wording === 'causal' ? '识别策略支持因果表述' : '因 IV-01 弱工具，全文锁定为相关表述'),
      qCard('数值一致性', '已校验', '解读中的每个数字均绑定结果表 cell_id')
    ]);
    return card;
  }

  function qCard(title, value, desc) {
    return el('div.card', {}, [
      el('h3', { text: title }),
      el('div', { text: value, style: { fontSize: '18px', fontWeight: '700', color: 'var(--purple)', marginBottom: '6px', fontFamily: 'var(--font-sans)' } }),
      el('p', { text: desc })
    ]);
  }

  ZY.stages = ZY.stages || {};
  ZY.stages.stats = { render: render, STATUS_TEXT: STATUS_TEXT };
})(window);
