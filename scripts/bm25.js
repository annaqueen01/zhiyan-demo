/* ============================================================
   智研 · 中文 BM25 检索 + RRF 融合（零依赖、可离线）
   ------------------------------------------------------------
   挂载：window.ZY.bm25
   设计说明与局限见 docs/RETRIEVAL.md。

   两路检索 + RRF 融合（k=60）：
     A 路 = 正文 BM25（k1=1.5, b=0.75）+ metaBoost × 元数据 BM25（标题×3/期刊×2/其余×1）
     B 路 = idf 加权的查询覆盖率（含标题/期刊命中加权），不看 tf、不做长度归一
   理由与实测反例见第 9 节注释与 docs/RETRIEVAL.md。

   对外 API（严格按 task-7 签名）：
     ZY.bm25.tokenize(text)                -> string[]   索引侧分词（bigram + 单字 + 英文词）
     ZY.bm25.buildIndex(docs)              -> index
     ZY.bm25.search(index, query, opts)    -> [{id, score, rank, matchedTerms, snippet}]
     ZY.bm25.rrf(rankings, k)              -> [{id, score}]
   附加（附加字段/附加函数，不改变上面签名）：
     ZY.bm25.queryTerms(text)              -> string[]   查询侧分词（多字 CJK 段只出 bigram）
     ZY.bm25.tokenizeSpans(text)           -> [{term, start, end}]（原文偏移）
     ZY.bm25.idf(df, N)                    -> number
     ZY.bm25.scoreTerm(...)                -> number
     ZY.bm25.DEFAULTS
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};

  /* ------------------------------------------------------------
     0. 参数
     ------------------------------------------------------------ */
  var DEFAULTS = {
    k1: 1.5,            // BM25 词频饱和参数
    b: 0.75,            // BM25 长度归一化参数
    rrfK: 60,           // RRF 平滑常数
    metaBoost: 0.5,     // A 路：meta BM25 的权重（1.0 = 与正文等价）
    titleBoost: 2,      // B 路：命中标题的额外权重（总共 1+2=3）
    journalBoost: 1,    // B 路：命中期刊的额外权重（总共 1+1=2）
    maxSnippet: 180,    // 引用片段硬上限（字符）
    minSnippet: 40,     // 引用片段软下限（字符）
    titleWeight: 3,     // 元数据路：标题重复次数（= 权重）
    journalWeight: 2,   // 元数据路：期刊重复次数
    metaWeight: 1       // 元数据路：其余字段（年份/作者/方法/结论）
  };

  /* ------------------------------------------------------------
     1. 停用词
     ------------------------------------------------------------ */
  /* 单字停用词：只收「几乎不承载沿用实体」的功能字。
     刻意不含 中/上/下/内/外/前/后 —— 它们常出现在实体名里（中国、上市、外部性），
     误删会直接损害召回。bigram 命中任一停用字即丢弃。 */
  var CJK_STOP_CHARS = '的了是在与及或等这那也就都而被把为对从到有无之其该此些者所但若则由於并且以又很更最会能可要将已未一二三个我你他她它们请让使得着过吗呢吧啊';
  var CJK_STOP_CHAR_SET = {};
  (function () {
    for (var i = 0; i < CJK_STOP_CHARS.length; i++) CJK_STOP_CHAR_SET[CJK_STOP_CHARS.charAt(i)] = 1;
  })();

  /* bigram 级停用词：功能短语。多数已被单字规则覆盖，保留是为了显式可读。 */
  var CJK_STOP_BIGRAMS = ('一个|一种|一样|一边|进行|具有|以及|由于|对于|关于|通过|根据|按照|随着|基于|除了|为了|' +
    '如果|那么|这样|那样|已经|尚未|是否|什么|怎么|可以|能够|我们|你们|他们|她们|它们|这个|那个|这些|那些|' +
    '一些|本文|本章|上述|如下|其中|因此|所以|但是|而且|并且|虽然|然而|此外|同时|以上|以下|之一|等之').split('|');
  var CJK_STOP_BIGRAM_SET = {};
  (function () {
    for (var i = 0; i < CJK_STOP_BIGRAMS.length; i++) CJK_STOP_BIGRAM_SET[CJK_STOP_BIGRAMS[i]] = 1;
  })();

  /* 英文停用词。注意：刻意**不含** did / fe / iv / rdd / psm / tfp 这类本领域方法缩写，
     「DiD」「FE」是识别策略关键词，误删会直接让相关检索归零。 */
  var EN_STOPWORDS = ('a an the and or of to in for on with at by from as is are was were be been being am ' +
    'that this these those it its it\'s their there here he she his her him they them we our you your i me my ' +
    'not no nor but if then than so such can could may might must will would shall should do does done have has had ' +
    'also more most much many any all both each few other some own same too very just only over under again further ' +
    'about into during before after above below up down out off between through because while').split(/\s+/);
  var EN_STOP_SET = {};
  (function () {
    for (var i = 0; i < EN_STOPWORDS.length; i++) EN_STOP_SET[EN_STOPWORDS[i]] = 1;
  })();

  /* ------------------------------------------------------------
     2. 字符分类与归一化
     ------------------------------------------------------------ */
  /* 汉字（含扩展 A、兼容表意文字）与 〇 */
  var CJK_CHAR_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3005\u3007]/;
  /* 英文/数字：半角 + 全角（全角在 term 侧做 NFKC 归一） */
  var WORD_CHAR_RE = /[0-9A-Za-z\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/;
  var WS_RE = /[\s\u00A0\u3000]/;
  var ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

  function normalizeText(text) {
    var s = (text == null) ? '' : String(text);
    if (ZERO_WIDTH_RE.test(s)) { ZERO_WIDTH_RE.lastIndex = 0; s = s.replace(ZERO_WIDTH_RE, ''); }
    try { if (typeof s.normalize === 'function') s = s.normalize('NFKC'); } catch (e) { /* 老引擎忽略 */ }
    s = s.toLowerCase();
    return s;
  }

  function isCjk(ch) { return CJK_CHAR_RE.test(ch); }
  function isWordChar(ch) { return WORD_CHAR_RE.test(ch); }
  function isStopChar(ch) { return !!CJK_STOP_CHAR_SET[ch]; }
  function isStopBigram(bg) { return isStopChar(bg.charAt(0)) || isStopChar(bg.charAt(1)) || !!CJK_STOP_BIGRAM_SET[bg]; }
  function isStopEn(w) { return !!EN_STOP_SET[w] || w.length < 1; }

  /* ------------------------------------------------------------
     3. 分词：中文 bigram + 单字，英文/数字单词
        顺序（可测）：对每个 CJK 连续段先输出全部 bigram（左到右），
        再输出全部单字（左到右）；英文/数字按出现顺序。
     ------------------------------------------------------------ */
  function tokenizeSpans(text) {
    var s = String(text == null ? '' : text);   // 用原文，保证 start/end 是「原文偏移」
    var out = [];
    var i = 0, n = s.length;
    while (i < n) {
      var ch = s.charAt(i);
      if (isCjk(ch)) {
        var j = i;
        while (j < n && isCjk(s.charAt(j))) j++;
        var run = s.slice(i, j);
        var k;
        for (k = 1; k < run.length; k++) {
          var bg = run.slice(k - 1, k + 1);
          if (!isStopBigram(bg)) out.push({ term: bg, start: i + k - 1, end: i + k + 1 });
        }
        for (k = 0; k < run.length; k++) {
          var c = run.charAt(k);
          if (!isStopChar(c)) out.push({ term: c, start: i + k, end: i + k + 1 });
        }
        i = j;
      } else if (isWordChar(ch)) {
        var j2 = i;
        while (j2 < n && isWordChar(s.charAt(j2))) j2++;
        var w = normalizeText(s.slice(i, j2));
        if (w && !isStopEn(w)) out.push({ term: w, start: i, end: j2 });
        i = j2;
      } else {
        i++;
      }
    }
    return out;
  }

  function tokenize(text) {
    var spans = tokenizeSpans(text);
    var out = [];
    for (var i = 0; i < spans.length; i++) out.push(spans[i].term);
    return out;
  }

  /**
   * 查询侧分词（与索引侧 tokenize 有意不同）：
   * 多字 CJK 连续段只产出 bigram，不产出单字；单字段落才用单字兜底。
   * 为什么：索引里保留单字是为了让「数」这种单字查询可用；但如果查询侧也带单字，
   * 「扫描件」就会命中任何含「件」的文档（例如「…条件。」），把真正的扫描件压下去。
   * 副作用（已在 docs 记录）：查询「创新」不会命中「创造新的价值」这种不连续出现。
   */
  function queryTerms(text) {
    var s = String(text == null ? '' : text);
    var out = [], i = 0, n = s.length;
    while (i < n) {
      var ch = s.charAt(i);
      if (isCjk(ch)) {
        var j = i;
        while (j < n && isCjk(s.charAt(j))) j++;
        var run = s.slice(i, j);
        if (run.length === 1) {
          if (!isStopChar(run)) out.push(run);
        } else {
          for (var k = 1; k < run.length; k++) {
            var bg = run.slice(k - 1, k + 1);
            if (!isStopBigram(bg)) out.push(bg);
          }
        }
        i = j;
      } else if (isWordChar(ch)) {
        var j2 = i;
        while (j2 < n && isWordChar(s.charAt(j2))) j2++;
        var w = normalizeText(s.slice(i, j2));
        if (w && !isStopEn(w)) out.push(w);
        i = j2;
      } else {
        i++;
      }
    }
    return out;
  }

  function termFreq(tokens) {
    var tf = {};
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      tf[t] = (tf[t] || 0) + 1;
    }
    return tf;
  }

  function uniq(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) {
      if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
    }
    return out;
  }

  function termsSet(tokens) {
    var set = {};
    for (var i = 0; i < tokens.length; i++) set[tokens[i]] = 1;
    return set;
  }

  /* ------------------------------------------------------------
     4. BM25 基础函数
     ------------------------------------------------------------ */
  /** idf = ln(1 + (N - df + 0.5)/(df + 0.5)) */
  function idf(df, N) {
    if (!N || N <= 0) return 0;
    if (df <= 0) return 0;
    return Math.log(1 + (N - df + 0.5) / (df + 0.5));
  }

  /** 单词条贡献：idf * tf*(k1+1) / (tf + k1*(1-b+b*dl/avgdl)) */
  function scoreTerm(opts) {
    var tf = opts.tf, dl = opts.dl, avgdl = opts.avgdl || 1;
    var k1 = (opts.k1 == null) ? DEFAULTS.k1 : opts.k1;
    var b = (opts.b == null) ? DEFAULTS.b : opts.b;
    var idfv = (opts.idf == null) ? idf(opts.df, opts.N) : opts.idf;
    if (!tf) return 0;
    var norm = 1 - b + b * (dl / avgdl);
    return idfv * (tf * (k1 + 1)) / (tf + k1 * norm);
  }

  /* ------------------------------------------------------------
     5. 建索引
        docs: [{id, title, journal, year, text, chunks?}]
        chunks（可选，扩展字段）: [{page, charStart, charEnd, text}]
        —— body 路索引分块文本；meta 路索引标题×3 + 期刊×2 + 其余字段×1。
     ------------------------------------------------------------ */
  function buildIndex(docs, opts) {
    var o = merge(DEFAULTS, opts);
    var index = {
      k1: o.k1, b: o.b, rrfK: o.rrfK,
      N: 0,
      docs: [],
      byId: {},
      body: { postings: {}, len: {}, total: 0, avgLen: 0 },
      meta: { postings: {}, len: {}, total: 0, avgLen: 0 },
      builtAt: null
    };
    var list = docs || [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i] || {};
      var id = (d.id == null) ? ('doc-' + i) : String(d.id);
      var text = (d.text == null) ? '' : String(d.text);
      var chunks = normalizeChunks(d, text, i, o);
      var doc = {
        id: id,
        title: d.title == null ? '' : String(d.title),
        journal: d.journal == null ? '' : String(d.journal),
        year: d.year == null ? '' : d.year,
        authors: d.authors == null ? '' : String(d.authors),
        method: d.method == null ? '' : String(d.method),
        conclusion: d.conclusion == null ? '' : String(d.conclusion),
        keywords: d.keywords == null ? '' : String(d.keywords),
        text: text,
        chunks: chunks,
        chunkTokens: [],
        len: 0,
        metaLen: 0,
        /* 字段命中集合：B 路（覆盖率）用它给标题/期刊命中加权 */
        titleTerms: termsSet(tokenize(d.title == null ? '' : String(d.title))),
        journalTerms: termsSet(tokenize(d.journal == null ? '' : String(d.journal)))
      };
      /* body 路 */
      var bodyTf = {};
      var totalLen = 0;
      for (var c = 0; c < chunks.length; c++) {
        var toks = tokenize(chunks[c].text);
        doc.chunkTokens.push(toks);
        totalLen += toks.length;
        for (var t = 0; t < toks.length; t++) {
          var term = toks[t];
          var e = bodyTf[term] || (bodyTf[term] = { tf: 0, chunkTf: {} });
          e.tf++;
          e.chunkTf[c] = (e.chunkTf[c] || 0) + 1;
        }
      }
      doc.len = totalLen;
      /* meta 路 */
      var metaTokens = metaTokenList(doc, o);
      doc.metaLen = metaTokens.length;
      var metaTf = termFreq(metaTokens);

      if (index.byId[id]) continue;        // 重复 id：保留第一篇，跳过后续
      index.byId[id] = doc;
      index.docs.push(doc);
      addPostings(index.body, id, bodyTf, totalLen);
      addPostings(index.meta, id, metaTf, metaTokens.length);
    }
    index.N = index.docs.length;
    index.body.avgLen = index.N ? (index.body.total / index.N) : 1;
    index.meta.avgLen = index.N ? (index.meta.total / index.N) : 1;
    index.builtAt = nowIso();
    return index;
  }

  function addPostings(field, docId, tfMap, len) {
    field.len[docId] = len;
    field.total += len;
    for (var term in tfMap) {
      if (!Object.prototype.hasOwnProperty.call(tfMap, term)) continue;
      var entry = field.postings[term] || (field.postings[term] = { df: 0, post: {} });
      entry.df++;
      var v = tfMap[term];
      /* body 路存 {tf, chunkTf}；meta 路传进来的是纯计数，这里统一成同一种形状 */
      entry.post[docId] = (typeof v === 'number') ? { tf: v } : v;
    }
  }

  function metaTokenList(doc, o) {
    var out = [];
    pushRep(out, tokenize(doc.title), o.titleWeight);
    pushRep(out, tokenize(doc.journal), o.journalWeight);
    var rest = [String(doc.year || ''), doc.authors, doc.method, doc.conclusion, doc.keywords].join(' ');
    pushRep(out, tokenize(rest), o.metaWeight);
    return out;
  }

  function pushRep(arr, tokens, times) {
    for (var r = 0; r < (times || 1); r++) {
      for (var i = 0; i < tokens.length; i++) arr.push(tokens[i]);
    }
  }

  /* 分块规整：保证 chunk.text === doc.text.slice(charStart,charEnd)（引用可核验的结构前提） */
  function normalizeChunks(d, text, docIndex, o) {
    var raw = d.chunks;
    var out = [];
    if (raw && raw.length) {
      for (var i = 0; i < raw.length; i++) {
        var c = raw[i] || {};
        var cs = clampInt(c.charStart, 0, text.length);
        var ce = clampInt(c.charEnd, cs, text.length);
        var slice = text.slice(cs, ce);
        out.push({
          idx: out.length,
          page: (c.page == null ? 1 : c.page),
          charStart: cs,
          charEnd: ce,
          text: (typeof c.text === 'string' && c.text === slice) ? c.text : slice
        });
      }
      return out;
    }
    /* 无分块：整篇当作第 1 页的一个块 */
    out.push({ idx: 0, page: (o.defaultPage == null ? 1 : o.defaultPage), charStart: 0, charEnd: text.length, text: text });
    return out;
  }

  /* ------------------------------------------------------------
     6. 单路打分
     ------------------------------------------------------------ */
  function scoreField(index, fieldName, qTerms, o) {
    var field = index[fieldName];
    var N = index.N;
    var out = [];
    if (!N) return out;
    var avgLen = field.avgLen || 1;
    var k1 = (o.k1 == null) ? index.k1 : o.k1;
    var b = (o.b == null) ? index.b : o.b;
    for (var di = 0; di < index.docs.length; di++) {
      var doc = index.docs[di];
      var dl = field.len[doc.id] || 0;
      if (!dl) continue;
      var score = 0;
      var matched = [];
      var chunkScore = {};
      for (var qi = 0; qi < qTerms.length; qi++) {
        var term = qTerms[qi];
        var entry = field.postings[term];
        if (!entry) continue;
        var post = entry.post[doc.id];
        if (!post) continue;
        var idfv = idf(entry.df, N);
        var contrib = scoreTerm({ tf: post.tf, dl: dl, avgdl: avgLen, k1: k1, b: b, idf: idfv });
        score += contrib;
        matched.push({ term: term, tf: post.tf, idf: idfv, contrib: contrib });
        if (post.chunkTf) {
          for (var ci in post.chunkTf) {
            if (!Object.prototype.hasOwnProperty.call(post.chunkTf, ci)) continue;
            chunkScore[ci] = (chunkScore[ci] || 0) + (post.chunkTf[ci] * idfv);
          }
        }
      }
      if (!matched.length) continue;
      var bestChunk = null, bestVal = -1;
      for (var ck in chunkScore) {
        if (!Object.prototype.hasOwnProperty.call(chunkScore, ck)) continue;
        if (chunkScore[ck] > bestVal) { bestVal = chunkScore[ck]; bestChunk = parseInt(ck, 10); }
      }
      matched.sort(function (x, y) { return (y.idf - x.idf) || (x.term < y.term ? -1 : x.term > y.term ? 1 : 0); });
      out.push({ id: doc.id, score: score, matched: matched, bestChunk: bestChunk });
    }
    out.sort(function (x, y) { return (y.score - x.score) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0); });
    for (var r = 0; r < out.length; r++) out[r].rank = r + 1;
    return out;
  }

  /* ------------------------------------------------------------
     7. RRF 融合：score = Σ 1/(k + rank)，rank 从 1 开始
        rankings: [[{id, score}] | [id] | [{id}]]
        同一路内重复 id 只计最好名次；同分按 id 升序（确定性）。
     ------------------------------------------------------------ */
  function rrf(rankings, k) {
    var kk = (k == null) ? DEFAULTS.rrfK : k;
    var acc = {}, order = [];
    var lists = rankings || [];
    for (var li = 0; li < lists.length; li++) {
      var list = lists[li] || [];
      var seen = {};
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var id = (item && typeof item === 'object') ? item.id : item;
        if (id == null) continue;
        id = String(id);
        if (seen[id]) continue;
        seen[id] = 1;
        if (!acc[id]) { acc[id] = { id: id, score: 0, ranks: [] }; order.push(id); }
        acc[id].score += 1 / (kk + i + 1);
        acc[id].ranks.push({ list: li, rank: i + 1, score: (item && typeof item === 'object') ? item.score : undefined });
      }
    }
    var out = [];
    for (var oi = 0; oi < order.length; oi++) out.push(acc[order[oi]]);
    out.sort(function (x, y) { return (y.score - x.score) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0); });
    return out;
  }

  /* ------------------------------------------------------------
     8. 引用片段（snippet）：全局偏移，保证 text.slice(charStart,charEnd) === text
     ------------------------------------------------------------ */
  var SENT_END_RE = /[。！？；!?;\n]/;

  function safeStart(s, i) {
    if (i <= 0) return 0;
    if (i >= s.length) return s.length;
    var c = s.charCodeAt(i);
    if (c >= 0xDC00 && c <= 0xDFFF) return i - 1;   // 不切在代理对中间
    return i;
  }
  function safeEnd(s, i) {
    if (i >= s.length) return s.length;
    if (i <= 0) return 0;
    var c = s.charCodeAt(i);
    if (c >= 0xDC00 && c <= 0xDFFF) return i - 1;
    return i;
  }

  function sentenceStart(text, pos, maxBack) {
    var lo = Math.max(0, pos - maxBack);
    for (var i = pos - 1; i >= lo; i--) {
      if (SENT_END_RE.test(text.charAt(i))) return i + 1;
    }
    return Math.max(0, pos - 24);
  }
  function sentenceEnd(text, pos, maxFwd) {
    var hi = Math.min(text.length, pos + maxFwd);
    for (var i = pos; i < hi; i++) {
      if (SENT_END_RE.test(text.charAt(i))) {
        var e = i + 1;
        while (e < text.length && /[」』”"）)]/.test(text.charAt(e))) e++;
        return e;
      }
    }
    return Math.min(text.length, pos + 24);
  }

  /** 以某个命中为锚点算一个引用窗口（优先完整句子，超长则居中） */
  function snippetWindow(text, hit, maxLen, minLen) {
    var start, end;
    var ss = sentenceStart(text, hit.start, Math.floor(maxLen * 0.6));
    var se = sentenceEnd(text, hit.end, Math.floor(maxLen * 0.6));
    if (se - ss <= maxLen) { start = ss; end = se; }
    else {
      var center = (hit.start + hit.end) / 2;
      start = Math.round(center - maxLen / 2);
      end = start + maxLen;
    }
    start = safeStart(text, Math.max(0, start));
    end = safeEnd(text, Math.min(text.length, end));
    if (end < start) end = start;
    if (end - start < minLen) {
      end = safeEnd(text, Math.min(text.length, start + minLen));
      if (end - start < minLen) start = safeStart(text, Math.max(0, end - minLen));
    }
    return { start: start, end: end };
  }

  /**
   * 引用窗口选择：在「以每个命中为锚点」的候选窗口里，选**覆盖查询词权重之和最大**的那个
   * （同分取最靠前）。只取「第一个命中」会把窗口锚在标题上，用户看到的是标题而不是
   * 真正回答问题的那句原话（实测：查询「外观设计专利」会锚到标题里的「专利」）。
   * weights: {term: idf}，缺省时退化为「覆盖的查询词个数」。
   */
  function buildSnippet(doc, chunkIdx, qTerms, o, weights) {
    var idx = (chunkIdx == null || chunkIdx < 0 || chunkIdx >= doc.chunks.length) ? -1 : chunkIdx;
    if (idx < 0) idx = pickChunk(doc, qTerms);
    var chunk = doc.chunks[idx] || doc.chunks[0];
    var text = chunk.text;
    var spans = tokenizeSpans(text);
    var qset = {};
    for (var i = 0; i < qTerms.length; i++) qset[qTerms[i]] = 1;
    var hits = [];
    for (var s = 0; s < spans.length; s++) if (qset[spans[s].term]) hits.push(spans[s]);

    var maxLen = o.maxSnippet, minLen = o.minSnippet;
    var start, end;
    if (hits.length) {
      var best = null, bestScore = -1, seen = {};
      var limit = Math.min(hits.length, 64);
      for (var h = 0; h < limit; h++) {
        var win = snippetWindow(text, hits[h], maxLen, minLen);
        var key = win.start + ':' + win.end;
        if (seen[key]) continue;
        seen[key] = 1;
        var sc = 0;
        for (var hh = 0; hh < hits.length; hh++) {
          if (hits[hh].start >= win.start && hits[hh].end <= win.end) {
            sc += (weights && weights[hits[hh].term] != null) ? weights[hits[hh].term] : 1;
          }
        }
        if (sc > bestScore) { bestScore = sc; best = win; }
      }
      start = best.start;
      end = best.end;
    } else {
      start = 0;
      end = Math.min(text.length, maxLen);
    }
    return {
      text: text.slice(start, end),
      page: chunk.page,
      charStart: chunk.charStart + start,
      charEnd: chunk.charStart + end
    };
  }

  function pickChunk(doc, qTerms) {
    var qset = {};
    for (var i = 0; i < qTerms.length; i++) qset[qTerms[i]] = 1;
    var best = 0, bestHit = -1;
    for (var c = 0; c < doc.chunks.length; c++) {
      var spans = tokenizeSpans(doc.chunks[c].text);
      var hit = 0;
      for (var s = 0; s < spans.length; s++) if (qset[spans[s].term]) hit++;
      if (hit > bestHit) { bestHit = hit; best = c; }
      if (bestHit > 0 && c > 0) break;    // 首个有命中的块够用，避免整篇扫描
    }
    return best;
  }

  /* ------------------------------------------------------------
     9. 检索：RRF 融合两路
        A 路（证据强度）= body BM25 + metaBoost × meta BM25
        B 路（查询覆盖率）= Σ idf(t) × boost(t)，t 为去重后的查询词；
             boost = 1 + titleBoost×[命中标题] + journalBoost×[命中期刊]

        为什么第二路不是「纯 meta BM25」：RRF 只看名次、丢掉分数幅度，
        于是「两路都沾一点」的宽泛文档会压过「只有一路但极强」的专业文献。
        实测样例库查询「宽带中国试点」：唯一提到该试点的 d21 在纯 meta 第二路下
        掉到第 9 名（用户看不见）；换成覆盖率第二路后，d21 两路都排第 1。
        字段加权改由 A 路的 metaBoost 与 B 路的 boost 承担，两路仍可单测对拍。

        opts: {limit, fusion:'rrf'|'bm25', field:'auto'|'body'|'meta'|'coverage',
               k1, b, rrfK, metaBoost, titleBoost, journalBoost,
               maxSnippet, minSnippet, docIds, minScore, candidates}
     ------------------------------------------------------------ */
  function scoreRouteA(index, qTerms, o) {
    var bodyR = scoreField(index, 'body', qTerms, o);
    var metaR = scoreField(index, 'meta', qTerms, o);
    var mb = (o.metaBoost == null) ? DEFAULTS.metaBoost : o.metaBoost;
    var bMap = byIdMap(bodyR), mMap = byIdMap(metaR);
    var order = [], seen = {};
    var collect = function (list) {
      for (var i = 0; i < list.length; i++) if (!seen[list[i].id]) { seen[list[i].id] = 1; order.push(list[i].id); }
    };
    collect(bodyR);
    collect(metaR);
    var out = [];
    for (var i = 0; i < order.length; i++) {
      var id = order[i], b = bMap[id], m = mMap[id];
      var matched = b ? b.matched.slice() : [];
      if (m) {
        var has = {};
        for (var k = 0; k < matched.length; k++) has[matched[k].term] = 1;
        for (var mi = 0; mi < m.matched.length; mi++) if (!has[m.matched[mi].term]) matched.push(m.matched[mi]);
      }
      out.push({
        id: id,
        score: (b ? b.score : 0) + mb * (m ? m.score : 0),
        bm25Score: b ? b.score : undefined,
        metaScore: m ? m.score : undefined,
        bm25Rank: b ? b.rank : undefined,
        metaRank: m ? m.rank : undefined,
        matched: matched,
        bestChunk: b ? b.bestChunk : (m ? m.bestChunk : null)
      });
    }
    return sortWithRanks(out);
  }

  function scoreCoverage(index, qTerms, o) {
    var out = [];
    if (!index.N) return out;
    var tb = (o.titleBoost == null) ? DEFAULTS.titleBoost : o.titleBoost;
    var jb = (o.journalBoost == null) ? DEFAULTS.journalBoost : o.journalBoost;
    for (var di = 0; di < index.docs.length; di++) {
      var doc = index.docs[di];
      var score = 0, matched = [], chunkHit = {};
      for (var qi = 0; qi < qTerms.length; qi++) {
        var term = qTerms[qi];
        var bEntry = index.body.postings[term];
        var bPost = bEntry ? bEntry.post[doc.id] : null;
        var inTitle = !!(doc.titleTerms && doc.titleTerms[term]);
        var inJournal = !!(doc.journalTerms && doc.journalTerms[term]);
        if (!bPost && !inTitle && !inJournal) continue;
        var entry = bEntry || index.meta.postings[term];
        if (!entry) continue;
        var idfv = idf(entry.df, index.N);
        var boost = 1 + (inTitle ? tb : 0) + (inJournal ? jb : 0);
        score += idfv * boost;
        matched.push({
          term: term, tf: (bPost ? bPost.tf : 0), idf: idfv, contrib: idfv * boost, boost: boost,
          where: (bPost ? 'body' : (inTitle ? 'title' : 'journal'))
        });
        if (bPost && bPost.chunkTf) {
          for (var ci in bPost.chunkTf) {
            if (!Object.prototype.hasOwnProperty.call(bPost.chunkTf, ci)) continue;
            chunkHit[ci] = (chunkHit[ci] || 0) + 1;
          }
        }
      }
      if (!score) continue;
      var bestChunk = null, bestVal = -1;
      for (var ck in chunkHit) {
        if (!Object.prototype.hasOwnProperty.call(chunkHit, ck)) continue;
        if (chunkHit[ck] > bestVal) { bestVal = chunkHit[ck]; bestChunk = parseInt(ck, 10); }
      }
      matched.sort(function (x, y) { return (y.idf - x.idf) || (x.term < y.term ? -1 : x.term > y.term ? 1 : 0); });
      out.push({ id: doc.id, score: score, matched: matched, bestChunk: bestChunk });
    }
    return sortWithRanks(out);
  }

  function sortWithRanks(list) {
    list.sort(function (x, y) { return (y.score - x.score) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0); });
    for (var i = 0; i < list.length; i++) list[i].rank = i + 1;
    return list;
  }

  function search(index, query, opts) {
    var o = merge(DEFAULTS, opts);
    var out = [];
    if (!index || !index.N) return out;
    var qTerms = uniq(queryTerms(query));
    if (!qTerms.length) return out;
    var field = o.field || 'auto';
    var rows = [], i, r;

    if (field === 'body' || field === 'meta') {
      var single = scoreField(index, field, qTerms, o);
      for (i = 0; i < single.length; i++) {
        r = single[i];
        rows.push({
          id: r.id, score: r.score, matched: r.matched, bestChunk: r.bestChunk,
          bm25Score: (field === 'body') ? r.score : undefined,
          bm25Rank: (field === 'body') ? r.rank : undefined,
          metaScore: (field === 'meta') ? r.score : undefined,
          metaRank: (field === 'meta') ? r.rank : undefined
        });
      }
    } else if (field === 'coverage') {
      var covOnly = scoreCoverage(index, qTerms, o);
      for (i = 0; i < covOnly.length; i++) {
        r = covOnly[i];
        rows.push({ id: r.id, score: r.score, matched: r.matched, bestChunk: r.bestChunk, coverageScore: r.score, coverageRank: r.rank });
      }
    } else {
      var routeA = scoreRouteA(index, qTerms, o);
      var routeB = scoreCoverage(index, qTerms, o);
      var fused = rrf([routeA, routeB], o.rrfK);
      var aMap = byIdMap(routeA), bMap = byIdMap(routeB);
      for (i = 0; i < fused.length; i++) {
        var f = fused[i];
        var a = aMap[f.id], bb = bMap[f.id];
        var matched = a ? a.matched.slice() : [];
        if (bb) {
          var has = {};
          for (var k = 0; k < matched.length; k++) has[matched[k].term] = 1;
          for (var bi = 0; bi < bb.matched.length; bi++) if (!has[bb.matched[bi].term]) matched.push(bb.matched[bi]);
        }
        rows.push({
          id: f.id,
          score: (o.fusion === 'bm25' && a) ? a.score : f.score,
          rrfScore: f.score,
          routeScore: a ? a.score : undefined,
          routeRank: a ? a.rank : undefined,
          coverageScore: bb ? bb.score : undefined,
          coverageRank: bb ? bb.rank : undefined,
          bm25Score: a ? a.bm25Score : undefined,
          bm25Rank: a ? a.bm25Rank : undefined,
          metaScore: a ? a.metaScore : undefined,
          metaRank: a ? a.metaRank : undefined,
          matched: matched,
          bestChunk: (a && a.bestChunk != null) ? a.bestChunk : (bb ? bb.bestChunk : null),
          nLists: f.ranks.length
        });
      }
      if (o.fusion === 'bm25') rows = rows.filter(function (x) { return x.routeScore != null; });
    }

    rows.sort(function (x, y) {
      return (y.score - x.score) ||
        ((y.routeScore || y.bm25Score || 0) - (x.routeScore || x.bm25Score || 0)) ||
        (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    });

    var docFilter = null;
    if (o.docIds && o.docIds.length) {
      docFilter = {};
      for (i = 0; i < o.docIds.length; i++) docFilter[String(o.docIds[i])] = 1;
    }
    var limit = (o.candidates != null) ? o.candidates : ((o.limit == null) ? 8 : o.limit);
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      var doc = index.byId[r.id];
      if (!doc) continue;
      if (docFilter && !docFilter[r.id]) continue;
      if (o.minScore != null && r.score < o.minScore) continue;
      var weights = null;
      if (r.matched && r.matched.length) {
        weights = {};
        for (var mi = 0; mi < r.matched.length; mi++) weights[r.matched[mi].term] = r.matched[mi].idf;
      }
      var snip = buildSnippet(doc, r.bestChunk, qTerms, o, weights);
      out.push({
        id: r.id,
        score: r.score,
        rank: out.length + 1,
        matchedTerms: r.matched.map(function (m) { return m.term; }),
        snippet: { text: snip.text, page: snip.page, charStart: snip.charStart, charEnd: snip.charEnd },
        bm25Score: r.bm25Score,
        bm25Rank: r.bm25Rank,
        metaScore: r.metaScore,
        metaRank: r.metaRank,
        routeScore: r.routeScore,
        routeRank: r.routeRank,
        coverageScore: r.coverageScore,
        coverageRank: r.coverageRank,
        rrfScore: r.rrfScore
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  function byIdMap(list) {
    var m = {};
    for (var i = 0; i < list.length; i++) m[list[i].id] = list[i];
    return m;
  }

  /* ------------------------------------------------------------
     10. 工具
     ------------------------------------------------------------ */
  function merge(base, extra) {
    var out = {};
    var k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (extra) for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] !== undefined) out[k] = extra[k];
    return out;
  }
  function clampInt(v, lo, hi) {
    var n = (v == null || isNaN(v)) ? lo : Math.floor(v);
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }
  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return null; }
  }

  ZY.bm25 = {
    tokenize: tokenize,
    queryTerms: queryTerms,
    tokenizeSpans: tokenizeSpans,
    buildIndex: buildIndex,
    search: search,
    rrf: rrf,
    idf: idf,
    scoreTerm: scoreTerm,
    DEFAULTS: DEFAULTS,
    STOPWORDS: {
      cjkChars: CJK_STOP_CHARS,
      cjkBigrams: CJK_STOP_BIGRAMS,
      english: EN_STOPWORDS
    }
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
