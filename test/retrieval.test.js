/* ============================================================
   智研 · 检索层独立测试（Node，无需浏览器、无需网络）
   ------------------------------------------------------------
   运行： node test/retrieval.test.js
   覆盖：tokenizer / BM25 手算对拍 / RRF 手算对拍 / 分块与字符区间 /
         引用出处不变量（charRange 切原文 === quote）/ 质量诊断 /
         pdf.js 引擎不可用降级 / 运行时加载（注入式 host 模拟 CDN）/
         手写最小合法 PDF（ASCII + 中文 Type0/Identity-H+ToUnicode）/
         零网络端到端可用性

   说明（诚实边界）：
   - 本机无网络，**没有**真的从 CDN 下载过 pdf.js；CDN 装载路径用
     注入式 host + 假引擎验证「适配器与抽取管线」，不等于验证了 pdf.js 本身。
   - 手写 PDF 由本文件的独立构造器生成，并用**独立于被测代码**的结构校验器
     验证其 xref/trailer 合法，因此「最小合法 PDF」这条是**真覆盖**（见各组断言）。
   - 输出只用 ASCII 标记（PASS/FAIL），避免 GBK 控制台编码问题。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_DIR = path.join(ROOT, 'scripts');

/* ------------------------------------------------------------
   断言框架
   ------------------------------------------------------------ */
let passCount = 0, failCount = 0;
const failures = [];
const syncChecks = [];
const asyncChecks = [];

function ascii(v) {
  const s = (v === undefined) ? 'undefined' : String(v);
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c <= 0x7E) out += ch;
    else if (c <= 0xFFFF) out += '\\u' + ('0000' + c.toString(16)).slice(-4);
    else out += '\\u{' + c.toString(16) + '}';
  }
  return out;
}
function j(v) {
  try { return ascii(JSON.stringify(v)); } catch (e) { return ascii(String(v)); }
}
function check(name, fn) { syncChecks.push([name, fn]); }
function acheck(name, fn) { asyncChecks.push([name, fn]); }

function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error((msg || 'not equal') + ' | expected=' + j(expected) + ' actual=' + j(actual));
}
function near(actual, expected, tol, msg) {
  if (typeof actual !== 'number' || isNaN(actual) || Math.abs(actual - expected) > tol) {
    throw new Error((msg || 'not close') + ' | expected=' + expected + ' actual=' + actual + ' tol=' + tol);
  }
}
function deepEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg || 'deep not equal') + ' | expected=' + ascii(b) + ' actual=' + ascii(a));
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function has(obj, key, msg) {
  if (!obj || !(key in obj)) throw new Error((msg || 'missing key') + ' | key=' + key);
}

/* ------------------------------------------------------------
   沙箱
   ------------------------------------------------------------ */
