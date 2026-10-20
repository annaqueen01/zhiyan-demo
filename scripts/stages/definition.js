/* 阶段页 1 · 项目定义
   读**当前项目的研究问题**（rq.js 的槽位结构），并兼容旧的预置结构。
   要点：字段缺失时显示"—"而不是崩溃；候选题目既支持字符串也支持对象。 */
(function (global) {
  'use strict';
  var ZY = global.ZY, U = ZY.util, D = ZY.data, S = ZY.store, E = ZY.engine;
  var el = U.create;

  var CLAIM_LABEL = {
    causal: '因果', associative: '相关', descriptive: '描述',
    mechanistic: '机制', 'policy-eval': '政策评估'
  };

  function claimLabel(t) {
    if (ZY.rq && ZY.rq.CLAIM_LABEL && ZY.rq.CLAIM_LABEL[t]) return ZY.rq.CLAIM_LABEL[t];
    return CLAIM_LABEL[t] || t || '—';
  }

  function dash(v) {
    return (v == null || v === '') ? '—' : String(v);
  }

  function render(host) {
    var p = S.project();
    var st = S.get();
    var rq = p && p.rq ? p.rq : null;

    host.appendChild(el('div.section-heading', {}, [
      el('h2', { text: '项目定义' }),
      el('small', { text: rq && rq.source === 'llm' ? '研究问题识别结果' : '命题解析 · 五槽位' })
    ]));

    if (!rq) {
      host.appendChild(el('div.banner.info', {}, [
        el('span', { html: U.ICONS.info, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div.banner-title', { text: '还没有研究问题' }),
          el('div', { text: '在对话区提交你的研究问题后，这里会显示识别出的五槽位。' })
        ])
      ]));
      host.appendChild(resourceCard(p, st));
      return;
    }

    /* 研究问题 + 资源绑定 */
    host.appendChild(el('div.card-grid.two', {}, [
      el('section.card', {}, [
        el('h3', { text: '研究问题' }),
        el('p', {
          text: rq.researchQuestion || rq.claimSentence || rq.phenomenon || '—',
          style: { fontSize: '15px', color: 'var(--ink)', fontWeight: '600', textIndent: '0' }
        }),
        el('div.divider'),
        el('div.deflist', {}, flatten([
          ['现象', dash(rq.phenomenon)],
          ['对象与层级', dash(rq.objectLevel || rq.objectLevelLabel)],
          ['时间窗', timeWindowText(rq.timeWindow)],
          ['变异来源', dash(rq.variationSource || rq.variationSourceLabel)],
          ['被解释变量', dash(rq.outcomeVar)],
          ['核心解释变量', dash(rq.treatmentVar)],
          ['允许措辞', claimLabel(rq.claimType)]
        ]))
      ]),
      resourceCard(p, st)
    ]));

    /* 本文不做 */
    var scope = toArray(rq.outOfScope);
    if (scope.length) {
      host.appendChild(el('h3.subhead', {}, ['本文不做', el('span.sub-note', { text: '明确边界，避免读者误解' })]));
      var sc = el('div.card');
      scope.forEach(function (s) {
        sc.appendChild(el('p', { text: '· ' + s, style: { fontSize: '13px', lineHeight: '1.8' } }));
      });
      host.appendChild(sc);
    }

    /* 候选题目 */
    var cands = toArray(rq.candidateQuestions);
    if (cands.length) {
      host.appendChild(el('h3.subhead', {}, ['候选研究问题',
        el('span.sub-note', { text: cands.length > 1 ? '可以往这几个方向走' : '当前唯一候选' })]));
      var wrap = el('div.card');
      cands.forEach(function (q, i) {
        var text = typeof q === 'string' ? q : (q.text || q.question || '');
        if (!text) return;
        wrap.appendChild(el('div.res-item', {}, [
          el('span.badge' + (i === 0 ? '' : '.plain'), { text: '候选 ' + (i + 1) }),
          el('span.res-name', { text: text }),
          (typeof q === 'object' && q.corpusSupport != null)
            ? el('span.res-meta', { text: '语料支撑 ' + q.corpusSupport + ' 篇' })
            : null
        ]));
        if (typeof q === 'object' && q.note) {
          wrap.appendChild(el('p.hint', { text: q.note, style: { marginBottom: '10px' } }));
        }
      });
      host.appendChild(wrap);
    }

    /* 槽位缺失提示 */
    var unknown = rq.unknownSlots || [];
    if (unknown.length) {
      var labels = unknown.map(function (k) {
        return (ZY.rq && ZY.rq.SLOT_LABEL && ZY.rq.SLOT_LABEL[k]) || k;
      });
      host.appendChild(el('div.banner.warn', {}, [
        el('span', { html: U.ICONS.warn, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div.banner-title', { text: '有 ' + unknown.length + ' 个槽位还没确定' }),
          el('div', { text: labels.join('、') + '。不阻断流程，但设计里会留出位置等你补。' })
        ])
      ]));
    }

    /* 文献检索状态（面向用户的进度反馈） */
    if (st.litRunning) {
      host.appendChild(el('h3.subhead', {}, ['文献检索']));
      host.appendChild(ZY.ui.searchProgress(
        '小智快速检索文献中',
        '已完成 ' + (st.litRunning.done || 0) + '/' + (st.litRunning.total || 0) + ' 路检索'
      ));
    } else if (p.litAnalysis && p.litAnalysis.summary) {
      var n = p.litAnalysis.hits.length;
      host.appendChild(el('h3.subhead', {}, ['文献检索']));
      host.appendChild(el('div.card', {}, [
        el('p', { text: '已按你的研究问题检索：命中 ' + n + ' 篇。' }),
        el('div', { style: { marginTop: '10px' } }, [
          el('button.btn.btn-sm', {
            type: 'button', text: '查看文献分析',
            onclick: function () { ZY.app.switchTab('literature'); }
          })
        ])
      ]));
    }
  }

  function resourceCard(p, st) {
    return el('section.card', {}, [
      el('h3', { text: '资源绑定' }),
      el('div.meta-row', {}, [el('span', { text: '文献库' }),
        el('strong', { text: st.libraryLoaded ? (D.LIBRARY_STATS.total + ' 篇') : '未导入' })]),
      el('div.meta-row', {}, [el('span', { text: '数据库' }),
        el('strong', { text: st.importedPanel
          ? (U.fmtInt(st.importedPanel.nRows) + ' 行')
          : (st.datasetLoaded ? (D.DATASETS[0].rows.toLocaleString() + ' 行') : '未导入') })]),
      el('div.meta-row', {}, [el('span', { text: '输出目录' }), el('strong', { text: '自动创建（浏览器内）' })]),
      el('div.divider'),
      el('p.hint', { text: '资源库支持"选择本地文件夹"或"上传到浏览器"两种方式，两者在检索与调用上能力等价。' })
    ]);
  }

  function timeWindowText(tw) {
    if (!tw) return '—';
    if (Array.isArray(tw) && tw.length >= 2) return tw[0] + '—' + tw[1];
    return String(tw);
  }

  function toArray(v) {
    if (!v) return [];
    return Array.isArray(v) ? v.filter(Boolean) : [v];
  }

  function flatten(pairs) {
    var out = [];
    pairs.forEach(function (kv) {
      out.push(el('dt', { text: kv[0] }), el('dd', { text: kv[1] }));
    });
    return out;
  }

  ZY.stages = ZY.stages || {};
  ZY.stages.definition = { render: render };
})(window);
