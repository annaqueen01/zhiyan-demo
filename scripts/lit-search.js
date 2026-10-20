/**
 * 智研 · 针对当前研究问题的文献分析
 *
 * 为什么单独做
 * ------------
 * 之前的文献分析页读的是 `D.PROBES` / `D.LIBRARY_STATS` —— 也就是"数字化转型 +
 * 企业创新"那一套固定结果。换一个课题，页面上还是这套数字，等于没检索。
 *
 * 现在：全部基于**该项目的 RQ** 生成检索式，跑真实 BM25 检索，再归纳。
 * 库里没东西就如实说"没有"，不填充任何编造内容。
 */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};

  /** 由 RQ 生成多路检索式（每路一个角度） */
  function buildQueries(rq) {
    rq = rq || {};
    var qs = [];
    function push(label, q, weight) {
      q = String(q == null ? '' : q).trim();
      if (q.length < 2) return;
      /* 去重 */
      for (var i = 0; i < qs.length; i++) if (qs[i].query === q) return;
      qs.push({ label: label, query: q, weight: weight || 1 });
    }

    /* 主干：核心解释变量 + 被解释变量 */
    if (rq.treatmentVar && rq.outcomeVar) {
      push('核心关系', rq.treatmentVar + ' ' + rq.outcomeVar, 1.4);
    }
    push('研究问题', rq.researchQuestion, 1.2);
    push('现象', rq.phenomenon, 1.0);
    if (rq.treatmentVar) push('核心解释变量', rq.treatmentVar, 0.9);
    if (rq.outcomeVar) push('被解释变量', rq.outcomeVar, 0.9);
    if (rq.variationSource) push('识别策略', rq.variationSource, 0.8);
    if (rq.objectLevel) push('样本对象', rq.objectLevel, 0.6);

    return qs.slice(0, 6);
  }

  function trustOf(doc) {
    if (doc.trust) return doc.trust;
    var q = (doc.quality || {});
    if (q.lowQuality) return 'low';
    var cov = (doc.diag && doc.diag.coverage != null) ? doc.diag.coverage : q.coverage;
    if (cov == null) return 'medium';
    return cov >= 0.7 ? 'high' : (cov >= 0.35 ? 'medium' : 'low');
  }

  /**
   * 跑真实检索。
   * @param rq 结构化研究问题
   * @param onProgress(done, total, label) 每路检索完成时回调，用于驱动动效
   * @returns 分析结果
   */
  function analyze(rq, onProgress) {
    var corpus = ZY.corpus;
    var queries = buildQueries(rq);

    var result = {
      ok: true,
      rq: rq,
      queries: queries,
      perQuery: [],
      hits: [],
      corpus: null,
      reason: null
    };

    if (!corpus) {
      result.ok = false;
      result.reason = '检索模块未加载';
      return result;
    }

    /* 先把样例库灌进真实索引（有导入文献时保留它们） */
    try {
      var stats0 = corpus.stats ? corpus.stats() : null;
      if (!stats0 || !stats0.docs) {
        if (ZY.data && ZY.data.LIBRARY) corpus.addSampleLibrary(ZY.data.LIBRARY);
      }
    } catch (e) { /* 索引失败不该让分析挂掉 */ }

    var stats = corpus.stats ? corpus.stats() : { docs: 0 };
    result.corpus = stats;

    if (!stats.docs) {
      result.ok = false;
      result.reason = '文献库还是空的。请先在左侧「文献库」上传 PDF，我再按你的题目检索。';
      return result;
    }

    /* 逐路检索 */
    var seen = Object.create(null);
    queries.forEach(function (q, i) {
      var hits = [];
      try {
        hits = corpus.search(q.query, { limit: 8 }) || [];
      } catch (e) {
        hits = [];
      }
      result.perQuery.push({ label: q.label, query: q.query, count: hits.length });
      hits.forEach(function (h) {
        var key = h.docId || h.id;
        var score = (h.score || 0) * q.weight;
        if (seen[key]) {
          seen[key].score += score;
          seen[key].matchedBy.push(q.label);
          return;
        }
        var rec = {
          docId: key,
          title: h.title,
          journal: h.journal,
          year: h.year,
          method: h.method || '',
          conclusion: h.conclusion || '',
          quote: h.quote,
          page: h.page,
          charRange: h.charRange,
          score: score,
          matchedBy: [q.label],
          trust: trustOf(h),
          lowQuality: !!h.lowQuality,
          diag: h.diag || null
        };
        seen[key] = rec;
        result.hits.push(rec);
      });
      if (onProgress) onProgress(i + 1, queries.length, q.label);
    });

    result.hits.sort(function (a, b) { return b.score - a.score; });
    return result;
  }

  /**
   * 把检索结果归纳成"证据结构"。
   * 所有计数都来自真实命中，不做任何编造；缺口必须显式列出。
   */
  function summarize(analysis) {
    var hits = analysis.hits || [];
    var out = {
      hitCount: hits.length,
      trust: { high: 0, medium: 0, low: 0 },
      methods: {},
      years: [],
      disagreements: [],
      withQuote: 0,
      lowQuality: 0,
      gaps: []
    };

    hits.forEach(function (h) {
      out.trust[h.trust] = (out.trust[h.trust] || 0) + 1;
      var m = h.method && h.method !== '—' ? h.method : '未标注';
      out.methods[m] = (out.methods[m] || 0) + 1;
      if (h.year) out.years.push(h.year);
      if (h.quote) out.withQuote++;
      if (h.lowQuality) out.lowQuality++;
      /* 结论与主流相反：负向/分歧结论在样例库里有标记 */
      if (h.conclusion === 'negative' || h.conclusion === 'mixed') out.disagreements.push(h);
    });

    out.years.sort(function (a, b) { return a - b; });
    out.yearRange = out.years.length ? [out.years[0], out.years[out.years.length - 1]] : null;

    /* 证据缺口：按研究问题的组成部分检查有没有支撑 */
    var rq = analysis.rq || {};
    var checked = [
      ['被解释变量的度量', rq.outcomeVar],
      ['核心解释变量的度量', rq.treatmentVar],
      ['识别策略', rq.variationSource],
      ['样本对象', rq.objectLevel]
    ];
    checked.forEach(function (c) {
      if (!c[1]) return;
      var term = String(c[1]);
      var n = hits.filter(function (h) {
        var hay = (h.title || '') + ' ' + (h.quote || '') + ' ' + (h.method || '');
        return hay.indexOf(term) >= 0 ||
               /* 中文长词退化匹配：取前两个字 */
               (term.length >= 3 && hay.indexOf(term.slice(0, 2)) >= 0);
      }).length;
      out.gaps.push({
        what: c[0], term: term, docs: n,
        status: n === 0 ? 'none' : (n <= 2 ? 'thin' : 'ok')
      });
    });

    /* 方法覆盖：有没有能支撑因果表述的识别策略 */
    var causalMethods = Object.keys(out.methods).filter(function (k) {
      return /DID|双重差分|断点|RDD|工具变量|IV|事件研究|随机|PSM|匹配/.test(k);
    });
    out.causalMethodCount = causalMethods.reduce(function (n, k) { return n + out.methods[k]; }, 0);
    out.causalMethods = causalMethods;

    return out;
  }

  ZY.litSearch = {
    buildQueries: buildQueries,
    analyze: analyze,
    summarize: summarize,
    trustOf: trustOf
  };
})(window);