function fresh(files, extraGlobals) {
  const win = Object.assign({ console: { log() {} } }, extraGlobals || {});
  win.window = win;
  const ctx = vm.createContext(win);
  for (const f of files) {
    const code = fs.readFileSync(scriptPath(f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  return { win, ctx };
}
/* data.js 是**既有文件**（不在我的写入范围）：测试直接读目标目录里的那一份，
   不拷贝、不修改，避免交付目录里出现样例数据的副本。 */
function resolveDataJs() {
  const candidates = [
    process.env.ZY_DATA_JS,
    path.join(ROOT, 'scripts', 'data.js'),
    'C:\\\u7ECF\u7BA1\u8BBA\u6587\u52A9\u624B\\economic-research-assistant\\frontend-demo\\scripts\\data.js'
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('data.js not found; tried: ' + candidates.join(' | '));
}
const DATA_JS = resolveDataJs();
function scriptPath(f) { return f === 'data.js' ? DATA_JS : path.join(SCRIPT_DIR, f); }
/* data.js 一起加载：样例库 D.LIBRARY 是真实的既有数据源，检索测试必须打真实数据 */
const ALL_SCRIPTS = ['data.js', 'pdftext.js', 'bm25.js', 'corpus.js'];

function loadLibrary(win) {
  const D = win.ZY && win.ZY.data;
  ok(D && Array.isArray(D.LIBRARY), 'data.js 未导出 ZY.data.LIBRARY');
  return D.LIBRARY;
}

/* ------------------------------------------------------------
   PDF 构造器（独立于被测代码）+ 独立结构校验器
   ------------------------------------------------------------ */
function pdfString(objects, opts) {
  /* objects: [{num, body}]，body 为对象内容（不含 N G obj / endobj） */
  const o = opts || {};
  let out = '%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n';
  const offsets = {};
  const maxNum = objects.reduce((m, x) => Math.max(m, x.num), 0);
  for (const obj of objects) {
    offsets[obj.num] = out.length;
    out += obj.num + ' 0 obj\n' + obj.body + '\nendobj\n';
  }
  const xrefStart = out.length;
  out += 'xref\n0 ' + (maxNum + 1) + '\n';
  out += '0000000000 65535 f \n';
  for (let i = 1; i <= maxNum; i++) {
    if (offsets[i] == null) { out += '0000000000 65535 f \n'; continue; }
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += 'trailer\n<< /Size ' + (maxNum + 1) + ' /Root 1 0 R' + (o.extraTrailer || '') + ' >>\n';
  out += 'startxref\n' + (o.badStartxref ? 999999 : xrefStart) + '\n%%EOF\n';
  return out;
}
function streamObj(dictExtra, contentLatin1, encode) {
  /* encode: null | 'flate' —— contentLatin1 为 latin1 字符串 */
  let payload = contentLatin1;
  let filter = '';
  if (encode === 'flate') {
    payload = zlib.deflateSync(Buffer.from(contentLatin1, 'latin1')).toString('latin1');
    filter = ' /Filter /FlateDecode';
  } else if (encode) {
    filter = ' /Filter /' + encode;
  }
  const dict = '<< /Length ' + payload.length + filter + (dictExtra ? ' ' + dictExtra : '') + ' >>';
  return dict + '\nstream\n' + payload + '\nendstream';
}
function latin1ToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}
function bytesToLatin1(b) { return Buffer.from(b).toString('latin1'); }

/** 独立结构校验器：不调用被测 pdftext 的任何函数 */
function validatePdfStructure(bytes) {
  const s = bytesToLatin1(bytes);
  const problems = [];
  if (s.slice(0, 8) !== '%PDF-1.4') problems.push('bad-header');
  if (!/%%EOF\s*$/.test(s)) problems.push('missing-EOF');
  if (s.indexOf('/ObjStm') >= 0) problems.push('uses-ObjStm');
  const sxIdx = s.lastIndexOf('startxref');
  if (sxIdx < 0) { problems.push('no-startxref'); return { ok: false, problems }; }
  const m = /startxref\s+(\d+)\s+%%EOF/.exec(s.slice(sxIdx));
  if (!m) { problems.push('bad-startxref-tail'); return { ok: false, problems }; }
  const xrefOff = parseInt(m[1], 10);
  if (s.slice(xrefOff, xrefOff + 4) !== 'xref') { problems.push('startxref-not-pointing-at-xref'); return { ok: false, problems }; }
  const lines = s.slice(xrefOff).split('\n');
  if (lines[0].trim() !== 'xref') problems.push('xref-keyword');
  const head = /^(\d+)\s+(\d+)\s*$/.exec(lines[1]);
  if (!head) { problems.push('bad-xref-subsection'); return { ok: false, problems }; }
  const first = parseInt(head[1], 10), count = parseInt(head[2], 10);
  const entries = {};
  for (let i = 0; i < count; i++) {
    const line = lines[2 + i];
    const em = /^(\d{10}) (\d{5}) ([nf]) $/.exec(line + (line.endsWith(' ') ? '' : '')) || /^(\d{10}) (\d{5}) ([nf])\s*$/.exec(line);
    if (!em) { problems.push('bad-entry:' + i + ':' + ascii(line)); continue; }
    if (em[3] === 'n') entries[first + i] = parseInt(em[1], 10);
  }
  const nums = Object.keys(entries);
  for (const n of nums) {
    const off = entries[n];
    const probe = s.slice(off, off + 60);
    const om = new RegExp('^' + n + ' 0 obj\\b').exec(probe);
    if (!om) problems.push('offset-wrong:' + n + '@' + off);
  }
  const trIdx = s.indexOf('trailer', xrefOff);
  const tr = /trailer\s*<<([\s\S]*?)>>/.exec(s.slice(trIdx));
  if (!tr) problems.push('no-trailer');
  else {
    const sizeM = /\/Size\s+(\d+)/.exec(tr[1]);
    const rootM = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(tr[1]);
    if (!sizeM) problems.push('no-Size');
    else {
      const maxNum = nums.reduce((mx, x) => Math.max(mx, parseInt(x, 10)), 0);
      if (parseInt(sizeM[1], 10) !== maxNum + 1) problems.push('Size-mismatch:' + sizeM[1] + '!=' + (maxNum + 1));
    }
    if (!rootM) problems.push('no-Root');
    else {
      const rootOff = entries[rootM[1]];
      if (rootOff == null) problems.push('Root-not-in-xref');
      else {
        const endIdx = s.indexOf('endobj', rootOff);
        const body = s.slice(rootOff, endIdx);
        if (!/\/Type\s*\/Catalog/.test(body)) problems.push('Root-not-Catalog');
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

/* ---------------- 具体 PDF 样例 ---------------- */
function pdfAsciiHello() {
  const content = 'BT /F1 24 Tf 72 720 Td (Hello, retrieval!) Tj ET';
  return pdfString([
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>' },
    { num: 4, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
    { num: 5, body: streamObj(null, content) }
  ]);
}
const CMAP_CN = [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin',
  'begincmap',
  '/CMapName /Adobe-Identity-UCS def',
  '/CMapType 2 def',
  '1 begincodespacerange',
  '<0000> <FFFF>',
  'endcodespacerange',
  '2 beginbfchar',
  '<4F60> <4F60>',
  '<597D> <597D>',
  'endbfchar',
  '1 beginbfrange',
  '<4E00> <4E02> <4E00>',
  'endbfrange',
  'endcmap',
  'CMapName currentdict /CMap defineresource pop',
  'end',
  'end'
].join('\n');

function pdfChinese(opts) {
  const o = opts || {};
  const content = o.content || 'BT /F1 12 Tf 72 720 Td <4F60597D> Tj 0 -20 Td <4E004E014E02> Tj ET';
  const fontBody = o.noToUnicode
    ? '<< /Type /Font /Subtype /Type0 /BaseFont /SimSun /Encoding /Identity-H /DescendantFonts [5 0 R] >>'
    : '<< /Type /Font /Subtype /Type0 /BaseFont /SimSun /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>';
  const objects = [
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>' },
    { num: 4, body: fontBody },
    { num: 5, body: '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SimSun /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>' },
    { num: 6, body: streamObj(null, content, o.encode) }
  ];
  if (!o.noToUnicode) objects.push({ num: 7, body: streamObj(null, CMAP_CN, o.encode) });
  return pdfString(objects);
}

function pdfEmptyPage() {
  const content = '';   // 合法但无文本算子（模拟扫描件：有页无文字层）
  return pdfString([
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>' },
    { num: 4, body: streamObj(null, content) }
  ]);
}
function pdfImageOnlyPage() {
  const content = 'q 595 0 0 842 0 0 cm /Im1 Do Q';
  return pdfString([
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>' },
    { num: 4, body: streamObj(null, content, 'DCTDecode') }
  ]);
}
function pdfEncrypted() {
  return pdfString([
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [] /Count 0 >>' },
    { num: 8, body: '<< /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -1 >>' }
  ], { extraTrailer: ' /Encrypt 8 0 R' });
}

/* ------------------------------------------------------------
   假 pdf.js 引擎（模拟 CDN 装载 + 适配器管线）
   pages: [[{str, x, y, w, hasEOL}]]（第 n-1 项为第 n 页）
   ------------------------------------------------------------ */
function fakePdfjsScript(pages) {
  const json = JSON.stringify(pages);
  return [
    '(function (g) {',
    '  var PAGES = ' + json + ';',
    '  g.pdfjsLib = {',
    '    version: "4.10.38-fake",',
    '    GlobalWorkerOptions: {},',
    '    getDocument: function (params) {',
    '      return { promise: Promise.resolve({',
    '        numPages: PAGES.length,',
    '        getPage: function (n) {',
    '          return Promise.resolve({',
    '            getViewport: function () { return { width: 600, height: 800 }; },',
    '            getTextContent: function () {',
    '              var src = PAGES[n - 1] || [], out = [];',
    '              for (var i = 0; i < src.length; i++) {',
    '                var it = src[i];',
    '                out.push({ str: it.str, width: it.w, hasEOL: !!it.hasEOL, transform: [1, 0, 0, 1, it.x, it.y] });',
    '              }',
    '              return Promise.resolve({ items: out });',
    '            }',
    '          });',
    '        },',
    '        destroy: function () {}',
    '      }) };',
    '    }',
    '  };',
    '})(window);'
  ].join('\n');
}
function fakeHost(win, ctx, scriptText, opts) {
  const o = opts || {};
  const calls = [];
  return {
    kind: 'fake',
    calls: calls,
    getGlobal: function (n) { return win[n]; },
    injectScript: function (url) {
      calls.push(url);
      /* 默认模拟「vendor/ 为空」：本地相对路径 404，于是走 CDN 路线 */
      if (!o.allowLocal && url.indexOf('//') < 0) return Promise.reject(new Error('404 ' + url));
      if (o.failAll) return Promise.reject(new Error('offline ' + url));
      vm.runInContext(scriptText, ctx, { filename: 'fake-pdfjs.js' });
      return Promise.resolve(url);
    },
    importModule: function (url) {
      calls.push('esm:' + url);
      return Promise.reject(new Error('no-esm'));
    }
  };
}
/** 与实现无关的页归属判断：最后一个 charStart <= off 的页 */
function pageOf(doc, off) {
  let found = null;
  for (const p of doc.pages) if (p.charStart <= off) found = p;
  ok(!!found, 'no page owns offset ' + off);
  return found.pageNo;
}

/* ============================================================
   1. tokenizer
   ============================================================ */
check('tokenizer: cjk bigram order + unigrams', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  deepEq(bm.tokenize('数字化转型'), ['数字', '字化', '化转', '转型', '数', '字', '化', '转', '型']);
});

check('tokenizer: stop char kills bigram and unigram', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  deepEq(bm.tokenize('与的'), [], 'both chars are stop chars');
  deepEq(bm.tokenize('创新与驱动'), ['创新', '驱动', '创', '新', '驱', '动'],
    'bigrams crossing a stop char (新与/与驱) are dropped');
});

check('tokenizer: mixed cjk + english + case folding + punctuation + stopwords', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  deepEq(bm.tokenize('数字化转型与 TFP 提升'), ['数字', '字化', '化转', '转型', '数', '字', '化', '转', '型', 'tfp', '提升', '提', '升']);
  deepEq(bm.tokenize('DiD Effect, 2021! the AND of'), ['did', 'effect', '2021']);
  deepEq(bm.tokenize(''), []);
  deepEq(bm.tokenize(null), []);
  deepEq(bm.tokenize('   ,.;:!?  '), []);
});

check('tokenizer: fullwidth digits normalized, tokenizeSpans offsets map to raw text', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  deepEq(bm.tokenize('\uFF12\uFF10\uFF12\uFF11\u5E74'), ['2021', '\u5E74']);
  const text = '\u521B\u65B0\u9A71\u52A8';   // 创新驱动：bigram = 创新 / 新驱 / 驱动
  const spans = bm.tokenizeSpans(text);
  deepEq(spans, [
    { term: '\u521B\u65B0', start: 0, end: 2 },
    { term: '\u65B0\u9A71', start: 1, end: 3 },
    { term: '\u9A71\u52A8', start: 2, end: 4 },
    { term: '\u521B', start: 0, end: 1 },
    { term: '\u65B0', start: 1, end: 2 },
    { term: '\u9A71', start: 2, end: 3 },
    { term: '\u52A8', start: 3, end: 4 }
  ]);
  for (const sp of spans) eq(text.slice(sp.start, sp.end), sp.term, 'span slice mismatch');
});

/* ============================================================
   2. BM25 手算对拍
   语料（body 只有纯英文词，便于手算；k1=1.5, b=0.75）：
     d1: "apple banana cherry"  -> len 3
     d2: "apple apple banana"   -> len 3
     d3: "cherry date"          -> len 2
   N=3, totalLen=8, avgdl=8/3=2.6666...
   手算（见文件底部注释）：
     idf(apple,df=2) = ln(1 + (3-2+0.5)/(2+0.5)) = ln(1.6) = 0.47000362924573558
     idf(date, df=1) = ln(1 + (3-1+0.5)/(1+0.5)) = ln(8/3) = 0.98082925301172641
     d1 norm  = 1-0.75+0.75*(3/(8/3)) = 0.25+0.84375 = 1.09375
     d1 score = 0.47000362924573558 * 2.5/(1+1.5*1.09375) = 0.44497385017347751
     d2 score = 0.47000362924573558 * 5/(2+1.5*1.09375) = 0.64549854660358541
     d3 norm  = 1-0.75+0.75*(2/(8/3)) = 0.25+0.5625 = 0.8125
     d3 score = 0.98082925301172641 * 2.5/(1+1.5*0.8125) = 1.10515972170335375
   ============================================================ */
function appleIndex(win) {
  const bm = win.ZY.bm25;
  return bm.buildIndex([
    { id: 'd1', title: '', journal: '', year: null, text: 'apple banana cherry' },
    { id: 'd2', title: '', journal: '', year: null, text: 'apple apple banana' },
    { id: 'd3', title: '', journal: '', year: null, text: 'cherry date' }
  ]);
}

check('bm25: idf matches closed form and hand-computed literals', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  near(bm.idf(2, 3), Math.log(1 + (3 - 2 + 0.5) / (2 + 0.5)), 1e-15, 'idf closed form');
  near(bm.idf(2, 3), 0.47000362924573558, 1e-15, 'idf(apple) hand value');
  near(bm.idf(1, 3), 0.98082925301172641, 1e-15, 'idf(date) hand value');
  eq(bm.idf(0, 3), 0, 'df=0 -> 0');
  eq(bm.idf(2, 0), 0, 'N=0 -> 0');
});

check('bm25: single-term scores equal hand-computed values', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  const idx = appleIndex(win);
  eq(idx.N, 3, 'doc count');

  const r = bm.search(idx, 'apple', { field: 'body', limit: 10 });
  eq(r.length, 2, 'only d1/d2 contain apple');
  eq(r[0].id, 'd2', 'higher tf ranks first');
  eq(r[1].id, 'd1');
  near(r[0].score, 0.64549854660358541, 1e-12, 'd2 apple (tf=2)');
  near(r[1].score, 0.44497385017347751, 1e-12, 'd1 apple (tf=1)');

  const r2 = bm.search(idx, 'date', { field: 'body', limit: 10 });
  eq(r2.length, 1);
  eq(r2[0].id, 'd3');
  near(r2[0].score, 1.10515972170335375, 1e-12, 'd3 date');

  const r3 = bm.search(idx, 'banana', { field: 'body', limit: 10 });
  eq(r3.length, 2, 'banana in d1/d2');
  eq(r3[0].id, 'd1', 'identical tf/dl -> identical score -> deterministic tie-break by id asc');
  near(r3[0].score, r3[1].score, 1e-15, 'same tf/dl -> same score');
});

check('bm25: rare term outweighs common term (same tf/length)', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  /* 三篇等长：apple 出现在 3 篇（df=3），date 只出现在 1 篇（df=1） */
  const idx = bm.buildIndex([
    { id: 'a', text: 'apple date' },
    { id: 'b', text: 'apple banana' },
    { id: 'c', text: 'apple cherry' }
  ]);
  const common = bm.search(idx, 'apple', { field: 'body', limit: 10 });
  const rare = bm.search(idx, 'date', { field: 'body', limit: 10 });
  eq(common.length, 3, 'apple is common');
  eq(rare.length, 1, 'date is rare');
  ok(rare[0].score > common[0].score, 'rare idf must beat common idf');
  /* 所有文档长度都等于 avgdl 时，长度归一化项为 1，单词语义分数 == idf */
  near(common[0].score, bm.idf(3, 3), 1e-15, 'score == idf when dl == avgdl (common)');
  near(rare[0].score, bm.idf(1, 3), 1e-15, 'score == idf when dl == avgdl (rare)');
  near(common[0].score, Math.log(1 + (3 - 3 + 0.5) / (3 + 0.5)), 1e-15);
});

check('bm25: tf saturation (k1) and length normalization (b) behave as specified', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  const idx = appleIndex(win);
  const idfApple = 0.47000362924573558;

  const base = bm.search(idx, 'apple', { field: 'body', limit: 10 });
  const s1 = base.filter(x => x.id === 'd1')[0].score;
  const s2 = base.filter(x => x.id === 'd2')[0].score;
  ok(s2 < 2 * s1, 'tf=2 must not double the score (saturation)');

  /* k1=0：分子 tf*1、分母 tf -> score == idf，与 tf 无关 */
  const k0 = bm.search(idx, 'apple', { field: 'body', limit: 10, k1: 0 });
  near(k0[0].score, idfApple, 1e-15, 'k1=0 -> score == idf');
  near(k0[1].score, idfApple, 1e-15, 'k1=0 -> tf independent');
  near(k0[0].score, k0[1].score, 1e-15);

  /* b=0：不做长度归一化 -> d2/d1 之比 = (5/3.5)/(2.5/2.5) = 1.4285714285714286 */
  const b0 = bm.search(idx, 'apple', { field: 'body', limit: 10, b: 0 });
  const b1 = b0.filter(x => x.id === 'd1')[0].score;
  const b2 = b0.filter(x => x.id === 'd2')[0].score;
  near(b1, idfApple * (2.5 / 2.5), 1e-15, 'b=0 d1');
  near(b2, idfApple * (5 / 3.5), 1e-15, 'b=0 d2');
  near(b2 / b1, 1.4285714285714286, 1e-15, 'b=0 ratio');
});

check('bm25: empty / stopword-only / no-match queries return []', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  const idx = appleIndex(win);
  deepEq(bm.search(idx, '', { field: 'body' }), []);
  deepEq(bm.search(idx, '   ', { field: 'body' }), []);
  deepEq(bm.search(idx, 'the of and', { field: 'body' }), [], 'english stopwords only');
  deepEq(bm.search(idx, '\u7684\u4E86\u662F', { field: 'body' }), [], 'cjk stop chars only');
  deepEq(bm.search(idx, 'zebra', { field: 'body' }), [], 'no match');
  deepEq(bm.search(null, 'apple'), [], 'null index');
});

