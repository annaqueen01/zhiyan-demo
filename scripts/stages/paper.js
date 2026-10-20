/* 阶段页 6 · 论文生成（九章初稿 + 风格参考 + 引用校验 + 导出） */
(function (global) {
  'use strict';
  var ZY = global.ZY, U = ZY.util, D = ZY.data, S = ZY.store, E = ZY.engine, C = ZY.checklist;
  var el = U.create;

  function render(host) {
    var p = S.project();
    var paper = p && p.paper;

    host.appendChild(el('div.section-heading', {}, [
      el('h2', { text: '论文生成' }),
      el('small', { text: paper ? '九章初稿 · 逐段生成' : '尚未生成' })
    ]));

    if (!paper) {
      var allDone = isAllDone(p);
      var missing = S.PIPELINE_STEPS.filter(function (s) {
        var st = p && p.pipeline ? p.pipeline[s.id] : null;
        return !st || (st.status !== 'done' && st.status !== 'skipped');
      }).map(function (s) { return s.label; });
      host.appendChild(el('div.card', {}, [
        el('h3', { text: '生成论文初稿' }),
        el('p', { text: allDone
          ? '七步实证已完成。生成初稿后会按《中国工业经济》的语体与章节结构组织，并逐段标注引用与措辞强度。'
          : '七步实证尚未全部完成。可以先完成流水线，也可以现在就生成——未完成与跳过的检验会在初稿里自动披露。' }),
        el('div.divider'),
        el('h3', { text: '语言风格' }),
        el('div', {}, [
          el('label.choice', {}, [
            el('input', { type: 'radio', name: 'style', checked: true }),
            el('span', {}, ['按《中国工业经济》的文献语言风格与行文架构（默认）',
              el('span.choice-desc', { text: '平均句长约 38 字；高频连接词"因此/然而/进一步地"；表格引出用"表 X 报告了…"' })])
          ]),
          el('label.choice', {}, [
            el('input', { type: 'radio', name: 'style' }),
            el('span', {}, ['按我指定的参考文献风格',
              el('span.choice-desc', { text: '拖入 1–5 篇文献，仅提取行文风格与章节组织，不搬运原句' })])
          ])
        ]),
        el('div.banner.info', {}, [
          el('span', { html: U.ICONS.info, style: { marginTop: '2px' } }),
          el('div.banner-body', {}, [
            el('div', { text: '风格参考模仿的是形式（结构、句式、语体、图表引出方式），不是内容。系统不会搬运参考文献的句子。' })
          ])
        ]),
        el('div.cta-row', {}, [
          /* 前置欠缺项在这里说明清楚，避免"准备中"与"可生成"互相矛盾 */
          el('div.cta-note' + (missing.length ? '.warn' : ''), {
            text: missing.length
              ? '前置欠缺：' + missing.join('、') + '。现在生成会在初稿里披露这些未做项。'
              : '七步实证已全部完成，可以直接生成初稿。'
          }),
          el('button.btn.btn-primary', { type: 'button', text: '生成论文初稿', onclick: function () { ZY.app.generatePaper(); } })
        ])
      ]));
      return;
    }

    /* 校验摘要 */
    var checks = E.verifyCitations(paper);
    var issues = checks.filter(function (c) { return c.issues.length; });
    var unverified = E.countUnverified(paper);
    var wording = paper.wording || 'associative';

    host.appendChild(el('div.card-grid.three', {}, [
      sumCard('章节完成', paper.sections.length + ' / 9', paper.skipped && paper.skipped.length ? ('已披露跳过：' + paper.skipped.join('、')) : '未跳过任何步骤'),
      sumCard('允许措辞强度', C.WORDING[wording].label, '相关证据段落中因果动词数必须为 0'),
      sumCard('校验结果', issues.length ? (issues.length + ' 处需处理') : '全部通过', unverified ? (unverified + ' 处待补文献') : '无待补文献')
    ]));

    if (unverified) {
      host.appendChild(el('div.banner.warn', {}, [
        el('span', { html: U.ICONS.warn, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div.banner-title', { text: '有 ' + unverified + ' 处找不到语料依据' }),
          el('div', { text: '这些句子已标为『此处待补文献』，而不是编造成看起来像样的结论。建议补文献或换个能被支持的近似说法。' })
        ])
      ]));
    }

    /* 风格 */
    host.appendChild(el('div.card', { style: { marginBottom: '16px' } }, [
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } }, [
        el('div', {}, [
          el('h3', { text: '语言风格：' + paper.styleJournal + '（默认）', style: { marginBottom: '6px' } }),
          el('p.hint', { text: '平均句长 ' + paper.styleProfile.avgSentenceLen + ' 字 · 高频连接词：' + paper.styleProfile.connectors.join('、') + ' · 表格引出：' + paper.styleProfile.figureLead })
        ]),
        el('button.btn.btn-sm', { type: 'button', text: '改为我的参考文献', onclick: function () { ZY.app.openStyleModal(); } })
      ])
    ]));

    /* 引用台账 */
    host.appendChild(el('h3.subhead', {}, ['引用台账', el('span.sub-note', { text: '逐段逐句的校验结果' })]));
    var tbl = el('div.table-wrap', { style: { marginBottom: '18px' } }, [
      el('table.table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: '章节' }), el('th', { text: '段落' }), el('th', { text: '引用数' }), el('th', { text: '数字绑定' }), el('th', { text: '校验' })
        ])),
        el('tbody', {}, checks.map(function (c) {
          var para = findPara(paper, c.sectionId, c.index);
          return el('tr', {}, [
            el('td', { text: c.sectionTitle }),
            el('td', { text: '第 ' + (c.index + 1) + ' 段', style: { color: 'var(--ink-tertiary)' } }),
            el('td.num', { text: String((para && para.cites ? para.cites.length : 0)) }),
            el('td.num', { text: String((para && para.cells ? para.cells.length : 0)) }),
            el('td', {}, [
              c.issues.length
                ? el('span.badge.warn', { text: c.issues.map(function (i) { return i.detail; }).join('；') })
                : el('span.badge.ok', { text: '通过' })
            ])
          ]);
        }))
      ])
    ]);
    host.appendChild(tbl);

    /* 正文 */
    host.appendChild(el('h3.subhead', {}, ['正文', el('span.sub-note', { text: '点击引用角标回跳原文' })]));
    host.appendChild(renderPaper(paper, p));

    /* 导出 */
    host.appendChild(el('div.divider'));
    host.appendChild(el('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' } }, [
      el('button.btn', { type: 'button', text: '导出 Markdown', onclick: function () { ZY.app.exportPaper('md'); } }),
      el('button.btn', { type: 'button', text: '导出完整项目包', onclick: function () { ZY.app.exportPackage(); } }),
      el('button.btn.btn-primary', {
        type: 'button', html: U.ICONS.download + ' 导出 Word（.docx）',
        title: '经本机导出桥生成真正的 Word 文档（需启动 serve_docx.py）',
        onclick: function () { ZY.app.exportDocx(); }
      })
    ]));
  }

  function sumCard(title, value, desc) {
    return el('div.card', {}, [
      el('h3', { text: title }),
      el('div', { text: value, style: { fontSize: '17px', fontWeight: '700', color: 'var(--purple)', marginBottom: '6px', fontFamily: 'var(--font-sans)' } }),
      el('p', { text: desc })
    ]);
  }

  function isAllDone(p) {
    if (!p || !p.pipeline) return false;
    return ZY.store.PIPELINE_STEPS.every(function (s) {
      var st = p.pipeline[s.id];
      return st && (st.status === 'done' || st.status === 'skipped');
    });
  }

  function findPara(paper, sectionId, index) {
    var sec = paper.sections.filter(function (s) { return s.id === sectionId; })[0];
    return sec ? sec.paragraphs[index] : null;
  }

  /** 正文渲染：段落 + 引用角标 + 数字 chip + 措辞标记 */
  function renderPaper(paper, p) {
    var page = el('div.paper-page');
    page.appendChild(el('h1.paper-title', { text: p.title }));
    page.appendChild(el('div.paper-byline', { text: '——基于 2011—2022 年中国 A 股制造业上市公司面板数据' }));

    page.appendChild(el('h2.paper-h2', { text: '摘要' }));
    page.appendChild(el('div.paper-abstract', {}, [
      el('p', { text: '本文基于 2011—2022 年中国 A 股制造业上市公司面板数据，考察数字化转型与企业创新产出之间的关系。结果表明二者存在稳健的正相关关系，且该关系在大型企业中更为明显。受识别策略限制，本文结论应理解为条件相关关系，而非因果效应。' })
    ]));
    page.appendChild(el('div.kw', { text: '关键词：数字化转型；企业创新；固定效应；异质性' }));

    paper.sections.forEach(function (sec) {
      page.appendChild(el('h2.paper-h2', { text: sec.no + '、' + sec.title }));
      sec.paragraphs.forEach(function (para, pi) {
        /* 段落标记：措辞强度 / 待补文献 */
        var flags = [];
        if (para.unverified) flags.push('此处待补文献');
        var viol = C.findCausalViolations(para.text);
        if (paper.wording !== 'causal' && viol.length) {
          flags.push('措辞越界：' + viol.length + ' 处因果断言（命中「' + viol[0].verbs.join('、') + '」）');
        }
        if (flags.length) {
          page.appendChild(el('div.para-flag', {}, [el('span', { html: U.ICONS.warn }), el('span', { text: flags.join(' · ') })]));
        }
        if (paper.wording !== 'causal' && viol.length) {
          var sug = C.suggestRewrites(viol[0].sentence);
          var fixBox = el('div', {
            style: { margin: '0 0 12px', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '6px', background: '#fbfcff' }
          }, [
            el('div', { style: { fontSize: '11px', color: 'var(--ink-tertiary)', marginBottom: '7px', fontFamily: 'var(--font-kai)' },
              text: '该句与「相关」强度不符。可改为以下说法（强度不可调高，只能调低）：' })
          ]);
          sug.forEach(function (s) {
            fixBox.appendChild(el('button', {
              type: 'button',
              style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', marginBottom: '4px', border: '1px solid var(--line)', borderRadius: '5px', background: '#fff', fontSize: '12px', fontFamily: 'var(--font-kai)' },
              onmouseover: function () { this.style.borderColor = 'var(--blue)'; },
              onmouseout: function () { this.style.borderColor = 'var(--line)'; },
              onclick: function () { ZY.app.applyRewrite(sec.id, pi, s.label); }
            }, [el('strong', { text: s.label, style: { fontFamily: 'var(--font-sans)', color: 'var(--blue)' } }), ' — ' + s.text]));
          });
          page.appendChild(fixBox);
        }

        var pEl = el('p');
        /* 文本 + 内联 chip（把 [n] 标记替换为引用角标） */
        var text = para.text;
        var parts = text.split(/(\[\d+\])/);
        parts.forEach(function (part) {
          var m = part.match(/^\[(\d+)\]$/);
          if (m) {
            var idx = parseInt(m[1], 10) - 1;
            var cite = (para.cites || [])[idx];
            if (cite) {
              var doc = ZY.stages.literature.docOf(cite.docId);
              pEl.appendChild(el('span.ref-chip' + (cite.support === 'weak' ? '.unverified' : ''), {
                text: '[' + m[1] + ']',
                title: doc.title + ' · ' + doc.journal + ' ' + doc.year + '（' + (cite.support === 'strong' ? '强支持' : cite.support === 'weak' ? '弱支持' : '仅提及') + '）',
                onclick: function () { ZY.app.openSource(cite.docId); }
              }));
            } else {
              pEl.appendChild(el('span.ref-chip.unverified', { text: '[?]', title: '找不到对应文献' }));
            }
          } else {
            if (part) pEl.appendChild(document.createTextNode(part));
          }
        });

        /* 数字 chip（关联同步） */
        (para.cells || []).forEach(function (cid, i) {
          var cell = ZY.engine.findCell(cid);
          if (!cell) return;
          pEl.appendChild(document.createTextNode(' '));
          pEl.appendChild(el('span.figure-link', {
            text: U.fmtNum(cell.value, 3),
            title: cell.label + ' · 点击回到结果表',
            role: 'button', tabindex: '0',
            onclick: function () { ZY.app.focusCell(cid); }
          }));
        });
        page.appendChild(pEl);
      });
    });
    return page;
  }

  ZY.stages = ZY.stages || {};
  ZY.stages.paper = { render: render, renderPaper: renderPaper };
})(window);
