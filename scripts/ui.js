/**
 * 智研 · 展示层小工具
 * · 结构化抽取期间：不把原始 JSON 糊到用户脸上，而是显示正在做什么
 * · 抽取完成后：把槽位渲染成可读的卡片
 */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};
  var U = ZY.util;

  /** 正在进行的任务条：文案 + 动态省略号 + 进度点 */
  function progressLine(text) {
    var el = U.create;
    var dots = el('span.zy-dots', {}, [
      el('i'), el('i'), el('i')
    ]);
    return el('div.zy-progress', {}, [
      el('span.zy-spinner', { 'aria-hidden': 'true' }),
      el('span.zy-progress-text', { text: text }),
      dots
    ]);
  }

  /** 检索中的动效（用于对话区与右侧面板） */
  function searchProgress(title, sub) {
    var el = U.create;
    return el('div.zy-search', {}, [
      el('div.zy-search-head', {}, [
        el('span.zy-spinner.zy-spinner-lg', { 'aria-hidden': 'true' }),
        el('div', {}, [
          el('div.zy-search-title', { text: title || '小智快速检索文献中' }),
          sub ? el('div.zy-search-sub', { text: sub }) : null
        ])
      ]),
      el('div.zy-search-track', {}, [el('i')]),
      el('div.zy-search-steps', {}, [
        el('span.zy-step', { text: '解析研究问题' }),
        el('span.zy-step.active', { text: '检索文献库' }),
        el('span.zy-step', { text: '归纳证据结构' })
      ])
    ]);
  }

  /**
   * 把结构化 RQ 渲染成用户可读的结果卡。
   * 关键：不出现 JSON、不出现字段名（phenomenon/claimType 之类）。
   */
  function rqCard(rq, opts) {
    opts = opts || {};
    var el = U.create;
    var claimLabel = (ZY.rq && ZY.rq.CLAIM_LABEL[rq.claimType]) || rq.claimType;

    var rows = [
      ['研究问题', rq.researchQuestion, true],
      ['现象', rq.phenomenon, false],
      ['对象与层级', rq.objectLevel, false],
      ['时间窗', rq.timeWindow ? (rq.timeWindow[0] + '—' + rq.timeWindow[1]) : null, false],
      ['被解释变量', rq.outcomeVar, false],
      ['核心解释变量', rq.treatmentVar, false],
      ['变异来源', rq.variationSource, false]
    ];

    var card = el('section.card.zy-rqcard', {});
    card.appendChild(el('div.zy-rqcard-head', {}, [
      el('h3', { text: '研究问题识别结果' }),
      el('span.badge.' + (rq.claimType === 'causal' ? 'ok' : 'warn'), {
        text: '允许措辞：' + claimLabel
      })
    ]));

    var dl = el('div.deflist');
    rows.forEach(function (r) {
      if (!r[1]) return;
      dl.appendChild(el('dt', { text: r[0] }));
      dl.appendChild(el('dd', {}, [
        el('span', { text: String(r[1]), style: r[2] ? { color: 'var(--ink)', fontWeight: '600' } : {} })
      ]));
    });
    card.appendChild(dl);

    /* 缺失项要显眼但不说教 */
    var missing = [];
    if (!rq.objectLevel) missing.push('研究对象与层级');
    if (!rq.timeWindow) missing.push('时间窗');
    if (missing.length) {
      card.appendChild(el('p.hint', {
        text: '未确定：' + missing.join('、') + '。可以先往下走——我会在设计里留出位置，等你补。',
        style: { marginTop: '8px' }
      }));
    }

    /* 为什么是这个措辞强度 */
    if (rq.claimType !== 'causal') {
      card.appendChild(el('div.zy-why', {}, [
        el('strong', { text: '为什么只给「' + claimLabel + '」表述：' }),
        el('span', {
          text: '变异来源是「' + (rq.variationSource || '未说明') +
            '」，属于企业之间的既有差异，不是外生冲击，所以全文不会写成因果。' +
            '如果你手上有一个政策试点或工具变量，可以升级为因果。'
        })
      ]));
    }

    /* 本文不做 */
    if (rq.outOfScope && rq.outOfScope.length) {
      card.appendChild(el('div.zy-scope', {}, [
        el('div.zy-scope-title', { text: '这一步先明确不做的事' }),
        el('ul', {}, rq.outOfScope.map(function (s) {
          return el('li', { text: s });
        }))
      ]));
    }

    /* 候选题目 */
    if (rq.candidateQuestions && rq.candidateQuestions.length > 1) {
      var cq = el('div.zy-cands', {}, [el('div.zy-scope-title', { text: '还可以往这几个方向走' })]);
      rq.candidateQuestions.forEach(function (q, i) {
        cq.appendChild(el('div.zy-cand', {}, [
          el('span.zy-cand-no', { text: String(i + 1) }),
          el('span', { text: q })
        ]));
      });
      card.appendChild(cq);
    }

    return card;
  }

  ZY.ui = {
    progressLine: progressLine,
    searchProgress: searchProgress,
    rqCard: rqCard
  };
})(window);