check('bm25: metadata sub-route is real and fused into route A', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  const idx = bm.buildIndex([
    { id: 'm1', title: '\u9762\u677F\u6570\u636E\u6A21\u578B\u7684\u4F30\u8BA1', journal: '\u6570\u91CF\u7ECF\u6D4E', year: 2020, text: '\u6B63\u6587\u4E0E\u4E3B\u9898\u65E0\u5173\u3002' },
    { id: 'm2', title: '\u4EA7\u4E1A\u653F\u7B56', journal: '\u7ECF\u6D4E\u7814\u7A76', year: 2021, text: '\u6B63\u6587\u4E0E\u4E3B\u9898\u65E0\u5173\u3002' }
  ]);
  /* body 路：查询词在正文里没有 */
  deepEq(bm.search(idx, '\u9762\u677F\u6570\u636E', { field: 'body', limit: 5 }), [], 'body route finds nothing');
  /* meta 子路：标题命中 */
  const meta = bm.search(idx, '\u9762\u677F\u6570\u636E', { field: 'meta', limit: 5 });
  eq(meta.length, 1, 'meta route hits title');
  eq(meta[0].id, 'm1');
  ok(meta[0].score > 0, 'meta score positive');
  /* auto（RRF 融合）：meta-only 命中也要出现在结果里，且能被识别出来 */
  const auto = bm.search(idx, '\u9762\u677F\u6570\u636E', { limit: 5 });
  eq(auto.length, 1, 'fused route keeps meta-only hit');
  eq(auto[0].id, 'm1');
  eq(auto[0].bm25Score, undefined, 'no body score for meta-only hit');
  eq(auto[0].metaRank, 1, 'meta rank recorded');
  near(auto[0].routeScore, 0.5 * auto[0].metaScore, 1e-15, 'route A = body + metaBoost(0.5) x meta');
  ok(auto[0].coverageScore > 0, 'coverage route also credits the title (titleBoost)');
  ok(auto[0].matchedTerms.length > 0, 'matched terms recorded');
});

check('bm25: coverage route (route B) is hand-computed and tf-free', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  /* c1: body = alpha beta
     c2: title = alpha, body = gamma
     c3: body = gamma                       N = 3
     idf(alpha) 正文 df=1 -> ln(1 + (3-1+0.5)/1.5) = ln(8/3)  = 0.98082925301172641
     idf(gamma) 正文 df=2 -> ln(1 + (3-2+0.5)/2.5) = ln(1.6)  = 0.47000362924573558
     查询 'alpha'：c1 正文命中 boost=1 -> 0.98082925301172641
                  c2 仅标题命中 boost=3 -> 2.94248775903517923
     查询 'alpha gamma'：c1 = 0.98082925301172641
                        c2 = 2.94248775903517923 + 0.47000362924573558 = 3.41249138828091481
                        c3 = 0.47000362924573558
     排序 c2 > c1 > c3 */
  const idx = bm.buildIndex([
    { id: 'c1', title: '', journal: '', text: 'alpha beta' },
    { id: 'c2', title: 'alpha', journal: '', text: 'gamma' },
    { id: 'c3', title: '', journal: '', text: 'gamma' }
  ]);
  const r1 = bm.search(idx, 'alpha', { field: 'coverage', limit: 5 });
  deepEq(r1.map(x => x.id), ['c2', 'c1']);
  near(r1[0].score, 2.94248775903517923, 1e-12, 'c2 title boost');
  near(r1[1].score, 0.98082925301172641, 1e-12, 'c1 body only');
  const r2 = bm.search(idx, 'alpha gamma', { field: 'coverage', limit: 5 });
  deepEq(r2.map(x => x.id), ['c2', 'c1', 'c3']);
  near(r2[0].score, 3.41249138828091481, 1e-12);
  near(r2[1].score, 0.98082925301172641, 1e-12);
  near(r2[2].score, 0.47000362924573558, 1e-12);
  deepEq(r2[0].matchedTerms, ['alpha', 'gamma'], 'both terms recorded');

  /* 覆盖率路不看 tf；BM25 路必须看 tf —— 两路因此互补 */
  const idx2 = bm.buildIndex([
    { id: 'x1', title: '', text: 'alpha' },
    { id: 'x2', title: '', text: 'alpha alpha alpha' }
  ]);
  const cov = bm.search(idx2, 'alpha', { field: 'coverage', limit: 5 });
  near(cov[0].score, cov[1].score, 1e-15, 'coverage ignores term frequency');
  const body = bm.search(idx2, 'alpha', { field: 'body', limit: 5 });
  ok(body[0].score > body[1].score, 'BM25 does distinguish term frequency');
  /* 两路分数不可比（量纲不同），RRF 只用名次 */
  ok(cov[0].score > 0 && body[0].score > 0);
});

check('bm25: RRF fusion keeps a strong single-route hit on top', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  /* 回归用例：spec 的 9 个查询词只命中 dA（覆盖率与 BM25 都是第 1），
     dB 只在标题里命中 1 个常见词。若第二路是「纯 meta BM25」，
     两路都沾一点的 dB 会因为 RRF 只看名次而反超 dA。 */
  const idx = bm.buildIndex([
    { id: 'dA', title: '\u65E0\u5173', journal: '', text: 'alpha bravo charlie delta echo foxtrot golf hotel india' },
    { id: 'dB', title: 'alpha', journal: 'alpha', text: 'juliet kilo lima' }
  ]);
  const q = 'alpha bravo charlie delta echo foxtrot golf hotel india';
  const res = bm.search(idx, q, { limit: 5 });
  eq(res[0].id, 'dA', 'the doc covering 9/9 terms must rank first');
  eq(res[0].coverageRank, 1);
  eq(res[0].bm25Rank, 1);
  eq(res[0].routeRank, 1);
  ok(res[1] === undefined || res[1].id === 'dB', 'second place is the metadata-only doc');
});

check('tokenizer: query side drops unigrams for multi-char CJK runs', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  /* 索引侧保留单字（让「数」这种单字查询可用） */
  deepEq(bm.tokenize('\u626B\u63CF\u4EF6'), ['\u626B\u63CF', '\u63CF\u4EF6', '\u626B', '\u63CF', '\u4EF6']);
  /* 查询侧只出 bigram：否则「扫描件」会命中任何含「件」的文档（例如「…条件。」） */
  deepEq(bm.queryTerms('\u626B\u63CF\u4EF6'), ['\u626B\u63CF', '\u63CF\u4EF6']);
  deepEq(bm.queryTerms('\u6570\u5B57\u5316\u8F6C\u578B'), ['\u6570\u5B57', '\u5B57\u5316', '\u5316\u8F6C', '\u8F6C\u578B']);
  /* 单字段落仍用单字兜底 */
  deepEq(bm.queryTerms('\u6570'), ['\u6570']);
  deepEq(bm.queryTerms('\u626B\u63CF'),
    ['\u626B\u63CF'], '2-char run -> single bigram');
  /* 英文/数字一视同仁 */
  deepEq(bm.queryTerms('DiD 2021'), ['did', '2021']);
  deepEq(bm.queryTerms('\u7684\u4E86'), [], 'stop chars only');
});

check('bm25: a token that only matches a stray single char must not rank', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  const idx = bm.buildIndex([
    { id: 'irrelevant', title: '', text: '\u8F6C\u5316\u7684\u91CD\u8981\u6761\u4EF6\u3002' },              // 含「件」
    { id: 'target', title: '', text: '\u626B\u63CF\u4EF6\u7F3A\u5931\u6587\u672C\u5C42\u3002' }            // 含「扫描件」
  ]);
  const res = bm.search(idx, '\u626B\u63CF\u4EF6', { limit: 5 });
  eq(res.length, 1, 'only the doc containing the bigrams matches');
  eq(res[0].id, 'target');
  const idx2 = bm.buildIndex([{ id: 'only', title: '', text: '\u91CD\u8981\u6761\u4EF6\u3002' }]);
  deepEq(bm.search(idx2, '\u626B\u63CF\u4EF6', { limit: 5 }), [], 'no bigram -> no hit');
});

check('bm25: snippet offsets slice back to the same text', () => {
  const { win } = fresh(['bm25.js']);
  const bm = win.ZY.bm25;
  const text = '\u7B2C\u4E00\u53E5\u3002\u6570\u5B57\u5316\u8F6C\u578B\u663E\u8457\u63D0\u5347\u4E86\u521B\u65B0\u7EE9\u6548\u3002\u7B2C\u4E09\u53E5\u3002';
  const idx = bm.buildIndex([{ id: 'x', title: 't', text: text }]);
  const r = bm.search(idx, '\u6570\u5B57\u5316\u8F6C\u578B', { limit: 3 });
  eq(r.length, 1);
  const sn = r[0].snippet;
  eq(text.slice(sn.charStart, sn.charEnd), sn.text, 'snippet slice invariant');
  ok(sn.text.indexOf('\u6570\u5B57\u5316') >= 0, 'snippet contains the bigram hit');
  ok(sn.text.length <= 180, 'snippet respects max length');
  eq(sn.page, 1, 'page defaults to 1 without chunks');
});

