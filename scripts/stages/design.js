/* 阶段页 3 · 实验设计（七分区 + 检查清单 + 确认门） */
(function (global) {
  'use strict';
  var ZY = global.ZY, U = ZY.util, D = ZY.data, S = ZY.store, E = ZY.engine, C = ZY.checklist;
  var el = U.create;

  var STATUS_BADGE = {
    pass: { cls: '.ok', text: '通过' },
    fail: { cls: '.err', text: '不通过' },
    unknown: { cls: '.warn', text: '信息不足' }
  };

  /* 实验设计必须包含的七个组成部分（顺序固定）。
     ①② 已经被「研究问题」「研究假设」占用，所以这里从 ③ 开始由页面统一编号。 */
  var BLOCK_ORDER = ['data-prep', 'window', 'scope', 'variables', 'robustness', 'heterogeneity', 'mechanism'];
  var BLOCK_TITLE = {
    'data-prep': '数据处理',
    'window': '基础回归数据区间选择',
    'scope': '研究样本范围',
    'variables': '变量度量（因变量 / 自变量 / 控制变量）',
    'robustness': '稳健性设计方案',
    'heterogeneity': '异质性设计方案',
    'mechanism': '机制设计'
  };

  /** 圈号：① = U+2460 */
  function circ(n) { return String.fromCharCode(0x2460 + n - 1); }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function list(v) { return Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []); }

  /**
   * 取设计的七个分块。
   * 新设计直接给 blocks；旧项目存的是 sample + pipeline 结构，
   * 这里从旧字段回退拼一份，缺的「选择理由」如实留空并在页面上标出来，
   * 不编一段理由填上。
   */
  function designBlocks(d) {
    var byId = {};
    list(d.blocks).forEach(function (b) { if (b && b.id) byId[b.id] = b; });
    var pipe = {};
    list(d.pipeline).forEach(function (x) { if (x && x.stepId) pipe[x.stepId] = list(x.items); });
    var s = d.sample || {};
    var fallback = {
      'data-prep': { data: s.source, items: pipe['data-prep'] },
      'window': { data: s.period },
      'scope': { data: s.filter },
      'variables': { data: '' },
      'robustness': { items: pipe['robustness'] },
      'heterogeneity': { items: pipe['heterogeneity'] },
      'mechanism': { items: pipe['mechanism'] }
    };
    return BLOCK_ORDER.map(function (id) {
      var b = byId[id] || {};
      var f = fallback[id] || {};
      return {
        id: id,
        title: str(b.title) || BLOCK_TITLE[id],
        data: str(b.data) || str(f.data),
        why: str(b.why),
        items: list(b.items).length ? list(b.items) : list(f.items),
        refs: list(b.refs)
      };
    });
  }

  /** 参考文献条：优先按文献库解析成「作者（年）」，解析不到就原样显示 id */
  function refChip(id) {
    id = str(id);
    var doc = null;
    if (ZY.resource && ZY.resource.byId) doc = ZY.resource.byId(id);
    if (!doc) {
      var lib = D.LIBRARY || [];
      for (var i = 0; i < lib.length; i++) if (lib[i].id === id) { doc = lib[i]; break; }
    }
    if (!doc) return el('span.lit-chip', { text: id || '—' });
    var first = str(doc.authors).split(/[,，]/)[0] || '未标注作者';
    var more = /[,，]/.test(str(doc.authors)) ? ' 等' : '';
    var yr = doc.year == null ? '年份未标注' : doc.year;
    return el('span.lit-chip', {
      text: first + more + '（' + yr + '）',
      title: doc.title + ' · ' + (doc.journal || '期刊未标注') + ' · ' + yr
    });
  }

  function litRow(ids) {
    var row = el('div.lit-row', {}, [el('span.group-label', { text: '参考文献' })]);
    ids.forEach(function (x) { row.appendChild(refChip(x)); });
    return row;
  }

  /** 变量度量表：变量 / 角色 / 度量方式（含选择理由）/ 数据字段 / 缺失处理 / 预期符号 / 参考文献 */
  /**
   * 变量度量表。
   * 选定真实数据集后，「数据字段」一列会**逐行回真实文件核对**：
   *   命中 → 显示真实字段名 + 中文含义（绿）
   *   没命中 → 标红并写明「该文件里没有这个字段」
   * 这是把「不编造」落到变量定义上：模型写的字段名必须能在文件里找到。
   */
  function variableTable(vars, datasetId) {
    var RES = ZY.resource;
    var ds = (RES && datasetId && RES.datasetById) ? RES.datasetById(datasetId) : null;
    var missCount = 0;
    var rows = (vars || []).map(function (v) {
      var refs = str(v.lit).split(/[,，]/).map(str).filter(function (x) { return x && x !== '—'; });
      var chk = (RES && ds && RES.checkField) ? RES.checkField(datasetId, v.source, v.name) : { checked: false };
      var fieldCell;
      if (!chk.checked) {
        fieldCell = el('td', { html: '<span class="mono" style="font-size:11px">' + U.escapeHtml(v.source) + '</span>' });
      } else if (chk.ok) {
        fieldCell = el('td', {}, [
          el('div', { html: '<span class="mono" style="font-size:11px">' + U.escapeHtml(chk.field.name) + '</span>' }),
          el('div.cell-note.ok', { text: '已在该文件中找到：' + (chk.field.label || '无中文标签') +
            (chk.field.missing == null ? '' : '（缺失 ' + (chk.field.missing * 100).toFixed(1) + '%）') })
        ]);
      } else {
        missCount++;
        fieldCell = el('td', {}, [
          el('div', { html: '<span class="mono" style="font-size:11px">' + U.escapeHtml(v.source || '（未写）') + '</span>' }),
          el('div.cell-note.err', { text: '⚠ 该文件里没有这个字段' })
        ]);
      }
      return el('tr', {}, [
        el('td', { html: '<span class="mono">' + U.escapeHtml(v.name) + '</span>' }),
        el('td', { text: v.role }),
        el('td', { style: { whiteSpace: 'normal' } }, [
          el('div', { text: v.construction }),
          v.why ? el('div.cell-note', { text: '选择理由：' + v.why }) : null
        ]),
        fieldCell,
        el('td', { text: v.missing }),
        el('td.num', { text: v.sign }),
        el('td', {}, refs.length
          ? refs.map(refChip)
          : [el('span.hint', { text: '—' })])
      ]);
    });
    var out = el('div');
    if (ds) {
      out.appendChild(el(missCount ? 'div.banner.warn' : 'div.banner.ok', {}, [
        el('span', { html: missCount ? U.ICONS.warn : U.ICONS.check, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div.banner-title', {
            text: missCount
              ? ('有 ' + missCount + ' 个变量写的数据字段在「' + ds.file + '」里找不到')
              : ('变量表里的数据字段都能在「' + ds.file + '」里找到')
          }),
          el('div', {
            text: missCount
              ? '这些字段要么是模型编的，要么得换一份数据。确认之前先处理掉——变量定义落不到真实字段上，后面七步实证就跑不起来。'
              : '已按 ' + U.fmtInt((ds.variables || []).length) + ' 个真实字段逐行核对过。'
          })
        ])
      ]));
    }
    out.appendChild(el('div.table-wrap', {}, [
      el('table.table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: '变量' }), el('th', { text: '角色' }), el('th', { text: '变量度量' }),
          el('th', { text: '数据字段' }), el('th', { text: '缺失处理' }), el('th', { text: '预期符号' }),
          el('th', { text: '参考文献' })
        ])),
        el('tbody', {}, rows)
      ])
    ]));
    return out;
  }

  /** 本设计依据的数据：显示 + 就地切换 */
  function dataBaseBanner(p) {
    var RES = ZY.resource;
    if (!RES || !RES.ready || !RES.ready()) return null;
    var ds = p.datasetId ? RES.datasetById(p.datasetId) : null;
    var card = el('div.card.ds-base');
    card.appendChild(el('div.ds-base-head', {}, [
      el('span.badge.' + (ds ? 'ok' : 'warn'), { text: ds ? '依据数据已选定' : '尚未选定数据' }),
      el('span', { text: ds ? RES.datasetLine(ds, { withUnit: true, withNote: true }) : '下面的设计不是照着某份具体数据写的' })
    ]));
    var opts = [el('option', { value: '', text: ds ? '（取消选定）' : '选择一份数据文件…' })];
    RES.groupDatasets().forEach(function (g) {
      var og = el('optgroup', { label: g.name });
      g.items.forEach(function (x) {
        og.appendChild(el('option', { value: x.id, text: x.file + '  ·  ' + (x.rows == null ? '?' : U.fmtInt(x.rows)) + ' 行 × ' + x.cols + ' 列' }));
      });
      opts.push(og);
    });
    var sel = el('select.ds-base-select', {
      onchange: function () {
        var v = sel.value;
        if (!v) { S.updateProject({ datasetId: null }); renderAll(); return; }
        ZY.app.pickDataset(v);
      }
    }, opts);
    if (ds) sel.value = ds.id;
    card.appendChild(el('div.ds-base-row', {}, [
      el('span.ds-base-label', { text: '换成' }), sel,
      el('span.hint', { text: '换数据会让已确认的设计失效' })
    ]));
    return card;
  }

  function render(host) {
    var p = S.project();
    var d = (p && p.design) ? p.design : null;
    if (!d) { renderNoDesign(host, p); return; }
    var gate = E.gateCheck(p);
    var confirmed = p && p.designConfirmed;
    var wording = E.projectWording(p);

    host.appendChild(el('div.section-heading', {}, [
      el('h2', { text: '实验设计' }),
      el('small', { text: '第 ' + d.version + ' 版 · ' + (confirmed ? '已确认（hash ' + p.designHash + '）' : '待确认') })
    ]));

    /* 本设计依据的数据：可在此就地切换；换数据会让已确认的设计失效 */
    var dbBanner = dataBaseBanner(p);
    if (dbBanner) host.appendChild(dbBanner);

    /* 门禁状态横幅 */
    if (confirmed) {
      host.appendChild(el('div.banner.ok', {}, [
        el('span', { html: U.ICONS.check, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div.banner-title', { text: '设计已确认，实证执行已解锁' }),
          el('div', { text: '确认时间 ' + U.hhmm(p.updatedAt) + '。修改设计任意字段会使确认自动失效，需重新确认。' })
        ])
      ]));
    } else if (gate.status === 'blocked') {
      host.appendChild(el('div.banner.err', {}, [
        el('span', { html: U.ICONS.lock, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div.banner-title', { text: '设计未确认：执行器拒绝读取数据（' + gate.blockers.length + ' 项待处置）' }),
          el('ul', { style: { marginTop: '6px' } }, gate.blockers.map(function (b) {
            return el('li', { text: '· ' + (b.ref ? '[' + b.ref + '] ' : '') + b.need });
          })),
          el('div.banner-actions', {}, [
            el('button.btn.btn-primary.btn-sm', { type: 'button', text: '处置未通过项并确认', onclick: function () { global.ZY.app.openGateModal(); } })
          ])
        ])
      ]));
    } else {
      host.appendChild(el('div.banner.info', {}, [
        el('span', { html: U.ICONS.info, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div.banner-title', { text: '方案已就绪，等待你确认' }),
          el('div', { text: '确认之前不会读取任何数据。' + (gate.warnings.length ? '有 ' + gate.warnings.length + ' 项需要你知情。' : '') }),
          el('div.banner-actions', {}, [
            el('button.btn.btn-primary.btn-sm', { type: 'button', text: '查看并确认', onclick: function () { global.ZY.app.openGateModal(); } })
          ])
        ])
      ]));
    }

    /* 分区一/二：研究问题 + 假设 */
    host.appendChild(el('div.card-grid.two', {}, [
      el('section.card', {}, [
        el('h3', { text: '① 研究问题' }),
        el('p', { text: (p.rq ? p.rq.claimSentence : '（未识别研究问题）'), style: { color: 'var(--ink)', fontWeight: '600', textIndent: '0' } }),
        el('div.divider'),
        el('div.deflist', {}, [
          el('dt', { text: '结论类型' }), el('dd', { text: (p.rq ? (ZY.rq.CLAIM_LABEL[p.rq.claimType] || p.rq.claimType) : '—') + '（由研究问题推导）' }),
          el('dt', { text: '当前允许措辞' }), el('dd', {}, [el('span.badge.warn', { text: C.WORDING[wording].label })]),
          el('dt', { text: '研究缺口' }), el('dd', { text: '机制类文献仅 3 篇；稳健性完整报告的仅 2 篇' })
        ])
      ]),
      el('section.card', {}, [
        el('h3', { text: '② 研究假设（确认即冻结）' }),
        d.hypotheses.map(function (h) {
          return el('div', { style: { marginBottom: '12px' } }, [
            el('div', { style: { fontWeight: '600', fontSize: '13px' } }, [el('span.badge.blue', { text: h.id }), ' ' + h.statement]),
            el('p.hint', { text: '方向 ' + h.direction + ' · 机制：' + h.mechanism + ' · 被解释变量：' + h.outcomeVar, style: { marginTop: '4px' } })
          ]);
        }),
        el('p.hint', { text: '冻结后若在结果出来之后再改假设，会记进偏离台账并在初稿里自动披露。' })
      ])
    ]));

    /* 分区三～六 / 八～十：设计的七个组成部分。
       每一块都必须写清两件事：采用的数据、为什么这样选，并附参考文献。 */
    var blocks = designBlocks(d);
    var sectionNo = 3;

    function pushBlock(b) {
      host.appendChild(el('h3.subhead', {}, [
        circ(sectionNo++) + ' ' + b.title,
        el('span.sub-note', { text: '采用的数据 · 选择理由 · 参考文献' })
      ]));
      var card = el('section.card');
      /* 「采用的数据」里点名的文件，回真实数据目录核一遍：
         编出来的文件名 / 写的是另一份文件，都在这里被抓住。 */
      var RESx = ZY.resource;
      var dataNote = null;
      if (RESx && RESx.checkDataText) {
        var ck = RESx.checkDataText(b.data, p.datasetId);
        if (ck.kind === 'ok') {
          dataNote = el('div.cell-note.ok', { text: '✓ 用的就是已选定的数据文件' });
        } else if (ck.kind === 'other') {
          dataNote = el('div.cell-note.err', {
            text: ck.noPin
              ? ('⚠ 用的是目录里的「' + ck.file + '」，但你还没选定数据文件')
              : ('⚠ 用的是「' + ck.file + '」，不是已选定的「' + ck.pinned + '」')
          });
        } else if (ck.kind === 'unknown') {
          dataNote = el('div.cell-note.err', {
            text: '⚠ 数据目录里没有这个文件名：' + ck.token
          });
        }
      }
      card.appendChild(el('div.deflist', {}, [
        el('dt', { text: '采用的数据' }),
        el('dd', {}, [b.data
          ? el('span', { text: b.data })
          : el('span', { text: '（未填写）', style: { color: 'var(--warning)' } }),
          dataNote]),
        el('dt', { text: '为什么这样选' }),
        el('dd', {}, [b.why
          ? el('span', { text: b.why })
          : el('span', { text: '（这份设计没有给出选择理由，建议让模型重新生成）', style: { color: 'var(--warning)' } })])
      ]));
      if (b.items.length) {
        card.appendChild(el('div.divider'));
        card.appendChild(el('div.group-label', { text: '具体做法' }));
        card.appendChild(el('ul.plain-list', {}, b.items.map(function (t) {
          return el('li', { text: String(t) });
        })));
      }
      if (b.id === 'scope' && d.sample) {
        card.appendChild(el('div.divider'));
        card.appendChild(el('div.deflist', {}, [
          el('dt', { text: '观测层级' }), el('dd', { text: d.sample.obsLevel || '—' }),
          el('dt', { text: '计划样本量' }), el('dd', { text: U.fmtInt(d.sample.nPlanned) + ' 个企业-年 · ' + U.fmtInt(d.sample.nUnits) + ' 家企业' }),
          el('dt', { text: '缺失处理' }), el('dd', { text: d.sample.missingHandling || '—' })
        ]));
      }
      if (b.id === 'variables') {
        card.appendChild(el('div.divider'));
        card.appendChild(variableTable(d.variables, p.datasetId));
      }
      if (b.refs.length) {
        card.appendChild(el('div.divider'));
        card.appendChild(litRow(b.refs));
      }
      host.appendChild(card);
    }

    blocks.slice(0, 4).forEach(pushBlock);

    /* 分区七：模型设定 */
    host.appendChild(el('h3.subhead', {}, [circ(sectionNo++) + ' 模型设定']));
    host.appendChild(el('div.card', {}, [
      el('div.code-block', { text: d.model.equation, style: { maxHeight: 'none', marginBottom: '14px' } }),
      el('div.deflist', {}, [
        el('dt', { text: '固定效应' }), el('dd', { text: d.model.feTerms.join(' + ') }),
        el('dt', { text: '聚类层级' }), el('dd', {}, [el('strong', { text: d.model.cluster }), ' ', el('span.hint', { text: '（' + d.model.clusterNote + '）' })]),
        el('dt', { text: '权重' }), el('dd', { text: d.model.weights }),
        el('dt', { text: '估计方法' }), el('dd', { text: d.model.estimator })
      ])
    ]));

    /* 分区八～十：稳健性 / 异质性 / 机制 */
    blocks.slice(4).forEach(pushBlock);

    /* 分区十一：检查清单 */
    host.appendChild(el('h3.subhead', {}, [circ(sectionNo++) + ' 识别策略检查清单', el('span.sub-note', { text: '逐项 pass / fail / unknown，unknown 不默认为 pass' })]));
    host.appendChild(el('div.table-wrap', {}, [
      el('table.table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: '检查项' }), el('th', { text: '判定' }), el('th', { text: '依据 / 需要你补什么' }), el('th', { text: '操作' })
        ])),
        el('tbody', {}, d.checks.map(function (c) {
          var sb = STATUS_BADGE[c.status] || STATUS_BADGE.unknown;
          return el('tr', {}, [
            el('td', {}, [
              el('div', { style: { fontWeight: '600' } }, [el('span.mono', { text: c.id })]),
              el('div.hint', { text: c.label })
            ]),
            el('td', {}, [el('span.badge' + sb.cls, { text: sb.text })]),
            el('td', { style: { whiteSpace: 'normal', minWidth: '260px' } }, [
              el('div', { text: c.evidence, style: { fontSize: '12px' } }),
              c.need ? el('div', { text: '需补：' + c.need, style: { fontSize: '11px', color: 'var(--warning)', marginTop: '4px' } }) : null
            ]),
            el('td', {}, [
              (c.status !== 'pass' && !c.disposed)
                ? el('button.btn.btn-sm', {
                    type: 'button', text: '处置',
                    onclick: function () { global.ZY.app.openDisposeModal(c.id); }
                  })
                : el('span.hint', { text: c.status === 'pass' ? '—' : '已处置' })
            ])
          ]);
        }))
      ])
    ]));

    /* 分区十二：预期结果 */
    host.appendChild(el('h3.subhead', {}, [circ(sectionNo++) + ' 预期结果与不符预案']));
    host.appendChild(el('div.card', {}, [
      el('div.deflist', {}, [
        el('dt', { text: '预期符号' }), el('dd', { text: d.expected.sign }),
        el('dt', { text: '预期量级' }), el('dd', { text: d.expected.magnitude }),
        el('dt', { text: '预期显著性' }), el('dd', { text: d.expected.significance }),
        el('dt', { text: '不符预案' }), el('dd', { text: d.expected.fallback })
      ])
    ]));

    /* 底部动作 */
    host.appendChild(el('div.divider'));
    var actions = el('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' } });
    actions.appendChild(el('button.btn', {
      type: 'button', text: '导出设计方案',
      onclick: function () { global.ZY.app.exportDesign(); }
    }));
    actions.appendChild(el('button.btn' + (confirmed ? '' : '.btn-primary'), {
      type: 'button',
      text: confirmed ? '重新确认设计' : '确认并开始实证',
      disabled: false,
      onclick: function () { global.ZY.app.openGateModal(); }
    }));
    host.appendChild(actions);
  }

  ZY.stages = ZY.stages || {};
  /**
   * 还没有实验设计时的占位。
   * 关键：**不显示预置设计**。真实课题没生成出设计就是没有，
   * 显示一份"数字化转型"的设计会让人以为那是自己的方案。
   */
  function renderNoDesign(host, p) {
    host.appendChild(el('div.section-heading', {}, [
      el('h2', { text: '实验设计' }),
      el('small', { text: '尚未生成' })
    ]));

    /* 检索/生成进行中：显示动效，避免用户以为卡住了 */
    var st = S.get();
    if (st.litRunning) {
      host.appendChild(ZY.ui.searchProgress(
        '小智快速检索文献中',
        '检索完成后会立刻基于你的研究问题生成设计。已完成 ' +
          (st.litRunning.done || 0) + '/' + (st.litRunning.total || 0) + ' 路'
      ));
      return;
    }
    if (st.designRunning) {
      host.appendChild(ZY.ui.progressLine('小智正在生成实验设计'));
      return;
    }

    var hasRq = !!(p && p.rq);
    host.appendChild(el('div.banner.' + (hasRq ? 'info' : 'warn'), {}, [
      el('span', { html: hasRq ? U.ICONS.info : U.ICONS.warn, style: { marginTop: '2px' } }),
      el('div.banner-body', {}, [
        el('div.banner-title', { text: hasRq ? '实验设计还没生成' : '还没有研究问题' }),
        el('div', { text: hasRq
          ? '设计要基于你的研究问题由模型生成，所以这里现在是空的。我没有放一份预置方案——那会把你的变量和识别策略换成另一个课题。'
          : '先在对话区提交你的研究问题。我需要先把它识别成结构化命题，才能据此设计实证策略。' }),
        el('div.banner-actions', {}, [
          hasRq
            ? el('button.btn.btn-primary.btn-sm', {
                type: 'button', text: '重新生成实验设计',
                onclick: function () { ZY.app.regenerateDesign(); }
              })
            : el('button.btn.btn-sm', {
                type: 'button', text: '去对话区输入',
                onclick: function () { ZY.app.switchTab('definition'); }
              })
        ])
      ])
    ]));

    if (!hasRq) return;

    /* 已有 RQ 时，把槽位摆出来，让用户知道设计会基于什么 */
    host.appendChild(el('h3.subhead', {}, ['将据此生成设计的研究问题']));
    host.appendChild(el('div.card', {}, [
      el('div.deflist', {}, [
        el('dt', { text: '研究问题' }), el('dd', { text: p.rq.researchQuestion || '—' }),
        el('dt', { text: '对象与层级' }), el('dd', { text: p.rq.objectLevel || '—' }),
        el('dt', { text: '被解释变量' }), el('dd', { text: p.rq.outcomeVar || '—' }),
        el('dt', { text: '核心解释变量' }), el('dd', { text: p.rq.treatmentVar || '—' }),
        el('dt', { text: '变异来源' }), el('dd', { text: p.rq.variationSource || '—' }),
        el('dt', { text: '结论类型' }), el('dd', {}, [
          el('span.badge' + (p.rq.claimType === 'causal' ? '.ok' : '.warn'), {
            text: (ZY.rq.CLAIM_LABEL[p.rq.claimType] || p.rq.claimType)
          })
        ])
      ])
    ]));
  }

  ZY.stages.design = { render: render };
})(window);
