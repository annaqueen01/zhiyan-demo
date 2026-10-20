/* 阶段页 4 · 数据处理（数据源 + 质量诊断 + 清洗 + 描述统计） */
(function (global) {
  'use strict';
  var ZY = global.ZY, U = ZY.util, D = ZY.data, S = ZY.store, E = ZY.engine;
  var el = U.create;

  function render(host) {
    var p = S.project();
    var pipe = (p && p.pipeline) || {};
    var confirmed = p && p.designConfirmed;
    var RES = ZY.resource;
    var hasReal = !!(RES && RES.ready && RES.ready());

    host.appendChild(el('div.section-heading', {}, [
      el('h2', { text: '数据处理' }),
      el('small', { text: '数据清洗 · 描述性统计' })
    ]));

    if (!confirmed) {
      host.appendChild(lockBanner());
      return;
    }

    if (hasReal) renderRealSource(host, p, RES);
    else renderSampleSource(host);

    /* 清洗与描述统计的结果 */
    renderStepBlock(host, 'data-prep', pipe['data-prep']);
    renderStepBlock(host, 'descriptive', pipe['descriptive']);
  }

  /** 真实数据目录：可选中，选中后下面的面板识别与缺失统计都换成这个文件的真值 */
  function renderRealSource(host, p, RES) {
    var ov = RES.catalogOverview();
    host.appendChild(el('h3.subhead', {}, [
      '数据源',
      el('span.sub-note', {
        text: ov.files + ' 个真实文件 · ' + ov.packages + ' 个数据包 · ' +
          U.fmtInt(ov.rows) + ' 行（跨文件合计）· ' + U.fmtInt(ov.vars) + ' 个变量'
      })
    ]));

    host.appendChild(el('div.card', {}, [
      el('p.hint', {
        text: '原始数据文件在你本机，没有随包分发；这里内置的是目录、变量字典与描述统计。' +
          '选定一个文件后，下面的面板结构识别与缺失统计就用**它的真实字段与真实数值**，' +
          '实验设计里的「采用的数据」也会以它为准。'
      })
    ]));

    var wrap = el('div.card.ds-catalog');
    RES.groupDatasets().forEach(function (g) {
      wrap.appendChild(el('div.ds-pkg', {}, [
        el('span.ds-pkg-name', { text: g.name }),
        el('span.sub-note', { text: g.items.length + ' 个文件' })
      ]));
      g.items.forEach(function (ds) {
        var picked = !!(p && p.datasetId === ds.id);
        wrap.appendChild(el('button.ds-pick' + (picked ? '.on' : ''), {
          type: 'button',
          'aria-pressed': picked ? 'true' : 'false',
          onclick: function () { ZY.app.pickDataset(ds.id); }
        }, [
          el('span.dp-name', { text: ds.file }),
          el('span.dp-meta', { text: RES.datasetLine(ds, { withUnit: true, withNote: true }) })
        ]));
      });
    });
    host.appendChild(wrap);

    var chosen = p && p.datasetId ? RES.datasetById(p.datasetId) : null;
    if (!chosen) {
      /* 没选就预览真实的分析样本（合并面板），而不是随便挑第一个 */
      var all = RES.datasets();
      chosen = all.filter(function (x) { return /panel\.dta$/.test(x.file); })[0] || all[0] || null;
      if (chosen) {
        host.appendChild(el('div.banner.warn', {}, [
          el('span', { html: U.ICONS.warn, style: { marginTop: '2px' } }),
          el('div.banner-body', {}, [
            el('div.banner-title', { text: '还没有选定数据文件' }),
            el('div', { text: '下面用目录里的合并面板做预览。选定之后，设计阶段的「采用的数据」与变量的「数据字段」都会以你选的那份为准。' })
          ])
        ]));
      }
    }
    if (!chosen) return;

    host.appendChild(el('h3.subhead', {}, [
      '面板结构识别',
      el('span.sub-note', { text: chosen.file })
    ]));
    host.appendChild(el('div.card-grid.three', {}, [
      infoCard('个体维度', chosen.unitId || '未识别',
        chosen.unitId
          ? (chosen.nUnits ? '共 ' + U.fmtInt(chosen.nUnits) + ' 个个体' : '识别到个体列，未取到个数')
          : '该文件里没有能当个体维度的列'),
      infoCard('时间维度', chosen.timeId || '未识别',
        chosen.timeId
          ? (chosen.yearMin && chosen.yearMax ? chosen.yearMin + '—' + chosen.yearMax : '识别到时间列，未取到年份范围')
          : '该文件里没有能当时间维度的列'),
      infoCard('缺失情况',
        chosen.missingRate == null ? '未计算' : (chosen.missingRate * 100).toFixed(2) + '%',
        chosen.statsNote === 'partial-first-2000-rows'
          ? '按文件前 2000 行计算，不是全样本'
          : (chosen.missingRate == null ? '该文件未算出统计量' : '全列平均缺失率'))
    ]));

    host.appendChild(el('h3.subhead', {}, [
      '变量字典与描述统计',
      el('span.sub-note', { text: '真实值；没算出来的一律写「未计算」' })
    ]));
    var CAP = 80;
    var vars = chosen.variables || [];
    host.appendChild(el('div.table-wrap', {}, [
      el('table.table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: '字段' }), el('th', { text: '含义' }), el('th', { text: '类型' }),
          el('th.num', { text: '缺失率' }), el('th.num', { text: '均值' }),
          el('th.num', { text: '标准差' }), el('th.num', { text: '最小' }), el('th.num', { text: '中位' }), el('th.num', { text: '最大' })
        ])),
        el('tbody', {}, vars.slice(0, CAP).map(function (c) {
          var f = function (x) { return x == null ? '—' : U.fmtNum(x, 3); };
          return el('tr', {}, [
            el('td', { html: '<span class="mono">' + U.escapeHtml(c.name) + '</span>' }),
            el('td', {}, [
              el('span', { text: c.label || '—' }),
              c.labelFrom ? el('span.hint', { text: '（来自字段说明）' }) : null
            ]),
            el('td', { text: c.type === 'num' ? '数值' : (c.type === 'str' ? '文本' : '?') }),
            el('td.num', { text: c.missing == null ? '未计算' : (c.missing * 100).toFixed(1) + '%' }),
            el('td.num', { text: f(c.mean) }), el('td.num', { text: f(c.sd) }),
            el('td.num', { text: f(c.min) }), el('td.num', { text: f(c.p50) }), el('td.num', { text: f(c.max) })
          ]);
        }))
      ])
    ]));
    if (vars.length > CAP) {
      host.appendChild(el('p.hint', { text: '该文件共 ' + vars.length + ' 个字段，上表只显示前 ' + CAP + ' 个。' }));
    }
  }

  /** 没有真实目录时的兜底：内置样例数据集 */
  function renderSampleSource(host) {
    host.appendChild(el('h3.subhead', {}, ['数据源']));
    var list = el('div.card');
    D.DATASETS.forEach(function (ds) {
      list.appendChild(el('div.res-item', {}, [
        el('span.badge.blue', { text: ds.shape === 'panel' ? '面板' : '截面' }),
        el('span.res-name', { text: ds.file }),
        el('span.res-meta', { text: U.fmtInt(ds.rows) + ' 行 × ' + ds.cols + ' 列 · ' + U.fmtBytes(ds.size) })
      ]));
    });
    list.appendChild(el('p.hint', { text: '支持"选择本地文件夹"或"上传到浏览器"；两者都能被检索、匹配与调用。上传 CSV 后，下面的面板识别与计量计算会直接用你导入的这份数据，而不是内置样例。', style: { marginTop: '10px' } }));
    host.appendChild(list);

    var ds0 = D.DATASETS[0];
    host.appendChild(el('h3.subhead', {}, ['面板结构识别', el('span.sub-note', { text: '这是统计误用的第一道闸' })]));
    host.appendChild(el('div.card-grid.three', {}, [
      infoCard('个体维度', ds0.unitId, '企业代码，共 ' + U.fmtInt(ds0.nUnits) + ' 家'),
      infoCard('时间维度', ds0.timeId, '共 ' + ds0.nPeriods + ' 期（2011—2022）'),
      infoCard('平衡性', '不平衡', '缺失率 ' + (ds0.missingRate * 100).toFixed(1) + '%，随机缺失检验 p = 0.31')
    ]));

    host.appendChild(el('h3.subhead', {}, ['列类型推断与缺失统计']));
    host.appendChild(el('div.table-wrap', {}, [
      el('table.table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: '字段' }), el('th', { text: '含义' }), el('th', { text: '类型' }), el('th.num', { text: '缺失率' }), el('th', { text: '处理方式' })
        ])),
        el('tbody', {}, ds0.columns.map(function (c) {
          var rate = c.missing;
          var handle = rate === 0 ? '无需处理' : '行业-年份中位数';
          return el('tr', {}, [
            el('td', { html: '<span class="mono">' + U.escapeHtml(c.name) + '</span>' }),
            el('td', { text: c.label }),
            el('td', { text: c.type }),
            el('td.num', { text: (rate * 100).toFixed(1) + '%' }),
            el('td', { text: handle, style: { color: rate > 0.05 ? 'var(--warning)' : 'inherit' } })
          ]);
        }))
      ])
    ]));
  }

  function infoCard(title, value, desc) {
    return el('div.card', {}, [
      el('h3', { text: title }),
      el('div', { text: value, style: { fontSize: '15px', fontWeight: '600', fontFamily: 'var(--font-mono)', marginBottom: '6px' } }),
      el('p', { text: desc })
    ]);
  }

  function lockBanner() {
    return el('div.banner.warn', {}, [
      el('span', { html: U.ICONS.lock, style: { marginTop: '2px' } }),
      el('div.banner-body', {}, [
        el('div.banner-title', { text: '实验设计尚未确认，数据阶段锁定' }),
        el('div', { text: '确认之前不会读取任何数据。请先在「实验设计」页核对方案并确认。' }),
        el('div.banner-actions', {}, [
          el('button.btn.btn-sm', { type: 'button', text: '前往实验设计', onclick: function () { ZY.app.switchTab('design'); } })
        ])
      ])
    ]);
  }

  /** 渲染某一步的结果摘要（复用 stats 页的通用块） */
  function renderStepBlock(host, stepId, st) {
    var def = ZY.store.PIPELINE_STEPS.filter(function (s) { return s.id === stepId; })[0];
    host.appendChild(el('h3.subhead', {}, [
      def.no + ' ' + def.label,
      el('span.sub-note', { text: statusText(st) }),
      /* 这里只给摘要，完整的过程文件与解读在统计分析页那一段里 */
      el('button.text-action', {
        type: 'button', text: '在统计分析里查看 →',
        onclick: function () { ZY.app.gotoStep(stepId); }
      })
    ]));
    if (!st || (st.status !== 'done' && st.status !== 'stale')) {
      host.appendChild(el('div.card', {}, [
        el('p', { text: '该步骤尚未执行。确认设计后会自动依次执行，也可在「统计分析」页单独启动。' })
      ]));
      return;
    }
    var data = D.STEPS[stepId];
    host.appendChild(el('div.card', {}, [
      el('p', { text: data.summary }),
      el('div.divider'),
      el('div.evidence', {}, data.metrics.map(function (m) {
        return el('div.evidence-item', {}, [
          el('strong', { text: m.v }),
          el('span', { text: m.k })
        ]);
      }))
    ]));
    var view = S.get().segView;
    host.appendChild(ZY.render.stepArtifacts(stepId, view));
  }

  function statusText(st) {
    if (!st) return '未执行';
    if (st.status === 'done') return '已完成 · 第 ' + st.runNo + ' 次运行';
    if (st.status === 'running') return '执行中 · ' + (st.percent || 0) + '%';
    if (st.status === 'stale') return '设计已变更，结果待更新';
    if (st.status === 'skipped') return '已跳过';
    return '未执行';
  }

  ZY.stages = ZY.stages || {};
  ZY.stages.data = { render: render, renderStepBlock: renderStepBlock, statusText: statusText, lockBanner: lockBanner };
})(window);