/* ============================================================
   3. RRF 手算对拍
   k=60：1/61=0.01639344262295082, 1/62=0.01612903225806452, 1/63=0.01587301587301587
   a = 1/61 + 1/63 = 0.03226645849596670
   b = 1/62 + 1/61 = 0.03252247488101534
   c = 1/63 + 1/62 = 0.03200204813108039  => b > a > c
   ============================================================ */
check('rrf: hand-computed scores and order', () => {
  const { win } = fresh(['bm25.js']);
  const rrf = win.ZY.bm25.rrf;
  const r = rrf([['a', 'b', 'c'], ['b', 'c', 'a']], 60);
  deepEq(r.map(x => x.id), ['b', 'a', 'c'], 'order b > a > c');
  near(r[0].score, 0.03252247488101534, 1e-15, 'b score');
  near(r[1].score, 0.03226645849596670, 1e-15, 'a score');
  near(r[2].score, 0.03200204813108039, 1e-15, 'c score');
  near(r[0].score, 1 / 62 + 1 / 61, 1e-15, 'b closed form');
  near(r[1].score, 1 / 61 + 1 / 63, 1e-15, 'a closed form');
  near(r[2].score, 1 / 63 + 1 / 62, 1e-15, 'c closed form');
  /* 默认 k=60 */
  const rDefault = rrf([['a', 'b', 'c'], ['b', 'c', 'a']]);
  near(rDefault[0].score, r[0].score, 1e-15, 'default k is 60');
});

check('rrf: k override, score-agnostic, dedupe, deterministic ties', () => {
  const { win } = fresh(['bm25.js']);
  const rrf = win.ZY.bm25.rrf;
  /* k=1：a=1/2+1/4=0.75, b=1/3+1/2=5/6, c=1/4+1/3=7/12 */
  const r1 = rrf([['a', 'b', 'c'], ['b', 'c', 'a']], 1);
  deepEq(r1.map(x => x.id), ['b', 'a', 'c']);
  near(r1[0].score, 1 / 3 + 1 / 2, 1e-15, 'b k=1 = 5/6');
  near(r1[1].score, 0.75, 1e-15, 'a k=1 = 0.75');
  near(r1[2].score, 7 / 12, 1e-15, 'c k=1 = 7/12');
  /* 输入分数不影响 RRF */
  const withScores = rrf([[{ id: 'a', score: 1000 }, { id: 'b', score: 1 }], [{ id: 'b', score: 0.001 }]], 60);
  const plain = rrf([['a', 'b'], ['b']], 60);
  deepEq(withScores.map(x => ({ id: x.id, score: x.score })), plain.map(x => ({ id: x.id, score: x.score })));
  /* 同一路内重复 id 只取最好名次 */
  const dup = rrf([['a', 'a', 'b']], 60);
  near(dup[0].score, 1 / 61, 1e-15, 'dup keeps best rank');
  near(dup[1].score, 1 / 63, 1e-15, 'b rank 3');
  /* 同分 -> id 升序（确定性） */
  const tie = rrf([['b'], ['a']], 60);
  deepEq(tie.map(x => x.id), ['a', 'b'], 'tie broken by id asc');
  /* 空输入 */
  deepEq(rrf([], 60), []);
  deepEq(rrf([[], []], 60), []);
});

/* ============================================================
   4. 分块 / 字符区间
   ============================================================ */
check('corpus: chunks never cross pages and always slice back to their text', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const C = win.ZY.corpus;
  const mk = (tag, n) => {
    let s = '';
    for (let i = 0; i < n; i++) s += '\u7B2C' + i + '\u53E5' + tag + '\u5185\u5BB9\uFF0C\u7528\u4E8E\u6D4B\u8BD5\u5206\u5757\u4E0E\u5B57\u7B26\u533A\u95F4\u3002';
    return s;
  };
  const p1 = mk('A', 40), p2 = mk('B', 30);
  const doc = C.addDocument({ id: 'c1', title: 'chunk test', pages: [{ pageNo: 1, text: p1 }, { pageNo: 2, text: p2 }] });

  eq(doc.pages.length, 2, 'two pages');
  eq(doc.fullText, p1 + '\n' + p2, 'page separator is a single \\n');
  for (const p of doc.pages) eq(doc.fullText.slice(p.charStart, p.charEnd), p.text, 'page slice invariant');
  eq(doc.pages[0].charStart, 0);
  eq(doc.pages[1].charStart, p1.length + 1, 'page 2 offset');

  ok(doc.chunks.length > 2, 'long pages must be chunked: ' + doc.chunks.length);
  for (const c of doc.chunks) {
    eq(doc.fullText.slice(c.charStart, c.charEnd), c.text, 'chunk slice invariant');
    const page = doc.pages.filter(p => p.pageNo === c.page)[0];
    ok(!!page, 'chunk has a known page');
    ok(c.charStart >= page.charStart && c.charEnd <= page.charEnd, 'chunk must not cross a page boundary');
    ok(c.charEnd > c.charStart, 'non-empty chunk');
    ok(c.text.length <= 400 + 80, 'chunk length bounded (target+minChunk tail merge)');
  }
  /* 覆盖率：每页首块从页首开始、末块到页尾结束；相邻块重叠且前进 */
  for (const page of doc.pages) {
    const list = doc.chunks.filter(c => c.page === page.pageNo);
    eq(list[0].charStart, page.charStart, 'first chunk starts at page start');
    eq(list[list.length - 1].charEnd, page.charEnd, 'last chunk ends at page end');
    for (let i = 1; i < list.length; i++) {
      ok(list[i].charStart <= list[i - 1].charEnd, 'adjacent chunks overlap or touch (no gap)');
      ok(list[i].charStart > list[i - 1].charStart, 'chunks advance');
    }
  }
});

check('corpus: chunkText boundary rule is hand-checked on a periodic text', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const C = win.ZY.corpus;
  /* '0123456789。' 每 11 字符一个句末标点：'。' 位于 10,21,32,43,54,...
     size=50 -> hard=50，回看区间 [30,49] 内最后一个 '。' 在 43 -> 第一块 = [0,44] */
  const text = '0123456789\u3002'.repeat(20);   // 220 chars
  const ranges = C.chunkText(text, 50, 10, 5);
  deepEq(ranges[0], { start: 0, end: 44 }, 'first chunk snaps to sentence end');
  eq(ranges[ranges.length - 1].end, text.length, 'last chunk reaches the end');
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    ok(r.end > r.start, 'non-empty range');
    if (r.end < text.length) eq(text.charAt(r.end - 1), '\u3002', 'range ends right after a sentence period');
    if (i > 0) {
      ok(r.start <= ranges[i - 1].end, 'no gap');
      ok(r.start > ranges[i - 1].start, 'progress');
      ok(ranges[i - 1].end - r.start <= 10, 'overlap bounded by opts.chunkOverlap');
    }
  }
  /* 短文本单块 */
  deepEq(C.chunkText('short text', 400, 80, 80), [{ start: 0, end: 10 }]);
  deepEq(C.chunkText('', 400, 80, 80), []);
  /* overlap >= size 时仍必须前进（防死循环） */
  const tight = C.chunkText('abcdefghijklmnopqrstuvwxyz', 10, 100, 1);
  ok(tight.length > 0 && tight[tight.length - 1].end === 26, 'forward progress with huge overlap');
});

/* ============================================================
   5. 检索出处不变量（产品核心承诺）
   ============================================================ */
check('corpus: sample library ingests with locatable quotes (22 docs, no blanks)', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const lib = loadLibrary(win);
  const C = win.ZY.corpus;
  const n = C.addSampleLibrary(lib);
  eq(n, 22, '22 sample documents');
  eq(C.stats().docs, 22);
  ok(C.stats().chunks >= 22, 'at least one chunk per doc: ' + C.stats().chunks);
  ok(C.stats().tokens > 0, 'token count positive');
  ok(C.stats().avgChunksPerDoc >= 1, 'avg chunks >= 1');

  for (const src of lib) {
    const doc = C.getDoc(src.id);
    ok(!!doc, 'doc ingested: ' + src.id);
    eq(doc.quoteFound, true, 'declared quote locatable in synthesized text: ' + src.id);
    ok(!!doc.quoteRange, 'quote range present');
    eq(doc.fullText.slice(doc.quoteRange[0], doc.quoteRange[1]), src.quote, 'declared quote round-trip: ' + src.id);
    const d = C.diag(src.id);
    ok(!!d, 'diag present: ' + src.id);
    for (const k of ['pages', 'chars', 'avgCharsPerPage', 'coverage', 'mojibakeRate', 'scanned', 'twoColRisk']) {
      has(d, k, 'diag field ' + k + ' for ' + src.id);
      ok(d[k] !== null && d[k] !== undefined, 'diag field not blank: ' + k + ' @' + src.id);
    }
    ok(typeof d.coverage === 'number' && d.coverage >= 0 && d.coverage <= 1, 'coverage in [0,1] @' + src.id);
    ok(typeof d.mojibakeRate === 'number' && d.mojibakeRate >= 0 && d.mojibakeRate <= 1, 'mojibake in [0,1] @' + src.id);
    ok(typeof d.scanned === 'boolean', 'scanned boolean @' + src.id);
    ok(d.pages === doc.pages.length, 'diag.pages matches pages @' + src.id);
    ok(d.chars === doc.fullText.length, 'diag.chars matches fullText @' + src.id);
    /* 声明值必须被承认，且标注来源为 declared */
    ok(d.declared != null, 'declared quality kept @' + src.id);
    eq(d.sources.coverage, 'declared', 'coverage source @' + src.id);
    eq(d.effective.coverage, src.coverage, 'effective coverage uses declared value @' + src.id);
    eq(d.computed.scanned, false, 'computed scanned (text exists) @' + src.id);
  }
  /* 声明与计算确实是两个不同的量（证明我们既没伪造、也没忽略计算） */
  const d01 = C.diag('d01');
  eq(d01.effective.coverage, 0.982, 'd01 declared coverage');
  ok(Math.abs(d01.computed.coverage - 0.982) > 0.1, 'computed coverage is a real, different measurement');
  /* 扫描件样例：声明 scanned=true 必须生效并被判低质量 */
  const d10 = C.diag('d10');
  eq(d10.effective.scanned, true, 'd10 declared scanned');
  eq(d10.sources.scanned, 'declared');
  eq(d10.quality, 'low', 'd10 is low quality');
  eq(C.getDoc('d10').lowQuality, true);
});

