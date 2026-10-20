/* ============================================================
   智研 · 语料与检索门面（分块 / 索引 / 质量诊断 / 引用出处）
   ------------------------------------------------------------
   挂载：window.ZY.corpus

   对外 API（严格按 task-7 签名）：
     ZY.corpus.addDocument(doc, opts)        -> Doc
     ZY.corpus.addSampleLibrary(libraryArray)-> number
     ZY.corpus.search(query, opts)           -> [{docId,title,journal,year,page,charRange,quote,score,trust,lowQuality}]
     ZY.corpus.stats()                       -> {docs, chunks, tokens, avgChunksPerDoc}
     ZY.corpus.diag(docId)                   -> {...}

   核心不变量（产品承诺「引用可核验」）：
     对任意检索结果 r：
       getDoc(r.docId).fullText.slice(r.charRange[0], r.charRange[1]) === r.quote
     该不变量由「先定位、再切片」的结构保证，并由 test/retrieval.test.js 真测。

   零网络默认可用：不依赖 ZY.pdftext / ZY.bm25 之外任何东西；
   若二者缺失，search() 返回 []，其余 API 仍不抛异常。
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};

  var DEFAULTS = {
    chunkSize: 400,          // 目标块长（字符）
    chunkOverlap: 80,        // 相邻块重叠（字符）
    minChunk: 80,            // 单块最小长度（尾部过短的块并入前一块）
    pageSep: '\n',           // fullText 页分隔符（与 pdftext 一致）
    maxQuote: 180,           // 引用片段硬上限（转发给 bm25 的 maxSnippet）
    minQuote: 40,
    qualityPenalty: 0.6,     // 低质量篇目的分数折扣
    limit: 8,
    includeLowQuality: true, // 默认返回但标记降权；置 false 则过滤
    /* 质量阈值与 pdftext.QUALITY 保持一致（pdftext 是单一事实来源） */
    coverageLow: 0.70,
    coverageHigh: 0.90,
    mojibakeLow: 0.05,
    mojibakeHigh: 0.01
  };

  var SENT_BREAK_RE = /[。！？；!?;\n]/;

  /* ------------------------------------------------------------
     0. 依赖（延迟取，避免脚本加载顺序问题）
     ------------------------------------------------------------ */
  function PT() { return (global.ZY && global.ZY.pdftext) || null; }
  function BM() { return (global.ZY && global.ZY.bm25) || null; }

  var state = {
    docs: [],
    byId: {},
    index: null,
    dirty: true,
    sampleLoaded: false,
    builtAt: null
  };

  /* ------------------------------------------------------------
     1. 工具
     ------------------------------------------------------------ */
  function merge(base, extra) {
    var out = {}, k;
    for (k in base) if (hasOwn(base, k)) out[k] = base[k];
    if (extra) for (k in extra) if (hasOwn(extra, k) && extra[k] !== undefined) out[k] = extra[k];
    return out;
  }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function round(x, d) { var f = Math.pow(10, d || 0); return Math.round(x * f) / f; }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function num(v) { return (typeof v === 'number' && !isNaN(v)) ? v : null; }

  /* ------------------------------------------------------------
     2. 分块：块不跨页，块文本 === fullText.slice(charStart,charEnd)
     ------------------------------------------------------------ */
  /* 纯文本分页：只认 \f（标准分页符）。pageSep 是**拼接**用的分隔符，
     不能拿来切页 —— 否则每换一行就变成「一页」，引用里会出现「第 4 页」这种假页码。 */
  function splitPages(text, pageSep) {
    var s = (text == null) ? '' : String(text);
    var parts = (s.indexOf('\f') >= 0) ? s.split('\f') : [s];
    var out = [];
    for (var i = 0; i < parts.length; i++) out.push({ pageNo: i + 1, text: parts[i] });
    return out;
  }

  function joinPages(pages, sep) {
    var full = '', cursor = 0, out = [];
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i] || {};
      var text = (p.text == null) ? '' : String(p.text);
      if (i > 0) { full += sep; cursor += sep.length; }
      var start = cursor;
      full += text;
      cursor += text.length;
      out.push({ pageNo: (p.pageNo == null ? (i + 1) : p.pageNo), text: text, charStart: start, charEnd: cursor });
    }
    return { fullText: full, pages: out };
  }

  /** 单页切块：优先在句末标点断开，尾部过短的块并入前一块 */
  function chunkText(text, size, overlap, minChunk) {
    var n = text.length, out = [];
    if (!n) return out;
    if (n <= size) return [{ start: 0, end: n }];
    var pos = 0, guard = 0;
    while (pos < n && guard++ < 100000) {
      var hard = Math.min(n, pos + size);
      var end = hard;
      if (hard < n) {
        var lo = pos + Math.floor(size * 0.6);
        for (var i = hard - 1; i >= lo; i--) {
          if (SENT_BREAK_RE.test(text.charAt(i))) { end = i + 1; break; }
        }
      }
      if (end <= pos) end = hard;
      out.push({ start: pos, end: end });
      if (end >= n) break;
      var next = end - overlap;
      if (next <= pos) next = end;
      pos = next;
    }
    if (out.length > 1 && (out[out.length - 1].end - out[out.length - 1].start) < minChunk) {
      var last = out.pop();
      out[out.length - 1].end = last.end;
    }
    return out;
  }

  function chunkPages(pages, opts) {
    var chunks = [];
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      var ranges = chunkText(p.text, opts.chunkSize, opts.chunkOverlap, opts.minChunk);
      for (var r = 0; r < ranges.length; r++) {
        var cs = p.charStart + ranges[r].start;
        var ce = p.charStart + ranges[r].end;
        chunks.push({
          idx: chunks.length,
          page: p.pageNo,
          charStart: cs,
          charEnd: ce,
          text: p.text.slice(ranges[r].start, ranges[r].end)
        });
      }
    }
    return chunks;
  }

  /* ------------------------------------------------------------
     3. 质量诊断：计算值 + 声明值（样例库自带）合并
        声明值来自 data.js 的 coverage/mojibake/scanned/twoCol，
        是本 Demo 为例样文献标注的事实；真实上传文件没有声明值，用计算值。
        来源在 diag.sources 里逐项标注，绝不掩盖。
     ------------------------------------------------------------ */
  function computeDiag(pages, opts) {
    var PTx = PT();
    if (PTx && typeof PTx.diagnose === 'function') {
      return PTx.diagnose(pages, { pageSep: opts.pageSep, engine: opts.engine, trust: opts.trust });
    }
    /* pdftext 缺失时的最小诊断（阈值与 pdftext 一致） */
    var joined = joinPages(pages, opts.pageSep);
    var n = joined.pages.length, nonSpace = 0, textPages = 0;
    for (var i = 0; i < n; i++) {
      var c = 0, t = joined.pages[i].text;
      for (var j = 0; j < t.length; j++) if (!/\s/.test(t.charAt(j))) c++;
      nonSpace += c;
      if (c >= 20) textPages++;
    }
    var avg = n ? nonSpace / n : 0;
    var scannedFallback = n > 0 && nonSpace === 0;
    return {
      pages: n, chars: joined.fullText.length, avgCharsPerPage: Math.round(avg),
      coverage: round(clamp(avg / 900, 0, 1), 4), mojibakeRate: 0,
      scanned: scannedFallback, twoColRisk: 'unknown',
      mojibakeChars: 0, textChars: joined.fullText.length, nonSpaceChars: nonSpace,
      noTextLayer: scannedFallback,
      textPages: textPages, textPageRatio: n ? round(textPages / n, 4) : 0,
      emptyPages: [], quality: qualityOfLocal({ coverage: clamp(avg / 900, 0, 1), mojibakeRate: 0, scanned: scannedFallback, twoColRisk: 'unknown' }, opts.trust),
      computedFallback: true
    };
  }

  function qualityOfLocal(eff, trust) {
    var PTx = PT();
    if (PTx && typeof PTx.qualityOf === 'function') return PTx.qualityOf(eff, trust);
    var q = 'high';
    if (eff.scanned) q = 'low';
    else if (eff.coverage < DEFAULTS.coverageLow || eff.mojibakeRate > DEFAULTS.mojibakeLow) q = 'low';
    else if (eff.coverage < DEFAULTS.coverageHigh || eff.mojibakeRate > DEFAULTS.mojibakeHigh || eff.twoColRisk === 'high') q = 'medium';
    if (trust === 'low') q = 'low';
    return q;
  }

  /**
   * 把「计算值」与「声明值」合成一份**扁平**诊断（corpus.diag() 的返回形状）：
   * 必填六项（pages/chars/avgCharsPerPage/coverage/mojibakeRate/scanned/twoColRisk）
   * 永远有值；声明值优先，来源逐项标注在 sources 里，计算值完整保留在 computed。
   */
  function mergeDiag(computed, declared, trust) {
    var dec = declared || {};
    var sources = { coverage: 'computed', mojibakeRate: 'computed', scanned: 'computed', twoColRisk: 'computed' };
    var eff = {
      coverage: computed.coverage,
      mojibakeRate: computed.mojibakeRate,
      scanned: computed.scanned,
      twoColRisk: computed.twoColRisk
    };
    if (num(dec.coverage) != null) { eff.coverage = num(dec.coverage); sources.coverage = 'declared'; }
    if (num(dec.mojibakeRate) != null) { eff.mojibakeRate = num(dec.mojibakeRate); sources.mojibakeRate = 'declared'; }
    if (typeof dec.scanned === 'boolean') { eff.scanned = dec.scanned; sources.scanned = 'declared'; }
    if (dec.twoColRisk) { eff.twoColRisk = dec.twoColRisk; sources.twoColRisk = 'declared'; }
    var quality = qualityOfLocal(eff, trust);
    return {
      /* —— 必填六项 —— */
      pages: computed.pages,
      chars: computed.chars,
      avgCharsPerPage: computed.avgCharsPerPage,
      coverage: eff.coverage,
      mojibakeRate: eff.mojibakeRate,
      scanned: eff.scanned,
      twoColRisk: eff.twoColRisk,
      /* —— 细分指标 —— */
      textChars: computed.textChars,
      nonSpaceChars: computed.nonSpaceChars,
      mojibakeChars: computed.mojibakeChars,
      noTextLayer: computed.noTextLayer,
      textPages: computed.textPages,
      textPageRatio: computed.textPageRatio,
      emptyPages: computed.emptyPages,
      twoColBasis: computed.twoColBasis,
      twoColPages: computed.twoColPages,
      needsEngine: computed.needsEngine,
      engine: computed.engine,
      computedFallback: !!computed.computedFallback,
      /* —— 分级与出处 —— */
      quality: quality,
      lowQuality: quality === 'low',
      sources: sources,
      effective: {
        coverage: eff.coverage,
        mojibakeRate: eff.mojibakeRate,
        scanned: eff.scanned,
        twoColRisk: eff.twoColRisk,
        quality: quality
      },
      declared: (declared && Object.keys(declared).length) ? declared : null,
      computed: computed
    };
  }

  /* ------------------------------------------------------------
     4. addDocument
        doc: {id, title, journal, year, authors, method, conclusion, trust,
              text | fullText | pages:[{pageNo,text}] ,
              coverage/mojibake/scanned/twoCol（可选，声明值），quote（可选）}
     ------------------------------------------------------------ */
  function addDocument(doc, opts) {
    var o = merge(DEFAULTS, opts);
    var d = doc || {};
    var id = String(d.id == null ? ('doc-' + (state.docs.length + 1)) : d.id);

    var pages = normalizePages(d, o);
    var joined = joinPages(pages, o.pageSep);
    var chunks = chunkPages(joined.pages, o);
    var declared = collectDeclared(d);
    var computed = computeDiag(joined.pages, { pageSep: o.pageSep, engine: d.engine, trust: d.trust });
    var diag = mergeDiag(computed, declared, d.trust);
    var quoteRange = null;
    if (typeof d.quote === 'string' && d.quote.length) {
      var at = joined.fullText.indexOf(d.quote);
      if (at >= 0) quoteRange = [at, at + d.quote.length];
    }

    var out = {
      id: id,
      title: d.title == null ? id : String(d.title),
      journal: d.journal == null ? '' : String(d.journal),
      year: (d.year == null ? null : d.year),
      authors: d.authors == null ? '' : String(d.authors),
      method: d.method == null ? '' : String(d.method),
      conclusion: d.conclusion == null ? '' : String(d.conclusion),
      keywords: d.keywords == null ? '' : String(d.keywords),
      trust: d.trust || 'medium',
      source: d.source || 'manual',
      engine: d.engine || (PT() && PT().hasEngine && PT().hasEngine() ? 'pdfjs' : (d.pages ? 'provided' : 'text')),
      file: d.file || null,
      pages: joined.pages,
      fullText: joined.fullText,
      chunks: chunks,
      diag: diag,
      quality: diag.quality,
      lowQuality: diag.lowQuality,
      quoteRange: quoteRange,
      quoteFound: !!quoteRange,
      declaredCharRange: d.charRange || null,
      declaredPage: (d.page == null ? null : d.page),
      declaredRrf: (d.rrf == null ? null : d.rrf),
      addedAt: nowIso()
    };
    state.byId[id] = out;
    var replaced = false;
    for (var i = 0; i < state.docs.length; i++) if (state.docs[i].id === id) { state.docs[i] = out; replaced = true; break; }
    if (!replaced) state.docs.push(out);
    state.dirty = true;
    return out;
  }

  function normalizePages(d, o) {
    var src = null;
    if (d.pages && d.pages.length) src = d.pages;
    else if (d.fullText != null) return splitPages(String(d.fullText), o.pageSep);
    else if (d.text != null) return splitPages(String(d.text), o.pageSep);
    var out = [];
    if (src) {
      for (var i = 0; i < src.length; i++) {
        var p = src[i] || {};
        out.push({ pageNo: (p.pageNo == null ? (i + 1) : p.pageNo), text: (p.text == null ? '' : String(p.text)) });
      }
      return out;
    }
    return [{ pageNo: 1, text: '' }];
  }

  function collectDeclared(d) {
    var dec = {};
    if (num(d.coverage) != null) dec.coverage = num(d.coverage);
    if (num(d.mojibake) != null) dec.mojibakeRate = num(d.mojibake);
    if (num(d.mojibakeRate) != null) dec.mojibakeRate = num(d.mojibakeRate);
    if (typeof d.scanned === 'boolean') dec.scanned = d.scanned;
    if (d.twoCol) dec.twoColRisk = (d.twoCol === 'none' ? 'none' : d.twoCol);
    return dec;
  }

  /* ------------------------------------------------------------
     5. 样例库灌库
        D.LIBRARY 只有结构化字段 + 一句原句摘录，没有真实 PDF 正文。
        因此正文由字段合成，并把摘录**逐字**嵌入，摘录因此可定位、可核验。
        声明质量字段（coverage/mojibake/scanned/twoCol）照搬，来源标注为 declared。
     ------------------------------------------------------------ */
  var CONCLUSION_CN = { positive: '正向', negative: '负向', mixed: '存在分歧', 'n/a': '不适用' };

  function sampleText(d) {
    var parts = [];
    parts.push('《' + (d.title || '') + '》');
    parts.push('期刊：' + (d.journal || '未标注') + '；年份：' + (d.year == null ? '未标注' : d.year) +
      '；作者：' + (d.authors || '未标注') + '；研究方法：' + (d.method || '未标注') + '。');
    parts.push('研究结论：' + (CONCLUSION_CN[d.conclusion] || '未标注') + '。');
    parts.push('原文摘录：「' + (d.quote || '') + '」');
    parts.push('关键词：' + [d.method, d.journal, d.year].filter(function (x) { return x != null && x !== ''; }).join(' ') + '。');
    parts.push('样例说明：本篇为 Demo 内置样例文献，正文文本由 title/journal/authors/method/conclusion/quote 字段合成，' +
      '原句摘录逐字嵌入，因此引用出处（页码 + 字符区间）可被程序核验；Demo 不随包分发真实 PDF 正文。');
    return parts.join('\n');
  }

  function addSampleLibrary(libraryArray) {
    var list = libraryArray || [];
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var d = list[i] || {};
      var doc = {
        id: d.id,
        title: d.title,
        journal: d.journal,
        year: d.year,
        authors: d.authors,
        method: d.method,
        conclusion: d.conclusion,
        trust: d.trust,
        quote: d.quote,
        text: sampleText(d),
        source: 'sample',
        engine: 'sample-synthesized',
        file: d.file,
        /* 声明质量字段 */
        coverage: d.coverage,
        mojibake: d.mojibake,
        scanned: d.scanned,
        twoCol: d.twoCol,
        charRange: d.charRange,
        page: d.page,
        rrf: d.rrf
      };
      addDocument(doc, { chunkSize: 400 });
      n++;
    }
    state.sampleLoaded = state.sampleLoaded || n > 0;
    return n;
  }

  /* ------------------------------------------------------------
     6. 索引（懒重建；Demo 规模 22 篇，重建成本可忽略）
     ------------------------------------------------------------ */
  function ensureIndex() {
    var BMx = BM();
    if (!BMx) return null;
    if (!state.dirty && state.index) return state.index;
    var docs = [];
    for (var i = 0; i < state.docs.length; i++) {
      var d = state.docs[i];
      docs.push({
        id: d.id, title: d.title, journal: d.journal, year: d.year,
        authors: d.authors, method: d.method, conclusion: d.conclusion,
        keywords: d.keywords,
        text: d.fullText, chunks: d.chunks
      });
    }
    state.index = BMx.buildIndex(docs);
    state.dirty = false;
    state.builtAt = nowIso();
    return state.index;
  }

  /* ------------------------------------------------------------
     7. 检索门面
     ------------------------------------------------------------ */
  function search(query, opts) {
    var o = merge(DEFAULTS, opts);
    var out = [];
    var BMx = BM();
    if (!BMx) return out;
    var idx = ensureIndex();
    if (!idx) return out;
    var want = Math.max(1, Math.min(o.limit || 8, 50));
    var rows = BMx.search(idx, query, {
      limit: Math.max(want * 3, 20),
      field: o.field || 'auto',
      fusion: o.fusion || 'rrf',
      k1: o.k1, b: o.b, rrfK: o.rrfK,
      maxSnippet: o.maxQuote,
      minSnippet: o.minQuote
    });
    var allow = null;
    if (o.docIds && o.docIds.length) {
      allow = {};
      for (var a = 0; a < o.docIds.length; a++) allow[String(o.docIds[a])] = 1;
    }
    var lastResults = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var doc = state.byId[r.id];
      if (!doc) continue;
      if (allow && !allow[r.id]) continue;
      if (o.includeLowQuality === false && doc.lowQuality) continue;
      var penalty = doc.lowQuality ? (o.qualityPenalty == null ? DEFAULTS.qualityPenalty : o.qualityPenalty) : 1;
      var score = r.score * penalty;
      if (o.minScore != null && score < o.minScore) continue;
      var snip = r.snippet;
      if (!snip) continue;
      var cs = clamp(snip.charStart, 0, doc.fullText.length);
      var ce = clamp(snip.charEnd, cs, doc.fullText.length);
      var quote = doc.fullText.slice(cs, ce);
      if (!quote.length) continue;
      var res = {
        docId: doc.id,
        id: doc.id,
        title: doc.title,
        journal: doc.journal,
        year: doc.year,
        method: doc.method,
        conclusion: doc.conclusion,
        page: snip.page,
        charRange: [cs, ce],
        quote: quote,
        score: score,
        rawScore: r.score,
        qualityPenalty: penalty,
        trust: doc.trust,
        lowQuality: doc.lowQuality,
        quality: doc.quality,
        matchedTerms: r.matchedTerms,
        bm25Score: r.bm25Score,
        bm25Rank: r.bm25Rank,
        metaScore: r.metaScore,
        metaRank: r.metaRank,
        routeScore: r.routeScore,
        routeRank: r.routeRank,
        coverageScore: r.coverageScore,
        coverageRank: r.coverageRank,
        rrfScore: r.rrfScore,
        declaredRrf: doc.declaredRrf,
        diag: {
          coverage: doc.diag.effective.coverage,
          mojibakeRate: doc.diag.effective.mojibakeRate,
          scanned: doc.diag.effective.scanned,
          twoColRisk: doc.diag.effective.twoColRisk,
          sources: doc.diag.sources
        },
        snippetMismatch: (quote !== snip.text)
      };
      out.push(res);
      lastResults.push(res);
    }
    out.sort(function (x, y) {
      return (y.score - x.score) ||
        ((y.bm25Score || 0) - (x.bm25Score || 0)) ||
        (x.docId < y.docId ? -1 : x.docId > y.docId ? 1 : 0);
    });
    out = out.slice(0, want);
    for (var k = 0; k < out.length; k++) out[k].rank = k + 1;
    state.lastResults = out;
    return out;
  }

  /** 引用核验：charRange 切原文是否等于 quote（产品承诺的可验证口子） */
  function verify(docId, charRange, quote) {
    var doc = state.byId[String(docId)];
    if (!doc) return { ok: false, reason: 'doc-not-found' };
    if (!charRange || charRange.length !== 2) return { ok: false, reason: 'bad-charRange' };
    var actual = doc.fullText.slice(charRange[0], charRange[1]);
    return { ok: actual === quote, actual: actual, expected: quote, docId: doc.id, fullTextLength: doc.fullText.length };
  }

  function lastResults() { return state.lastResults || []; }

  /* ------------------------------------------------------------
     8. 统计与查询
     ------------------------------------------------------------ */
  function stats() {
    ensureIndex();   // 懒索引先建好，否则 uniqueTerms 会是 0（数字必须自洽）
    var chunks = 0, tokens = 0, pages = 0, low = 0, high = 0, cov = 0;
    for (var i = 0; i < state.docs.length; i++) {
      var d = state.docs[i];
      chunks += d.chunks.length;
      pages += d.pages.length;
      if (d.lowQuality) low++;
      if (d.quality === 'high') high++;
      cov += d.diag.effective.coverage;
    }
    var idx = state.index;
    var unique = 0;
    if (idx && idx.body && idx.body.postings) {
      for (var t in idx.body.postings) if (hasOwn(idx.body.postings, t)) unique++;
      for (var di = 0; di < idx.docs.length; di++) {
        for (var ci = 0; ci < idx.docs[di].chunkTokens.length; ci++) tokens += idx.docs[di].chunkTokens[ci].length;
      }
    } else {
      var BMx = BM();
      if (BMx) {
        for (var j = 0; j < state.docs.length; j++) {
          var cs = state.docs[j].chunks;
          for (var c = 0; c < cs.length; c++) tokens += BMx.tokenize(cs[c].text).length;
        }
      }
    }
    return {
      docs: state.docs.length,
      chunks: chunks,
      tokens: tokens,
      avgChunksPerDoc: state.docs.length ? round(chunks / state.docs.length, 2) : 0,
      /* 附加统计 */
      pages: pages,
      uniqueTerms: unique,
      lowQualityDocs: low,
      highQualityDocs: high,
      avgCoverage: state.docs.length ? round(cov / state.docs.length, 4) : 0,
      sampleLoaded: state.sampleLoaded,
      indexed: !!(idx && !state.dirty),
      builtAt: state.builtAt
    };
  }

  function diag(docId) {
    var d = state.byId[String(docId)];
    return d ? d.diag : null;
  }
  function getDoc(docId) { return state.byId[String(docId)] || null; }
  function list() { return state.docs.slice(); }
  function clear() {
    state.docs = [];
    state.byId = {};
    state.index = null;
    state.dirty = true;
    state.sampleLoaded = false;
    state.lastResults = [];
    state.builtAt = null;
  }

  function nowIso() { try { return new Date().toISOString(); } catch (e) { return null; } }

  ZY.corpus = {
    addDocument: addDocument,
    addSampleLibrary: addSampleLibrary,
    search: search,
    stats: stats,
    diag: diag,
    /* 附加 API */
    getDoc: getDoc,
    list: list,
    clear: clear,
    ensureIndex: ensureIndex,
    chunkText: chunkText,
    verify: verify,
    lastResults: lastResults,
    DEFAULTS: DEFAULTS,
    CONCLUSION_CN: CONCLUSION_CN
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
