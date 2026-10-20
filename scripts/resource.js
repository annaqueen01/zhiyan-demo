/* ============================================================
   智研 · 真实资源库门面
   ------------------------------------------------------------
   挂载：window.ZY.resource

   数据来自 scripts/library-real.js（由 work/extract_corpus.py 与
   work/extract_data.py 从真实目录抽取后生成）：
     · 51 个真实 PDF 的逐页文本   → 与 22 篇内置样例一起灌进 ZY.corpus
     · 45 个真实数据文件的目录、变量字典与描述统计
     · 18 份 do / 日志 / 结果文件

   三条硬规矩：
     1. 真实篇目的质量诊断由**真实文本**算出（corpus.diag），
        这一层不另算一套，也不照抄抽取脚本里的估计值。
     2. 「可引用 / 需核对 / 仅提及」由诊断结果决定；字形码损坏、
        没有可用文字层的篇目一律「仅提及」，且不给原句摘录。
     3. 取不到的元数据一律留空显示为「未标注」，绝不猜一个填上。
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};
  var D = ZY.data = ZY.data || {};

  var RAW = ZY.realData || null;
  var loaded = false;
  var regInfo = { samples: 0, real: 0, chunks: 0 };

  function has() { return !!(RAW && RAW.docs && RAW.docs.length); }
  function ready() { return has(); }
  function summary() { return (RAW && RAW.summary) || null; }
  function datasets() { return (RAW && RAW.datasets) || []; }
  function artifacts() { return (RAW && RAW.artifacts) || []; }
  function vocab() { return (RAW && RAW.vocab) || []; }
  function rawDocs() { return (RAW && RAW.docs) || []; }

  /* ---------------- 分组：按真实目录结构归包 ---------------- */
  function splitRel(rel) {
    var parts = String(rel || '').split('\\');
    if (parts.length > 1) parts.pop();                 /* 去掉文件名 */
    if (parts[0] === '数据' || parts[0] === '文献') parts.shift();
    return parts;
  }

  function pkgOf(rel) {
    var p = splitRel(rel);
    if (!p.length) return '其他';
    if (p[0] === '权益资本成本模型2025年' && p[1]) {
      return '权益资本成本模型 · ' + p[1].replace(/2025年$/, '');
    }
    if (p[0] === '人工智能水平-姚加权版') return '人工智能水平 · 姚加权版';
    if (p[0] === '人工智能水平-彭树宏版') return '人工智能水平 · 彭树宏版';
    if (p[0] === '合并数据') return '合并数据 · 分析样本';
    if (p[0] === '常用控制变量 00-25年') {
      return p[1] === 'dta原始数据' ? '常用控制变量 · 原始分表' : '常用控制变量 · 面板';
    }
    return p[0];
  }

  var PKG_ORDER = [
    '人工智能水平 · 姚加权版',
    '人工智能水平 · 彭树宏版',
    '权益资本成本模型 · CAPM模型',
    '权益资本成本模型 · MPEG模型',
    '权益资本成本模型 · OJ模型',
    '权益资本成本模型 · PEG模型',
    '常用控制变量 · 面板',
    '常用控制变量 · 原始分表',
    '合并数据 · 分析样本'
  ];

  function pkgRank(name) {
    var i = PKG_ORDER.indexOf(name);
    return i < 0 ? 900 : i;
  }

  function groupDatasets() {
    var map = {}, out = [];
    datasets().forEach(function (ds) {
      var k = pkgOf(ds.rel);
      if (!map[k]) { map[k] = { name: k, items: [] }; out.push(map[k]); }
      map[k].items.push(ds);
    });
    out.forEach(function (g) {
      g.items.sort(function (a, b) { return (b.rows || 0) - (a.rows || 0); });
    });
    out.sort(function (a, b) { return pkgRank(a.name) - pkgRank(b.name) || a.name.localeCompare(b.name); });
    return out;
  }

  /* ---------------- 灌库：真实逐页文本 → ZY.corpus ---------------- */
  /**
   * 真实文献走 addDocument({pages})，于是 coverage/mojibake/scanned/twoCol
   * 全部由 pypdf 抽出来的真实文本算出来，而不是像样例库那样「声明」。
   * 幂等：重复调用不会重复灌。
   */
  function ensureCorpus() {
    if (loaded) return regInfo;
    var C = ZY.corpus;
    if (!C) return regInfo;

    /* 内置样例（虚构，仅用于演示流程） */
    try {
      if (D.LIBRARY && D.LIBRARY.length) regInfo.samples = C.addSampleLibrary(D.LIBRARY) || 0;
    } catch (e) { regInfo.samples = 0; }

    /* 真实文献：逐页文本 */
    rawDocs().forEach(function (d) {
      try {
        C.addDocument({
          id: d.id,
          title: d.title,
          journal: d.journal || '',
          year: d.year == null ? null : d.year,
          authors: d.authors || '',
          keywords: d.keywords || '',
          method: '',
          conclusion: '',
          trust: d.readable === false ? 'low' : 'medium',
          quote: d.quote || '',
          page: d.page == null ? null : d.page,
          charRange: d.charRange || null,
          pages: d.pages || [],
          source: 'real',
          engine: 'pypdf-textlayer',
          file: d.file
        }, { chunkSize: 400 });
        regInfo.real++;
      } catch (e) { /* 单篇失败不影响其它篇 */ }
    });

    loaded = true;
    try {
      var st = C.stats();
      regInfo.chunks = st.chunks;
    } catch (e) { /* stats 不可用不影响 */ }
    return regInfo;
  }

  /** 诊断：只读 corpus 的结果，单一事实来源 */
  function diagOf(id) {
    var C = ZY.corpus;
    if (!C || typeof C.diag !== 'function') return null;
    try { return C.diag(id); } catch (e) { return null; }
  }

  var TRUST_CN = { high: '可引用', medium: '需核对', low: '仅提及' };

  function trustOf(dg, raw) {
    if (raw && raw.readable === false) return 'low';
    if (!dg) return 'medium';
    return dg.quality || 'medium';
  }

  /* ---------------- 文献：与内置样例同形，方便共用渲染与引用解析 ---------------- */
  function docRecord(d) {
    var dg = diagOf(d.id);
    var trust = trustOf(dg, d);
    return {
      id: d.id,
      title: d.title || d.file,
      journal: d.journal || '',
      year: d.year == null ? null : d.year,
      authors: d.authors || '',
      method: '',
      trust: trust,
      trustLabel: TRUST_CN[trust] || '需核对',
      coverage: dg ? dg.coverage : null,
      mojibake: dg ? dg.mojibakeRate : null,
      scanned: dg ? !!dg.scanned : null,
      twoCol: dg ? dg.twoColRisk : '',
      conclusion: 'n/a',
      quote: d.quote || '（该篇没有可用文字层，无法给原句摘录）',
      page: d.page == null ? null : d.page,
      charRange: d.charRange || null,
      source: 'real',
      file: d.file,
      rel: d.rel,
      tag: d.tag || '',
      kind: d.kind || 'literature',
      nPages: d.nPages || 0,
      chars: d.chars || 0,
      readable: d.readable !== false,
      truncated: !!d.truncated,
      keywords: d.keywords || ''
    };
  }

  var _cache = null;
  function docs() {
    if (_cache) return _cache;
    _cache = rawDocs().map(docRecord);
    return _cache;
  }

  function samples() {
    return (D.LIBRARY || []).map(function (d) {
      var o = {};
      for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) o[k] = d[k];
      o.source = 'sample';
      o.trustLabel = TRUST_CN[d.trust] || '需核对';
      return o;
    });
  }

  function allDocs() { return samples().concat(docs()); }

  var _byId = null;
  function byIdIndex() {
    if (_byId) return _byId;
    _byId = {};
    allDocs().forEach(function (d) { _byId[d.id] = d; });
    return _byId;
  }

  function byId(id) { return byIdIndex()[String(id)] || null; }

  function datasetById(id) { return datasets().filter(function (d) { return d.id === id; })[0] || null; }

  /** 数据集的一行摘要，各处显示保持一致 */
  function datasetLine(ds, opt) {
    if (!ds) return '';
    opt = opt || {};
    var bits = [];
    bits.push(ds.file);
    bits.push((ds.rows == null ? '行数未知' : U_fmtInt(ds.rows) + ' 行') + ' × ' + ds.cols + ' 列');
    if (ds.yearMin && ds.yearMax) bits.push(ds.yearMin + '–' + ds.yearMax);
    if (opt.withUnit && ds.unitId) bits.push(ds.unitId + (ds.nUnits ? ' ' + U_fmtInt(ds.nUnits) + ' 个个体' : ''));
    if (opt.withNote && ds.statsNote === 'partial-first-2000-rows') bits.push('统计量按前 2000 行');
    return bits.join(' · ');
  }

  /* 只为了不让 resource.js 依赖 util.js 的加载顺序，这里的千分位自己实现一份 */
  function U_fmtInt(n) {
    if (n == null || !isFinite(n)) return '—';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * 字段核对：设计里写的「数据字段」是不是真在这个数据集里。
   * 返回 null 表示「没选数据集，无从核对」——不能把无从核对说成通过。
   */
  function fieldsOf(datasetId) {
    var ds = datasetId ? datasetById(datasetId) : null;
    if (!ds) return null;
    var m = Object.create(null);
    ds.variables.forEach(function (v) { m[String(v.name)] = v; });
    return m;
  }

  function matchField(m, key) {
    var k = String(key == null ? '' : key).trim();
    if (!k) return null;
    if (m[k]) return m[k];
    var lo = k.toLowerCase();
    var names = Object.keys(m);
    for (var i = 0; i < names.length; i++) {
      if (names[i].toLowerCase() === lo) return m[names[i]];
    }
    /* 允许用中文含义命中：设计里常把 source 写成「资产负债率」而不是 Lev */
    for (var j = 0; j < names.length; j++) {
      var lb = m[names[j]].label;
      if (lb && (lb === k || lb.indexOf(k) >= 0)) return m[names[j]];
    }
    return null;
  }

  /**
   * 核对一个变量声明的 source。返回：
   *   {checked:false}                        没选数据集
   *   {checked:true, ok:true, field:{...}}   命中真实列
   *   {checked:true, ok:false}               该文件里没有这个字段
   */
  function checkField(datasetId, name, label) {
    var m = fieldsOf(datasetId);
    if (!m) return { checked: false, ok: false };
    var hit = matchField(m, name) || matchField(m, label);
    if (hit) return { checked: true, ok: true, field: hit };
    return { checked: true, ok: false };
  }

  /**
   * 给设计提示词用的真实数据目录。
   * 指定了数据集 → 给出该文件的字段级细节（模型必须从这里挑字段）；
   * 没指定 → 给出按包分组的文件清单（至少让模型知道真实文件名长什么样）。
   */
  function catalogForPrompt(datasetId, opts) {
    opts = opts || {};
    if (!has()) return '';
    if (datasetId) {
      var ds = datasetById(datasetId);
      if (ds) return catalogDetail(ds, opts.maxVars || 80);
    }
    var lines = [];
    var perPkg = opts.perPkg || 3;
    groupDatasets().forEach(function (g) {
      var items = g.items.slice(0, perPkg).map(function (d) { return datasetLine(d); });
      lines.push('· ' + g.name + '：' + items.join('；') +
        (g.items.length > perPkg ? '（该包共 ' + g.items.length + ' 个文件）' : ''));
    });
    return lines.join('\n');
  }

  function catalogDetail(ds, maxVars) {
    var lines = [];
    lines.push('【用户已选定的数据文件】' + ds.file);
    lines.push('规模：' + (ds.rows == null ? '行数未知' : U_fmtInt(ds.rows) + ' 行') + ' × ' + ds.cols + ' 列' +
      (ds.yearMin && ds.yearMax ? '，年份 ' + ds.yearMin + '–' + ds.yearMax : '') +
      (ds.unitId ? '，个体维度 ' + ds.unitId : '') +
      (ds.timeId ? '，时间维度 ' + ds.timeId : ''));
    if (ds.missingRate != null) lines.push('整体缺失率：' + (ds.missingRate * 100).toFixed(2) + '%（全列平均）');
    if (ds.statsNote === 'partial-first-2000-rows') lines.push('注意：该文件统计量按前 2000 行计算，不是全样本');
    lines.push('可用字段（字段名=中文含义，缺失率）：');
    ds.variables.slice(0, maxVars).forEach(function (v) {
      lines.push('  ' + v.name + '=' + (v.label || '无标签') +
        (v.missing == null ? '' : '（缺失 ' + (v.missing * 100).toFixed(1) + '%）'));
    });
    if (ds.variables.length > maxVars) {
      lines.push('  …另有 ' + (ds.variables.length - maxVars) + ' 个字段未列出');
    }
    return lines.join('\n');
  }

  /** 数据目录总览（给数据页做标题用） */
  function catalogOverview() {
    var s = summary() || {};
    return {
      files: datasets().length,
      rows: s.datasetRows || 0,
      vars: s.datasetVars || 0,
      packages: groupDatasets().length,
      computed: s.statsComputed || 0,
      partial: s.statsPartial || 0
    };
  }

  /* ---------------- 「采用的数据」里写的文件名，是真的吗 ---------------- */
  /* 注意：resource.js 在生成器里是原样（raw）字符串，正则里的反斜杠只写一层 */
  var FILE_TOKEN = /[^\s，。；：、（）()【】]{2,60}?\.(?:csv|xlsx|xls|dta|txt|do)/g;

  function fileTokens(text) {
    var m = String(text == null ? '' : text).match(FILE_TOKEN);
    return m ? m.map(function (x) { return x.trim(); }) : [];
  }

  function fileByName(tok) {
    var base = String(tok).split(/[\\\/]/).pop().trim();
    if (!base) return null;
    var all = datasets();
    for (var i = 0; i < all.length; i++) {
      var f = all[i].file;
      if (f === base || f.indexOf(base) >= 0 || base.indexOf(f) >= 0) return all[i];
    }
    return null;
  }

  /**
   * 核对一段「采用的数据」文字里点名的文件：
   *   ok      写了已选定的那份
   *   other   写的是目录里另一份真实文件（不是编的，但不是选定的）
   *   unknown 目录里根本没有这个文件名 —— 很可能是模型编的
   *   nofile  只描述了数据种类，没点名文件（不算错）
   */
  function checkDataText(text, datasetId) {
    var toks = fileTokens(text);
    if (!toks.length) return { kind: 'nofile', tokens: [] };
    var ds = datasetId ? datasetById(datasetId) : null;
    for (var i = 0; i < toks.length; i++) {
      var hit = fileByName(toks[i]);
      if (hit) {
        if (!ds) return { kind: 'other', file: hit.file, token: toks[i], noPin: true };
        if (hit.id === ds.id) return { kind: 'ok', file: hit.file, token: toks[i] };
        return { kind: 'other', file: hit.file, token: toks[i], pinned: ds.file };
      }
      return { kind: 'unknown', token: toks[i], tokens: toks };
    }
    return { kind: 'nofile', tokens: toks };
  }

  /* ---------------- 检索：真实 BM25，带来源标记 ---------------- */
  /**
   * 统一检索入口。返回的每一条都能被 corpus.verify 核验：
   *   doc.fullText.slice(charRange[0], charRange[1]) === quote
   */
  function search(q, opts) {
    q = String(q == null ? '' : q).trim();
    if (!q) return [];
    ensureCorpus();
    var C = ZY.corpus;
    if (!C || typeof C.search !== 'function') return [];
    var o = opts || {};
    var hits = C.search(q, o) || [];
    var idx = byIdIndex();
    hits.forEach(function (h) {
      var meta = idx[h.docId];
      h.source = meta ? meta.source : (String(h.docId).charAt(0) === 'r' ? 'real' : 'sample');
      h.sourceLabel = h.source === 'real' ? '真实文献' : '内置样例';
      h.file = meta ? meta.file : '';
      h.tag = meta ? meta.tag : '';
    });
    return hits;
  }

  /** 引用核验：给「引用可核验」这个承诺一个可调用的入口 */
  function verify(docId, charRange, quote) {
    var C = ZY.corpus;
    if (!C || typeof C.verify !== 'function') return { ok: false, reason: 'corpus-unavailable' };
    return C.verify(docId, charRange, quote);
  }

  /* ---------------- 汇总 ---------------- */
  function stats() {
    var s = summary() || {};
    var out = {
      samples: (D.LIBRARY || []).length,
      real: rawDocs().length,
      realLiterature: 0, realNotes: 0, readable: 0, unreadable: 0,
      pages: s.pages || 0, chars: s.chars || 0,
      withQuote: s.withQuote || 0, withJournal: s.withJournal || 0, withYear: s.withYear || 0,
      datasets: datasets().length, artifacts: artifacts().length,
      years: [s.yearMin, s.yearMax],
      source: s.source || ''
    };
    rawDocs().forEach(function (d) {
      if (d.kind === 'note') out.realNotes++; else out.realLiterature++;
      if (d.readable === false) out.unreadable++; else out.readable++;
    });
    out.total = out.samples + out.real;
    return out;
  }

  ZY.resource = {
    ready: ready,
    summary: summary,
    stats: stats,
    docs: docs,
    samples: samples,
    allDocs: allDocs,
    byId: byId,
    datasets: datasets,
    datasetById: datasetById,
    datasetLine: datasetLine,
    fieldsOf: fieldsOf,
    checkField: checkField,
    catalogForPrompt: catalogForPrompt,
    catalogOverview: catalogOverview,
    fileTokens: fileTokens,
    checkDataText: checkDataText,
    groupDatasets: groupDatasets,
    pkgOf: pkgOf,
    artifacts: artifacts,
    vocab: vocab,
    ensureCorpus: ensureCorpus,
    registration: function () { return regInfo; },
    diagOf: diagOf,
    search: search,
    verify: verify,
    trustLabel: function (t) { return TRUST_CN[t] || '需核对'; }
  };
})(window);