check('corpus: charRange slice === quote for every hit of several queries', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const lib = loadLibrary(win);
  const C = win.ZY.corpus;
  C.addSampleLibrary(lib);
  const byId = {};
  for (const x of lib) byId[x.id] = x;

  const queries = [
    '\u6570\u5B57\u5316\u8F6C\u578B',
    '\u521B\u65B0 \u7EE9\u6548',
    '\u5168\u8981\u7D20\u751F\u4EA7\u7387',
    '\u9AD8\u94C1\u5F00\u901A',
    '\u878D\u8D44\u7EA6\u675F',
    '\u6570\u5B57\u91D1\u878D',
    '\u9762\u677F\u6570\u636E',
    '\u626B\u63CF\u4EF6',
    '\u4E13\u5229\u8D28\u91CF',
    '\u653F\u5E9C\u8865\u8D34'
  ];
  let totalHits = 0, overlapChecked = 0;
  for (const q of queries) {
    const res = C.search(q, { limit: 6 });
    ok(res.length > 0, 'query returns hits: ' + ascii(q));
    for (const r of res) {
      totalHits++;
      const doc = C.getDoc(r.docId);
      ok(!!doc, 'doc exists for hit');
      /* —— 最重要的一条：charRange 切原文必须等于 quote —— */
      eq(doc.fullText.slice(r.charRange[0], r.charRange[1]), r.quote, 'INVARIANT charRange->quote @' + r.docId);
      eq(C.verify(r.docId, r.charRange, r.quote).ok, true, 'corpus.verify agrees @' + r.docId);
      ok(r.charRange[0] >= 0 && r.charRange[1] <= doc.fullText.length, 'range in bounds');
      ok(r.charRange[1] > r.charRange[0], 'non-empty range');
      ok(r.quote.length > 0 && r.quote.length <= 180, 'quote length bounded: ' + r.quote.length);
      eq(r.snippetMismatch, false, 'no snippet/quote mismatch');
      eq(r.page, pageOf(doc, r.charRange[0]), 'page owns the range @' + r.docId);
      ok(r.matchedTerms.length > 0, 'matched terms recorded @' + r.docId);
      /* body 命中时，引用片段里必须真的出现命中词（不是凭空给的窗口） */
      if (r.bm25Score != null) {
        ok(r.matchedTerms.some(t => r.quote.indexOf(t) >= 0), 'quote contains a body-matched term @' + r.docId);
      }
      /* 与「样例库声明的原句区间」交叉核对：两套独立算出的偏移量在重叠处必须一致 */
      const qr = doc.quoteRange;
      ok(!!qr, 'declared excerpt range located @' + r.docId);
      if (r.charRange[0] < qr[1] && qr[0] < r.charRange[1]) {
        const a = Math.max(qr[0], r.charRange[0]), b = Math.min(qr[1], r.charRange[1]);
        eq(doc.fullText.slice(a, b), r.quote.slice(a - r.charRange[0], b - r.charRange[0]),
          'overlap with the declared excerpt agrees @' + r.docId);
        overlapChecked++;
      }
    }
  }
  ok(totalHits >= 20, 'enough hits exercised: ' + totalHits);
  ok(overlapChecked >= 1, 'at least one hit overlaps the declared excerpt: ' + overlapChecked);
});

check('corpus: a query matched inside the declared excerpt returns that excerpt', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const lib = loadLibrary(win);
  const C = win.ZY.corpus;
  C.addSampleLibrary(lib);
  const byId = {};
  for (const x of lib) byId[x.id] = x;
  /* 这些短语只出现在样例库声明的原句摘录里 —— 命中窗口必须把整句原句包进来，
     否则「引用可核验」在用户眼里就是半句话 */
  const cases = [
    { q: '\u5236\u9020\u4E1A\u4E0E\u9AD8\u6280\u672F\u884C\u4E1A', id: 'd01' },
    { q: '\u5916\u89C2\u8BBE\u8BA1\u4E13\u5229', id: 'd05' },
    { q: '\u5E7F\u5E26\u4E2D\u56FD\u8BD5\u70B9', id: 'd21' }
  ];
  for (const c of cases) {
    const res = C.search(c.q, { limit: 5 });
    ok(res.length > 0, 'hit for ' + ascii(c.q));
    const hit = res.filter(x => x.docId === c.id)[0];
    ok(!!hit, 'expected doc ' + c.id + ' among hits for ' + ascii(c.q));
    const declared = byId[c.id].quote;
    ok(hit.quote.indexOf(declared) >= 0,
      'citation window contains the full declared excerpt @' + c.id + ' :: ' + ascii(hit.quote));
    eq(C.getDoc(c.id).fullText.slice(hit.charRange[0], hit.charRange[1]), hit.quote, 'invariant holds');
  }
});

check('corpus: verify() is a real check (negative control fails)', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const C = win.ZY.corpus;
  C.addSampleLibrary(loadLibrary(win));
  const res = C.search('\u6570\u5B57\u5316\u8F6C\u578B', { limit: 3 });
  ok(res.length > 0);
  const r = res[0];
  eq(C.verify(r.docId, r.charRange, r.quote).ok, true, 'honest citation passes');
  eq(C.verify(r.docId, r.charRange, r.quote + 'X').ok, false, 'tampered quote must fail');
  eq(C.verify(r.docId, [r.charRange[0], r.charRange[1] - 1], r.quote).ok, false, 'shortened range must fail');
  eq(C.verify('nope', r.charRange, r.quote).ok, false, 'unknown doc must fail');
  eq(C.verify(r.docId, null, r.quote).ok, false, 'bad range must fail');
});

check('corpus: low quality docs are flagged and down-weighted', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const C = win.ZY.corpus;
  C.addSampleLibrary(loadLibrary(win));
  const all = C.search('\u6570\u5B57\u5316\u8F6C\u578B', { limit: 30 });
  const low = all.filter(r => r.docId === 'd10');
  eq(low.length, 1, 'scanned sample appears for this query');
  eq(low[0].lowQuality, true, 'flagged lowQuality');
  eq(low[0].trust, 'low', 'trust preserved');
  near(low[0].score, low[0].rawScore * 0.6, 1e-12, 'score discounted by 0.6');
  const high = all.filter(r => !r.lowQuality)[0];
  ok(!!high, 'at least one high quality hit');
  near(high.score, high.rawScore, 1e-12, 'no discount for clean docs');
  const filtered = C.search('\u6570\u5B57\u5316\u8F6C\u578B', { limit: 30, includeLowQuality: false });
  eq(filtered.filter(r => r.lowQuality).length, 0, 'filtering removes low quality docs');
  ok(filtered.length > 0, 'filtering keeps the rest');
});

check('corpus: the unique owner of a phrase ranks first (RRF relevance regression)', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const C = win.ZY.corpus;
  C.addSampleLibrary(loadLibrary(win));
  /* 回归用例：'宽带中国试点' 只出现在 d21 声明的原句里。
     若第二路是「纯 meta BM25」，d21 会掉到第 9 名（用户看不见）：
     RRF 只看名次，「两路都沾一点」的 d19 反而更高。 */
  const res = C.search('\u5BBD\u5E26\u4E2D\u56FD\u8BD5\u70B9', { limit: 5 });
  ok(res.length > 0, 'hits exist');
  eq(res[0].docId, 'd21', 'the only doc that covers the phrase must rank first');
  eq(res[0].coverageRank, 1, 'coverage route also puts it first');
  ok(res[0].coverageScore > 0, 'coverage score forwarded');
  for (let i = 1; i < res.length; i++) {
    ok(res[i].coverageScore <= res[i - 1].coverageScore + 1e-12, 'coverage scores non-increasing');
  }
  const doc = C.getDoc('d21');
  eq(doc.fullText.slice(res[0].charRange[0], res[0].charRange[1]), res[0].quote, 'citation invariant intact');
});

check('corpus: plain text becomes ONE page, not one page per newline', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const C = win.ZY.corpus;
  const doc = C.addDocument({ id: 'multi', title: 't', text: 'line one\nline two\nline three' });
  eq(doc.pages.length, 1, '\\n is not a page separator');
  eq(doc.pages[0].text, 'line one\nline two\nline three');
  eq(doc.fullText, 'line one\nline two\nline three', 'single page -> fullText is the text itself');
  eq(C.search('line', { limit: 3 })[0].page, 1, 'citation page is 1');
  /* \f 才是分页符 */
  const doc2 = C.addDocument({ id: 'paged', title: 'p2', text: 'page one\nstill one\fpage two' });
  eq(doc2.pages.length, 2, '\\f splits pages');
  eq(doc2.pages[1].pageNo, 2);
  eq(doc2.fullText, 'page one\nstill one\npage two');
  const hit = C.search('page two', { limit: 3 });
  ok(hit.length > 0, 'hit found');
  eq(hit[0].docId, 'paged');
  eq(hit[0].page, 2, 'citation page follows the real page split');
  eq(doc2.fullText.slice(hit[0].charRange[0], hit[0].charRange[1]), hit[0].quote, 'invariant across pages');
});

check('corpus: stats() numbers are self-consistent before any search', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const C = win.ZY.corpus;
  C.addSampleLibrary(loadLibrary(win));
  const s = C.stats();
  eq(s.docs, 22);
  ok(s.chunks >= 22, 'chunks: ' + s.chunks);
  ok(s.tokens > 500, 'tokens: ' + s.tokens);
  ok(s.uniqueTerms > 100, 'uniqueTerms must be computed (lazily-built index): ' + s.uniqueTerms);
  eq(s.indexed, true, 'stats() ensures the index');
  near(s.avgChunksPerDoc, s.chunks / s.docs, 1e-9, 'avg is consistent');
  eq(s.pages, 22, 'each sample doc is a single text page');
});

check('corpus: scanned sample still surfaces when its exact phrase is queried', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const C = win.ZY.corpus;
  C.addSampleLibrary(loadLibrary(win));
  const res = C.search('\u626B\u63CF\u4EF6', { limit: 5 });
  eq(res.length, 1, 'only the scanned sample matches the bigram pair');
  eq(res[0].docId, 'd10');
  eq(res[0].lowQuality, true, 'still flagged low quality');
  ok(res[0].score < res[0].rawScore, 'still down-weighted');
  eq(C.getDoc('d10').fullText.slice(res[0].charRange[0], res[0].charRange[1]), res[0].quote, 'invariant');
});

