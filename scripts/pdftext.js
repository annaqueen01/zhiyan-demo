/* ============================================================
   智研 · PDF 文本抽取（离线优先，零构建，classic script）
   ------------------------------------------------------------
   挂载：window.ZY.pdftext

   三种引擎，按可用性自动选择：
     1) pdf.js —— 运行时动态加载（本地 vendor/ → CDN UMD → CDN ESM）。
        本机无网络时不可用，loadEngine() 会明确返回 ok:false + 原因。
     2) builtin —— 内置降级解析器：只吃「经典 PDF」（未加密、无对象流/交叉引用流），
        支持未压缩与 FlateDecode 内容流、Type0/Identity-H + ToUnicode（可读中文）。
     3) plaintext —— 纯文本输入（.txt/.md），按 \f 分页。

   对外 API（严格按 task-7 签名）：
     ZY.pdftext.loadEngine(opts)  -> Promise<{ok, source:'cdn'|'local'|'unavailable', message, ...}>
     ZY.pdftext.extract(input, opts)
         -> Promise<{ok, pages:[{pageNo,text,chars}], fullText, diag:{...}, message, ...}>

   附加（附加字段/附加函数，不改变上面签名）：
     ZY.pdftext.diagnose(pages, opts)   质量诊断（corpus 复用，单一事实来源）
     ZY.pdftext.qualityOf(diag, trust)  质量分级
     ZY.pdftext.twoColRisk(items, w)    双栏版式几何启发式
     ZY.pdftext.mojibakeStats(text)     乱码统计
     ZY.pdftext.extractText(text, opts) 纯文本入语料
     ZY.pdftext.hasEngine() / engineStatus() / reset()
     ZY.pdftext.CONFIG / QUALITY
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};

  /* ------------------------------------------------------------
     0. 配置（URL 可被 Lead 覆盖，便于换版本/换镜像）
     ------------------------------------------------------------ */
  var PDFJS_UMD_VERSION = '3.11.174';
  var PDFJS_ESM_VERSION = '4.10.38';

  var CONFIG = {
    timeoutMs: 12000,
    /* 本地优先：由 Lead 在 index.html 里 <script src="vendor/pdf.min.js"> 预载，
       或把 pdf.js 放进 vendor/ 目录后由本模块动态注入 */
    local: ['vendor/pdf.min.js', 'vendor/pdfjs/pdf.min.js'],
    umd: [
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_UMD_VERSION + '/build/pdf.min.js',
      'https://unpkg.com/pdfjs-dist@' + PDFJS_UMD_VERSION + '/build/pdf.min.js'
    ],
    esm: [
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_ESM_VERSION + '/build/pdf.min.mjs',
      'https://unpkg.com/pdfjs-dist@' + PDFJS_ESM_VERSION + '/build/pdf.min.mjs'
    ],
    workers: {
      umd: [
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_UMD_VERSION + '/build/pdf.worker.min.js',
        'https://unpkg.com/pdfjs-dist@' + PDFJS_UMD_VERSION + '/build/pdf.worker.min.js'
      ],
      esm: [
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_ESM_VERSION + '/build/pdf.worker.min.mjs',
        'https://unpkg.com/pdfjs-dist@' + PDFJS_ESM_VERSION + '/build/pdf.worker.min.mjs'
      ]
    },
    globalNames: ['pdfjsLib', 'pdfjs', 'PDFJS'],
    pageSep: '\n',              // fullText 中页码分隔符（固定 1 字符，便于字符区间映射）
    charsPerPageTarget: 900,    // 覆盖率基准：每页非空白字符数（中文期刊单栏一页约 900–1400）
    minPageChars: 20,           // 一页至少要有这么多非空白字符才算「有文本层」
    coverageLow: 0.70,
    coverageHigh: 0.90,
    mojibakeLow: 0.05,
    mojibakeHigh: 0.01
  };

  /* ------------------------------------------------------------
     1. 小工具
     ------------------------------------------------------------ */
  function setT(fn, ms) {
    if (typeof setTimeout === 'function') return setTimeout(fn, ms);
    if (global && typeof global.setTimeout === 'function') return global.setTimeout(fn, ms);
    return null;   // 无定时器的沙箱：跳过超时保护
  }
  function clearT(id) {
    if (id == null) return;
    if (typeof clearTimeout === 'function') { clearTimeout(id); return; }
    if (global && typeof global.clearTimeout === 'function') global.clearTimeout(id);
  }
  function round(x, digits) {
    var f = Math.pow(10, digits || 0);
    return Math.round(x * f) / f;
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function errMsg(e) { return (e && e.message) ? e.message : String(e); }
  function nowIso() { try { return new Date().toISOString(); } catch (e) { return null; } }
  var WS_RE = /[\s\u00A0\u3000]/;
  function countNonSpace(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) if (!WS_RE.test(s.charAt(i))) n++;
    return n;
  }

  function toBytes(input) {
    if (input == null) return null;
    if (typeof input.byteLength === 'number' && typeof input.length === 'number') {
      var out = new Uint8Array(input.length);
      for (var i = 0; i < input.length; i++) out[i] = input[i] & 255;
      return out;
    }
    if (typeof input.byteLength === 'number') { try { return new Uint8Array(input); } catch (e) { return null; } }
    if (Object.prototype.toString.call(input) === '[object Array]') return new Uint8Array(input);
    return null;
  }

  /** 接受 ArrayBuffer / Uint8Array / File / Blob / {arrayBuffer()} */
  function readBytes(input) {
    if (input == null) return Promise.resolve(null);
    if (typeof input.arrayBuffer === 'function') {
      return Promise.resolve()
        .then(function () { return input.arrayBuffer(); })
        .then(function (ab) { return toBytes(ab); });
    }
    return Promise.resolve(toBytes(input));
  }

  function bytesToLatin1(bytes) {
    var CHUNK = 8192, parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      var end = Math.min(i + CHUNK, bytes.length);
      var sub = Array.prototype.slice.call(bytes, i, end);
      parts.push(String.fromCharCode.apply(null, sub));
    }
    return parts.join('');
  }

  /* ------------------------------------------------------------
     2. 乱码统计
        标记：U+FFFD / C0 控制符 / 经典 UTF-8→Latin1 误码序列 / 锟斤拷
        分母：非空白字符数。刻意不做「重音字母=乱码」的一刀切，
              连续 2 个以上 Latin-1 字母（Ã© 这类）才计，避免误伤 Müller/Björk。
     ------------------------------------------------------------ */
  var MOJIBAKE_CHAR_RE = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
  var MOJIBAKE_SEQ_RE = /(?:\u00E2\u20AC|\u00E3\u20AC|\u00EF\u00BF\u00BD|\u9535\u65A4\u62F7|[\u00C0-\u00FF]{2,})/g;

  function mojibakeStats(text) {
    var s = String(text == null ? '' : text);
    var n = s.length, i;
    var marked = [];
    for (i = 0; i < n; i++) marked.push(MOJIBAKE_CHAR_RE.test(s.charAt(i)) ? 1 : 0);
    MOJIBAKE_SEQ_RE.lastIndex = 0;
    var m;
    while ((m = MOJIBAKE_SEQ_RE.exec(s)) !== null) {
      for (i = m.index; i < m.index + m[0].length; i++) marked[i] = 1;
      if (MOJIBAKE_SEQ_RE.lastIndex === m.index) MOJIBAKE_SEQ_RE.lastIndex++;
    }
    var nonSpace = 0, count = 0;
    for (i = 0; i < n; i++) {
      if (WS_RE.test(s.charAt(i))) continue;
      nonSpace++;
      if (marked[i]) count++;
    }
    return { count: count, nonSpace: nonSpace, rate: nonSpace ? count / nonSpace : 0 };
  }

  /* ------------------------------------------------------------
     3. 质量分级（阈值单一定义处，corpus 复用 qualityOf）
     ------------------------------------------------------------ */
  var QUALITY = {
    coverageLow: CONFIG.coverageLow,
    coverageHigh: CONFIG.coverageHigh,
    mojibakeLow: CONFIG.mojibakeLow,
    mojibakeHigh: CONFIG.mojibakeHigh
  };

  /**
   * @param diag  {coverage, mojibakeRate, scanned, twoColRisk}
   * @param trust 'high'|'medium'|'low'（可空）
   */
  function qualityOf(diag, trust) {
    var d = diag || {};
    var q = 'high';
    if (d.scanned) q = 'low';
    else if ((d.coverage != null && d.coverage < QUALITY.coverageLow) ||
             (d.mojibakeRate != null && d.mojibakeRate > QUALITY.mojibakeLow)) q = 'low';
    else if ((d.coverage != null && d.coverage < QUALITY.coverageHigh) ||
             (d.mojibakeRate != null && d.mojibakeRate > QUALITY.mojibakeHigh) ||
             d.twoColRisk === 'high') q = 'medium';
    if (trust === 'low') q = 'low';
    return q;
  }

  /* ------------------------------------------------------------
     4. 版式：双栏风险（几何启发式，纯函数，可单测）
        items: [{x, y, w, str}]（pdf.js textContent.items 的 transform 已抽成 x/y）
        规则：把 items 按 y 聚成行；只判断「≥4 个 item」的行；
              行内以页宽一半为界分左右簇，要求两簇各自宽度 ≥ 页宽 25%
              且中间空隙 > 页宽 4%；满足则记为一行为双栏行。
              双栏行占比 ≥60% → high，≥25% → low，否则 none；无法判断 → unknown。
     ------------------------------------------------------------ */
  function groupItemsToLines(items) {
    var lines = [], cur = null, list = items || [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it) continue;
      var x = Number(it.x) || 0, y = Number(it.y) || 0, w = Number(it.w) || 0;
      var s = (it.str == null) ? '' : String(it.str);
      if (!cur || Math.abs(cur.y - y) > 2) { cur = { y: y, items: [] }; lines.push(cur); }
      cur.items.push({ x: x, y: y, w: w, str: s });
      if (it.hasEOL) cur = null;
    }
    lines.sort(function (a, b) { return b.y - a.y; });
    for (var l = 0; l < lines.length; l++) {
      lines[l].items.sort(function (a, b) { return a.x - b.x; });
    }
    return lines;
  }

  function twoColRisk(items, pageWidth) {
    var w = Number(pageWidth) || 0;
    if (!w || !items || !items.length) {
      return { level: 'unknown', basis: 'no-geometry', twoColLines: 0, qualifyLines: 0, ratio: 0, pages: [] };
    }
    var lines = groupItemsToLines(items);
    var qualify = 0, two = 0;
    for (var i = 0; i < lines.length; i++) {
      var its = lines[i].items;
      if (its.length < 4) continue;
      var mid = w / 2;
      var left = [], right = [];
      for (var j = 0; j < its.length; j++) {
        (((its[j].x + its[j].w / 2) < mid) ? left : right).push(its[j]);
      }
      qualify++;
      if (!left.length || !right.length) continue;
      var lMin = Infinity, lMax = -Infinity, rMin = Infinity, rMax = -Infinity;
      for (var a = 0; a < left.length; a++) { lMin = Math.min(lMin, left[a].x); lMax = Math.max(lMax, left[a].x + left[a].w); }
      for (var b = 0; b < right.length; b++) { rMin = Math.min(rMin, right[b].x); rMax = Math.max(rMax, right[b].x + right[b].w); }
      if ((lMax - lMin) >= w * 0.25 && (rMax - rMin) >= w * 0.25 && (rMin - lMax) > w * 0.04) two++;
    }
    var ratio = qualify ? two / qualify : 0;
    var level = ratio >= 0.6 ? 'high' : (ratio >= 0.25 ? 'low' : 'none');
    return { level: level, basis: 'geometry', twoColLines: two, qualifyLines: qualify, ratio: round(ratio, 4), pages: [] };
  }

  /* ------------------------------------------------------------
     5. 页拼接 + 诊断
     ------------------------------------------------------------ */
  function joinPages(pages, sep) {
    var s = (sep == null) ? CONFIG.pageSep : sep;
    var full = '', cursor = 0, out = [];
    for (var i = 0; i < (pages || []).length; i++) {
      var p = pages[i] || {};
      var text = (p.text == null) ? '' : String(p.text);
      if (i > 0) { full += s; cursor += s.length; }
      var start = cursor;
      full += text; cursor += text.length;
      out.push({
        pageNo: p.pageNo == null ? (i + 1) : p.pageNo,
        text: text,
        chars: text.length,
        charStart: start,
        charEnd: cursor,
        width: (p.width == null ? null : p.width),
        height: (p.height == null ? null : p.height),
        lineCount: (p.lineCount == null ? null : p.lineCount)
      });
    }
    return { fullText: full, pages: out };
  }

  /**
   * 质量诊断。per task-7：pages / chars / avgCharsPerPage / coverage /
   * mojibakeRate / scanned / twoColRisk 必有；其余为附加字段。
   * coverage = clamp(avgCharsPerPage / charsPerPageTarget, 0, 1)（avgCharsPerPage 用未舍入值）
   */
  function diagnose(pages, opts) {
    var o = opts || {};
    var joined = joinPages(pages, o.pageSep);
    var list = joined.pages;
    var n = list.length;
    var textChars = 0, nonSpace = 0, textPages = 0, emptyPages = [];
    for (var i = 0; i < n; i++) {
      textChars += list[i].text.length;
      var c = countNonSpace(list[i].text);
      nonSpace += c;
      if (c >= CONFIG.minPageChars) textPages++; else emptyPages.push(list[i].pageNo);
    }
    var avg = n ? nonSpace / n : 0;
    var coverage = clamp(avg / CONFIG.charsPerPageTarget, 0, 1);
    var moji = mojibakeStats(joined.fullText);

    /* 双栏：优先进出口径 */
    var tc;
    if (o.twoColRisk) {
      tc = { level: o.twoColRisk, basis: o.twoColBasis || 'declared', twoColLines: null, qualifyLines: null, ratio: null, pages: [] };
    } else if (o.itemsByPage && o.itemsByPage.length) {
      var perPage = [], worst = 'none', sawUnknown = false;
      var rank = { none: 0, unknown: 1, low: 2, high: 3 };
      for (var pi = 0; pi < o.itemsByPage.length; pi++) {
        var e = o.itemsByPage[pi] || {};
        var r = twoColRisk(e.items, e.width);
        perPage.push({ pageNo: e.pageNo, level: r.level, ratio: r.ratio });
        if (r.level === 'unknown') sawUnknown = true;
        if (rank[r.level] > rank[worst]) worst = r.level;
      }
      tc = {
        level: worst === 'none' && sawUnknown ? 'unknown' : worst,
        basis: worst === 'none' && sawUnknown ? 'partial-geometry' : 'geometry',
        twoColLines: null, qualifyLines: null, ratio: null, pages: perPage
      };
    } else if (o.items) {
      tc = twoColRisk(o.items, o.pageWidth);
    } else {
      tc = { level: 'unknown', basis: 'no-geometry', twoColLines: null, qualifyLines: null, ratio: null, pages: [] };
    }

    /* scanned 的判定必须只表达「有页但完全没有文字层」。
       「文字很少」是另一回事，由 coverage / textPageRatio / emptyPages 表达，
       两者混在一起会把只有 16 个字符的短页误判成扫描件。 */
    var scanned = n > 0 && nonSpace === 0;
    var eff = {
      coverage: round(coverage, 4),
      mojibakeRate: round(moji.rate, 6),
      scanned: scanned,
      twoColRisk: tc.level
    };
    return {
      /* —— task-7 要求的最小字段 —— */
      pages: n,
      chars: joined.fullText.length,
      avgCharsPerPage: Math.round(avg),
      coverage: eff.coverage,
      mojibakeRate: eff.mojibakeRate,
      scanned: eff.scanned,
      twoColRisk: eff.twoColRisk,
      /* —— 附加诊断细节 —— */
      textChars: textChars,
      nonSpaceChars: nonSpace,
      noTextLayer: n > 0 && nonSpace === 0,
      mojibakeChars: moji.count,
      textPages: textPages,
      textPageRatio: n ? round(textPages / n, 4) : 0,
      emptyPages: emptyPages,
      twoColBasis: tc.basis,
      twoColLines: tc.twoColLines,
      twoColQualifyLines: tc.qualifyLines,
      twoColRatio: tc.ratio,
      twoColPages: tc.pages,
      pageSep: (o.pageSep == null ? CONFIG.pageSep : o.pageSep),
      needsEngine: !!o.needsEngine,
      unsupportedPages: o.unsupportedPages || [],
      engine: o.engine || null,
      quality: qualityOf(eff, o.trust),
      computedAt: nowIso()
    };
  }

  /* ------------------------------------------------------------
     6. 宿主抽象：脚本注入 / 模块导入 / 全局探测
        —— 默认走浏览器 DOM；测试可注入 host 模拟 CDN 或离线。
     ------------------------------------------------------------ */
  function getGlobalSafe(name) {
    try { return global ? global[name] : undefined; } catch (e) { return undefined; }
  }

  function defaultHost() {
    var doc = (typeof document !== 'undefined') ? document : null;
    return {
      kind: 'dom',
      hasDocument: !!doc,
      getGlobal: getGlobalSafe,
      injectScript: function (url) {
        return new Promise(function (resolve, reject) {
          if (!doc || !doc.createElement) { reject(new Error('no-document')); return; }
          var s = doc.createElement('script');
          var done = false;
          var timer = setT(function () { if (!done) { done = true; reject(new Error('timeout:' + url)); } }, CONFIG.timeoutMs);
          s.src = url;
          s.async = true;
          s.onload = function () { if (done) return; done = true; clearT(timer); resolve(url); };
          s.onerror = function () { if (done) return; done = true; clearT(timer); reject(new Error('script-error:' + url)); };
          try {
            (doc.head || doc.documentElement || doc.body).appendChild(s);
          } catch (e) { if (!done) { done = true; clearT(timer); reject(e); } }
        });
      },
      importModule: function (url) {
        /* classic script 里不能出现静态 import；用 Function 构造动态 import()。
           绝对 URL 不受 base 影响，浏览器可直接解析。 */
        var f = new Function('u', 'return import(u);');
        return Promise.resolve().then(function () { return f(url); });
      }
    };
  }

  function pickEngineFromGlobal(host) {
    for (var i = 0; i < CONFIG.globalNames.length; i++) {
      var g = host.getGlobal(CONFIG.globalNames[i]);
      if (g && typeof g.getDocument === 'function') return { engine: g, name: CONFIG.globalNames[i] };
      if (g && g.default && typeof g.default.getDocument === 'function') return { engine: g.default, name: CONFIG.globalNames[i] + '.default' };
    }
    return null;
  }

  function applyWorker(engine, kind) {
    try {
      if (!engine || !engine.GlobalWorkerOptions) return;
      var list = (kind === 'esm') ? CONFIG.workers.esm : CONFIG.workers.umd;
      if (list && list.length && !engine.GlobalWorkerOptions.workerSrc) {
        engine.GlobalWorkerOptions.workerSrc = list[0];
      }
    } catch (e) { /* 设置 worker 失败不致命 */ }
  }

  var state = { engine: null, status: null, attempts: [], via: null };

  function okStatus(via, message) {
    var src = (via === 'injected' || via === 'global' || via === 'local') ? 'local' : 'cdn';
    return {
      ok: true,
      source: src,               // task-7 签名：'cdn' | 'unavailable'
      via: via,                  // 附加：'injected'|'global'|'local'|'cdn-umd'|'cdn-esm'（'local' 为本实现扩展值）
      message: message || ('pdf.js 引擎就绪（' + via + '）'),
      attempts: state.attempts.slice(),
      engine: state.engine,
      checkedAt: nowIso()
    };
  }

  function unavailableStatus(lastError, why) {
    var tried = state.attempts.map(function (a) { return a.url + ' → ' + a.error; }).join('；') || '（无可用加载途径）';
    return {
      ok: false,
      source: 'unavailable',
      via: null,
      engine: null,
      message: '离线环境或 CDN 不可达：无法加载 pdf.js 解析引擎。' +
        '已尝试：本地 vendor/ pdf.js、jsDelivr/unpkg 的 UMD(' + PDFJS_UMD_VERSION + ')、ESM(' + PDFJS_ESM_VERSION + ')。' +
        '离线环境下无法用 pdf.js 解析 PDF；' +
        '文献库检索、索引、引用出处不受影响（走内置 BM25），PDF 可改用内置降级解析器（仅支持未压缩/Flate 的经典 PDF，不支持扫描件 OCR 与对象流）。' +
        (why ? '原因：' + why + '。' : '') +
        (lastError ? '最后错误：' + errMsg(lastError) + '。' : '') +
        '尝试记录：' + tried,
      attempts: state.attempts.slice(),
      checkedAt: nowIso()
    };
  }

  /**
   * 运行时加载 pdf.js 引擎。永不 reject（失败也返回 ok:false 的状态对象）。
   * opts: {force, inject, host, timeoutMs, allowLocal, allowEsm, allowCdn}
   */
  function loadEngine(opts) {
    var o = opts || {};
    if (state.engine && !o.force) {
      return Promise.resolve(okStatus(state.via || 'cached', '复用已加载的 pdf.js 引擎'));
    }
    return Promise.resolve().then(function () {
      var host = o.host || defaultHost();
      if (o.inject) {
        state.engine = o.inject;
        state.via = 'injected';
        state.attempts = [];
        state.status = okStatus('injected', '使用调用方注入的 pdf.js 引擎（测试/预载场景）');
        return state.status;
      }
      var found = pickEngineFromGlobal(host);
      if (found) {
        state.engine = found.engine;
        state.via = 'global';
        state.status = okStatus('global', '检测到已预载的 ' + found.name + '（例如 vendor/pdf.min.js 或已有 CDN 脚本）');
        return state.status;
      }
      var chain = [];
      if (o.allowLocal !== false) {
        for (var i = 0; i < CONFIG.local.length; i++) chain.push({ url: CONFIG.local[i], how: 'script', via: 'local' });
      }
      if (o.allowCdn !== false) {
        for (var j = 0; j < CONFIG.umd.length; j++) chain.push({ url: CONFIG.umd[j], how: 'script', via: 'cdn-umd' });
        if (o.allowEsm !== false) {
          for (var k = 0; k < CONFIG.esm.length; k++) chain.push({ url: CONFIG.esm[k], how: 'module', via: 'cdn-esm' });
        }
      }
      if (!chain.length) return unavailableStatus(null, '调用方禁用了全部加载途径（allowLocal/allowCdn=false）');
      state.attempts = [];

      function attempt(index, lastError) {
        if (index >= chain.length) return unavailableStatus(lastError, null);
        var c = chain[index];
        var step = (c.how === 'module')
          ? Promise.resolve().then(function () { return host.importModule(c.url); })
          : Promise.resolve().then(function () { return host.injectScript(c.url); });
        return step.then(function (mod) {
          var eng = null;
          if (c.how === 'module' && mod) eng = (typeof mod.getDocument === 'function') ? mod : (mod.default || null);
          if (!eng) {
            var g = pickEngineFromGlobal(host);
            if (g) eng = g.engine;
          }
          if (!eng || typeof eng.getDocument !== 'function') throw new Error('未取得 getDocument（脚本已注入但未挂载引擎）');
          applyWorker(eng, c.via === 'cdn-esm' ? 'esm' : 'umd');
          state.engine = eng;
          state.via = c.via;
          state.attempts.push({ url: c.url, via: c.via, error: null });
          state.status = okStatus(c.via, 'pdf.js 引擎加载成功（' + c.url + '）');
          return state.status;
        }, function (e) {
          state.attempts.push({ url: c.url, via: c.via, error: errMsg(e) });
          return attempt(index + 1, e);
        });
      }
      return attempt(0, null);
    }).catch(function (e) {
      return unavailableStatus(e, '加载过程抛出异常');
    });
  }

  function hasEngine() { return !!state.engine; }
  function engineStatus() { return state.status; }
  function reset() { state = { engine: null, status: null, attempts: [], via: null }; }

  /* ------------------------------------------------------------
     7. pdf.js 抽取路径
     ------------------------------------------------------------ */
  var CJK_LIKE_RE = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFF60\uFFE0-\uFFE6]/;

  function joinLineItems(items) {
    var out = '', prev = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (prev) {
        var gap = it.x - (prev.x + (prev.w || 0));
        var cw = Math.max(1, (prev.w || 0) / Math.max(1, prev.str.length));
        var prevCh = prev.str.charAt(prev.str.length - 1);
        var nextCh = it.str.charAt(0);
        if (gap > Math.max(2, cw * 0.5) && !CJK_LIKE_RE.test(prevCh) && !CJK_LIKE_RE.test(nextCh)) out += ' ';
      }
      out += it.str;
      prev = it;
    }
    return out.replace(/[ \t]+$/, '');
  }

  function itemsToText(items) {
    var norm = [], list = items || [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || it.str == null) continue;
      var t = it.transform || [1, 0, 0, 1, 0, 0];
      norm.push({
        x: Number(t[4]) || 0,
        y: Number(t[5]) || 0,
        w: Number(it.width) || 0,
        str: String(it.str),
        hasEOL: !!it.hasEOL
      });
    }
    var lines = groupItemsToLines(norm);
    var texts = [];
    for (var l = 0; l < lines.length; l++) {
      var txt = joinLineItems(lines[l].items);
      if (txt.length) texts.push(txt);
    }
    return { text: texts.join('\n'), items: norm, lineCount: texts.length };
  }

  function extractWithPdfjs(status, bytes, opts) {
    var o = opts || {};
    var engine = status.engine;
    var params = { data: bytes, useSystemFonts: true };
    if (o.password) params.password = o.password;
    var task = engine.getDocument(params);
    var promise = (task && typeof task.then === 'function') ? task : (task && task.promise);
    if (!promise || typeof promise.then !== 'function') {
      return Promise.reject(new Error('getDocument 未返回 promise（引擎接口不符）'));
    }
    return promise.then(function (doc) {
      var numPages = doc.numPages || 0;
      var limit = o.maxPages ? Math.min(o.maxPages, numPages) : numPages;
      var rawPages = [], itemsByPage = [];
      var chain = Promise.resolve();
      var failedPages = [];
      for (var i = 1; i <= limit; i++) {
        (function (pageNo) {
          chain = chain.then(function () {
            return Promise.resolve(doc.getPage(pageNo)).then(function (page) {
              var viewport = (page && page.getViewport) ? page.getViewport({ scale: 1 }) : null;
              return Promise.resolve(page.getTextContent()).then(function (tc) {
                var info = itemsToText((tc && tc.items) || []);
                rawPages.push({ pageNo: pageNo, text: info.text, lineCount: info.lineCount, width: viewport ? viewport.width : null, height: viewport ? viewport.height : null });
                itemsByPage.push({ pageNo: pageNo, items: info.items, width: viewport ? viewport.width : null });
              }, function (e) {
                failedPages.push({ pageNo: pageNo, error: errMsg(e) });
                rawPages.push({ pageNo: pageNo, text: '', lineCount: 0 });
                itemsByPage.push({ pageNo: pageNo, items: [], width: null });
              });
            }, function (e) {
              failedPages.push({ pageNo: pageNo, error: errMsg(e) });
              rawPages.push({ pageNo: pageNo, text: '', lineCount: 0 });
              itemsByPage.push({ pageNo: pageNo, items: [], width: null });
            });
          });
        })(i);
      }
      return chain.then(function () {
        if (typeof doc.destroy === 'function') { try { doc.destroy(); } catch (e) { /* 忽略 */ } }
        return finishExtract(rawPages, {
          engine: 'pdfjs',
          engineMessage: '已用 pdf.js（' + (status.via || 'cdn') + (engine.version ? ' v' + engine.version : '') + '）抽取文本层。',
          itemsByPage: itemsByPage,
          failedPages: failedPages,
          warnings: failedPages.map(function (f) { return '第 ' + f.pageNo + ' 页 getTextContent 失败：' + f.error; })
        }, o);
      });
    });
  }

  function finishExtract(rawPages, info, opts) {
    var joined = joinPages(rawPages, opts.pageSep);
    var diag = diagnose(rawPages, {
      pageSep: opts.pageSep,
      itemsByPage: info.itemsByPage,
      needsEngine: !!info.needsEngine,
      unsupportedPages: info.unsupportedPages || [],
      engine: info.engine,
      trust: opts.trust
    });
    var warnings = (info.warnings || []).slice();
    if (info.needsEngine) {
      warnings.push('该 PDF 含内置降级解析器不支持的压缩/加密特性，文本可能不完整，建议在联网环境使用 pdf.js。');
    }
    if (diag.scanned) {
      warnings.push('未检测到文本层（疑似扫描件）：本 Demo 不做 OCR，无法引用原句，只能标记为「仅提及」。');
    }
    if (diag.twoColRisk === 'high') {
      warnings.push('疑似双栏排版：文本顺序可能跨栏错位，页码与字符区间需人工核对。');
    }
    return {
      ok: true,
      engine: info.engine,
      pages: joined.pages,
      fullText: joined.fullText,
      diag: diag,
      message: (info.engineMessage || '文本抽取完成') +
        ' 共 ' + joined.pages.length + ' 页 / ' + joined.fullText.length + ' 字符，覆盖率 ' +
        (diag.coverage * 100).toFixed(1) + '%，乱码率 ' + (diag.mojibakeRate * 100).toFixed(2) + '%。',
      warnings: warnings,
      parse: info.parse || null,
      extractedAt: nowIso()
    };
  }

  function failExtract(message, opts, engine) {
    return {
      ok: false,
      engine: engine || 'none',
      pages: [],
      fullText: '',
      diag: diagnose([], { pageSep: (opts && opts.pageSep) }),
      message: message,
      warnings: [],
      parse: null,
      extractedAt: nowIso()
    };
  }

  /* ------------------------------------------------------------
     8. extract 门面：pdf.js → 内置降级 → 明确失败（永不抛异常）
     ------------------------------------------------------------ */
  function extract(input, opts) {
    var o = opts || {};
    return readBytes(input).then(function (bytes) {
      if (!bytes || !bytes.byteLength) {
        return failExtract('输入为空：没有可解析的字节。请选择文件或传入 ArrayBuffer/Uint8Array。', o, 'none');
      }
      return loadEngine(o).then(function (status) {
        if (status.ok) {
          /* 用 Promise.resolve().then 包一层：引擎同步抛错也必须走降级分支，
             不能被外层 catch 直接吞成「解析异常」 */
          return Promise.resolve().then(function () {
            return extractWithPdfjs(status, bytes, o);
          }).catch(function (e) {
            if (o.fallback === false) {
              return failExtract('pdf.js 解析失败：' + errMsg(e) + '（已禁用内置降级解析器 opts.fallback=false）', o, 'pdfjs');
            }
            return extractWithBuiltin(bytes, o, { status: status, engineError: errMsg(e) });
          });
        }
        if (o.fallback === false) return failExtract(status.message, o, 'none');
        return extractWithBuiltin(bytes, o, { status: status, engineError: null });
      });
    }).catch(function (e) {
      return failExtract('PDF 解析异常：' + errMsg(e), o, 'none');
    });
  }

  /* ------------------------------------------------------------
     9. 内置降级解析器（经典 PDF）
     ------------------------------------------------------------ */
  function skipWsComments(s, p) {
    for (var guard = 0; guard < 1000000; guard++) {
      while (p < s.length && /\s/.test(s.charAt(p))) p++;
      if (s.charAt(p) === '%') {
        while (p < s.length && s.charAt(p) !== '\n' && s.charAt(p) !== '\r') p++;
        continue;
      }
      return p;
    }
    return p;
  }
  function readName(s, p) {   // s.charAt(p) === '/'
    var out = '', i = p + 1;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (/[\s/\[\]<>()%]/.test(ch)) break;
      if (ch === '#' && /[0-9A-Fa-f]{2}/.test(s.substr(i + 1, 2))) {
        out += String.fromCharCode(parseInt(s.substr(i + 1, 2), 16));
        i += 3;
        continue;
      }
      out += ch;
      i++;
    }
    return { v: out, pos: i };
  }
  function readLiteralString(s, p) {   // s.charAt(p) === '('
    var depth = 1, out = '', i = p + 1;
    for (; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '\\') {
        var nx = s.charAt(i + 1);
        if (nx === 'n') { out += '\n'; i++; }
        else if (nx === 'r') { out += '\r'; i++; }
        else if (nx === 't') { out += '\t'; i++; }
        else if (nx === 'b') { out += '\b'; i++; }
        else if (nx === 'f') { out += '\f'; i++; }
        else if (nx === '(' || nx === ')' || nx === '\\') { out += nx; i++; }
        else if (nx === '\n') { i++; }
        else if (nx === '\r') { i++; if (s.charAt(i + 1) === '\n') i++; }
        else if (/[0-7]/.test(nx)) {
          var oct = '';
          while (oct.length < 3 && /[0-7]/.test(s.charAt(i + 1))) { oct += s.charAt(i + 1); i++; }
          out += String.fromCharCode(parseInt(oct, 8) & 255);
        } else { out += nx; i++; }
      } else if (ch === '(') { depth++; out += ch; }
      else if (ch === ')') {
        depth--;
        if (depth === 0) return { v: out, pos: i + 1 };
        out += ch;
      } else out += ch;
    }
    return { v: out, pos: s.length };
  }
  function readHexString(s, p) {   // s.charAt(p) === '<'
    var digits = '', i = p + 1;
    for (; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '>') break;
      if (/[0-9A-Fa-f]/.test(ch)) digits += ch;
    }
    if (digits.length % 2) digits += '0';
    var out = '';
    for (var k = 0; k < digits.length; k += 2) out += String.fromCharCode(parseInt(digits.substr(k, 2), 16));
    return { v: out, pos: Math.min(s.length, i + 1) };
  }

  function parseValue(s, pos) {
    var p = skipWsComments(s, pos);
    if (p >= s.length) return { v: null, pos: p };
    var ch = s.charAt(p);
    if (ch === '<' && s.charAt(p + 1) === '<') {
      p += 2;
      var dict = {};
      for (var guard = 0; guard < 100000; guard++) {
        p = skipWsComments(s, p);
        if (s.substr(p, 2) === '>>') { p += 2; break; }
        if (p >= s.length) break;
        if (s.charAt(p) !== '/') {
          var sk = parseValue(s, p);
          if (sk.pos <= p) p++; else p = sk.pos;
          continue;
        }
        var nm = readName(s, p);
        p = nm.pos;
        var val = parseValue(s, p);
        if (val.pos <= p) { p++; continue; }
        p = val.pos;
        dict[nm.v] = val.v;
      }
      return { v: dict, pos: p };
    }
    if (ch === '<') { var hs = readHexString(s, p); return { v: hs.v, pos: hs.pos }; }
    if (ch === '(') { var ls = readLiteralString(s, p); return { v: ls.v, pos: ls.pos }; }
    if (ch === '[') {
      p++;
      var arr = [];
      for (var g2 = 0; g2 < 100000; g2++) {
        p = skipWsComments(s, p);
        if (s.charAt(p) === ']') { p++; break; }
        if (p >= s.length) break;
        var it = parseValue(s, p);
        if (it.pos <= p) { p++; continue; }
        p = it.pos;
        arr.push(it.v);
      }
      return { v: arr, pos: p };
    }
    if (ch === '/') { var n2 = readName(s, p); return { v: { __name: n2.v }, pos: n2.pos }; }
    var numM = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)/.exec(s.substr(p, 32));
    if (numM) {
      var after = skipWsComments(s, p + numM[0].length);
      var genM = /^\d+/.exec(s.substr(after, 16));
      if (genM) {
        var after2 = skipWsComments(s, after + genM[0].length);
        if (s.charAt(after2) === 'R') {
          return { v: { __ref: parseInt(numM[0], 10), __gen: parseInt(genM[0], 10) }, pos: after2 + 1 };
        }
      }
      return { v: parseFloat(numM[0]), pos: p + numM[0].length };
    }
    var kw = /^(true|false|null)/.exec(s.substr(p, 6));
    if (kw) {
      return { v: (kw[1] === 'true' ? true : (kw[1] === 'false' ? false : null)), pos: p + kw[1].length };
    }
    return { v: null, pos: p + 1 };
  }

  function nameOf(v) { return (v && typeof v === 'object' && v.__name != null) ? v.__name : null; }
  function refNum(v) { return (v && typeof v === 'object' && v.__ref != null) ? v.__ref : null; }
  function isDict(v) { return !!v && typeof v === 'object' && !Array.isArray(v) && v.__name == null && v.__ref == null; }

  /* --- 9.1 xref 表 --- */
  function readXref(s) {
    var idx = s.lastIndexOf('startxref');
    if (idx < 0) return null;
    var m = /startxref\s+(\d+)/.exec(s.substr(idx, 40));
    if (!m) return null;
    var off = parseInt(m[1], 10);
    if (!(off >= 0 && off < s.length)) return null;
    var seg = s.substr(off, 64);
    if (!/^[\s]*xref/.test(seg)) return null;    // xref 流（PDF 1.5+）本解析器不支持
    var p = off + seg.indexOf('xref') + 4;
    var offsets = {};
    for (var guard = 0; guard < 200000; guard++) {
      p = skipWsComments(s, p);
      if (s.substr(p, 7) === 'trailer') { p += 7; break; }
      var hm = /^(\d+)\s+(\d+)/.exec(s.substr(p, 40));
      if (!hm) return null;
      var start = parseInt(hm[1], 10), count = parseInt(hm[2], 10);
      p += hm[0].length;
      if (count < 0 || count > 200000) return null;
      for (var i = 0; i < count; i++) {
        var em = /^\s*(\d+)\s+(\d+)\s+([nf])/.exec(s.substr(p, 24));
        if (!em) return null;
        if (em[3] === 'n') offsets[start + i] = parseInt(em[1], 10);
        /* 条目定长 20 字节（含 EOL）；按实际消耗推进以兼容 \r\n / \n / \r\n\r\n */
        var adv = 20;
        var probe = s.substr(p, 24);
        var mm = /^\s*\d+\s+\d+\s+[nf](\r\n|\n|\r)/.exec(probe);
        if (mm) adv = mm[0].length;
        p += adv;
      }
    }
    var trailer = null;
    var tr = parseValue(s, p);
    if (isDict(tr.v)) trailer = tr.v;
    return { offsets: offsets, trailer: trailer };
  }

  /* --- 9.2 对象加载 --- */
  function loadObjectAt(s, num, off) {
    var m = /^\s*(\d+)\s+(\d+)\s+obj\b/.exec(s.substr(off, 48));
    if (!m) return null;
    if (parseInt(m[1], 10) !== num) return null;
    var bodyStart = off + m[0].length;
    var endIdx = s.indexOf('endobj', bodyStart);
    var body = (endIdx < 0) ? s.substr(bodyStart) : s.substr(bodyStart, endIdx - bodyStart);
    return { num: num, gen: parseInt(m[2], 10), body: body, offset: off };
  }

  function scanObjects(ctx) {
    var re = /(\d{1,7})\s+(\d{1,5})\s+obj\b/g;
    var m;
    while ((m = re.exec(ctx.s)) !== null) {
      var num = parseInt(m[1], 10);
      if (!num) continue;
      if (ctx.objects[num]) continue;
      var bodyStart = m.index + m[0].length;
      var endIdx = ctx.s.indexOf('endobj', bodyStart);
      var body = (endIdx < 0) ? ctx.s.substr(bodyStart) : ctx.s.substr(bodyStart, endIdx - bodyStart);
      ctx.objects[num] = { num: num, gen: parseInt(m[2], 10), body: body, offset: m.index };
      ctx.order.push(num);
    }
  }

  function resolveDataEnd(body, q, len) {
    var end = -1;
    if (typeof len === 'number' && len >= 0 && q + len <= body.length) {
      if (/^[\r\n\s]*endstream/.test(body.substr(q + len, 20))) end = q + len;
    }
    if (end < 0) {
      var es = body.indexOf('endstream', q);
      end = (es < 0) ? body.length : es;
      while (end > q && (body.charAt(end - 1) === '\n' || body.charAt(end - 1) === '\r')) end--;
    }
    return end;
  }

  function parseObjectBody(ctx, obj) {
    if (obj.__parsed) return;
    obj.__parsed = true;
    var body = obj.body;
    var r = parseValue(body, 0);
    obj.value = r ? r.v : null;
    var p = skipWsComments(body, r ? r.pos : 0);
    if (body.substr(p, 6) !== 'stream') return;
    obj.isStream = true;
    var q = p + 6;
    if (body.charAt(q) === '\r') q++;
    if (body.charAt(q) === '\n') q++;
    obj.dataStart = q;
    obj.__lenRef = (obj.value && obj.value.Length != null) ? obj.value.Length : null;
    obj.dataEnd = resolveDataEnd(body, q, obj.__lenRef);
    obj.raw = body.slice(obj.dataStart, obj.dataEnd);
  }

  function filterNames(obj) {
    var f = obj.value ? obj.value.Filter : null;
    if (f == null) return [];
    if (Array.isArray(f)) {
      var out = [];
      for (var i = 0; i < f.length; i++) { var n = nameOf(f[i]); if (n) out.push(n); }
      return out;
    }
    var one = nameOf(f);
    return one ? [one] : [];
  }

  function inflateBytes(bytes) {
    var DS = getGlobalSafe('DecompressionStream');
    var BlobC = getGlobalSafe('Blob');
    var Resp = getGlobalSafe('Response');
    if (typeof DS !== 'function' || typeof BlobC !== 'function' || typeof Resp !== 'function') {
      return Promise.resolve(null);
    }
    try {
      var ds = new DS('deflate');
      var stream = new BlobC([bytes]).stream().pipeThrough(ds);
      return new Resp(stream).arrayBuffer().then(function (ab) {
        return new Uint8Array(ab);
      }, function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function parsePdfObjects(latin1) {
    var ctx = { s: latin1, objects: {}, order: [], trailer: null, via: 'scan', notes: [], filtersUsed: [], missingToUnicode: 0 };
    var x = readXref(latin1);
    if (x && x.trailer) ctx.trailer = x.trailer;
    var loaded = 0, nums = x ? Object.keys(x.offsets) : [];
    for (var i = 0; i < nums.length; i++) {
      var num = parseInt(nums[i], 10);
      var obj = loadObjectAt(latin1, num, x.offsets[nums[i]]);
      if (obj) { ctx.objects[num] = obj; ctx.order.push(num); loaded++; }
    }
    if (loaded) ctx.via = 'xref';
    else if (x) ctx.notes.push('xref 表存在但没有任何条目能定位到对象，已回退全文件扫描');

    for (var k in ctx.objects) if (hasOwn(ctx.objects, k)) parseObjectBody(ctx, ctx.objects[k]);
    if (!findCatalogNum(ctx)) {
      var before = countKeys(ctx.objects);
      scanObjects(ctx);
      var after = countKeys(ctx.objects);
      for (var k2 in ctx.objects) if (hasOwn(ctx.objects, k2)) parseObjectBody(ctx, ctx.objects[k2]);
      if (ctx.via === 'xref' && after > before) ctx.notes.push('xref 未覆盖全部对象（可能是增量更新），已补以全文件扫描');
      if (!findCatalogNum(ctx) && ctx.via === 'xref') { ctx.via = 'scan'; ctx.notes.push('未找到 Catalog，降级为扫描解析'); }
    }
    /* /Length 为间接引用时重算流数据范围 */
    for (var k3 in ctx.objects) {
      if (!hasOwn(ctx.objects, k3)) continue;
      var o = ctx.objects[k3];
      if (!o.isStream) continue;
      if (o.__lenRef && refNum(o.__lenRef) != null) {
        var lo = ctx.objects[refNum(o.__lenRef)];
        if (lo && typeof lo.value === 'number') o.dataEnd = resolveDataEnd(o.body, o.dataStart, lo.value);
      }
      o.raw = o.body.slice(o.dataStart, o.dataEnd);
    }
    return ctx;
  }

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function countKeys(o) { var n = 0; for (var k in o) if (hasOwn(o, k)) n++; return n; }

  function findCatalogNum(ctx) {
    for (var k in ctx.objects) {
      if (!hasOwn(ctx.objects, k)) continue;
      var v = ctx.objects[k].value;
      if (isDict(v) && nameOf(v.Type) === 'Catalog') return parseInt(k, 10);
    }
    /* 无 Type 的 Catalog：退回 trailer /Root */
    if (ctx.trailer) {
      var rn = refNum(ctx.trailer.Root);
      if (rn != null && ctx.objects[rn]) return rn;
    }
    return null;
  }

  /* --- 9.3 页面树 --- */
  function collectPages(ctx) {
    var pages = [], visited = {}, rootNum = null;
    if (ctx.trailer) rootNum = refNum(ctx.trailer.Root);
    if (rootNum == null || !ctx.objects[rootNum]) rootNum = findCatalogNum(ctx);
    function walk(num, inherited, depth) {
      if (depth > 64 || num == null) return;
      if (visited[num]) return;
      visited[num] = 1;
      var o = ctx.objects[num];
      if (!o || !isDict(o.value)) return;
      var v = o.value;
      var type = nameOf(v.Type);
      var inh = {
        Resources: (v.Resources != null) ? v.Resources : inherited.Resources,
        MediaBox: (v.MediaBox != null) ? v.MediaBox : inherited.MediaBox
      };
      if (type === 'Pages' || (type == null && Array.isArray(v.Kids))) {
        var kids = v.Kids || [];
        for (var i = 0; i < kids.length; i++) {
          var kn = refNum(kids[i]);
          if (kn != null) walk(kn, inh, depth + 1);
        }
        return;
      }
      if (type === 'Page' || v.Contents != null) {
        pages.push({ num: num, obj: v, resources: inh.Resources, mediaBox: inh.MediaBox });
      }
    }
    if (rootNum != null) {
      var root = ctx.objects[rootNum];
      var pagesRef = root && isDict(root.value) ? refNum(root.value.Pages) : null;
      if (pagesRef != null) walk(pagesRef, {}, 0);
      else walk(rootNum, {}, 0);
    }
    if (!pages.length) {
      var nums = Object.keys(ctx.objects).map(function (x) { return parseInt(x, 10); }).sort(function (a, b) { return a - b; });
      for (var i = 0; i < nums.length; i++) {
        var v2 = ctx.objects[nums[i]].value;
        if (isDict(v2) && nameOf(v2.Type) === 'Page') pages.push({ num: nums[i], obj: v2, resources: v2.Resources, mediaBox: v2.MediaBox });
      }
      if (pages.length) ctx.notes.push('页面树不可用，已按对象顺序扫描 /Type /Page');
    }
    return pages;
  }

  /* --- 9.4 字体 / ToUnicode --- */
  function cleanHex(h) { return String(h || '').replace(/[^0-9A-Fa-f]/g, ''); }
  function hexToUtf16(h) {
    var x = cleanHex(h);
    if (!x) return '';
    if (x.length % 4) x += new Array(4 - (x.length % 4) + 1).join('0');
    var out = '';
    for (var i = 0; i < x.length; i += 4) out += String.fromCharCode(parseInt(x.substr(i, 4), 16));
    return out;
  }
  function incrementUtf16(str, delta) {
    if (!str.length || !delta) return str;
    var units = [];
    for (var i = 0; i < str.length; i++) units.push(str.charCodeAt(i));
    var carry = delta;
    for (var j = units.length - 1; j >= 0 && carry > 0; j--) {
      var v = units[j] + carry;
      units[j] = v & 0xFFFF;
      carry = v >>> 16;
    }
    return String.fromCharCode.apply(null, units);
  }
  function parseToUnicode(cmap) {
    var map = {}, m, pm, rm;
    var charRe = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = charRe.exec(cmap)) !== null) {
      var pairRe = /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]*)>/g;
      while ((pm = pairRe.exec(m[1])) !== null) {
        map[parseInt(cleanHex(pm[1]), 16)] = hexToUtf16(pm[2]);
      }
    }
    var rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = rangeRe.exec(cmap)) !== null) {
      var rowRe = /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*(?:<([0-9A-Fa-f\s]*)>|\[([\s\S]*?)\])/g;
      while ((rm = rowRe.exec(m[1])) !== null) {
        var lo = parseInt(cleanHex(rm[1]), 16);
        var hi = parseInt(cleanHex(rm[2]), 16);
        if (!(hi >= lo) || hi - lo > 65535) continue;
        if (rm[3] != null) {
          var dst = hexToUtf16(rm[3]);
          for (var c = lo; c <= hi; c++) map[c] = incrementUtf16(dst, c - lo);
        } else if (rm[4] != null) {
          var items = rm[4].match(/<[0-9A-Fa-f\s]*>/g) || [];
          for (var k = 0; k < items.length; k++) map[lo + k] = hexToUtf16(items[k].slice(1, -1));
        }
      }
    }
    return map;
  }

  var WIN_ANSI_HIGH = {
    0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026',
    0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160',
    0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019',
    0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153',
    0x9E: '\u017E', 0x9F: '\u0178'
  };
  function simpleChar(code) {
    if (code >= 0x20 && code <= 0x7E) return String.fromCharCode(code);
    if (code >= 0xA0 && code <= 0xFF) return String.fromCharCode(code);
    if (WIN_ANSI_HIGH[code] != null) return WIN_ANSI_HIGH[code];
    if (code === 9 || code === 10 || code === 13) return ' ';
    return '\uFFFD';
  }

  function buildFontMap(ctx, page) {
    var map = {}, res = page.resources;
    if (!res || !isDict(res)) return map;
    var fonts = res.Font;
    if (!isDict(fonts)) return map;
    for (var name in fonts) {
      if (!hasOwn(fonts, name)) continue;
      var fo = ctx.objects[refNum(fonts[name])];
      if (!fo || !isDict(fo.value)) continue;
      var f = fo.value;
      var sub = nameOf(f.Subtype);
      var enc = nameOf(f.Encoding);
      var twoByte = (sub === 'Type0');
      var tu = null;
      var tuRef = refNum(f.ToUnicode);
      if (tuRef != null) {
        var tuObj = ctx.objects[tuRef];
        if (tuObj && tuObj.__dataStr != null) tu = parseToUnicode(tuObj.__dataStr);
      }
      map[name] = { twoByte: twoByte, toUnicode: tu, subtype: sub, encoding: enc };
      if (twoByte && !tu) ctx.missingToUnicode++;
    }
    return map;
  }

  function decodeRawString(font, raw) {
    var out = '', i, code;
    if (!font) {
      for (i = 0; i < raw.length; i++) out += simpleChar(raw.charCodeAt(i) & 255);
      return out;
    }
    if (font.twoByte) {
      for (i = 0; i + 1 < raw.length; i += 2) {
        code = (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1);
        out += (font.toUnicode && font.toUnicode[code] != null) ? font.toUnicode[code] : '\uFFFD';
      }
      if (raw.length % 2) {
        code = raw.charCodeAt(raw.length - 1) << 8;
        out += (font.toUnicode && font.toUnicode[code] != null) ? font.toUnicode[code] : '\uFFFD';
      }
      return out;
    }
    for (i = 0; i < raw.length; i++) {
      code = raw.charCodeAt(i) & 255;
      if (font.toUnicode && font.toUnicode[code] != null) out += font.toUnicode[code];
      else out += simpleChar(code);
    }
    return out;
  }

  /* --- 9.5 内容流解析 --- */
  function parseContentText(content, fontMap) {
    var stack = [], arrStack = [];
    var out = [], curFont = null, lastY = null;
    var sawTextOp = false;
    var i = 0, n = content.length;

    function pushVal(v) {
      if (arrStack.length) { arrStack[arrStack.length - 1].items.push(v); return; }
      stack.push(v);
    }
    function newline() { if (out.length && out[out.length - 1] !== '\n') out.push('\n'); }
    function emit(str) { if (str) { out.push(str); sawTextOp = true; } }

    while (i < n) {
      var ch = content.charAt(i);
      if (ch === '%') { while (i < n && content.charAt(i) !== '\n' && content.charAt(i) !== '\r') i++; continue; }
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '(') { var ls = readLiteralString(content, i); pushVal({ str: ls.v }); i = ls.pos; continue; }
      if (ch === '<' && content.charAt(i + 1) === '<') {
        var d = parseValue(content, i);            // 内联字典（如 BDC 的属性）
        i = (d.pos > i) ? d.pos : i + 1;
        continue;
      }
      if (ch === '<') { var hs = readHexString(content, i); pushVal({ str: hs.v }); i = hs.pos; continue; }
      if (ch === '[') { arrStack.push({ items: [] }); i++; continue; }
      if (ch === ']') {
        if (arrStack.length) { var a = arrStack.pop(); pushVal({ arr: a.items }); }
        i++;
        continue;
      }
      if (ch === '/') { var nm = readName(content, i); pushVal({ name: nm.v }); i = nm.pos; continue; }
      if (ch === ')' || ch === '>' || ch === '{' || ch === '}') { i++; continue; }
      var numM = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)/.exec(content.substr(i, 32));
      if (numM) { pushVal({ num: parseFloat(numM[0]) }); i += numM[0].length; continue; }
      var opM = /^[A-Za-z][A-Za-z0-9]*|^['"*]/.exec(content.substr(i, 12));
      if (!opM) { i++; continue; }
      var op = opM[0];
      i += op.length;
      if (op === 'Tf') {
        var fname = null;
        for (var a = stack.length - 1; a >= 0; a--) if (stack[a] && stack[a].name != null) { fname = stack[a].name; break; }
        curFont = (fname != null && fontMap) ? (fontMap[fname] || null) : null;
        stack = [];
      } else if (op === 'Td' || op === 'TD') {
        var ty = 0;
        for (var b = stack.length - 1; b >= 0; b--) if (stack[b] && stack[b].num != null) { ty = stack[b].num; break; }
        if (ty !== 0) newline();
        stack = [];
      } else if (op === 'T*') {
        newline(); stack = [];
      } else if (op === 'Tm') {
        var nums = [];
        for (var c = 0; c < stack.length; c++) if (stack[c] && stack[c].num != null) nums.push(stack[c].num);
        var fy = nums.length >= 6 ? nums[5] : (nums.length ? nums[nums.length - 1] : null);
        if (fy != null && lastY != null && Math.abs(fy - lastY) > 0.01) newline();
        if (fy != null) lastY = fy;
        stack = [];
      } else if (op === 'Tj') {
        for (var s1 = 0; s1 < stack.length; s1++) if (stack[s1] && stack[s1].str != null) emit(decodeRawString(curFont, stack[s1].str));
        stack = [];
      } else if (op === "'") {
        newline();
        for (var s2 = 0; s2 < stack.length; s2++) if (stack[s2] && stack[s2].str != null) emit(decodeRawString(curFont, stack[s2].str));
        stack = [];
      } else if (op === '"') {
        newline();
        for (var s3 = stack.length - 1; s3 >= 0; s3--) if (stack[s3] && stack[s3].str != null) { emit(decodeRawString(curFont, stack[s3].str)); break; }
        stack = [];
      } else if (op === 'TJ') {
        for (var t = 0; t < stack.length; t++) {
          var el = stack[t];
          if (!el) continue;
          if (el.arr) {
            for (var u = 0; u < el.arr.length; u++) {
              var item = el.arr[u];
              if (item && item.str != null) emit(decodeRawString(curFont, item.str));
              else if (item && item.num != null && item.num < -120) emit(' ');
            }
          } else if (el.str != null) {
            emit(decodeRawString(curFont, el.str));
          }
        }
        stack = [];
      } else if (op === 'BT') {
        if (out.length) newline();
        lastY = null;
        stack = [];
      } else {
        stack = [];   // 其他算子不产出文本
      }
      if (stack.length > 64) stack = stack.slice(-64);
    }
    var text = out.join('').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
    return { text: text, sawTextOp: sawTextOp };
  }

  function pageContent(ctx, page) {
    var refs = [], c = page.obj.Contents;
    if (refNum(c) != null) refs.push(refNum(c));
    else if (Array.isArray(c)) {
      for (var i = 0; i < c.length; i++) if (refNum(c[i]) != null) refs.push(refNum(c[i]));
    }
    var parts = [], unsupported = [], filters = [];
    for (var r = 0; r < refs.length; r++) {
      var o = ctx.objects[refs[r]];
      if (!o || !o.isStream) continue;
      if (o.__unsupportedFilter) { unsupported.push(o.__unsupportedFilter); continue; }
      if (o.__dataStr == null) continue;
      parts.push(o.__dataStr);
      if (o.__filterLabel && filters.indexOf(o.__filterLabel) < 0) filters.push(o.__filterLabel);
    }
    return { content: parts.join('\n'), unsupported: unsupported, filters: filters };
  }

  /* --- 9.6 主流程 --- */
  function extractWithBuiltin(buf, opts, info) {
    var o = opts || {};
    var status = (info && info.status) || null;
    var engineError = info ? info.engineError : null;
    var bytes = toBytes(buf);
    var latin1 = bytesToLatin1(bytes);
    var engineNote = status
      ? '（pdf.js 不可用：' + (engineError || status.message) + '）'
      : '（未加载 pdf.js）';

    /* 规范允许 %PDF- 之前有最多 1024 字节的前导垃圾，这里宽容处理 */
    if (latin1.substr(0, 1024).indexOf('%PDF-') < 0) {
      return Promise.resolve(failExtract(
        '不是 PDF 文件（前 1024 字节内没有 %PDF- 文件头）。' + engineNote +
        ' 若这是扫描件或损坏文件，离线环境下没有可用解析途径。', o, 'builtin'));
    }

    var ctx;
    try {
      ctx = parsePdfObjects(latin1);
    } catch (e) {
      return Promise.resolve(failExtract('内置解析器无法解析该 PDF 的对象结构：' + errMsg(e) + ' ' + engineNote, o, 'builtin'));
    }
    if (ctx.trailer && ctx.trailer.Encrypt) {
      return Promise.resolve(failExtract('该 PDF 已加密（/Encrypt），内置降级解析器不支持。' + engineNote, o, 'builtin'));
    }

    /* 流数据准备：未压缩直接用；FlateDecode 尝试 DecompressionStream；其他标记不支持 */
    var inflateJobs = [];
    for (var k in ctx.objects) {
      if (!hasOwn(ctx.objects, k)) continue;
      var obj = ctx.objects[k];
      if (!obj.isStream) continue;
      var filters = filterNames(obj);
      if (!filters.length) {
        obj.__dataStr = obj.raw;
        obj.__filterLabel = 'none';
        continue;
      }
      if (filters.length === 1 && filters[0] === 'FlateDecode') {
        inflateJobs.push((function (ob) {
          return inflateBytes(stringToBytes(ob.raw)).then(function (out) {
            if (out) { ob.__dataStr = bytesToLatin1(out); ob.__filterLabel = 'FlateDecode'; }
            else { ob.__unsupportedFilter = 'FlateDecode(无解压能力)'; }
          });
        })(obj));
        continue;
      }
      obj.__unsupportedFilter = filters.join('+');
    }

    return Promise.all(inflateJobs).then(function () {
      return buildBuiltinPages(ctx, o, status, engineError);
    }).catch(function (e) {
      return failExtract('内置解析器解压/组页失败：' + errMsg(e) + ' ' + engineNote, o, 'builtin');
    });
  }

  function stringToBytes(s) {
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
    return out;
  }

  function buildBuiltinPages(ctx, o, status, engineError) {
    var engineNote = status
      ? '（pdf.js 不可用：' + (engineError || status.message) + '）'
      : '（未加载 pdf.js）';
    var pages = collectPages(ctx);
    if (!pages.length) {
      return failExtract('在 PDF 中找不到页面对象（可能是对象流/交叉引用流结构，内置降级解析器不支持）。' +
        engineNote + ' 离线环境下无法解析该 PDF。', o, 'builtin');
    }
    if (o.maxPages) pages = pages.slice(0, o.maxPages);
    var rawPages = [], unsupportedAll = [], filtersAll = [], emptyTextPages = [];
    for (var i = 0; i < pages.length; i++) {
      var fontMap = buildFontMap(ctx, pages[i]);
      var pc = pageContent(ctx, pages[i]);
      for (var u = 0; u < pc.unsupported.length; u++) if (unsupportedAll.indexOf(pc.unsupported[u]) < 0) unsupportedAll.push(pc.unsupported[u]);
      for (var f = 0; f < pc.filters.length; f++) if (filtersAll.indexOf(pc.filters[f]) < 0) filtersAll.push(pc.filters[f]);
      var parsed = parseContentText(pc.content, fontMap);
      if (!parsed.text) emptyTextPages.push(i + 1);
      rawPages.push({ pageNo: i + 1, text: parsed.text, lineCount: parsed.text ? parsed.text.split('\n').length : 0 });
    }
    var needsEngine = unsupportedAll.length > 0 || ctx.missingToUnicode > 0;
    var warnings = [];
    if (unsupportedAll.length) {
      warnings.push('以下流过滤器不被内置解析器支持，相关页面文本缺失：' + unsupportedAll.join('、') + '。需要 pdf.js。');
    }
    if (ctx.missingToUnicode > 0) {
      warnings.push('有 ' + ctx.missingToUnicode + ' 处 Type0 字体缺少 ToUnicode CMap（逐页统计），中文会变成 U+FFFD（乱码率会被计入诊断）。');
    }
    if (ctx.notes.length) warnings = warnings.concat(ctx.notes);
    if (emptyTextPages.length) {
      warnings.push('未抽到文本的页：' + emptyTextPages.join('、') + '（可能是图片页/扫描页）。');
    }
    warnings.push('内置降级解析器不做版式几何分析：twoColRisk 记为 unknown；也不做 OCR，扫描件无法引用原句。');

    var res = finishExtract(rawPages, {
      engine: 'builtin',
      engineMessage: 'pdf.js 不可用' + engineNote + '，已改用内置降级解析器抽取文本层（支持经典 PDF：未加密、无对象流，内容流未压缩或 FlateDecode）。',
      itemsByPage: null,
      needsEngine: needsEngine,
      unsupportedPages: emptyTextPages,
      warnings: warnings,
      parse: {
        via: ctx.via,
        objects: countKeys(ctx.objects),
        pages: pages.length,
        filters: filtersAll,
        unsupported: unsupportedAll,
        notes: ctx.notes,
        missingToUnicode: ctx.missingToUnicode,
        xref: ctx.via === 'xref',
        trailerSize: (ctx.trailer && typeof ctx.trailer.Size === 'number') ? ctx.trailer.Size : null
      }
    }, o);
    res.engineError = engineError || (status ? status.message : null);
    res.engineStatus = status ? { ok: status.ok, source: status.source, via: status.via, message: status.message } : null;
    return res;
  }

  /* ------------------------------------------------------------
     10. 纯文本入语料（离线可用）
     ------------------------------------------------------------ */
  function extractText(text, opts) {
    var o = opts || {};
    var s = (text == null) ? '' : String(text);
    var parts = s.indexOf('\f') >= 0 ? s.split('\f') : [s];
    var pages = [];
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      pages.push({ pageNo: i + 1, text: t, lineCount: t ? t.split('\n').length : 0 });
    }
    return finishExtract(pages, {
      engine: 'plaintext',
      engineMessage: '按纯文本处理（' + pages.length + ' 页，以 \\f 分页）。',
      itemsByPage: null
    }, o);
  }

  /* ------------------------------------------------------------
     11. 导出
     ------------------------------------------------------------ */
  ZY.pdftext = {
    loadEngine: loadEngine,
    extract: extract,
    /* 附加 API */
    diagnose: diagnose,
    qualityOf: qualityOf,
    twoColRisk: twoColRisk,
    mojibakeStats: mojibakeStats,
    joinPages: joinPages,
    extractText: extractText,
    hasEngine: hasEngine,
    engineStatus: engineStatus,
    reset: reset,
    CONFIG: CONFIG,
    QUALITY: QUALITY
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
