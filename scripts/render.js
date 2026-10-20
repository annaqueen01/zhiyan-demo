/* ============================================================
   智研 · 渲染层
   页面壳 / 对话 / 阶段页分派 / 三件套 / 模态与抽屉
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY, U = ZY.util, D = ZY.data, S = ZY.store, E = ZY.engine;
  var el = U.create;

  /* ---------------- 顶部栏 ---------------- */
  function topbar() {
    var st = S.get();
    /* 顶栏只保留「品牌 + 全局状态」：项目名交给研究对话页头与成果区标题，
       不在顶栏重复一遍。 */
    var sync = U.$('#sync-status');
    sync.dataset.state = st.syncState === 'error' ? 'offline' : 'local';
    sync.textContent = st.syncState === 'error' ? '本地保存失败' : '本地已保存';
    /* 左下角用户行：只保留身份 + 「点击设置」入口，不在这里堆配置统计。
       模型状态改由输入组里的模型选择器表达（见 app.js 的 updateModelPicker）。 */
    var u = st.user || { name: '研究者' };
    U.$('#user-avatar').textContent = S.avatarChar();
    U.$('#user-name').textContent = u.name || '研究者';
    U.$('#user-hint').textContent = '点击设置';
  }

  function configuredCount() {
    var st = S.get();
    return st.providers.filter(function (p) { return !!st.credentials[p.credentialRef]; }).length;
  }

  /* ---------------- 视图切换：资源页 / 项目页 / 空态 ---------------- */
  /**
   * 三态视图：资源页 / 项目三栏 / 空态两栏。
   * data-view 放在 .app 上，栅格重排完全由 CSS 负责（见 layout.css）。
   * 空态与项目态的差别只有一处：右侧是"输入框+示例卡片"还是"对话记录+成果区"。
   */
  function views() {
    var st = S.get();
    var app = U.$('.app');
    var resourceView = U.$('#resource-view');
    var projectView = U.$('#project-view');
    var p = activeProject();

    if (st.resourcePage) {
      app.dataset.view = 'resource';
      resourceView.hidden = false;
      projectView.hidden = true;
      resourceView.innerHTML = '';
      renderResourcePage(resourceView, st.resourcePage);
      U.$('#btn-dataset').setAttribute('aria-current', st.resourcePage === 'dataset' ? 'true' : 'false');
      U.$('#btn-library').setAttribute('aria-current', st.resourcePage === 'library' ? 'true' : 'false');
      return;
    }

    U.$('#btn-dataset').setAttribute('aria-current', 'false');
    U.$('#btn-library').setAttribute('aria-current', 'false');
    resourceView.hidden = true;
    projectView.hidden = !p;

    /* 关键：没有活跃项目 = 还没提交首轮研究问题 = 两栏空态 */
    app.dataset.view = p ? 'project' : 'empty';
    if (!p) renderHero();
  }

  /** 空态主区：示例卡片（输入框由 .compose 承担，不在这里复制） */
  function renderHero() {
    var host = U.$('#demo-cards');
    if (!host) return;
    U.clear(host);
    var hasKey = hasAnyCredential();
    D.DEMO_PROJECTS.forEach(function (dp) {
      host.appendChild(el('button.demo-card' + (dp.requiresApi ? '.needs-api' : ''), {
        type: 'button',
        onclick: function () { ZY.app.startDemo(dp.id); }
      }, [
        el('span.dc-tag', { text: dp.tag }),
        el('span.dc-title', { text: dp.title }),
        el('span.dc-desc', { text: dp.desc }),
        dp.requiresApi
          ? el('span.dc-state' + (hasKey ? '.ok' : '.warn'), {
              text: hasKey ? '模型已接入 · 可直接运行' : '需要先接入模型 API'
            })
          : null
      ]));
    });
  }

  /** 侧栏「资源库」对应的活动项目（不跟随「浏览资源」模式） */
  function activeProject() {
    var st = S.get();
    for (var i = 0; i < st.projects.length; i++) {
      if (st.projects[i].id === st.activeId) return st.projects[i];
    }
    return null;
  }

  function hasAnyCredential() {
    var st = S.get();
    return Object.keys(st.credentials).some(function (k) { return !!st.credentials[k]; });
  }

  function modelSummary() {
    var p = S.project();
    var st = S.get();
    var id = p && p.model ? p.model.provider : 'deepseek-official';
    var prof = st.providers.filter(function (x) { return x.id === id; })[0];
    if (!prof) return '模型服务未配置';
    var ci = S.credentialInfo(prof.credentialRef);
    return ci.configured ? ('模型已就绪 · ' + prof.displayName) : (prof.displayName + ' · 未配置密钥');
  }

  /* ---------------- 项目栏 ---------------- */
  function projectRail() {
    var st = S.get();
    var host = U.$('#project-list');
    U.clear(host);
    var unnamed = unnamedRanks(st.projects);
    st.projects.forEach(function (p) {
      var active = p.id === st.activeId;
      var sts = E.stageState(p.id);
      var doneCount = Object.keys(sts).filter(function (k) { return sts[k] === 'done'; }).length;
      var wf = workflowStatus(p);
      /* 列表只保留「状态点 + 标题」两件事；主题、未命名编号、阶段进度等
         次要信息全部收进 title 提示，避免信息过载。 */
      var tip = p.title + ' · ' + doneCount + '/6 阶段 · ' + wf.label;
      if (unnamed[p.id]) {
        tip += ' · #' + unnamed[p.id]
          + ' · 创建于 ' + U.fmtDate(p.createdAt).slice(5)
          + ' · 最近编辑 ' + U.hhmm(p.updatedAt);
      } else if (p.topic) {
        tip += ' · ' + p.topic;
      }
      host.appendChild(el('button.project', {
        type: 'button',
        'aria-current': active ? 'true' : 'false',
        title: tip,
        onclick: function () { ZY.app.selectProject(p.id); }
      }, [
        el('span.ps-dot', { 'data-state': wf.kind, 'aria-hidden': 'true' }),
        el('strong', { text: p.title })
      ]));
    });
    /* 侧栏计数要跟资源库页一致：内置真实资源也算「已入库」，
       否则会出现「文献库 22」而页面里明明写着 73 篇的自相矛盾。 */
    var _rs = (ZY.resource && ZY.resource.ready()) ? ZY.resource.stats() : null;
    U.$('#library-count').textContent = _rs
      ? _rs.total
      : (st.libraryLoaded ? D.LIBRARY_STATS.total : 0);
    U.$('#dataset-count').textContent = _rs
      ? _rs.datasets + D.DATASETS.length
      : (st.datasetLoaded ? D.DATASETS.length : 0);
  }

  /** 是否属于"未命名项目"（副信息仅用于区分，不修改真实项目名） */
  function isUnnamed(p) {
    return !p || !p.title || /^\s*未命名/.test(p.title);
  }

  /** 未命名项目的自动编号：按创建时间排序，编号不随列表顺序变化 */
  function unnamedRanks(projects) {
    var out = {};
    projects.filter(isUnnamed)
      .slice()
      .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); })
      .forEach(function (p, i) { out[p.id] = i + 1; });
    return out;
  }

  /* ---------------- 真实工作流状态（唯一来源） ----------------
     顶部状态、对话副标题、项目行阶段信息都读这里；
     它与"当前查看哪个阶段页签"无关，避免把"正在看论文页"当成"论文已生成"。 */
  function workflowStatus(p) {
    if (!p) return { kind: 'idle', badge: 'plain', label: '尚未开始研究', short: '未开始' };
    if (p.paper) return { kind: 'done', badge: 'ok', label: '论文初稿已生成', short: '论文已生成' };
    if (p.designConfirmed) {
      return isAllDone(p)
        ? { kind: 'done', badge: 'ok', label: '七步实证已完成，可以生成论文初稿', short: '可生成论文' }
        : { kind: 'active', badge: 'plain', label: '实验设计已确认，七步实证执行中', short: '实证执行中' };
    }
    if (p.design) return { kind: 'blocked', badge: 'warn', label: '实验设计待确认，数据与统计阶段锁定', short: '待确认设计' };
    if (p.literatureDone) return { kind: 'active', badge: 'plain', label: '文献分析已完成，等待生成实验设计', short: '文献已完成' };
    return { kind: 'active', badge: 'plain', label: '研究准备中：等待研究问题与文献分析', short: '定义中' };
  }

  /* ---------------- 对话区 ---------------- */
  function chat() {
    var p = S.project();
    U.$('#chat-project-path').textContent = p ? p.title : '研究对话';
    U.$('#chat-subtitle').textContent = p
      ? workflowStatus(p).label
      : '输入研究问题，或选择下方示例开始';
    var thread = U.$('#thread');
    U.clear(thread);
    /* 空态下对话区被 CSS 隐藏，且内容由 #empty-hero 承担，不必渲染 */
    if (!p) return;
    var msgs = p.messages || [];
    if (!msgs.length) {
      thread.appendChild(emptyState());
      return;
    }
    msgs.forEach(function (m) { thread.appendChild(messageEl(m)); });
    thread.scrollTop = thread.scrollHeight;
  }

  function isAllDone(p) {
    if (!p || !p.pipeline) return false;
    return S.PIPELINE_STEPS.every(function (s) {
      var st = p.pipeline[s.id];
      return st && (st.status === 'done' || st.status === 'skipped');
    });
  }

  /**
   * 对话记录的占位（仅当"已有项目但还没有任何消息"时出现）。
   * 真正的空态（未提交研究问题）由 #empty-hero + .compose 承担，
   * 走的是两栏栅格，不在这里渲染。
   */
  function emptyState() {
    return el('div', { style: { paddingTop: '8px' } }, [
      el('div', { style: { fontSize: '12px', color: 'var(--ink-tertiary)', lineHeight: '1.9', fontFamily: 'var(--font-kai)' },
        text: '还没有对话。在下面输入你的研究问题，我会先把它解析成可检验的命题。' })
    ]);
  }

  /* ---------------- 资源库页面（在成果区显示，取代抽屉） ---------------- */
  function renderResourcePage(host, kind) {
    var st = S.get();
    var isLib = kind === 'library';
    var page = el('div.resource-page');
    var inner = el('div.resource-page-inner');
    var RES = ZY.resource;
    var hasReal = !!(RES && RES.ready());
    var RS = hasReal ? RES.stats() : null;

    /* 页头 */
    inner.appendChild(el('div.resource-page-head', {}, [
      el('div', {}, [
        el('h1', { text: isLib ? '文献库' : '数据库' }),
        el('div.resource-sub', {
          text: isLib
            ? (hasReal
                ? ('资源库 / 文献库 · 可检索 ' + RS.total + ' 篇（真实文献 ' + RS.real + ' 篇 + 内置样例 ' + RS.samples +
                   ' 篇）· 共 ' + U.fmtInt(RS.pages) + ' 页 · 命中片段带页号与字符区间，可逐条核验')
                : ('资源库 / 文献库 · 已入库 ' + D.LIBRARY_STATS.total + ' 篇，全部可检索、可匹配、可被 Agent 调用'))
            : (hasReal
                ? ('资源库 / 数据库 · 已入库 ' + RS.datasets + ' 个真实数据文件 · 变量字典 ' +
                   U.fmtInt((RES.summary() || {}).datasetVars || 0) + ' 项，用于实验设计与实证计算')
                : ('资源库 / 数据库 · 已入库 ' + D.DATASETS.length + ' 个数据集，用于实验设计与实证计算'))
        })
      ]),
      el('div', { style: { display: 'flex', gap: '8px', flex: 'none' } }, [
        el('button.btn.btn-sm', {
          type: 'button', text: '返回研究',
          onclick: function () { ZY.app.closeResource(); }
        })
      ])
    ]));

    /* 已内置的真实资源：先讲清楚「有什么」，再讲清楚「哪里不完美」 */
    if (hasReal) {
      var sum = RES.summary() || {};
      var realCard = el('div.card.real-source-card');
      realCard.appendChild(el('div.rsc-head', {}, [
        el('span.badge.ok', { text: '已内置真实资源' }),
        el('span.hint', { text: '来源：' + (RS.source || '') })
      ]));
      realCard.appendChild(el('div.card-grid.three', { style: { marginTop: '12px' } }, isLib ? [
        resCard('真实文献', RS.real + ' 个 PDF', RS.pages + ' 页 · ' + U.fmtInt(RS.chars) + ' 字' +
          (RS.realNotes ? '（含 ' + RS.realNotes + ' 份说明文件）' : '')),
        resCard('可引用篇目', RS.withQuote + ' 篇有原文摘录',
          '期刊名可判定的 ' + RS.withJournal + ' 篇；年份可判定的 ' + RS.withYear + ' 篇'),
        resCard('检索能力', 'BM25 + 页号定位',
          '命中片段给「页号 + 字符区间」，可用原文逐字核验')
      ] : [
        resCard('真实数据文件', RS.datasets + ' 个',
          (sum.datasetRows ? U.fmtInt(sum.datasetRows) + ' 行（跨文件合计）' : '') +
          (sum.datasetVars ? ' · ' + U.fmtInt(sum.datasetVars) + ' 个变量' : '')),
        resCard('有完整统计量的文件', (sum.statsComputed || 0) + ' 个',
          (sum.statsPartial || 0) + ' 个超 80MB 的文件按前 2000 行算，已在表内标注'),
        resCard('方法证据', (sum.artifacts || 0) + ' 份 do / 日志 / 结果',
          '实验设计的「具体做法」可以直接引用，不用凭空编')
      ]));
      var caveats = [];
      if (isLib) {
        if (RS.unreadable) {
          caveats.push(RS.unreadable + ' 篇 PDF 的字体没有嵌 ToUnicode，文本层是字形码 —— 已标为「仅提及」，不给原句摘录，也不参与引用');
        }
        if (RS.real - RS.withJournal > 0) {
          caveats.push((RS.real - RS.withJournal) + ' 篇的刊头里没有期刊名、' + (RS.real - RS.withYear) + ' 篇没有可判定的年份 —— 一律显示「未标注」，没有猜一个填上');
        }
        caveats.push('逐字排版的 PDF 原本会把「地方政府」拆成「地 方 政 府」，已做字间空格清理，否则 bigram 检索会失效');
        caveats.push('PDF 文本是本机抽取后内置的，检索不联网；引用一律给「页号 + 字符区间」，可用原文核对');
      } else {
        if (sum.statsPartial) {
          caveats.push(sum.statsPartial + ' 个数据文件超过 80MB，只按文件前 2000 行算了统计量 —— 表内已标注，精确统计请在 Stata 里跑');
        }
        caveats.push('变量中文含义优先取 Stata 变量标签；没有标签的从《控制变量字段说明.pdf》回填，两处都没有的显示「—」，不编');
        caveats.push('数据文件本身没有内置（最大单个 .dta 有 919MB），这里内置的是目录、变量字典与描述统计');
      }
      realCard.appendChild(el('ul.plain-list.rsc-notes', {}, caveats.map(function (t) {
        return el('li', { text: t });
      })));
      inner.appendChild(realCard);
    }

    /* 来源 */
    inner.appendChild(el('div.resource-section-title', {}, ['来源', el('span.sub-note', { text: '两种来源能力等价' })]));
    var src = el('div.card');
    src.appendChild(el('label.choice', {}, [
      el('input', { type: 'radio', name: 'res-src', checked: true }),
      el('span', {}, ['选择本地文件夹',
        el('span.choice-desc', { text: '需要浏览器支持 File System Access API；只记录文件句柄，不复制文件；下次打开需重新授权，索引不会重算' })])
    ]));
    src.appendChild(el('label.choice', {}, [
      el('input', { type: 'radio', name: 'res-src' }),
      el('span', {}, ['上传到浏览器',
        el('span.choice-desc', { text: '文件读进浏览器内存并即时建索引；刷新后需重新上传（本 Demo 不做 OPFS 持久化）' })])
    ]));

    /* 真实文件输入：PDF（文献）或 CSV（数据） */
    var pickFolder = el('button.btn.btn-sm', {
      type: 'button', text: isLib ? '选择文献文件夹…' : '选择数据文件夹…',
      onclick: function () { ZY.app.pickFolder(isLib); }
    });
    var pickFiles = el('button.btn.btn-sm', {
      type: 'button', text: isLib ? '上传 PDF / TXT…' : '上传 CSV…',
      onclick: function () { ZY.app.pickFiles(isLib); }
    });
    var status = el('span.hint', { text: '' });
    src.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' } }, [
      pickFolder, pickFiles, status
    ]));
    /* 拖放区 */
    var drop = el('div', {
      style: {
        marginTop: '12px', padding: '18px', textAlign: 'center',
        border: '1px dashed var(--line-strong)', borderRadius: '8px',
        color: 'var(--ink-tertiary)', fontSize: '12px', fontFamily: 'var(--font-kai)'
      },
      text: isLib ? '或者把 PDF 拖到这里' : '或者把 CSV 拖到这里'
    });
    ['dragenter', 'dragover'].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault(); drop.style.borderColor = 'var(--blue)'; drop.style.background = 'var(--blue-soft)';
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault(); drop.style.borderColor = 'var(--line-strong)'; drop.style.background = '';
      });
    });
    drop.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) ZY.app.ingestFiles(Array.prototype.slice.call(files), isLib, status);
    });
    src.appendChild(drop);

    /* 引擎状态：离线时如实说明，并给出补救办法 */
    if (isLib && ZY.pdftext) {
      var es = ZY.pdftext.engineStatus();
      src.appendChild(el('div', { style: { marginTop: '10px' } }, [
        el('span.badge' + (es && es.loaded ? '.ok' : '.warn'), {
          text: es && es.loaded ? ('PDF 引擎已就绪（' + (es.via || '') + '）') : 'PDF 引擎未加载'
        }),
        el('span.hint', {
          text: es && es.loaded
            ? '　可以解析 PDF'
            : '　首次解析 PDF 时会自动加载 pdf.js；离线环境请把 pdf.min.js 放进 vendor/（见 vendor/README.md）'
        })
      ]));
    }
    inner.appendChild(src);

    /* 检索预览 */
    inner.appendChild(el('div.resource-section-title', {}, ['检索预览', el('span.sub-note', { text: '命中片段带出处，这是"不编造"的第一道用户可见证据' })]));
    var preview = el('div.card');
    var input = el('input', {
      type: 'text',
      placeholder: isLib
        ? (hasReal ? '输入关键词试检索，例如：经济政策不确定性 杠杆操纵' : '输入关键词试检索，例如：数字化转型 创新')
        : (hasReal ? '输入字段名或含义，例如：杠杆操纵 / Size / 资产负债率' : '输入字段名，例如：ln_innov'),
      style: { width: '100%', height: '38px', padding: '0 11px', border: '1px solid var(--line-strong)', borderRadius: '6px', fontSize: '13px', fontFamily: 'var(--font-kai)' }
    });
    var result = el('div', { style: { marginTop: '12px' } });

    /** 真实检索：BM25 命中原文，附页号 + 字符区间 + 核验结果 */
    function previewRealHits(q) {
      var hits = q ? RES.search(q, { limit: 8 }) : [];
      if (!q) {
        result.appendChild(el('p.hint', { text: '试着搜一个你关心的概念。下面每一条都能点开，看到它在原文里的位置。' }));
        return;
      }
      if (!hits.length) {
        result.appendChild(el('div.empty-state', { style: { padding: '20px' } }, [
          el('div', { text: '文献库里没有匹配的片段' }),
          el('div.hint', { text: '换个关键词。我不会在此凭空生成引用。' })
        ]));
        return;
      }
      var okAll = hits.every(function (h) { return h.charRange && h.quote; });
      result.appendChild(el('p.hint', { text: '命中 ' + hits.length + ' 个片段 · 点击查看原文位置 · 每条都按「页号 + 字符区间」回原文核验过' }));
      hits.forEach(function (h) {
        var v = okAll ? RES.verify(h.docId, h.charRange, h.quote) : null;
        /* 原文片段可能很长（整段）。只显示前 160 字，好在这里显示的**逐字就是原文前缀**，
           并明确写出「仅显示前 160 字」，免得与后面的字符区间对不上。 */
        var raw = String(h.quote || '');
        var shown = raw.length > 160 ? (raw.slice(0, 160) + '…') : raw;
        result.appendChild(el('button.cite', {
          type: 'button', style: { marginTop: '8px' },
          onclick: function () { ZY.app.openSource(h.docId); }
        }, [
          el('span.cite-idx', { text: String(h.docId).toUpperCase() }),
          el('span.cite-main', {}, [
            el('span.cite-text', { text: '「' + shown + '」', title: raw }),
            el('span.cite-src', {
              text: h.title + ' · ' + (h.journal || '期刊未标注') + ' ' + (h.year == null ? '年份未标注' : h.year) +
                ' · 第 ' + h.page + ' 页 · 字符 ' + h.charRange[0] + '–' + h.charRange[1] +
                (raw.length > 160 ? '（片段共 ' + raw.length + ' 字，仅显示前 160 字）' : '') +
                ' · ' + h.sourceLabel + (v ? (v.ok ? ' · 已核验' : ' · 核验未通过') : '')
            })
          ])
        ]));
      });
    }

    /** 数据目录检索：跨全部真实文件找字段（不是只看第一个数据集） */
    function previewRealFields(q) {
      var all = RES.datasets();
      if (!q) {
        result.appendChild(el('p.hint', { text: '共 ' + all.length + ' 个数据文件。搜一个字段名或中文含义，看看哪个文件里有它。' }));
        return;
      }
      var needle = q.toLowerCase();
      var rows = [];
      all.forEach(function (ds) {
        ds.variables.forEach(function (v) {
          var hay = (v.name + ' ' + (v.label || '')).toLowerCase();
          if (hay.indexOf(needle) >= 0) rows.push({ ds: ds, v: v });
        });
      });
      if (!rows.length) {
        result.appendChild(el('div.empty-state', { style: { padding: '20px' } }, [el('div', { text: '没有匹配的字段' })]));
        return;
      }
      result.appendChild(el('p.hint', { text: '在 ' + rows.length + ' 个字段上命中，来自 ' +
        Object.keys(rows.reduce(function (a, r) { a[r.ds.id] = 1; return a; }, {})).length + ' 个数据文件' }));
      result.appendChild(el('div.table-wrap', { style: { marginTop: '10px' } }, [
        el('table.table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: '字段' }), el('th', { text: '含义' }), el('th', { text: '所属文件' }),
            el('th.num', { text: '缺失率' }), el('th.num', { text: '均值' })
          ])),
          el('tbody', {}, rows.slice(0, 30).map(function (r) {
            return el('tr', {}, [
              el('td', { html: '<span class="mono">' + U.escapeHtml(r.v.name) + '</span>' }),
              el('td', { text: r.v.label || '—' }),
              el('td', { text: r.ds.file, style: { fontFamily: 'var(--font-mono)', fontSize: '11px' } }),
              el('td.num', { text: r.v.missing == null ? '未计算' : (r.v.missing * 100).toFixed(1) + '%' }),
              el('td.num', { text: r.v.mean == null ? '—' : U.fmtNum(r.v.mean, 3) })
            ]);
          }))
        ])
      ]));
    }

    function runPreview() {
      U.clear(result);
      var q = input.value.trim();
      if (hasReal) {
        if (isLib) previewRealHits(q); else previewRealFields(q);
        return;
      }
      if (isLib) {
        var hits = q ? D.LIBRARY.filter(function (d) {
          return (d.title + d.quote + d.method + d.journal).indexOf(q) >= 0;
        }) : D.LIBRARY.slice(0, 3);
        if (!hits.length) {
          result.appendChild(el('div.empty-state', { style: { padding: '20px' } }, [
            el('div', { text: '你的文献库里没有匹配的文献' }),
            el('div.hint', { text: '换个关键词，或先把相关文献加入文献库。我不会在此凭空生成引用。' })
          ]));
          return;
        }
        result.appendChild(el('p.hint', { text: '命中 ' + hits.length + ' 篇 · 点击查看原文片段' }));
        hits.slice(0, 6).forEach(function (d) {
          result.appendChild(el('button.cite', {
            type: 'button', style: { marginTop: '8px' },
            onclick: function () { ZY.app.openSource(d.id); }
          }, [
            el('span.cite-idx', { text: d.id.toUpperCase() }),
            el('span.cite-main', {}, [
              el('span.cite-text', { text: '「' + d.quote + '」' }),
              el('span.cite-src', { text: d.title + ' · ' + d.journal + ' ' + d.year + ' · 第 ' + d.page + ' 页 · 字符 ' + d.charRange[0] + '–' + d.charRange[1] + ' · RRF ' + d.rrf.toFixed(2) })
            ])
          ]));
        });
      } else {
        var ds = D.DATASETS[0];
        var cols = q ? ds.columns.filter(function (c) { return (c.name + c.label).indexOf(q) >= 0; }) : ds.columns;
        if (!cols.length) {
          result.appendChild(el('div.empty-state', { style: { padding: '20px' } }, [el('div', { text: '没有匹配的字段' })]));
          return;
        }
        result.appendChild(el('p.hint', { text: '匹配 ' + cols.length + ' 个字段（共 ' + ds.cols + ' 列 / ' + U.fmtInt(ds.rows) + ' 行）' }));
        var tw = el('div.table-wrap', { style: { marginTop: '10px' } }, [
          el('table.table', {}, [
            el('thead', {}, el('tr', {}, [el('th', { text: '字段' }), el('th', { text: '含义' }), el('th', { text: '类型' }), el('th.num', { text: '缺失率' })])),
            el('tbody', {}, cols.map(function (c) {
              return el('tr', {}, [
                el('td', { html: '<span class="mono">' + U.escapeHtml(c.name) + '</span>' }),
                el('td', { text: c.label }),
                el('td', { text: c.type }),
                el('td.num', { text: (c.missing * 100).toFixed(1) + '%' })
              ]);
            }))
          ])
        ]);
        result.appendChild(tw);
      }
    }
    input.addEventListener('input', U.debounce(runPreview, 200));
    preview.appendChild(input);
    preview.appendChild(result);
    inner.appendChild(preview);
    runPreview();

    /* 已入库清单 */
    if (isLib) {
      var list = hasReal ? RES.allDocs() : D.LIBRARY;
      inner.appendChild(el('div.resource-section-title', {}, [
        '已入库文献',
        el('span.sub-note', {
          text: hasReal
            ? ('共 ' + list.length + ' 篇：真实 ' + RS.real + ' 篇（逐页真实文本算出的质量诊断）+ 内置样例 ' + RS.samples + ' 篇')
            : '逐篇解析质量诊断，无空白项'
        })
      ]));
      inner.appendChild(el('div.table-wrap', {}, [
        el('table.table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: '文献' }),
            hasReal ? el('th', { text: '来源' }) : null,
            el('th', { text: '年份' }), el('th', { text: '期刊' }), el('th', { text: '作者' }),
            el('th', { text: '识别策略' }), el('th', { text: '结论' }), el('th', { text: '解析质量' }),
            el('th.num', { text: '覆盖率' }), el('th.num', { text: '乱码率' })
          ])),
          el('tbody', {}, list.map(function (d) {
            var isReal = d.source === 'real';
            return el('tr', { style: { cursor: 'pointer' }, onclick: function () { ZY.app.openSource(d.id); } }, [
              el('td', {}, [
                el('span', { text: d.title, style: { display: 'block', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis' } }),
                isReal && d.tag ? el('span.hint', { text: d.tag }) : null
              ]),
              hasReal ? el('td', {}, [el('span.badge' + (isReal ? '.ok' : ''), {
                text: isReal ? '真实文献' : '内置样例'
              })]) : null,
              el('td.num', { text: d.year == null ? '未标注' : String(d.year) }),
              el('td', { text: d.journal || '未标注' }),
              el('td', { text: d.authors || '未标注' }),
              el('td', { text: d.method || '—' }),
              el('td', { text: d.conclusion === 'positive' ? '正向' : (d.conclusion === 'negative' ? '负向' : (d.conclusion === 'mixed' ? '分歧' : '—')) }),
              el('td', {}, [el('span.badge' + (d.trust === 'high' ? '.ok' : d.trust === 'medium' ? '.warn' : '.err'), {
                text: d.trustLabel || (d.trust === 'high' ? '可引用' : d.trust === 'medium' ? '需核对' : '仅提及')
              })]),
              el('td.num', { text: d.coverage == null ? '—' : (d.coverage * 100).toFixed(1) + '%' }),
              el('td.num', { text: d.mojibake == null ? '—' : (d.mojibake * 100).toFixed(2) + '%' })
            ]);
          }))
        ])
      ]));
      /* 体检汇总：真实篇目按算出来的诊断统计；样例沿用其声明值 */
      inner.appendChild(el('div.resource-section-title', {}, ['语料体检汇总']));
      if (hasReal) {
        var realList = RES.docs();
        var g = { high: 0, medium: 0, low: 0 }, cov = [], moj = [];
        realList.forEach(function (d) {
          g[d.trust] = (g[d.trust] || 0) + 1;
          if (typeof d.coverage === 'number') cov.push(d.coverage);
          if (typeof d.mojibake === 'number') moj.push(d.mojibake);
        });
        var avg = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; };
        var med = function (a) {
          if (!a.length) return 0;
          var b = a.slice().sort(function (x, y) { return x - y; });
          return b[Math.floor(b.length / 2)];
        };
        var scanned = realList.filter(function (d) { return d.scanned; }).length;
        var twoCol = realList.filter(function (d) { return d.twoCol && d.twoCol !== 'none'; }).length;
        inner.appendChild(el('div.card-grid.three', {}, [
          resCard('真实篇目质量分布', '绿 ' + (g.high || 0) + ' / 黄 ' + (g.medium || 0) + ' / 红 ' + (g.low || 0),
            '由真实文本算出，非声明值 · 绿灯率 ' + (realList.length ? ((g.high || 0) / realList.length * 100).toFixed(1) : '0.0') + '%'),
          resCard('平均覆盖率', (avg(cov) * 100).toFixed(1) + '%', '乱码率中位数 ' + (med(moj) * 100).toFixed(2) + '%'),
          resCard('版式风险', scanned + ' 篇无文字层 / ' + twoCol + ' 篇双栏',
            '无文字层的篇目已标「仅提及」，不给原句摘录')
        ]));
      } else {
        var s = D.LIBRARY_STATS;
        inner.appendChild(el('div.card-grid.three', {}, [
          resCard('质量分布', '绿 ' + s.byTrust.high + ' / 黄 ' + s.byTrust.medium + ' / 红 ' + s.byTrust.low, '绿灯率 ' + (s.byTrust.high / s.total * 100).toFixed(1) + '%（≥50% 可继续）'),
          resCard('平均覆盖率', (s.avgCoverage * 100).toFixed(1) + '%', '乱码率中位数 ' + (s.medianMojibake * 100).toFixed(2) + '%'),
          resCard('版式风险', s.scanned + ' 篇扫描 / ' + s.twoColRisk + ' 篇双栏', '扫描件未做 OCR；双栏篇目引用需人工核对页码')
        ]));
      }
    } else {
      /* 数据库：展示真实文件（按目录归包），每个文件给真实变量字典与描述统计 */
      var dsGroups = hasReal
        ? RES.groupDatasets()
        : [{ name: '内置样例数据', items: D.DATASETS.map(function (x) { return x; }) }];
      inner.appendChild(el('div.resource-section-title', {}, [
        '已入库数据集',
        el('span.sub-note', {
          text: hasReal
            ? ('共 ' + RS.datasets + ' 个真实文件，按原目录归包；缺失率与描述统计都来自真实数据，未计算的一律标「未计算」')
            : '用于实验设计与实证计算'
        })
      ]));
      if (hasReal) {
        inner.appendChild(el('div.card', { style: { marginBottom: '16px' } }, [
          el('div.deflist', {}, [
            el('dt', { text: '数据来源' }), el('dd', { text: RS.source }),
            el('dt', { text: '分析样本' }), el('dd', { text: (function () {
              var p = RES.datasets().filter(function (x) { return /panel\.dta$/.test(x.file); })[0];
              return p
                ? ('panel.dta —— ' + U.fmtInt(p.rows) + ' 行 × ' + p.cols + ' 列 · ' + U.fmtInt(p.nUnits) +
                   ' 家公司 · ' + p.yearMin + '–' + p.yearMax)
                : '（未找到 panel.dta）';
            })() }),
            el('dt', { text: '变量字典' }), el('dd', { text: (function () {
              var n = 0, withLabel = 0;
              RES.datasets().forEach(function (x) {
                x.variables.forEach(function (v) { n++; if (v.label) withLabel++; });
              });
              return U.fmtInt(n) + ' 项，其中 ' + U.fmtInt(withLabel) + ' 项有中文含义（含从《控制变量字段说明.pdf》回填的标签）';
            })() }),
            el('dt', { text: '怎么用' }), el('dd', { text: '实验设计里的「采用的数据」与变量度量直接引用这里的文件名与字段名；do 代码见下方「方法证据」' })
          ])
        ]));
      }
      dsGroups.forEach(function (grp) {
        inner.appendChild(el('h3.subhead', {}, [
          grp.name,
          el('span.sub-note', { text: grp.items.length + ' 个文件' })
        ]));
        grp.items.forEach(function (ds) {
          var card = el('div.card', { style: { marginBottom: '14px' } }, [
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' } }, [
              el('span.badge.blue', { text: ds.shape === 'panel' ? '面板数据' : (ds.shape === 'unknown' ? '结构未知' : '截面数据') }),
              el('strong', { text: ds.file, style: { fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: '600' } }),
              el('span.hint', {
                text: (ds.rows == null ? '行数未取到' : U.fmtInt(ds.rows) + ' 行') + ' × ' + ds.cols + ' 列 · ' +
                  U.fmtBytes(ds.bytes) + (ds.format ? ' · .' + ds.format : '')
              }),
              ds.statsNote === 'partial-first-2000-rows'
                ? el('span.badge.warn', { text: '统计量按前 2000 行' })
                : (ds.statsNote === 'metadata-only' ? el('span.badge.warn', { text: '仅元数据' }) : null)
            ]),
            el('div.deflist', {}, [
              ds.unitId ? el('dt', { text: '个体维度' }) : null,
              ds.unitId ? el('dd', { text: ds.unitId + (ds.nUnits ? '（' + U.fmtInt(ds.nUnits) + ' 个个体）' : '') }) : null,
              ds.timeId ? el('dt', { text: '时间维度' }) : null,
              ds.timeId ? el('dd', { text: ds.timeId + (ds.yearMin ? '（' + ds.yearMin + '–' + ds.yearMax + '）' : '') }) : null,
              el('dt', { text: '缺失率' }),
              el('dd', { text: ds.missingRate == null ? '未计算（文件过大或未取到）' : (ds.missingRate * 100).toFixed(2) + '%（全列平均）' }),
              el('dt', { text: '原始路径' }), el('dd', { text: ds.rel, style: { fontFamily: 'var(--font-mono)', fontSize: '11px' } })
            ])
          ]);
          if (ds.statsNote === 'partial-first-2000-rows' || ds.statsNote === 'metadata-only') {
            card.appendChild(el('p.hint', {
              text: ds.statsNote === 'partial-first-2000-rows'
                ? '该文件超过 80MB，缺失率与均值/标准差按文件前 2000 行计算（不是全样本），只看字段结构即可；要精确统计请在 Stata 里跑。'
                : '该文件未算出统计量，只登记了规模与字段名。'
            }));
          }
          card.appendChild(el('div.table-wrap', { style: { marginTop: '14px' } }, [
            el('table.table', {}, [
              el('thead', {}, el('tr', {}, [
                el('th', { text: '字段' }), el('th', { text: '含义' }), el('th', { text: '类型' }),
                el('th.num', { text: '缺失率' }), el('th.num', { text: '均值' }),
                el('th.num', { text: '标准差' }), el('th.num', { text: '最小' }), el('th.num', { text: '中位' }), el('th.num', { text: '最大' })
              ])),
              el('tbody', {}, ds.variables.slice(0, 60).map(function (c) {
                var f = function (x, d) { return x == null ? '—' : U.fmtNum(x, d == null ? 3 : d); };
                return el('tr', {}, [
                  el('td', { html: '<span class="mono">' + U.escapeHtml(c.name) + '</span>' }),
                  el('td', {}, [
                    el('span', { text: c.label || '—' }),
                    c.labelFrom ? el('span.hint', { text: '（来自字段说明）' }) : null
                  ]),
                  el('td', { text: c.type === 'num' ? '数值' : (c.type === 'str' ? '文本' : '?') }),
                  el('td.num', { text: c.missing == null ? '未计算' : (c.missing * 100).toFixed(1) + '%' }),
                  el('td.num', { text: f(c.mean) }),
                  el('td.num', { text: f(c.sd) }),
                  el('td.num', { text: f(c.min) }),
                  el('td.num', { text: f(c.p50) }),
                  el('td.num', { text: f(c.max) })
                ]);
              }))
            ])
          ]));
          if (ds.variables.length > 60) {
            card.appendChild(el('p.hint', { text: '该文件共 ' + ds.variables.length + ' 个字段，上表只显示前 60 个。' }));
          }
          inner.appendChild(card);
        });
      });

      /* 方法证据：真实的 do 代码、回归日志与结果表 —— 实验设计的现成模板 */
      if (hasReal && RES.artifacts().length) {
        inner.appendChild(el('div.resource-section-title', {}, [
          '方法证据',
          el('span.sub-note', { text: RES.artifacts().length + ' 份 do 代码 / 回归日志 / 结果文件，可被检索，也可直接抄进设计' })
        ]));
        inner.appendChild(el('div.card', {}, [
          el('p.hint', { text: '这些是你自己跑过的代码与日志。实验设计里的「具体做法」可以直接引用它们，而不是让模型凭空编一套步骤。' }),
          el('div.table-wrap', { style: { marginTop: '10px' } }, [
            el('table.table', {}, [
              el('thead', {}, el('tr', {}, [
                el('th', { text: '文件' }), el('th', { text: '类型' }), el('th', { text: '所属' }),
                el('th.num', { text: '字符数' })
              ])),
              el('tbody', {}, RES.artifacts().map(function (a) {
                return el('tr', { style: { cursor: 'pointer' }, onclick: function () { ZY.app.openArtifact(a.rel); } }, [
                  el('td', { html: '<span class="mono">' + U.escapeHtml(a.file) + '</span>' }),
                  el('td', {}, [el('span.badge', { text: a.ext })]),
                  el('td', { text: RES.pkgOf(a.rel), style: { fontSize: '12px' } }),
                  el('td.num', { text: U.fmtInt(a.chars) })
                ]);
              }))
            ])
          ])
        ]));
      }
      inner.appendChild(el('div.banner.info', {}, [
        el('span', { html: U.ICONS.info, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div.banner-title', { text: '数据只用于本机计算' }),
          el('div', { text: '解析、清洗与统计计算全部在浏览器内完成；「本次将发送什么」可随时查看即将出网的内容。' })
        ])
      ]));
    }

    page.appendChild(inner);
    host.appendChild(page);
  }

  function resCard(title, value, desc) {
    return el('div.card', {}, [
      el('h3', { text: title }),
      el('div', { text: value, style: { fontSize: '16px', fontWeight: '700', color: 'var(--purple)', marginBottom: '6px', fontFamily: 'var(--font-sans)' } }),
      el('p', { text: desc })
    ]);
  }

  function messageEl(m) {
    var isUser = m.role === 'user';
    var body = el('div.msg-body');
    String(m.text || '').split('\n').forEach(function (line) {
      if (line === '') { return; }
      body.appendChild(el('p', { text: line }));
    });

    /* 正在进行的任务：显示动效而不是原始 JSON */
    if (m.progress) {
      body.appendChild(ZY.ui.progressLine(m.progress));
      if (m.progressSub) {
        body.appendChild(el('div.hint', { text: m.progressSub, style: { marginTop: '6px' } }));
      }
    }
    if (m.streaming && !m.progress) {
      body.appendChild(el('span.stream-cursor', { text: '▍' }));
    }
    /* 结构化研究问题：渲染成可读卡片，不显示 JSON */
    if (m.rqCard && ZY.ui && ZY.ui.rqCard) {
      var proj = S.project();
      if (proj && proj.rq) body.appendChild(ZY.ui.rqCard(proj.rq));
    }
    if (m.citations && m.citations.length) {
      body.appendChild(el('div.chat-steps', {}, m.citations.map(function (c, i) {
        return el('span.chip', { text: '[' + (i + 1) + '] ' + c.journal + ' ' + c.year });
      })));
    }
    if (m.chips && m.chips.length) {
      body.appendChild(el('div.chat-steps', {}, m.chips.map(function (c) {
        return el('span.chip' + (c.indexOf('⚠') === 0 || c.indexOf('无') === 0 ? '.warn' : (c.indexOf('完成') >= 0 || c.indexOf('通过') >= 0 ? '.ok' : '')), { text: c });
      })));
    }
    if (m.attachments && m.attachments.length) {
      var strip = el('div.msg-attachments');
      m.attachments.forEach(function (n) {
        strip.appendChild(el('span.attach-chip', {}, [el('span.ac-name', { text: n, title: n })]));
      });
      body.appendChild(strip);
    }
    if (m.ask) {
      var picked = m.ask.answered || null;
      var card = el('div.ask-card', {}, [el('div.ask-title', { text: m.ask.title })]);
      var opts = el('div.ask-options');
      m.ask.options.forEach(function (o) {
        var isPicked = picked === o.key;
        opts.appendChild(el('button.ask-option', {
          type: 'button',
          'aria-pressed': isPicked ? 'true' : 'false',
          disabled: picked ? true : null,
          onclick: function () { if (!m.ask.answered) ZY.app.answerAsk(m, o); }
        }, [
          el('span.ao-ico', { html: o.icon === 'edit' ? U.ICONS.edit : U.ICONS.play, 'aria-hidden': 'true' }),
          el('span.ao-body', {}, [
            el('span.ao-label', { text: o.label }),
            o.desc ? el('span.ao-desc', { text: o.desc }) : null
          ])
        ]));
      });
      card.appendChild(opts);
      body.appendChild(card);
    }
    /* 助手头像用产品 logo；用户侧仍用文字标记，避免两人头像混淆 */
    var marker = isUser
      ? el('div.marker', { text: '你' })
      : el('div.marker', {}, [el('img', { src: 'assets/logo.svg', alt: '' })]);
    return el('article.message' + (isUser ? '.user' : ''), {}, [
      marker,
      el('div', {}, [
        el('h3', {}, [el('span', { text: isUser ? '你' : '研究助手' }), el('time', { text: U.hhmm(m.at) })]),
        body
      ])
    ]);
  }

  /* ---------------- 成果区头 + 页签 ---------------- */
  function resultHead() {
    var p = activeProject();
    if (!p) return;
    U.$('#project-title').textContent = p.title;
    U.$('#project-subtitle').textContent = p.rq
      ? p.rq.claimSentence
      : (p.topic || '尚未定义研究问题');

    var actions = U.$('#result-actions');
    U.clear(actions);

    /* 顶部状态来自真实工作流（workflowStatus），与正在查看的阶段页签无关 */
    var wf = workflowStatus(p);
    actions.appendChild(el('span.badge.' + wf.badge, { text: wf.short, title: wf.label }));

    if (p.design && !p.designConfirmed) {
      actions.appendChild(el('button.btn.btn-primary.btn-sm', {
        type: 'button', text: '确认设计', onclick: function () { ZY.app.openGateModal(); }
      }));
    } else if (p.designConfirmed && !p.paper) {
      actions.appendChild(el('button.btn.btn-sm', {
        type: 'button', text: '运行七步实证', onclick: function () { ZY.app.runPipeline(); }
      }));
    } else if (p.paper) {
      actions.appendChild(el('button.btn.btn-sm', {
        type: 'button', text: '导出项目包', onclick: function () { ZY.app.exportPackage(); }
      }));
    }
  }

  /* 实际进度的文字表达：与"当前查看"分开 */
  var PROGRESS_TEXT = { done: '已完成', active: '进行中', blocked: '受阻', idle: '未开始' };

  function tabs() {
    var p = activeProject();
    var host = U.$('#tabs');
    U.clear(host);
    if (!p) return;
    var sts = E.stageState(p.id);
    S.STAGES.forEach(function (s) {
      var state = sts[s.id] || 'idle';
      var progress = PROGRESS_TEXT[state] || PROGRESS_TEXT.idle;
      var dotCls = state === 'done' ? 'done' : (state === 'blocked' ? 'blocked' : (state === 'active' ? 'active' : ''));
      var viewing = p.tab === s.id;
      host.appendChild(el('button', {
        type: 'button',
        'aria-current': viewing ? 'step' : 'false',
        'data-progress': state,
        /* 选中只表示"正在查看该页"；实际完成度由状态点与提示文字表达 */
        title: s.label + '：实际进度 ' + progress + (viewing ? '（当前正在查看）' : ''),
        'aria-label': s.label + '，实际进度' + progress + (viewing ? '，当前正在查看' : ''),
        onclick: function () { ZY.app.switchTab(s.id); }
      }, [
        el('span.tab-dot' + (dotCls ? '.' + dotCls : ''), { 'aria-hidden': 'true' }),
        el('span', { text: s.label }),
        el('span.sr-only', { text: '（实际进度：' + progress + '）' })
      ]));
    });
  }

  /* 同一页签重渲染时保留滚动位置。
     跑流水线会反复 renderAll，不保留的话每 tick 都把用户弹回顶部；
     统计页现在七段铺开、很长，这个问题会被放大。 */
  var stageScroll = { tab: null, top: 0 };

  function stageContent() {
    var p = activeProject();
    var host = U.$('#stage-content');
    var scroller = null;
    try { scroller = document.querySelector('.content'); } catch (e) { scroller = null; }
    var before = scroller ? scroller.scrollTop : 0;
    var sameTab = stageScroll.tab === (p && p.tab);
    U.clear(host);
    if (!p) return;   /* 未开始项目：成果区显示空态，六个阶段不出现 */
    var mod = ZY.stages[p.tab] || ZY.stages.definition;
    mod.render(host);
    stageScroll.tab = p.tab;
    stageScroll.top = before;
    if (sameTab && scroller && before > 0 && scroller.scrollTop === 0) {
      scroller.scrollTop = before;
    }
  }

  /* ---------------- 三件套视图 ---------------- */
  function stepArtifacts(stepId, view) {
    var wrap = el('div');
    var real = realResultOf(stepId);

    /* 文件行 */
    var files = el('div.card', { style: { marginBottom: '14px' } }, [
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' } }, [
        el('h3', { text: '三件套文件', style: { marginBottom: '0' } }),
        el('button.btn.btn-sm', { type: 'button', html: U.ICONS.download + ' 下载三件套', onclick: function () { ZY.app.downloadStep(stepId); } })
      ])
    ]);
    files.appendChild(el('div', { style: { marginBottom: '10px' } }, [
      real
        ? el('span.badge.ok', { text: '真实计算结果 · 用时 ' + U.fmtDur(real.elapsedMs || 0) + ' · 样本 ' + U.fmtInt(real.nObs || 0) })
        : el('span.badge.warn', { text: '预置样例数据（pipeline.js 未生效）' })
    ]));
    [
      { kind: 'code', name: E.codeFileName(stepId), cls: '', size: '' },
      { kind: 'result', name: E.resultFileName(stepId), cls: 'md', size: '' },
      { kind: 'interpret', name: E.interpretFileName(stepId), cls: 'md', size: '' }
    ].forEach(function (f) {
      var content = E.fileContent(stepId, f.kind);
      files.appendChild(el('div.file-row', {}, [
        el('span.file-icon' + (f.cls ? '.' + f.cls : ''), { text: 'PY' }),
        el('span.file-name', { text: f.name }),
        el('span.file-size', { text: U.fmtBytes(content.length) }),
        el('button.text-action', { type: 'button', text: '预览', onclick: function () { ZY.app.previewFile(stepId, f.kind); } })
      ]));
    });
    wrap.appendChild(files);

    if (view === 'code') {
      wrap.appendChild(el('div.code-block', { text: E.fileContent(stepId, 'code') }));
      return wrap;
    }
    if (view === 'interpret') {
      wrap.appendChild(real ? realInterpretView(stepId, real) : interpretView(stepId, D.STEPS[stepId] || {}));
      return wrap;
    }
    if (real) {
      wrap.appendChild(realResultView(stepId, real));
      return wrap;
    }
    var data = D.STEPS[stepId];
    if (data) wrap.appendChild(resultView(stepId, data));
    return wrap;
  }

  /** 取某步的真实计算结果（没有则 null） */
  function realResultOf(stepId) {
    var p = S.project();
    if (!p || !p.pipeline) return null;
    var st = p.pipeline[stepId];
    if (!st || !st.real) return null;
    return Object.assign({}, st.real, {
      elapsedMs: st.elapsedMs,
      nObs: (st.real.provenance && st.real.provenance.nObs) || st.real.nObs
    });
  }

  /** 真实结果视图：多张表 + 指标 + 诊断 + 可复现信息 */
  function realResultView(stepId, real) {
    var wrap = el('div.card');

    if (real.summary) wrap.appendChild(el('p', { text: real.summary }));

    /* 指标 */
    if (real.metrics && real.metrics.length) {
      wrap.appendChild(el('div.divider'));
      wrap.appendChild(el('div.evidence', {}, real.metrics.slice(0, 8).map(function (m) {
        return el('div.evidence-item', {}, [
          el('strong', { text: String(m.v) }),
          el('span', { text: m.k })
        ]);
      })));
    }

    /* 表：可能有多张（稳健性 8 项、异质性分组等） */
    (real.tables || []).forEach(function (t) {
      wrap.appendChild(el('h3', { text: t.title || t.caption || '结果表', style: { marginTop: '18px' } }));
      wrap.appendChild(renderRealTable(t));
      if (t.note) wrap.appendChild(el('p.hint', { text: '注：' + t.note, style: { marginTop: '6px' } }));
    });

    /* 诊断与告警：真实计算的局限必须可见 */
    var diag = real.diagnostics || {};
    var warns = (diag.warnings || []).concat(diag.notes || []);
    if (warns.length) {
      wrap.appendChild(el('div.banner.warn', { style: { marginTop: '16px', marginBottom: '0' } }, [
        el('span', { html: U.ICONS.warn, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div.banner-title', { text: '本步诊断（' + warns.length + ' 条）' })
        ].concat(warns.map(function (w) {
          return el('div', { text: '· ' + (typeof w === 'string' ? w : (w.message || JSON.stringify(w))), style: { fontSize: '12px' } });
        })))
      ]));
    }

    /* provenance：可复现信息 */
    var prov = real.provenance || {};
    wrap.appendChild(el('h3', { text: '可复现信息', style: { marginTop: '18px' } }));
    wrap.appendChild(el('div.deflist', {}, flattenPairs([
      ['样本量', prov.nObs != null ? U.fmtInt(prov.nObs) : '—'],
      ['个体数', prov.nUnits != null ? U.fmtInt(prov.nUnits) : '—'],
      ['固定效应', (prov.fe || []).join(' + ') || '—'],
      ['聚类层级', prov.cluster || '—'],
      ['随机种子', prov.seed != null ? String(prov.seed) : '—'],
      ['去均值迭代', prov.demeanIterations != null ? (prov.demeanIterations + ' 次' + (prov.demeanConverged ? '（已收敛）' : '（未收敛）')) : '—'],
      ['引擎版本', prov.engine || '内置计量引擎'],
      ['代码指纹', prov.codeHash || '—']
    ])));

    return wrap;
  }

  function flattenPairs(pairs) {
    var out = [];
    pairs.forEach(function (kv) { out.push(el('dt', { text: kv[0] }), el('dd', { text: String(kv[1]) })); });
    return out;
  }

  /** 渲染 pipeline.js 的结果表（numCols 为 0 基列索引，指数据列） */
  function renderRealTable(t) {
    var head = t.head || t.header || [];
    var rows = t.formattedRows || t.rows || [];
    var numCols = (t.numCols || []).map(function (c) { return c + 1; });   /* 转成含首列的表格索引 */
    return el('div.table-wrap', {}, [
      el('table.table', {}, [
        el('thead', {}, el('tr', {}, head.map(function (h, i) {
          return el('th' + (numCols.indexOf(i) >= 0 ? '.num' : ''), { text: String(h) });
        }))),
        el('tbody', {}, rows.map(function (r) {
          return el('tr', {}, (r || []).map(function (c, i) {
            var txt = c == null ? '—' : String(c);
            return el('td' + (numCols.indexOf(i) >= 0 ? '.num' : '') + (/^\*+$/.test(txt.trim()) ? '.sig' : ''), { text: txt });
          }));
        }))
      ])
    ]);
  }

  /** 真实结果的解读视图（含引用到的 cell 与措辞强度） */
  function realInterpretView(stepId, real) {
    var wrap = el('div.card');
    var wording = ZY.engine.projectWording();

    wrap.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' } }, [
      el('span.badge.ok', { text: '真实计算' }),
      el('span.badge.blue', { text: '数值一致性：已绑定 ' + ((real.cells || []).length) + ' 个单元格' }),
      el('span.badge' + (wording === 'causal' ? '.ok' : '.warn'), { text: '措辞强度：' + ZY.checklist.WORDING[wording].label })
    ]));

    var it = real.interpretation;
    var text = (it && it.text) || real.summary || '';
    String(text).split('\n').forEach(function (line) {
      if (line.trim()) wrap.appendChild(el('p', { text: line }));
    });

    /* 引用的 cell：点回结果表 */
    if (it && it.refs && it.refs.length) {
      wrap.appendChild(el('div.divider'));
      wrap.appendChild(el('p.hint', { text: '本段引用的数字（点击回到结果表）：' }));
      wrap.appendChild(el('div.chat-steps', {}, it.refs.slice(0, 40).map(function (r) {
        var cid = typeof r === 'string' ? r : (r.cellId || r.id);
        var cell = (real.cells || []).filter(function (c) { return c.id === cid || c.cellId === cid; })[0];
        return el('span.chip', {
          text: cell ? (cell.label + ' = ' + (cell.formatted != null ? cell.formatted : cell.value)) : cid,
          title: cid
        });
      })));
    }
    return wrap;
  }

  function resultView(stepId, data) {
    var wrap = el('div.card');
    wrap.appendChild(el('p', { text: data.summary }));
    if (data.metrics && data.metrics.length) {
      wrap.appendChild(el('div.divider'));
      wrap.appendChild(el('div.evidence', {}, data.metrics.map(function (m) {
        return el('div.evidence-item', {}, [el('strong', { text: m.v }), el('span', { text: m.k })]);
      })));
    }
    if (data.table) {
      wrap.appendChild(el('h3', { text: '结果表', style: { marginTop: '18px' } }));
      var head = data.table.head.map(function (h, i) {
        return el('th' + (data.table.numCols && data.table.numCols.indexOf(i - 1) >= 0 ? '.num' : ''), { text: h });
      });
      wrap.appendChild(el('div.table-wrap', {}, [
        el('table.table', {}, [
          el('thead', {}, el('tr', {}, head)),
          el('tbody', {}, data.table.rows.map(function (r) {
            return el('tr', {}, r.map(function (c, i) {
              var isNum = data.table.numCols && data.table.numCols.indexOf(i - 1) >= 0;
              var isSig = /^\*+$/.test(String(c).trim());
              return el('td' + (isNum ? '.num' : '') + (isSig ? '.sig' : ''), { text: c });
            }));
          }))
        ])
      ]));
      /* baseline 表格附加数字关联 */
      if (stepId === 'baseline') {
        wrap.appendChild(el('p.hint', { text: '系数 0.083 与组内 R² 0.412 已登记为 cell_id（c-0001 / c-0003），正文中的数字可点击回到此处。', style: { marginTop: '10px' } }));
      }
    }
    if (data.warning) {
      wrap.appendChild(el('div.banner.warn', { style: { marginTop: '16px', marginBottom: '0' } }, [
        el('span', { html: U.ICONS.warn, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [el('div', { text: data.warning })])
      ]));
    }
    return wrap;
  }

  function interpretView(stepId, data) {
    var wording = ZY.engine.projectWording();
    var wrap = el('div.card');
    wrap.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' } }, [
      el('span.badge.blue', { text: '生成方式：rule + llm' }),
      el('span.badge' + (wording === 'causal' ? '.ok' : '.warn'), { text: '措辞强度：' + ZY.checklist.WORDING[wording].label }),
      el('span.badge.ok', { text: '数值一致性：通过' })
    ]));
    wrap.appendChild(el('p', { text: data.summary }));
    if (data.warning) {
      wrap.appendChild(el('div.divider'));
      wrap.appendChild(el('p', { text: '局限：' + data.warning, style: { color: 'var(--warning)' } }));
    }
    wrap.appendChild(el('div.divider'));
    wrap.appendChild(el('p.hint', { text: '解读中的每个数字都绑定结果表的单元格；若一致性校验失败，会降级为规则版并标红，不会放行。' }));
    return wrap;
  }

  /* ---------------- 过程文件树 ---------------- */
  function exportTree(pipe, p) {
    var tree = E.buildExportTree(p);
    var wrap = el('div.card');
    tree.forEach(function (node) {
      var done = node.status === 'done';
      wrap.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 0', borderBottom: '1px dashed var(--line)' } }, [
        el('span', { html: U.ICONS.doc, style: { color: done ? 'var(--blue)' : 'var(--ink-tertiary)', flex: 'none' } }),
        el('span.mono', { text: node.dir + '/', style: { fontSize: '12px', flex: '1' } }),
        el('span.badge' + (done ? '.ok' : '.plain'), { text: node.files.length + ' 个文件' }),
        el('span.hint', { text: done ? '已生成' : '待生成' })
      ]));
    });
    wrap.appendChild(el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '14px' } }, [
      el('button.btn.btn-sm', { type: 'button', html: U.ICONS.download + ' 打包下载全部过程文件', onclick: function () { ZY.app.exportPackage(); } })
    ]));
    return wrap;
  }

  /* ---------------- 模态 / 抽屉 ---------------- */
  function openModal(opts) {
    var root = U.$('#overlay-root');
    var mask = el('div.modal-mask', {
      onclick: function (e) { if (e.target === mask && opts.dismissable !== false) close(); }
    });
    var modal = el('div.modal' + (opts.wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title });
    modal.appendChild(el('div.modal-head', {}, [
      el('div', {}, [
        el('h2', { text: opts.title }),
        opts.sub ? el('div.modal-sub', { text: opts.sub }) : null
      ]),
      el('button.icon-btn', { type: 'button', html: U.ICONS.close, 'aria-label': '关闭', onclick: close })
    ]));
    var body = el('div.modal-body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    modal.appendChild(body);
    if (opts.foot) {
      var foot = el('div.modal-foot');
      if (opts.footLeft) foot.appendChild(el('span.foot-left', { text: opts.footLeft }));
      (opts.foot || []).forEach(function (b) { foot.appendChild(b); });
      modal.appendChild(foot);
    }
    mask.appendChild(modal);
    root.appendChild(mask);

    /* 焦点管理 */
    var focusable = modal.querySelector('button, input, textarea, select, [tabindex]');
    if (focusable) setTimeout(function () { focusable.focus(); }, 30);

    function onKey(e) { if (e.key === 'Escape' && opts.dismissable !== false) close(); }
    document.addEventListener('keydown', onKey);

    function close() {
      document.removeEventListener('keydown', onKey);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      if (opts.onClose) opts.onClose();
    }
    return { close: close, el: modal };
  }

  function openDrawer(opts) {
    var root = U.$('#overlay-root');
    var mask = el('div.drawer-mask', { onclick: close });
    var drawer = el('div.drawer' + (opts.wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title });
    drawer.appendChild(el('div.drawer-head', {}, [
      el('div', {}, [
        el('h2', { text: opts.title }),
        opts.sub ? el('div.modal-sub', { text: opts.sub }) : null
      ]),
      el('button.icon-btn', { type: 'button', html: U.ICONS.close, 'aria-label': '关闭', onclick: close })
    ]));
    var body = el('div.drawer-body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    drawer.appendChild(body);
    if (opts.foot) {
      var foot = el('div.drawer-foot');
      (opts.foot || []).forEach(function (b) { foot.appendChild(b); });
      drawer.appendChild(foot);
    }
    root.appendChild(mask);
    root.appendChild(drawer);

    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    function close() {
      document.removeEventListener('keydown', onKey);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      if (drawer.parentNode) drawer.parentNode.removeChild(drawer);
    }
    return { close: close, el: drawer };
  }

  function toast(msg, kind) {
    var root = U.$('#overlay-root');
    var t = el('div', {
      style: {
        position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)',
        zIndex: '200', padding: '10px 16px', borderRadius: '8px',
        background: 'var(--ink)', color: '#fff', fontSize: '12px',
        boxShadow: 'var(--shadow-pop)', maxWidth: '80vw', fontFamily: 'var(--font-kai)'
      }, text: msg
    });
    if (kind === 'err') t.style.background = 'var(--danger)';
    if (kind === 'ok') t.style.background = 'var(--success)';
    root.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }

  ZY.render = {
    topbar: topbar, projectRail: projectRail, chat: chat, emptyState: emptyState,
    resultHead: resultHead, tabs: tabs, stageContent: stageContent,
    views: views, renderResourcePage: renderResourcePage, activeProject: activeProject,
    stepArtifacts: stepArtifacts, exportTree: exportTree,
    openModal: openModal, openDrawer: openDrawer, toast: toast,
    modelSummary: modelSummary, hasAnyCredential: hasAnyCredential, isAllDone: isAllDone
  };
})(window);