check('corpus: rare phrase ranks its only owner first', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const C = win.ZY.corpus;
  C.addSampleLibrary(loadLibrary(win));
  const a = C.search('\u5168\u8981\u7D20\u751F\u4EA7\u7387', { limit: 5 });
  eq(a[0].docId, 'd11', 'only d11 mentions TFP in Chinese');
  const b = C.search('\u9AD8\u94C1', { limit: 5 });
  eq(b[0].docId, 'd08', 'only d08 is about high-speed rail');
  const c = C.search('rdd', { limit: 5 });
  eq(c[0].docId, 'd08', 'RDD method keyword routes to d08');
});

/* ============================================================
   6. 质量诊断（构造样本，手算）
   ============================================================ */
check('diagnose: scanned sample (pages exist, no text layer)', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const pt = win.ZY.pdftext;
  const d = pt.diagnose([{ pageNo: 1, text: '' }, { pageNo: 2, text: '   \n  ' }]);
  eq(d.pages, 2);
  eq(d.scanned, true);
  eq(d.noTextLayer, true, 'zero non-space chars -> no text layer at all');
  eq(d.textPages, 0);
  eq(d.textPageRatio, 0);
  eq(d.coverage, 0);
  eq(d.avgCharsPerPage, 0);
  eq(d.mojibakeChars, 0);
  eq(d.mojibakeRate, 0);
  deepEq(d.emptyPages, [1, 2]);
  eq(d.quality, 'low');
  eq(d.twoColRisk, 'unknown', 'no geometry -> unknown, not a fake none');
  eq(pt.qualityOf(d, 'high'), 'low', 'scanned always low');
});

check('diagnose: mojibake counting is hand-computed (and does not over-flag accents)', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const pt = win.ZY.pdftext;
  /* 'abc' + U+FFFD U+FFFD + 'de' + 锟斤拷 + 'f'  -> 非空白 11 字符，乱码 5 个 */
  const t1 = 'abc\uFFFD\uFFFDde\u9535\u65A4\u62F7f';
  const m1 = pt.mojibakeStats(t1);
  eq(m1.nonSpace, 11, 'non-space count');
  eq(m1.count, 5, 'marked count');
  near(m1.rate, 5 / 11, 1e-15, 'rate');
  /* 'a' + â€ + 'b' -> 非空白 4，乱码 2 */
  const m2 = pt.mojibakeStats('a\u00E2\u20ACb');
  eq(m2.nonSpace, 4);
  eq(m2.count, 2);
  near(m2.rate, 0.5, 1e-15);
  /* 正常重音文本不得误报 */
  const m3 = pt.mojibakeStats('caf\u00E9 r\u00E9sum\u00E9 M\u00FCller Bj\u00F6rk');
  eq(m3.count, 0, 'legit accented latin text must not be flagged');
  const d = pt.diagnose([{ pageNo: 1, text: t1 }]);
  eq(d.mojibakeChars, 5);
  eq(d.mojibakeRate, 0.454545, 'round to 6 decimals');
  eq(d.quality, 'low', 'mojibake above 5% -> low');
});

check('diagnose: coverage / avgCharsPerPage hand-computed against the 900-char target', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const pt = win.ZY.pdftext;
  const d450 = pt.diagnose([{ pageNo: 1, text: '\u6570'.repeat(450) }]);
  eq(d450.nonSpaceChars, 450);
  eq(d450.avgCharsPerPage, 450);
  eq(d450.coverage, 0.5, '450/900');
  eq(d450.quality, 'low', 'coverage 0.5 < 0.70');
  const d900 = pt.diagnose([{ pageNo: 1, text: '\u6570'.repeat(900) }]);
  eq(d900.coverage, 1, '900/900 clamped');
  eq(d900.quality, 'high');
  const d1800 = pt.diagnose([{ pageNo: 1, text: '\u6570'.repeat(1800) }]);
  eq(d1800.coverage, 1, 'clamped at 1');
  const d810 = pt.diagnose([{ pageNo: 1, text: '\u6570'.repeat(810) }]);
  eq(d810.coverage, 0.9, '810/900 = 0.9 boundary -> high');
  eq(d810.quality, 'high', '>=0.90 is high');
  const d800 = pt.diagnose([{ pageNo: 1, text: '\u6570'.repeat(800) }]);
  near(d800.coverage, 0.8889, 1e-4, '800/900');
  eq(d800.quality, 'medium', 'between 0.70 and 0.90 is medium');
});

check('diagnose: qualityOf threshold table', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const q = win.ZY.pdftext.qualityOf;
  eq(q({ coverage: 0.95, mojibakeRate: 0, scanned: false, twoColRisk: 'none' }), 'high');
  eq(q({ coverage: 0.90, mojibakeRate: 0.01, scanned: false, twoColRisk: 'none' }), 'high');
  eq(q({ coverage: 0.85, mojibakeRate: 0, scanned: false, twoColRisk: 'none' }), 'medium');
  eq(q({ coverage: 0.95, mojibakeRate: 0.02, scanned: false, twoColRisk: 'none' }), 'medium');
  eq(q({ coverage: 0.95, mojibakeRate: 0, scanned: false, twoColRisk: 'high' }), 'medium');
  eq(q({ coverage: 0.60, mojibakeRate: 0, scanned: false, twoColRisk: 'none' }), 'low');
  eq(q({ coverage: 0.95, mojibakeRate: 0.06, scanned: false, twoColRisk: 'none' }), 'low');
  eq(q({ coverage: 0.95, mojibakeRate: 0, scanned: true, twoColRisk: 'none' }), 'low');
  eq(q({ coverage: 0.95, mojibakeRate: 0, scanned: false, twoColRisk: 'none' }, 'low'), 'low', 'trust low forces low');
});

check('twoColRisk: geometry heuristic (hand-built layouts)', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const pt = win.ZY.pdftext;
  function twoColLine(y) {
    return [
      { x: 50, y: y, w: 200, str: 'A'.repeat(20) },
      { x: 260, y: y, w: 30, str: 'B'.repeat(3) },
      { x: 330, y: y, w: 200, str: 'C'.repeat(20) },
      { x: 540, y: y, w: 30, str: 'D'.repeat(3) }
    ];
  }
  function oneColLine(y) {
    return [
      { x: 50, y: y, w: 80, str: 'A'.repeat(10) },
      { x: 150, y: y, w: 80, str: 'B'.repeat(10) },
      { x: 250, y: y, w: 80, str: 'C'.repeat(10) },
      { x: 350, y: y, w: 80, str: 'D'.repeat(10) }
    ];
  }
  let two = [];
  for (let i = 0; i < 10; i++) two = two.concat(twoColLine(700 - i * 20));
  const r1 = pt.twoColRisk(two, 600);
  eq(r1.level, 'high', 'all lines two-column');
  eq(r1.twoColLines, 10);
  eq(r1.qualifyLines, 10);
  eq(r1.ratio, 1);
  eq(r1.basis, 'geometry');

  let one = [];
  for (let i = 0; i < 10; i++) one = one.concat(oneColLine(700 - i * 20));
  eq(pt.twoColRisk(one, 600).level, 'none', 'single column');

  let mixed = [];
  for (let i = 0; i < 6; i++) mixed = mixed.concat(twoColLine(700 - i * 20));
  for (let i = 0; i < 4; i++) mixed = mixed.concat(oneColLine(500 - i * 20));
  const r3 = pt.twoColRisk(mixed, 600);
  eq(r3.qualifyLines, 10);
  eq(r3.twoColLines, 6);
  near(r3.ratio, 0.6, 1e-15, '6/10');
  eq(r3.level, 'high', 'ratio 0.6 hits the high threshold');

  /* 少于 4 个 item 的行不参与判断；没有几何信息 -> unknown */
  const shortLines = [];
  for (let i = 0; i < 5; i++) shortLines.push({ x: 50, y: 700 - i * 20, w: 100, str: 'x' });
  const r4 = pt.twoColRisk(shortLines, 600);
  eq(r4.qualifyLines, 0);
  eq(r4.level, 'none');
  eq(pt.twoColRisk([], 600).level, 'unknown');
  eq(pt.twoColRisk(two, 0).level, 'unknown');
  eq(pt.twoColRisk(two, null).basis, 'no-geometry');
});

/* ============================================================
   7. PDF 引擎不可用 / 降级
   ============================================================ */
acheck('pdftext: loadEngine() degrades gracefully offline (no throw, explicit reason)', async () => {
  const { win } = fresh(['pdftext.js']);      // 无 document / fetch / timer 之外的宿主能力
  const pt = win.ZY.pdftext;
  const st = await pt.loadEngine();
  eq(st.ok, false, 'ok=false offline');
  eq(st.source, 'unavailable', 'source=unavailable');
  eq(st.engine, null);
  ok(typeof st.message === 'string' && st.message.length > 20, 'message is explicit');
  ok(st.message.indexOf('\u79BB\u7EBF') >= 0, 'message mentions offline (离线)');
  ok(st.message.indexOf('pdf.js') >= 0, 'message names pdf.js');
  ok(Array.isArray(st.attempts) && st.attempts.length >= 4, 'attempt log kept: ' + (st.attempts || []).length);
  eq(pt.hasEngine(), false, 'no engine cached');
  /* 二次调用同样安全 */
  const st2 = await pt.loadEngine({ force: true });
  eq(st2.ok, false);
  /* 注入式：可用 */
  const injected = { getDocument: function () { throw new Error('never called'); } };
  const st3 = await pt.loadEngine({ inject: injected, force: true });
  eq(st3.ok, true);
  eq(st3.source, 'local', 'injected engine is a local source (documented extension of the union)');
  eq(st3.via, 'injected');
  eq(pt.hasEngine(), true);
  pt.reset();
  eq(pt.hasEngine(), false);
});

acheck('pdftext: extract() on non-PDF bytes fails clearly and never throws', async () => {
  const { win } = fresh(['pdftext.js']);
  const pt = win.ZY.pdftext;
  const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const res = await pt.extract(junk);
  eq(res.ok, false);
  eq(res.engine, 'builtin', 'fallback parser was used for the diagnosis');
  deepEq(res.pages, []);
  eq(res.fullText, '');
  eq(res.diag.pages, 0);
  ok(res.message.indexOf('PDF') >= 0, 'message explains it is not a PDF');
  /* fallback 关闭时直接给出引擎原因 */
  const res2 = await pt.extract(junk, { fallback: false });
  eq(res2.ok, false);
  eq(res2.engine, 'none');
  ok(res2.message.indexOf('\u79BB\u7EBF') >= 0, 'message mentions the offline engine problem');
  /* 空输入 */
  const res3 = await pt.extract(new Uint8Array(0));
  eq(res3.ok, false);
  const res4 = await pt.extract(null);
  eq(res4.ok, false);
  ok(res4.message.indexOf('\u7A7A') >= 0, 'empty input explained');
});

