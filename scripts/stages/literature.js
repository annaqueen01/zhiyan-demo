/* 阶段页 2 · 文献分析
   全部基于**当前项目的研究问题**做真实检索，不使用固定探针结果。
   检索进行中显示"小智快速检索文献中"的动效。 */
(function (global) {
  'use strict';
  var ZY = global.ZY, U = ZY.util, D = ZY.data, S = ZY.store, E = ZY.engine;
  var el = U.create;

  var TRUST_LABEL = { high: '可引用', medium: '需核对', low: '仅提及' };
  var TRUST_CLASS = { high: 'ok', medium: 'warn', low: 'err' };

  function render(host) {
    var p = S.project();
    var st = S.get();

    host.appendChild(el('div.section-heading', {}, [
      el('h2', { text: '文献分析' }),
      el('small', { text: p && p.rq
        ? ('检索式基于：' + (p.rq.researchQuestion || p.rq.phenomenon || ''))
        : '等待研究问题' })
    ]));

    /* 检索进行中：显示动效，而不是空白或旧数据 */
    if (st.litRunning) {
      host.appendChild(ZY.ui.searchProgress(
        '小智快速检索文献中',
        '已完成 ' + (st.litRunning.done || 0) + '/' + (st.litRunning.total || 0) + ' 路检索' +
        (st.litRunning.label ? ('　最近一路：' + st.litRunning.label) : '')
      ));
      return;
    }

    var a = p && p.litAnalysis;
    if (!a || !a.summary) {
      /* 还没做过检索：不显示任何样例数据 */
      var body = el('div.banner-body', {}, [
        el('div.banner-title', { text: '还没有针对这个题目做检索' }),
        el('div', { text: (p && p.rq)
          ? '研究问题已识别。检索会在生成实验设计之前自动进行；也可以点下面按钮立刻开始。'
          : '先在对话区提交你的研究问题，我会据此生成检索式。' })
      ]);
      if (p && p.rq) {
        body.appendChild(el('div.banner-actions', {}, [
          el('button.btn.btn-primary.btn-sm', {
            type: 'button', text: '开始检索',
            onclick: function () { ZY.app.runLiterature(); }
          })
        ]));
      }
      host.appendChild(el('div.banner.info', {}, [
        el('span', { html: U.ICONS.info, style: { marginTop: '2px' } }),
        body
      ]));

      /* 把将要用到的检索式先摆出来，让用户知道会查什么 */
      if (p && p.rq && ZY.litSearch) {
        var qs = ZY.litSearch.buildQueries(p.rq);
        host.appendChild(el('h3.subhead', {}, ['将使用的检索式']));
        var card = el('div.card');
        qs.forEach(function (q) {
          card.appendChild(el('div.res-item', {}, [
            el('span.badge.blue', { text: q.label }),
            el('span.res-name', { text: q.query, style: { fontFamily: 'var(--font-kai)' } })
          ]));
        });
        host.appendChild(card);
      }
      return;
    }

    /* ---------------- 有真实检索结果 ---------------- */
    var sum = a.summary;

    if (!a.hits.length) {
      host.appendChild(el('div.banner.warn', {}, [
        el('span', { html: U.ICONS.warn, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div.banner-title', { text: '没有命中任何文献' }),
          el('div', { text: '跑了 ' + a.queries.length + ' 路检索式都没有命中。' +
            '请先在左侧「文献库」上传相关 PDF，或换一个更贴近库内用词的说法。' }),
          el('div.banner-actions', {}, [
            el('button.btn.btn-sm', {
              type: 'button', text: '打开文献库',
              onclick: function () { ZY.app.openResourcePage('library'); }
            }),
            el('button.btn.btn-sm', {
              type: 'button', text: '重新检索',
              onclick: function () { ZY.app.runLiterature(); }
            })
          ])
        ])
      ]));
      return;
    }

    /* 概览 */
    host.appendChild(el('div.card-grid.three', {}, [
      statCard('命中文献', a.hits.length + ' 篇',
        '来自 ' + a.queries.length + ' 路检索式，共 ' + sum.withQuote + ' 段可引用片段'),
      statCard('质量分布', '可引用 ' + (sum.trust.high || 0),
        '需核对 ' + (sum.trust.medium || 0) + ' 篇 · 仅可提及 ' + (sum.trust.low || 0) + ' 篇'),
      statCard('年份跨度',
        sum.yearRange ? (sum.yearRange[0] + '—' + sum.yearRange[1]) : '—',
        Object.keys(sum.methods || {}).length
          ? (Object.keys(sum.methods).length + ' 类识别策略')
          : '未标注识别策略')
    ]));

    /* 检索式与命中数 */
    host.appendChild(el('h3.subhead', {}, ['检索式与命中',
      el('span.sub-note', { text: '命中数少的检索式说明该角度的语料薄弱' })]));
    var qcard = el('div.card');
    a.perQuery.forEach(function (q) {
      qcard.appendChild(el('div.res-item', {}, [
        el('span.badge' + (q.count ? '.blue' : '.warn'), { text: q.label }),
        el('span.res-name', { text: q.query, style: { fontFamily: 'var(--font-kai)' } }),
        el('span.res-meta', { text: q.count + ' 篇' })
      ]));
    });
    host.appendChild(qcard);

    /* 识别策略分布（真实计数） */
    var methods = Object.keys(sum.methods || {}).sort(function (x, y) {
      return sum.methods[y] - sum.methods[x];
    });
    if (methods.length) {
      host.appendChild(el('h3.subhead', {}, ['识别策略分布']));
      var mcard = el('div.card.zy-dist');
      var maxN = sum.methods[methods[0]] || 1;
      methods.forEach(function (k) {
        mcard.appendChild(el('div.zy-dist-row', {}, [
          el('div.zy-dist-label', {}, [
            el('span', { text: k }),
            el('span', { text: sum.methods[k] + ' 篇' })
          ]),
          el('div.bar', {}, [el('i', { style: { width: Math.round(sum.methods[k] / maxN * 100) + '%' } })])
        ]));
      });
      host.appendChild(mcard);
    }

    /* 证据缺口：必须显式 */
    if (sum.gaps && sum.gaps.length) {
      host.appendChild(el('h3.subhead', {}, ['证据就绪度',
        el('span.sub-note', { text: '按你研究问题的组成部分逐项检查' })]));
      host.appendChild(el('div.table-wrap', {}, [
        el('table.table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: '研究问题组成' }), el('th', { text: '对应表述' }),
            el('th', { text: '状态' }), el('th.num', { text: '支撑篇数' })
          ])),
          el('tbody', {}, sum.gaps.map(function (g) {
            var cls = g.status === 'ok' ? '.ok' : (g.status === 'thin' ? '.warn' : '.err');
            var txt = g.status === 'ok' ? '就绪' : (g.status === 'thin' ? '薄弱' : '无证据');
            return el('tr', {}, [
              el('td', { text: g.what }),
              el('td', { text: g.term, style: { color: 'var(--ink-tertiary)' } }),
              el('td', {}, [el('span.badge' + cls, { text: txt })]),
              el('td.num', { text: String(g.docs) })
            ]);
          }))
        ])
      ]));
    }

    /* 反向证据 */
    if (sum.disagreements && sum.disagreements.length) {
      host.appendChild(el('h3.subhead', {}, ['反向证据（必须进综述，否则是选择性引用）']));
      var dis = el('div.card');
      sum.disagreements.forEach(function (h) {
        dis.appendChild(el('button.cite', {
          type: 'button', onclick: function () { ZY.app.openSource(h.docId); }
        }, [
          el('span.cite-idx', { text: '反' }),
          el('span.cite-main', {}, [
            el('span.cite-text', { text: '《' + (h.title || '') + '》' + (h.year ? (' ' + h.year) : '') }),
            el('span.cite-src', { text: (h.journal || '') + ' · ' + (h.method || '未标注识别策略') })
          ])
        ]));
      });
      host.appendChild(dis);
    }

    /* 命中清单（可点击回原文） */
    host.appendChild(el('h3.subhead', {}, ['命中清单',
      el('span.sub-note', { text: '点击查看原文片段与出处' })]));
    host.appendChild(el('div.table-wrap', {}, [
      el('table.table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: '文献' }), el('th', { text: '年份' }), el('th', { text: '期刊' }),
          el('th', { text: '识别策略' }), el('th', { text: '命中角度' }), el('th', { text: '质量' }),
          el('th.num', { text: '相关度' })
        ])),
        el('tbody', {}, a.hits.map(function (h) {
          return el('tr', {
            style: { cursor: 'pointer' },
            onclick: function () { ZY.app.openSource(h.docId); }
          }, [
            el('td', { text: h.title, style: { maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' } }),
            el('td.num', { text: h.year ? String(h.year) : '—' }),
            el('td', { text: h.journal || '—' }),
            el('td', { text: h.method || '—' }),
            el('td', { text: (h.matchedBy || []).join('、'), style: { color: 'var(--ink-tertiary)', fontSize: '11px' } }),
            el('td', {}, [el('span.badge' + TRUST_CLASS[h.trust], { text: TRUST_LABEL[h.trust] })]),
            el('td.num', { text: h.score.toFixed(3) })
          ]);
        }))
      ])
    ]));

    host.appendChild(el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '14px' } }, [
      el('button.btn.btn-sm', {
        type: 'button', text: '重新检索',
        onclick: function () { ZY.app.runLiterature(); }
      })
    ]));
  }

  function statCard(title, value, desc) {
    return el('section.card', {}, [
      el('h3', { text: title }),
      el('div', { text: value, style: { fontSize: '17px', fontWeight: '700', color: 'var(--purple)', marginBottom: '6px', fontFamily: 'var(--font-sans)' } }),
      el('p', { text: desc })
    ]);
  }

  function docOf(id) {
    /* 真实文献与内置样例都要能解析：真实篇目的元数据来自真实 PDF，
       缺期刊/年份是常态，这里如实留空，不编。 */
    if (ZY.resource && ZY.resource.byId) {
      var r = ZY.resource.byId(id);
      if (r) return r;
    }
    for (var i = 0; i < D.LIBRARY.length; i++) if (D.LIBRARY[i].id === id) return D.LIBRARY[i];
    return { title: id, journal: '', year: '' };
  }

  ZY.stages = ZY.stages || {};
  ZY.stages.literature = { render: render, docOf: docOf };
})(window);