/* ============================================================
   8. 手写最小合法 PDF：真实抽取（内置降级解析器）
   ============================================================ */
acheck('pdf: hand-built minimal PDF is structurally legal (independent validator)', () => {
  const ascii = pdfAsciiHello();
  const bytes = latin1ToBytes(ascii);
  const v = validatePdfStructure(bytes);
  ok(v.ok, 'validator problems: ' + j(v.problems));
  const cn = pdfChinese();
  const v2 = validatePdfStructure(latin1ToBytes(cn));
  ok(v2.ok, 'chinese pdf problems: ' + j(v2.problems));
  const fl = pdfChinese({ encode: 'flate' });
  const v3 = validatePdfStructure(latin1ToBytes(fl));
  ok(v3.ok, 'flate pdf problems: ' + j(v3.problems));
});

acheck('pdf: ASCII text extracted from hand-built PDF via xref path', async () => {
  const { win } = fresh(['pdftext.js']);
  const pt = win.ZY.pdftext;
  const res = await pt.extract(latin1ToBytes(pdfAsciiHello()));
  eq(res.ok, true, res.message);
  eq(res.engine, 'builtin', 'pdf.js unavailable offline -> builtin');
  eq(res.parse.via, 'xref', 'parsed through the real cross-reference table');
  eq(res.parse.xref, true);
  eq(res.parse.objects, 5, 'five objects were loaded from xref');
  deepEq(res.parse.unsupported, [], 'no unsupported filters');
  eq(res.pages.length, 1);
  eq(res.pages[0].pageNo, 1);
  eq(res.pages[0].text, 'Hello, retrieval!', 'exact text round-trip');
  eq(res.pages[0].chars, 17, 'chars = text length');
  eq(res.fullText, 'Hello, retrieval!');
  eq(res.pages[0].charStart, 0);
  eq(res.pages[0].charEnd, 17);
  eq(res.diag.chars, 17);
  eq(res.diag.nonSpaceChars, 16, 'the string contains one space');
  eq(res.diag.pages, 1);
  eq(res.diag.scanned, false, 'a short but real text page must NOT be labeled scanned');
  eq(res.diag.textPageRatio, 0, '16 non-space chars < minPageChars(20) -> no page counts as a text page');
  eq(res.diag.emptyPages.length, 1, 'the page is listed as thin/empty for the finer signal');
  eq(res.diag.mojibakeChars, 0);
  near(res.diag.coverage, 16 / 900, 1e-4, '16 non-space chars over a 900-char page target');
  eq(res.diag.quality, 'low', 'a 17-char page really is low coverage (thresholds are honest)');
  eq(res.engineStatus.ok, false, 'engine status attached: pdf.js was unavailable');
});

acheck('pdf: Chinese Type0/Identity-H + ToUnicode (bfchar and bfrange)', async () => {
  const { win } = fresh(['pdftext.js']);
  const pt = win.ZY.pdftext;
  const res = await pt.extract(latin1ToBytes(pdfChinese()));
  eq(res.ok, true, res.message);
  eq(res.engine, 'builtin');
  eq(res.parse.via, 'xref');
  eq(res.parse.missingToUnicode, 0);
  eq(res.pages[0].text, '\u4F60\u597D\n\u4E00\u4E01\u4E02', 'Chinese decoded via ToUnicode (bfchar + bfrange)');
  eq(res.diag.mojibakeChars, 0, 'no replacement chars');
  eq(res.diag.mojibakeRate, 0);
  /* 没有 ToUnicode 的同类 PDF：必须诚实产出 U+FFFD，并被判低质量 */
  const res2 = await pt.extract(latin1ToBytes(pdfChinese({ noToUnicode: true, content: 'BT /F1 12 Tf 72 720 Td <4F60597D> Tj ET' })));
  eq(res2.ok, true, res2.message);
  eq(res2.pages[0].text, '\uFFFD\uFFFD', 'unmapped CIDs become replacement chars');
  eq(res2.diag.mojibakeChars, 2);
  eq(res2.diag.mojibakeRate, 1);
  eq(res2.diag.quality, 'low');
  eq(res2.parse.missingToUnicode, 1);
  ok(res2.warnings.join('|').indexOf('ToUnicode') >= 0, 'warning names the missing ToUnicode CMap');
});

acheck('pdf: FlateDecode content stream is inflated', async () => {
  const { win } = fresh(['pdftext.js'], { DecompressionStream: DecompressionStream, Blob: Blob, Response: Response });
  const pt = win.ZY.pdftext;
  const res = await pt.extract(latin1ToBytes(pdfChinese({ encode: 'flate' })));
  eq(res.ok, true, res.message);
  eq(res.pages[0].text, '\u4F60\u597D\n\u4E00\u4E01\u4E02', 'flate-decoded content');
  ok(res.parse.filters.indexOf('FlateDecode') >= 0, 'filter recorded');
  deepEq(res.parse.unsupported, [], 'flate is supported');
});

acheck('pdf: empty page -> scanned; image-only filter -> unsupported + needsEngine', async () => {
  const { win } = fresh(['pdftext.js']);
  const pt = win.ZY.pdftext;
  const empty = await pt.extract(latin1ToBytes(pdfEmptyPage()));
  eq(empty.ok, true, empty.message);
  eq(empty.pages[0].text, '');
  eq(empty.diag.scanned, true, 'page exists but has no text layer');
  eq(empty.diag.coverage, 0);
  eq(empty.diag.quality, 'low');
  ok(empty.warnings.join('|').indexOf('OCR') >= 0, 'warning says OCR is not done');

  const img = await pt.extract(latin1ToBytes(pdfImageOnlyPage()));
  eq(img.ok, true, 'object structure is fine; the filter is not');
  eq(img.pages[0].text, '', 'DCTDecode stream cannot be decoded');
  ok(img.parse.unsupported.indexOf('DCTDecode') >= 0, 'unsupported filter recorded');
  eq(img.diag.needsEngine, true, 'flags that pdf.js is required');
  ok(img.warnings.join('|').indexOf('DCTDecode') >= 0);
});

acheck('pdf: broken startxref falls back to object scan and still extracts', async () => {
  const { win } = fresh(['pdftext.js']);
  const pt = win.ZY.pdftext;
  const res = await pt.extract(latin1ToBytes(pdfAsciiHello().replace('startxref\n', 'startxref\n').replace(/\n(\d+)\n%%EOF/, '\n999999\n%%EOF')));
  eq(res.ok, true, res.message);
  eq(res.parse.via, 'scan', 'fell back to brute-force object scan');
  eq(res.pages[0].text, 'Hello, retrieval!', 'text still extracted');
});

acheck('pdf: encrypted and headerless inputs are refused with explicit reasons', async () => {
  const { win } = fresh(['pdftext.js']);
  const pt = win.ZY.pdftext;
  const enc = await pt.extract(latin1ToBytes(pdfEncrypted()));
  eq(enc.ok, false);
  ok(enc.message.indexOf('\u52A0\u5BC6') >= 0, 'says encrypted');
  const broken = await pt.extract(latin1ToBytes('%PDF-1.4\ngarbage garbage\n%%EOF\n'));
  eq(broken.ok, false);
  ok(broken.message.length > 10, 'explains the failure');
  ok(broken.message.indexOf('\u9875\u9762') >= 0 || broken.message.indexOf('PDF') >= 0, 'mentions pages/PDF');
});

acheck('pdf: extracted PDF text feeds corpus with a verifiable citation', async () => {
  const { win } = fresh(ALL_SCRIPTS);
  const pt = win.ZY.pdftext, C = win.ZY.corpus;
  const res = await pt.extract(latin1ToBytes(pdfAsciiHello()));
  eq(res.ok, true);
  const doc = C.addDocument({ id: 'pdf-ascii', title: 'Hand-built PDF', journal: 'Test', year: 2025, pages: res.pages, trust: 'high', source: 'pdf' });
  eq(doc.fullText, 'Hello, retrieval!');
  eq(doc.pages.length, 1);
  const hits = C.search('retrieval', { limit: 3 });
  eq(hits.length, 1, 'query hits the ingested PDF');
  const r = hits[0];
  eq(r.docId, 'pdf-ascii');
  eq(doc.fullText.slice(r.charRange[0], r.charRange[1]), r.quote, 'INVARIANT for PDF-sourced doc');
  ok(r.quote.indexOf('retrieval') >= 0, 'quote contains the query term');
  eq(C.verify(r.docId, r.charRange, r.quote).ok, true);
  eq(r.page, 1);
});

/* ============================================================
   9. 运行时加载（模拟 CDN）+ pdf.js 适配器管线
   ============================================================ */
async function withFakeEngine(pages, extraOpts) {
  const { win, ctx } = fresh(ALL_SCRIPTS);
  const host = fakeHost(win, ctx, fakePdfjsScript(pages), extraOpts || {});
  const st = await win.ZY.pdftext.loadEngine({ host: host });
  return { win, ctx, host, st };
}

acheck('loader: simulates a CDN script load and records the route', async () => {
  const { win, host, st } = await withFakeEngine([[[{ str: 'x', x: 0, y: 0, w: 10 }]]]);
  eq(st.ok, true, st.message);
  eq(st.source, 'cdn', 'loaded at runtime -> cdn');
  eq(st.via, 'cdn-umd', 'UMD script route');
  ok(st.message.indexOf('pdfjs-dist') >= 0, 'message names the URL');
  ok(host.calls.length >= 1, 'host.injectScript was called');
  ok(host.calls[0].indexOf('pdf.min.js') >= 0, 'first candidate is the pinned UMD build');
  ok(win.pdfjsLib.GlobalWorkerOptions.workerSrc.indexOf('pdf.worker.min.js') >= 0, 'worker configured');
});

acheck('loader: all routes failing yields ok:false with the attempt log', async () => {
  const { win, ctx } = fresh(['pdftext.js']);
  const host = fakeHost(win, ctx, '', { failAll: true });
  const st = await win.ZY.pdftext.loadEngine({ host: host });
  eq(st.ok, false);
  eq(st.source, 'unavailable');
  ok(st.attempts.length >= 6, 'local + UMD + ESM were all tried: ' + st.attempts.length);
  ok(st.message.indexOf('\u79BB\u7EBF') >= 0, 'offline reason reported');
});

acheck('pdfjs adapter: lines, reading order, page offsets, diagnostics', async () => {
  const pages = [
    [
      { str: '\u7B2C\u4E00\u6761\uFF1A\u6570\u5B57\u5316\u8F6C\u578B', x: 50, y: 700, w: 120 },
      { str: '\u63D0\u5347\u4E86\u521B\u65B0\u4EA7\u51FA\u3002', x: 170, y: 700, w: 110 },
      { str: 'Second line words', x: 50, y: 660, w: 150, hasEOL: true }
    ],
    [
      { str: '\u7B2C 2 \u9875', x: 50, y: 700, w: 50 }
    ]
  ];
  const { win } = await withFakeEngine(pages);
  const res = await win.ZY.pdftext.extract(new Uint8Array([1]));
  eq(res.ok, true, res.message);
  eq(res.engine, 'pdfjs', 'pdf.js route used');
  eq(res.pages.length, 2);
  eq(res.pages[0].text, '\u7B2C\u4E00\u6761\uFF1A\u6570\u5B57\u5316\u8F6C\u578B\u63D0\u5347\u4E86\u521B\u65B0\u4EA7\u51FA\u3002\nSecond line words', 'CJK joined without spaces, EOL honored');
  eq(res.pages[1].text, '\u7B2C 2 \u9875');
  eq(res.fullText, res.pages[0].text + '\n' + res.pages[1].text);
  eq(res.pages[0].charStart, 0);
  eq(res.pages[0].charEnd, res.pages[0].text.length);
  eq(res.pages[1].charStart, res.pages[0].text.length + 1, 'page 2 offset accounts for the separator');
  for (const p of res.pages) eq(res.fullText.slice(p.charStart, p.charEnd), p.text, 'page slice invariant');
  eq(res.diag.twoColRisk, 'none', 'short lines are not treated as two-column');
  eq(res.diag.needsEngine, false);
  /* 分块后再核验引用 */
  const C = win.ZY.corpus;
  const doc = C.addDocument({ id: 'pjs1', title: 'PDF', pages: res.pages });
  const hits = C.search('\u6570\u5B57\u5316\u8F6C\u578B', { limit: 3 });
  ok(hits.length === 1, 'hit found');
  eq(doc.fullText.slice(hits[0].charRange[0], hits[0].charRange[1]), hits[0].quote, 'INVARIANT via pdf.js-sourced doc');
  eq(hits[0].page, 1);
});

acheck('pdfjs adapter: two-column geometry is flagged from real item coordinates', async () => {
  const items = [];
  /* 20 行 x 4 item：正文足够长（>810 非空白字符），覆盖率不为 0，
     这样 quality=medium 只可能来自「双栏风险」这一条规则 */
  for (let i = 0; i < 20; i++) {
    const y = 700 - i * 20;
    items.push({ str: 'A'.repeat(20), x: 50, y: y, w: 200 });
    items.push({ str: 'B'.repeat(3), x: 260, y: y, w: 30 });
    items.push({ str: 'C'.repeat(20), x: 330, y: y, w: 200 });
    items.push({ str: 'D'.repeat(3), x: 540, y: y, w: 30, hasEOL: true });
  }
  const { win } = await withFakeEngine([items]);
  const res = await win.ZY.pdftext.extract(new Uint8Array([1]));
  eq(res.ok, true, res.message);
  eq(res.diag.coverage, 1, 'long enough to reach full coverage');
  eq(res.diag.twoColRisk, 'high', 'two-column layout detected from geometry');
  eq(res.diag.twoColBasis, 'geometry');
  eq(res.diag.quality, 'medium', 'only the two-column risk caps quality here');
  ok(res.warnings.join('|').indexOf('\u53CC\u680F') >= 0, 'warning mentions two-column risk');
  /* 每行左右两栏各 2 个 item，行内按 x 排序 => 渲染顺序会跨栏（这正是风险所在） */
  ok(res.pages[0].text.indexOf('A'.repeat(20) + ' ' + 'B'.repeat(3)) === 0, 'line reads left-then-right across the column gap');
});

acheck('pdfjs adapter: engine failure falls back to the builtin parser', async () => {
  const { win, ctx } = fresh(['pdftext.js']);
  const broken = '(function (g) { g.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: function () { throw new Error("boom"); } }; })(window);';
  const host = fakeHost(win, ctx, broken);
  const res = await win.ZY.pdftext.extract(latin1ToBytes(pdfAsciiHello()), { host: host });
  eq(res.ok, true, 'fallback rescued the extraction');
  eq(res.engine, 'builtin');
  eq(res.pages[0].text, 'Hello, retrieval!');
  ok(String(res.engineError).indexOf('boom') >= 0, 'original engine error is preserved');
  /* 禁止降级时必须失败并说明 */
  const strict = await win.ZY.pdftext.extract(latin1ToBytes(pdfAsciiHello()), { host: host, fallback: false });
  eq(strict.ok, false);
  eq(strict.engine, 'pdfjs');
  ok(strict.message.indexOf('boom') >= 0, 'strict mode reports the engine error');
});

acheck('pdftext.extractText: plain text ingestion works offline', async () => {
  const { win } = fresh(ALL_SCRIPTS);
  const pt = win.ZY.pdftext, C = win.ZY.corpus;
  const res = pt.extractText('\u7B2C\u4E00\u9875\uFF1A\u6570\u5B57\u5316\u8F6C\u578B\u6539\u5584\u4E86\u521B\u65B0\u3002\f\u7B2C\u4E8C\u9875\uFF1A\u9AD8\u94C1\u4E0E\u533A\u57DF\u521B\u65B0\u6EA2\u51FA\u3002');
  eq(res.ok, true);
  eq(res.engine, 'plaintext');
  eq(res.pages.length, 2, '\\f splits pages');
  eq(res.pages[1].pageNo, 2);
  const doc = C.addDocument({ id: 'txt1', title: 'notes', pages: res.pages });
  const hits = C.search('\u9AD8\u94C1', { limit: 3 });
  eq(hits.length, 1);
  eq(hits[0].page, 2, 'page number survives chunking');
  eq(doc.fullText.slice(hits[0].charRange[0], hits[0].charRange[1]), hits[0].quote, 'INVARIANT for text-sourced doc');
});

/* ============================================================
   10. 零网络默认可用（端到端）
   ============================================================ */
acheck('offline default: search + citations work with no engine and no network', async () => {
  const { win } = fresh(ALL_SCRIPTS);          // 没有 document / fetch / DecompressionStream / 定时器
  const pt = win.ZY.pdftext, C = win.ZY.corpus;
  const st = await pt.loadEngine();
  eq(st.ok, false, 'engine really is unavailable');
  eq(pt.hasEngine(), false);
  const lib = loadLibrary(win);
  eq(C.addSampleLibrary(lib), 22);
  const res = C.search('\u6570\u5B57\u5316\u8F6C\u578B\u4E0E\u4F01\u4E1A\u521B\u65B0', { limit: 5 });
  ok(res.length > 0, 'search still works offline');
  ok(res[0].lowQuality === false, 'top hit is trustworthy');
  for (const r of res) {
    const doc = C.getDoc(r.docId);
    eq(doc.fullText.slice(r.charRange[0], r.charRange[1]), r.quote, 'offline citation invariant');
    ok(r.page >= 1, 'page number present');
  }
  const s = C.stats();
  eq(s.docs, 22);
  ok(s.chunks >= 22 && s.tokens > 0, 'index built: ' + s.chunks + ' chunks / ' + s.tokens + ' tokens');
  ok(s.avgChunksPerDoc >= 1, 'avg chunks per doc >= 1');
  eq(s.sampleLoaded, true);
});

/* ============================================================
   11. API 形状（签名一致性）
   ============================================================ */
check('api: public surface matches the task-7 signatures', () => {
  const { win } = fresh(ALL_SCRIPTS);
  const pt = win.ZY.pdftext, bm = win.ZY.bm25, C = win.ZY.corpus;
  for (const k of ['loadEngine', 'extract']) has(pt, k, 'pdftext.' + k);
  for (const k of ['tokenize', 'buildIndex', 'search', 'rrf']) has(bm, k, 'bm25.' + k);
  for (const k of ['addDocument', 'addSampleLibrary', 'search', 'stats', 'diag']) has(C, k, 'corpus.' + k);
  eq(typeof pt.loadEngine, 'function');
  eq(bm.tokenize.length, 1, 'tokenize(text)');
  eq(bm.buildIndex.length >= 1, true, 'buildIndex(docs[, opts])');
  eq(bm.search.length, 3, 'search(index, query, opts)');
  eq(bm.rrf.length, 2, 'rrf(rankings, k)');
  eq(C.addDocument.length, 2, 'addDocument(doc, opts)');
  eq(C.addSampleLibrary.length, 1, 'addSampleLibrary(array)');
  eq(C.search.length, 2, 'search(query, opts)');
  eq(C.stats.length, 0, 'stats()');
  eq(C.diag.length, 1, 'diag(docId)');
  /* 结果字段 */
  C.addSampleLibrary(loadLibrary(win));
  const r = C.search('\u6570\u5B57\u5316', { limit: 1 })[0];
  for (const k of ['docId', 'title', 'journal', 'year', 'page', 'charRange', 'quote', 'score', 'trust', 'lowQuality']) {
    has(r, k, 'corpus result field ' + k);
  }
  ok(Array.isArray(r.charRange) && r.charRange.length === 2, 'charRange is [start,end]');
  ok(typeof r.quote === 'string' && typeof r.score === 'number', 'types');
  const b = win.ZY.bm25.search(C.ensureIndex(), '\u6570\u5B57\u5316', { limit: 1 })[0];
  for (const k of ['id', 'score', 'rank', 'matchedTerms', 'snippet']) has(b, k, 'bm25 result field ' + k);
  for (const k of ['text', 'page', 'charStart', 'charEnd']) has(b.snippet, k, 'bm25 snippet field ' + k);
});

/* ------------------------------------------------------------
   主流程
   ------------------------------------------------------------ */
(async function main() {
  for (const [name, fn] of syncChecks) {
    try { fn(); passCount++; console.log('PASS ' + name); }
    catch (e) { failCount++; failures.push([name, e]); console.log('FAIL ' + name + ' :: ' + ascii(e && e.message ? e.message : e)); }
  }
  for (const [name, fn] of asyncChecks) {
    try { await fn(); passCount++; console.log('PASS ' + name); }
    catch (e) { failCount++; failures.push([name, e]); console.log('FAIL ' + name + ' :: ' + ascii(e && e.message ? e.message : (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e))); }
  }
  console.log('');
  console.log('TOTAL ' + (passCount + failCount) + ' PASS ' + passCount + ' FAIL ' + failCount);
  console.log('RESULT ' + (failCount === 0 ? 'PASS' : 'FAIL'));
  if (failCount) process.exitCode = 1;
})();
