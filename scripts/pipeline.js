/* ============================================================================
   智研 · 七步实证流水线（真实计量执行层）        scripts/pipeline.js   v1.0.0
   ----------------------------------------------------------------------------
   设计原则（与产品承诺一致）：
   1) 所有系数 / 标准误 / t / p / R² / F / 均值 / 相关系数 / VIF 都来自
      ZY.econ 的真实调用，本文件不写入任何"预置结果数字"。
   2) 算不出来就失败：返回 { status:'failed', error:{ code, message } }，
      绝不给出一个看起来正常的假结果。
   3) 每个数值单元格都有稳定 cell_id（<stepId>.<tableId>.r<行>c<列>），
      并全部被 interpretation 引用（引用不了的会自动补一条"其余数值"）。
   4) 每一步都返回 provenance（样本量 / 变量 / FE / 聚类 / 种子 / 数据与代码 hash），
      不含时间戳 —— 同 seed 同输入必须得到逐字节相同的结果。

   依赖：scripts/econ.js（必须先加载），零构建、ES5、classic script。
   导出：window.ZY.pipeline
   ============================================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};

  var VERSION = 'pipeline.js@1.0.0';
  var STEP_ORDER = ['data-prep', 'descriptive', 'baseline', 'robustness', 'endogeneity', 'heterogeneity', 'mechanism'];
  var DEFAULT_SEED = 20240113;
  var DEFAULT_N = 6000;                 /* 无外部数据时合成面板的默认行数 */
  var BASE_X = ['digi', 'size', 'lev', 'roa', 'age', 'subsidy'];   /* 基准控制变量 */
  var REQUIRED = ['firm_id', 'year', 'ln_innov', 'digi', 'size', 'lev', 'roa', 'age'];
  var CONT = ['ln_innov', 'ln_innov_inv', 'ln_innov_util', 'digi', 'digi_alt', 'size', 'lev', 'roa', 'age', 'subsidy', 'fc'];
  var DESC_VARS = ['ln_innov', 'ln_innov_inv', 'digi', 'digi_alt', 'size', 'lev', 'roa', 'age', 'subsidy'];
  var CORR_VARS = ['ln_innov', 'digi', 'size', 'lev', 'roa', 'age'];
  var DERIVE_ORDER = ['digi_lag1', 'digi_lead2', 'digi_perm', 'z_iv', 'large', 'own', 'digi_x_large', 'digi_x_own'];
  var IV_F_THRESHOLD = 10;              /* Stock–Yogo 经验门槛（方法学约定，不是结果） */
  /* 合成面板 DGP 参数（真值）：只用于①生成数据 ②测试校准。
     绝不进入任何结果表 —— 表里的每个数字都来自 ZY.econ 的真实估计。 */
  var DGP = {
    periods: 12, startYear: 2011,       /* 与 DESIGN.sample.period（2011–2022，12 期）一致 */
    ar: 0.60, arSd: 0.075,              /* digi 的企业内 AR(1) 演化 */
    indYearSd: 0.009,                   /* 行业-年份共同冲击：决定"同行业同年度均值"工具的相关性 */
    directBase: -0.01,                  /* digi 当期直接效应：中小企业 */
    directLargeBonus: 0.10,             /* digi 当期直接效应的规模增量（大型企业更强） */
    lagDirect: 0.05,                    /* digi 滞后一期的直接效应 */
    channelA: -0.45, channelB: -0.10,   /* fc 渠道：a 路径（digi→fc）与 b 路径（fc→ln_innov） */
    sigmaEps: 0.13
  };
  /* 当期总效应真值 = 平均直接效应 + 经 fc 的中介效应（a×b），供测试做"系数是否跑偏"的校准 */
  DGP.totalEffectDigi = (DGP.directBase + DGP.directLargeBonus / 2) + (DGP.channelA * DGP.channelB);
  /* 合成面板缺失率：与 data.js DATASETS.ds1.columns[].missing 保持一致（是设定，不是结果） */
  var MISS_PROB = [
    ['ln_innov', 0.004], ['ln_innov_inv', 0.006], ['ln_innov_util', 0.006], ['digi', 0.031],
    ['digi_alt', 0.048], ['size', 0.002], ['lev', 0.011], ['roa', 0.009],
    ['age', 0.003], ['subsidy', 0.057], ['fc', 0.010]
  ];

  function E() {
    var e = ZY && ZY.econ;
    if (!e || !e.fitOLS) throw new Error('ZY.econ 未加载：pipeline.js 依赖 scripts/econ.js（请先加载）');
    return e;
  }

  /* ========================== 基础工具 ========================== */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v) {
    if (v === '' || v === null || v === undefined) return NaN;
    var f = Number(v);
    return isFinite(f) ? f : NaN;
  }
  function copy(o) { var s = {}, k; for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) s[k] = o[k]; return s; }
  function merge(dst, src) { var k; for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k]; return dst; }
  function isArr(a) { return Object.prototype.toString.call(a) === '[object Array]'; }
  function sum(a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return s; }
  function range(n) { var a = [], i; for (i = 0; i < n; i++) a.push(i); return a; }
  function colOf(rows, name) { return rows.map(function (o) { return num(o[name]); }); }
  function finite(a) { return a.filter(isNum); }
  function minOf(a) { var m = Infinity, i; for (i = 0; i < a.length; i++) if (isNum(a[i]) && a[i] < m) m = a[i]; return m; }
  function maxOf(a) { var m = -Infinity, i; for (i = 0; i < a.length; i++) if (isNum(a[i]) && a[i] > m) m = a[i]; return m; }

  /** FNV-1a 32 位哈希（自己实现，不依赖 util.js，保证 Node 下也能跑） */
  function hash32(str) {
    var h = 0x811c9dc5, s = String(str), i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function groupInt(v) {
    var s = String(Math.abs(Math.round(v))), out = '', c = 0, i;
    for (i = s.length - 1; i >= 0; i--) { out = s[i] + out; if (++c % 3 === 0 && i > 0) out = ',' + out; }
    return (v < 0 ? '-' : '') + out;
  }
  function fmtNum(v, d) {
    if (!isFinite(v)) return '—';
    d = (d === undefined || d === null) ? 3 : d;
    var neg = v < 0, s = Math.abs(v).toFixed(d), parts = s.split('.');
    return (neg ? '-' : '') + groupInt(Number(parts[0])) + (parts[1] ? '.' + parts[1] : '');
  }
  function fmtInt(v) { return isFinite(v) ? groupInt(v) : '—'; }
  function fmtP(p) {
    if (!isFinite(p)) return '—';
    if (p < 0.001) return '<0.001';
    return p.toFixed(3);
  }
  /** 通用格式化：大数千分位、普通数 3 位、小数 4 位、极小值科学计数 */
  function fmtVal(v) {
    if (!isFinite(v)) return '—';
    if (Math.abs(v) >= 1000) return groupInt(v);
    if (Math.abs(v) >= 1) return fmtNum(v, 3);
    if (v === 0) return '0.000';
    if (Math.abs(v) < 1e-4) return v.toExponential(2);
    return v.toFixed(4);
  }
  var FMT = {
    int: fmtInt, p: fmtP, coef: function (v) { return fmtNum(v, 3); }, v: fmtVal
  };

  /* ========================== 表格 / 单元格 / 解释 ========================== */
  /**
   * 建表：rows 保留原始数值（number 仍是 number），formattedRows 供 UI 直接渲染。
   * 每个数值单元格生成稳定 cell_id 与 formatted，供 interpretation 精确回溯。
   * opts: { numCols:[0基列号], formats:{col:'int'|'coef'|'p'|'v'}, rowLabels:[], terms:[],
   *         stat:[{coef,se,t,p}], note:'' }
   */
  function makeTable(id, title, head, rows, opts) {
    opts = opts || {};
    var numCols = opts.numCols || [], formats = opts.formats || {};    var rowLabels = opts.rowLabels || [], terms = opts.terms || [], stat = opts.stat || [];
    var cells = [], fmtRows = [], r, c;
    for (r = 0; r < rows.length; r++) {
      var out = [];
      for (c = 0; c < rows[r].length; c++) {
        var v = rows[r][c], cellId = id + '.r' + r + 'c' + c, formatted;
        if (isNum(v)) {
          var kind = (typeof formats === 'function') ? formats(r, c) : formats[c];
          var fn = FMT[kind || 'v'] || fmtVal;
          formatted = fn(v);
          var cell = {
            id: cellId, cellId: cellId, tableId: id, row: r, col: c,
            label: (rowLabels[r] !== undefined ? rowLabels[r] : ('第' + (r + 1) + '行')) + ' · ' + head[c],
            term: terms[r], value: v, formatted: formatted
          };
          if (stat[r]) { cell.coef = stat[r].coef; cell.se = stat[r].se; cell.t = stat[r].t; cell.p = stat[r].p; }
          cells.push(cell);
        } else if (typeof v === 'number') {
          formatted = '—';                       /* NaN / Infinity：明确留空，不打印 "NaN" */
        } else {
          formatted = (v === null || v === undefined) ? '' : String(v);
        }
        out.push(formatted);
      }
      fmtRows.push(out);
    }
    return {
      id: id, title: title, head: head.slice(), rows: rows, formattedRows: fmtRows,
      numCols: numCols.slice(), rowLabels: rowLabels.slice(), cells: cells, note: opts.note || ''
    };
  }
  function cellAt(t, rowLabel, colHeader) {
    var r = t.rowLabels.indexOf(rowLabel), c = t.head.indexOf(colHeader);
    if (r < 0 || c < 0) return null;
    var id = t.id + '.r' + r + 'c' + c, i;
    for (i = 0; i < t.cells.length; i++) if (t.cells[i].id === id) return t.cells[i];
    return null;
  }
  /** 生成 {{cellId}} 占位符；单元格不存在或非数值时直接抛错（宁可报错不要静默） */
  function ph(t, rowLabel, colHeader) {
    var cell = cellAt(t, rowLabel, colHeader);
    if (!cell) throw new Error('interpretation 引用了不存在的数值单元格：' + t.id + ' / ' + rowLabel + ' / ' + colHeader);
    return '{{' + cell.id + '}}';
  }
  /** 可选单元格：存在则引用，否则给 fallback（用于可能失败、单元格不存在的分支） */
  function phOr(t, rowLabel, colHeader, fallback) {
    var cell = cellAt(t, rowLabel, colHeader);
    return cell ? ('{{' + cell.id + '}}') : fallback;
  }
  /** 直接取格式化文本（用于非数值列，如显著性星号） */
  function tx(t, rowLabel, colHeader) {
    var r = t.rowLabels.indexOf(rowLabel), c = t.head.indexOf(colHeader);
    if (r < 0 || c < 0) return '';
    return t.formattedRows[r][c];
  }
  /**
   * 组装 interpretation：先用模板引用关键单元格，再把剩下所有数值单元格
   * 自动补进"其余数值"（cell_id=值），从而保证"表里每个数字都能被解释引用"。
   */
  function interp(tables, sentences) {
    var byId = {}, i, j;
    for (i = 0; i < tables.length; i++) for (j = 0; j < tables[i].cells.length; j++) byId[tables[i].cells[j].id] = tables[i].cells[j];
    var used = {}, refs = [], out = [];
    function take(cell) { if (!used[cell.id]) { used[cell.id] = 1; refs.push(cell); } return cell.formatted; }
    for (i = 0; i < sentences.length; i++) {
      out.push(String(sentences[i]).replace(/\{\{([^}]+)\}\}/g, function (m, id) {
        var cell = byId[id];
        if (!cell) throw new Error('interpretation 引用了不存在的 cell_id：' + id);
        return take(cell);
      }).replace(/=\s*</g, '<'));          /* "p = <0.001" → "p <0.001" */
    }
    var rest = [];
    for (i = 0; i < tables.length; i++) {
      for (j = 0; j < tables[i].cells.length; j++) {
        var c2 = tables[i].cells[j];
        if (!used[c2.id]) { used[c2.id] = 1; rest.push(c2); refs.push(c2); }
      }
    }
    if (rest.length) {
      /* 其余数值：按表分组，坐标简写，保证每个数字都能回溯到单元格 */
      var byTable = {}, order = [];
      for (i = 0; i < rest.length; i++) {
        var tid = rest[i].tableId;
        if (!byTable[tid]) { byTable[tid] = []; order.push(tid); }
        byTable[tid].push('r' + rest[i].row + 'c' + rest[i].col + '=' + rest[i].formatted);
      }
      var groups = [];
      for (i = 0; i < order.length; i++) groups.push(order[i] + '：' + byTable[order[i]].join('，'));
      out.push('其余数值（按表给出 cell_id 坐标=值，可逐格回溯）：' + groups.join('；') + '。');
    }
    return { text: out.join(''), refs: refs };
  }

  /* ========================== provenance ========================== */
  var _codeHash = null;
  function codeHash() {
    if (_codeHash) return _codeHash;
    try {
      _codeHash = hash32(String(runStep) + String(buildSpec) + String(prepareSample) + String(makeSyntheticPanel) + VERSION);
    } catch (e) { _codeHash = VERSION; }
    return _codeHash;
  }
  var _engineInfo = null;
  function engineInfo() {
    if (_engineInfo) return _engineInfo;
    var e = E(), keys = Object.keys(e).sort();
    _engineInfo = { name: 'econ.js', api: keys.length, fingerprint: hash32(keys.join(',')), weakIVThreshold: IV_F_THRESHOLD };
    return _engineInfo;
  }
  function mkProv(stepId, sample, extra) {
    var p = {
      stepId: stepId,
      codeVersion: VERSION,
      codeHash: codeHash(),
      engine: engineInfo(),
      specVersion: 'spec/1.0.0',
      dataset: sample.datasetLabel,
      dataSource: sample.kind,
      dataHash: sample.dataHash,
      seed: sample.seed,
      nObsRaw: sample.rawRows,
      nObs: sample.nObs,
      dropped: sample.dropped,
      imputed: sample.imputed,
      winsor: [sample.winsor.lo, sample.winsor.hi],
      missingMode: sample.missingMode,
      nUnits: (sample.panel && sample.panel.ok) ? sample.panel.nUnits : null,
      nPeriods: (sample.panel && sample.panel.ok) ? sample.panel.nPeriods : null,
      balanced: (sample.panel && sample.panel.ok) ? !!sample.panel.balanced : null,
      y: null, x: [], fe: [], cluster: null, variables: [], specHash: null
    };
    return merge(p, extra || {});
  }
  function specHashOf(list) { return hash32(JSON.stringify(list)); }

  /* ========================== 结果打包 ========================== */
  function failedResult(stepId, sample, code, message, extra) {
    var diag = merge({ error: { code: code, message: message }, warnings: [code + '：' + message] }, (extra && extra.diagnostics) || {});
    var prov = sample ? mkProv(stepId, sample, (extra && extra.provenance) || {}) : null;
    var text = '本步未能完成：' + code + ' —— ' + message;
    return {
      stepId: stepId, status: 'failed', tables: [], cells: [], metrics: [],
      primaryTableId: null, primaryTable: null, table: null,
      interpretation: { text: text, refs: [] }, summary: text, warning: text,
      diagnostics: diag, provenance: prov, error: { code: code, message: message }
    };
  }
  function pack(stepId, sample, tables, metrics, ip, diagnostics, prov, extra) {
    var cells = [], i, j;
    for (i = 0; i < tables.length; i++) for (j = 0; j < tables[i].cells.length; j++) cells.push(tables[i].cells[j]);
    var primary = tables.length ? tables[0] : null;
    var warnings = diagnostics.warnings || [];
    var res = {
      stepId: stepId,
      status: extra && extra.status ? extra.status : 'done',
      tables: tables,
      cells: cells,
      primaryTableId: primary ? primary.id : null,
      primaryTable: primary ? {
        head: primary.head.slice(), rows: primary.formattedRows, numericRows: primary.rows,
        numCols: primary.numCols.slice(), note: primary.note
      } : null,
      metrics: metrics,
      interpretation: ip,
      summary: ip.text,
      warning: diagnostics.warning || (warnings.length ? warnings.join(' ') : null),
      diagnostics: diagnostics,
      provenance: prov
    };
    res.table = res.primaryTable;
    if (extra && extra.error) res.error = extra.error;
    return res;
  }
  function metricFrom(k, cell) {
    return { k: k, v: cell ? cell.formatted : '—', value: cell ? cell.value : null, cellId: cell ? cell.id : null };
  }
  function metric(k, v) { return { k: k, v: String(v), value: null, cellId: null }; }

  /* ========================== 确定性随机数 ========================== */
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rnd) {
    var u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ========================== 合成面板（确定性） ==========================
     列与 data.js DATASETS.ds1 一致：firm_id, year, province_id, industry_id,
     ln_innov, ln_innov_inv, ln_innov_util, digi, digi_alt, size, lev, roa, age, subsidy
     另加两列（本 Demo 专用）：soe（所有制虚拟变量）、fc（融资约束指数，机制步骤用）。
     DGP（真值见 DGP 常量）：
       · y = firm FE + year FE + digi 当期直接效应（大型企业更强）+ digi 滞后一期效应
             + 经 fc 的中介效应 + 控制变量 + 噪声
       · digi 在企业内 AR(1) 演化，并带行业-年份共同冲击（使"同行业同年度均值"工具
         弱但非退化：第一阶段 F 落在弱工具区间，用于演示"弱工具必须如实报告"）
       · 故意保留真实的坑：缺失值、lev 越界行、重复 firm-year 行、不平衡面板
     n = 返回行数（精确为 n；末尾几行被替换成上面两类"脏行"，不是额外追加）
     ====================================================================== */
  function makeSyntheticPanel(n, seed) {
    n = Math.max(24, Math.floor(num(n) > 0 ? num(n) : DEFAULT_N));
    seed = (seed === undefined || seed === null || !isFinite(Number(seed))) ? DEFAULT_SEED : (Number(seed) >>> 0);
    var rnd = mulberry32(seed);
    var T = DGP.periods, Y0 = DGP.startYear, nF = Math.ceil(n / T);
    var firms = [], f, t, i;
    for (f = 0; f < nF; f++) {
      var sizeF = 22.0 + 1.10 * gauss(rnd);
      var digiF = 0.28 + 0.10 * gauss(rnd) + 0.018 * (sizeF - 22);
      var levF = 0.43 + 0.06 * gauss(rnd);
      var roaF = 0.04 + 0.02 * gauss(rnd) - 0.10 * (levF - 0.43);
      var ageF = 2.6 + 0.5 * gauss(rnd) + 0.10 * (sizeF - 22);
      var aF = 1.00 + 0.90 * gauss(rnd) + 3.50 * (digiF - 0.28);
      firms.push({
        size: sizeF, digi: digiF, lev: levF, roa: roaF, age: ageF, a: aF,
        large: sizeF > 22.0 ? 1 : 0,
        soe: rnd() < 0.35 ? 1 : 0,
        ind: 1 + Math.floor(rnd() * 12),
        prov: 1 + Math.floor(rnd() * 20)
      });
    }
    var lam = [];
    for (t = 0; t < T; t++) lam.push(0.20 * gauss(rnd));
    /* 行业-年份共同冲击（固定顺序抽取，保证确定性） */
    var indYear = {};
    for (f = 1; f <= 12; f++) for (t = 0; t < T; t++) indYear[f + '|' + (Y0 + t)] = DGP.indYearSd * gauss(rnd);
    var rows = [], dev = new Array(nF).fill(0), prevDigi = new Array(nF).fill(NaN);
    for (i = 0; i < n; i++) {
      f = Math.floor(i / T); t = i % T;
      var F = firms[f];
      dev[f] = DGP.ar * dev[f] + DGP.arSd * gauss(rnd);
      var digi = F.digi + dev[f] + indYear[F.ind + '|' + (Y0 + t)];
      var lagDigi = prevDigi[f];
      prevDigi[f] = digi;
      var size = F.size + 0.05 * (t - 3.5) + 0.30 * gauss(rnd);
      var lev = F.lev + 0.09 * gauss(rnd);
      var roa = F.roa + 0.05 * gauss(rnd);
      var age = F.age + 0.10 * gauss(rnd);
      var subsidy = 1.5 + 0.6 * gauss(rnd);
      var digiAlt = 0.06 + 0.40 * (digi - 0.28) + 0.015 * gauss(rnd);
      var fc = 2.5 + DGP.channelA * digi + 0.80 * (lev - 0.43) - 1.20 * (roa - 0.04) + 0.15 * gauss(rnd);
      var eps = DGP.sigmaEps * gauss(rnd);
      var direct = DGP.directBase + DGP.directLargeBonus * F.large;
      var lagEffect = isFinite(lagDigi) ? DGP.lagDirect * lagDigi : 0;
      var lnInnov = F.a + 1.00 * lam[t] + direct * digi + lagEffect + DGP.channelB * (fc - 2.33)
        + 0.18 * (size - 22) - 0.08 * lev + 0.35 * roa - 0.03 * age + 0.06 * subsidy + eps;
      var lnInv = 0.40 * F.a + 0.80 * lam[t] + 0.045 * digi - 0.06 * (fc - 2.33)
        + 0.12 * (size - 22) + 0.50 * eps + 0.12 * gauss(rnd);
      var lnUtil = 0.50 * F.a + 0.70 * lam[t] + 0.05 * digi + 0.10 * (size - 22)
        + 0.60 * eps + 0.20 * gauss(rnd);
      var row = {
        firm_id: f + 1, year: Y0 + t, province_id: F.prov, industry_id: F.ind,
        ln_innov: lnInnov, ln_innov_inv: lnInv, ln_innov_util: lnUtil,
        digi: digi, digi_alt: digiAlt, size: size, lev: lev, roa: roa, age: age,
        subsidy: subsidy, soe: F.soe, fc: fc
      };
      for (var m = 0; m < MISS_PROB.length; m++) if (rnd() < MISS_PROB[m][1]) row[MISS_PROB[m][0]] = NaN;
      rows.push(row);
    }
    /* 在末尾注入清洗对象（确定性，不改变总行数）：
       · outN 行 lev 越界（独立 firm_id，供"剔除 lev 越界"）
       · dupN 行是前面某行的完全复制（制造重复 firm-year，供"去重"） */
    var dupN = Math.max(2, Math.round(n * 0.0015));
    var outN = Math.max(1, Math.round(n * 0.0008));
    var base = n - dupN - outN;
    for (i = 0; i < outN; i++) {
      rows[base + i] = {
        firm_id: 900000 + i, year: Y0, province_id: 1, industry_id: 1,
        ln_innov: 1.0 + i, ln_innov_inv: 0.8, ln_innov_util: 0.6, digi: 0.20, digi_alt: 0.05,
        size: 22.0, lev: (i % 2 ? 1.4 : -0.2), roa: 0.03, age: 2.5, subsidy: 1.5, soe: 0, fc: 2.4
      };
    }
    for (i = 0; i < dupN; i++) rows[base + outN + i] = copy(rows[Math.floor(rnd() * base)]);
    return rows;
  }

  /* ========================== 样本准备（清洗 / 缩尾 / 对账） ========================== */
  function sampleHas(sample, name) { return sample.vars.indexOf(name) >= 0; }

  function prepareSample(ctx) {
    ctx = ctx || {};
    var econ = E();
    var seed = (ctx.seed === undefined || ctx.seed === null) ? DEFAULT_SEED : (Number(ctx.seed) >>> 0);
    var w = ctx.winsor || {};
    var wLo = (w.lo === undefined || w.lo === null) ? 0.01 : Number(w.lo);
    var wHi = (w.hi === undefined || w.hi === null) ? 0.99 : Number(w.hi);
    var missingMode = (ctx.missing === 'impute-median') ? 'impute-median' : 'drop';

    /* --- 1) 取原始数据 --- */
    var raw = null, kind = 'synthetic', parse = null, label = ctx.datasetLabel || null, i, k;
    if (typeof ctx.csvText === 'string' && ctx.csvText.length) {
      var tbl = econ.csvToTable(ctx.csvText);
      if (!tbl.ok) return { ok: false, code: tbl.code || 'PARSE_FAILED', message: tbl.message || 'CSV 解析失败' };
      raw = [];
      for (i = 0; i < tbl.nRows; i++) {
        var o = {};
        for (k = 0; k < tbl.cols.length; k++) o[tbl.cols[k].name] = tbl.cols[k].values[i];
        raw.push(o);
      }
      kind = 'csv';
      label = label || ('CSV 文本（' + tbl.nRows + ' 行 × ' + tbl.cols.length + ' 列）');
      parse = { nRows: tbl.nRows, rawRows: tbl.rawRows, truncated: !!tbl.truncated, names: tbl.names };
    } else if (isArr(ctx.rows || ctx.panel)) {
      raw = (ctx.rows || ctx.panel).slice();
      kind = 'rows';
      label = label || ('外部面板 ctx.rows（' + raw.length + ' 行）');
    } else {
      var nn = (ctx.n === undefined || ctx.n === null) ? DEFAULT_N : Math.max(24, Math.floor(Number(ctx.n)));
      raw = makeSyntheticPanel(nn, seed);
      kind = 'synthetic';
      label = label || ('合成面板 makeSyntheticPanel(n=' + nn + ', seed=' + seed + ')');
    }
    if (!raw.length) return { ok: false, code: 'EMPTY_DATA', message: '没有数据行' };

    /* --- 2) 变量存在性 --- */
    var present = {};
    for (i = 0; i < raw.length; i++) for (k in raw[i]) if (Object.prototype.hasOwnProperty.call(raw[i], k)) present[k] = 1;
    var vars = Object.keys(present).sort();
    var missReq = REQUIRED.filter(function (v) { return !present[v]; });
    if (missReq.length) {
      return { ok: false, code: 'MISSING_VAR', message: '数据缺少必需变量：' + missReq.join('、') + '（需要 ' + REQUIRED.join(', ') + '）' };
    }

    /* --- 3) 逐行归类（重复 → lev 越界 → 关键缺失） --- */
    var seen = Object.create(null), reason = new Array(raw.length);
    var dropped = { duplicate: 0, levOutOfRange: 0, missing: 0, total: 0 };
    var missCells = 0, cellTotal = 0;
    for (i = 0; i < raw.length; i++) {
      var r0 = raw[i];
      cellTotal += vars.length;
      for (k = 0; k < vars.length; k++) if (!isNum(num(r0[vars[k]]))) missCells++;
      var fid = num(r0.firm_id), yr = num(r0.year);
      var key = (isFinite(fid) && isFinite(yr)) ? (fid + '|' + yr) : null;
      var levV = num(r0.lev);
      var badLev = isFinite(levV) && (levV > 1 || levV < 0);
      var miss = false;
      for (k = 0; k < REQUIRED.length; k++) if (!isFinite(num(r0[REQUIRED[k]]))) { miss = true; break; }
      var rs;
      if (key !== null && seen[key]) rs = 'duplicate';
      else if (badLev) rs = 'levOutOfRange';
      else if (miss) rs = (missingMode === 'impute-median') ? 'impute' : 'missing';
      else rs = 'ok';
      if (key !== null) seen[key] = 1;
      reason[i] = rs;
      if (rs === 'duplicate') dropped.duplicate++;
      else if (rs === 'levOutOfRange') dropped.levOutOfRange++;
      else if (rs === 'missing') dropped.missing++;
    }
    dropped.total = dropped.duplicate + dropped.levOutOfRange + dropped.missing;

    var keptIdx = [];
    for (i = 0; i < raw.length; i++) if (reason[i] === 'ok' || reason[i] === 'impute') keptIdx.push(i);
    var rows = keptIdx.map(function (ix) {
      var s = {}, j;
      for (j = 0; j < vars.length; j++) s[vars[j]] = raw[ix][vars[j]];
      return s;
    });

    /* --- 4) 缺失统计（清理后样本，插补前） --- */
    var missingBefore = [];
    for (k = 0; k < vars.length; k++) {
      var cnt = 0;
      for (i = 0; i < rows.length; i++) if (!isNum(num(rows[i][vars[k]]))) cnt++;
      missingBefore.push({ name: vars[k], n: cnt, rate: rows.length ? cnt / rows.length : NaN });
    }
    /* --- 5) 中位数插补（可选，默认关闭） --- */
    var imputedByVar = {}, imputedTotal = 0;
    if (missingMode === 'impute-median') {
      for (k = 0; k < REQUIRED.length; k++) {
        var v = REQUIRED[k], groups = {}, all = [];
        for (i = 0; i < rows.length; i++) {
          var val = num(rows[i][v]);
          if (!isFinite(val)) continue;
          var gk = (present.industry_id ? String(rows[i].industry_id) : '') + '|' + String(rows[i].year);
          (groups[gk] = groups[gk] || []).push(val);
          all.push(val);
        }
        var gmed = {};
        Object.keys(groups).forEach(function (gk2) { if (groups[gk2].length >= 5) gmed[gk2] = econ.median(groups[gk2]); });
        var omed = econ.median(all), c2 = 0;
        for (i = 0; i < rows.length; i++) {
          if (isFinite(num(rows[i][v]))) continue;
          var gk3 = (present.industry_id ? String(rows[i].industry_id) : '') + '|' + String(rows[i].year);
          var mv = gmed[gk3];
          if (!isFinite(mv)) mv = omed;
          if (isFinite(mv)) { rows[i][v] = mv; c2++; }
        }
        if (c2) { imputedByVar[v] = c2; imputedTotal += c2; }
      }
    }

    /* --- 6) 缩尾 1%/99%（真实调用 econ.winsorize） --- */
    var winsorInfo = [], contPresent = CONT.filter(function (v) { return present[v]; });
    for (k = 0; k < contPresent.length; k++) {
      var vn = contPresent[k];
      var vals = colOf(rows, vn);
      var lo = econ.quantile(vals, wLo), hi = econ.quantile(vals, wHi);
      var wv = econ.winsorize(vals, wLo, wHi), changed = 0;
      for (i = 0; i < rows.length; i++) {
        if (isFinite(vals[i]) && wv[i] !== vals[i]) changed++;
        rows[i][vn] = wv[i];
      }
      winsorInfo.push({ name: vn, lo: lo, hi: hi, changed: changed });
    }
    var winsorTotal = 0;
    for (k = 0; k < winsorInfo.length; k++) winsorTotal += winsorInfo[k].changed;

    /* --- 7) 面板结构识别（真实调用 econ.inferType + econ.detectPanel） --- */
    var panel, warnings = [];
    try {
      var pcols = vars.map(function (nm) {
        var rv = rows.map(function (o) {
          var v2 = o[nm];
          if (v2 === '' || v2 === null || v2 === undefined) return '';
          var fv = num(v2);
          if (isFinite(fv)) return fv;
          return (typeof v2 === 'number') ? '' : v2;   /* NaN 记为缺失，不能写进类型推断 */
        });
        var strs = rv.map(function (v3) { return (v3 === '' || v3 === null) ? '' : String(v3); });
        var missN = 0;
        for (var q = 0; q < rv.length; q++) if (rv[q] === '') missN++;
        return { name: nm, type: econ.inferType(strs), values: rv, missing: rv.length ? missN / rv.length : NaN };
      });
      panel = econ.detectPanel(pcols);
    } catch (err) {
      panel = { ok: false, message: 'detectPanel 异常：' + (err && err.message ? err.message : String(err)) };
      warnings.push('面板结构识别失败：' + panel.message);
    }
    if (!panel.ok) warnings.push('面板结构未识别：' + panel.message);
    /* 声明口径（firm_id × year）：本流水线的数据模型固定用这两个维度做 FE/聚类 */
    var declared = null;
    if (present.firm_id && present.year) {
      var nU = econ.countUniq({ values: rows.map(function (o) { return o.firm_id; }) });
      var nT = econ.countUniq({ values: rows.map(function (o) { return o.year; }) });
      declared = {
        ok: true, unitId: 'firm_id', timeId: 'year', nUnits: nU, nPeriods: nT,
        balanced: rows.length === nU * nT,
        coverage: (nU * nT) ? rows.length / (nU * nT) : NaN,
        message: '声明口径 firm_id（' + nU + '）× year（' + nT + '）'
      };
    }
    if (panel.ok && declared && (panel.unitId !== declared.unitId || panel.timeId !== declared.timeId)) {
      warnings.push('econ.detectPanel 自动识别为 ' + panel.unitId + ' × ' + panel.timeId +
        '，与声明口径 ' + declared.unitId + ' × ' + declared.timeId + ' 不一致：data-prep 以声明口径为准，自动识别仅作诊断');
    }

    /* --- 8) 缺失率（原始，全表口径） --- */
    var missingRate = cellTotal ? missCells / cellTotal : NaN;

    /* --- 9) 数据 hash（可复现） --- */
    var hashSrc = [];
    for (i = 0; i < rows.length; i++) {
      var parts = [];
      for (k = 0; k < vars.length; k++) {
        var vv = num(rows[i][vars[k]]);
        parts.push(isFinite(vv) ? vv.toPrecision(12) : (rows[i][vars[k]] === null || rows[i][vars[k]] === undefined ? '' : String(rows[i][vars[k]])));
      }
      hashSrc.push(parts.join(','));
    }
    var dataHash = hash32(rows.length + '|' + vars.join(',') + '|' + hashSrc.join(';'));

    var sample = {
      ok: true, code: null, message: null,
      kind: kind, datasetLabel: label, parse: parse,
      seed: seed, winsor: { lo: wLo, hi: wHi }, missingMode: missingMode,
      rawRows: raw.length, dropped: dropped,
      imputed: { total: imputedTotal, byVar: imputedByVar, mode: missingMode },
      nObs: rows.length,
      reconcile: {
        ok: raw.length === dropped.total + rows.length,
        formula: '原始观测 = 剔除（重复 + lev 越界 + 关键缺失）+ 有效样本',
        raw: raw.length, dropped: dropped.total, valid: rows.length
      },
      rows: rows, vars: vars, present: present,
      missingBefore: missingBefore, missingAfter: (function () {
        var out = [];
        for (var q = 0; q < vars.length; q++) {
          var c3 = 0;
          for (var p = 0; p < rows.length; p++) if (!isNum(num(rows[p][vars[q]]))) c3++;
          out.push({ name: vars[q], n: c3, rate: rows.length ? c3 / rows.length : NaN });
        }
        return out;
      })(),
      winsorInfo: winsorInfo, winsorTotal: winsorTotal,
      panel: panel, panelDeclared: declared, missingRate: missingRate, dataHash: dataHash,
      warnings: warnings, derived: {}, _rows: null, _added: {}
    };
    sample._rows = sample.rows;
    return sample;
  }

  /* ========================== 派生列（确定性） ========================== */
  function ensureDerived(sample, need) {
    var rows = sample._rows || sample.rows, i, k;
    function byFirm() {
      var m = {};
      for (i = 0; i < rows.length; i++) (m[String(rows[i].firm_id)] = m[String(rows[i].firm_id)] || []).push(rows[i]);
      return m;
    }
    for (k = 0; k < DERIVE_ORDER.length; k++) {
      var name = DERIVE_ORDER[k];
      if (need.indexOf(name) < 0 || sample._added[name]) continue;
      if (name === 'digi_lag1' || name === 'digi_lead2') {
        var shift = (name === 'digi_lag1') ? -1 : 2;
        var m = byFirm();
        for (i = 0; i < rows.length; i++) {
          var g = m[String(rows[i].firm_id)], hit = null, j;
          for (j = 0; j < g.length; j++) if (num(g[j].year) === num(rows[i].year) + shift) { hit = g[j]; break; }
          rows[i][name] = hit ? num(hit.digi) : NaN;
        }
      } else if (name === 'digi_perm') {
        var rnd = mulberry32((sample.seed + 991) >>> 0);
        var mm = byFirm(), kk;
        for (kk in mm) {
          if (!Object.prototype.hasOwnProperty.call(mm, kk)) continue;
          var grp = mm[kk], vals = grp.map(function (r2) { return num(r2.digi); }), a, b, tmp;
          for (a = vals.length - 1; a > 0; a--) { b = Math.floor(rnd() * (a + 1)); tmp = vals[a]; vals[a] = vals[b]; vals[b] = tmp; }
          for (a = 0; a < grp.length; a++) grp[a].digi_perm = vals[a];
        }
      } else if (name === 'z_iv') {
        var cells = {};
        for (i = 0; i < rows.length; i++) {
          var key = String(rows[i].industry_id) + '|' + String(rows[i].year);
          (cells[key] = cells[key] || { s: 0, n: 0 });
          var dv = num(rows[i].digi);
          if (isFinite(dv)) { cells[key].s += dv; cells[key].n++; }
        }
        for (i = 0; i < rows.length; i++) {
          var c4 = cells[String(rows[i].industry_id) + '|' + String(rows[i].year)];
          var own = num(rows[i].digi);
          rows[i].z_iv = (c4 && c4.n > 1 && isFinite(own)) ? (c4.s - own) / (c4.n - 1) : NaN;
        }
      } else if (name === 'large') {
        var byF = {}, fk;
        for (i = 0; i < rows.length; i++) (byF[String(rows[i].firm_id)] = byF[String(rows[i].firm_id)] || []).push(num(rows[i].size));
        var means = [];
        for (fk in byF) if (Object.prototype.hasOwnProperty.call(byF, fk)) means.push(E().mean(byF[fk]));
        var med = E().median(means);
        for (i = 0; i < rows.length; i++) {
          var fmean = E().mean(byF[String(rows[i].firm_id)]);
          rows[i].large = isFinite(fmean) && isFinite(med) ? (fmean > med ? 1 : 0) : NaN;
        }
        sample.largeMedian = med;
      } else if (name === 'own') {
        var ownVar = null, cands = ['soe', 'own', 'state', 'soe_dummy'];
        for (i = 0; i < cands.length; i++) if (sampleHas(sample, cands[i])) { ownVar = cands[i]; break; }
        sample.ownVar = ownVar;
        if (ownVar) for (i = 0; i < rows.length; i++) rows[i].own = num(rows[i][ownVar]);
      } else if (name === 'digi_x_large') {
        ensureDerived(sample, ['large']);
        for (i = 0; i < rows.length; i++) rows[i].digi_x_large = num(rows[i].digi) * num(rows[i].large);
      } else if (name === 'digi_x_own') {
        ensureDerived(sample, ['own']);
        for (i = 0; i < rows.length; i++) rows[i].digi_x_own = num(rows[i].digi) * num(rows[i].own);
      }
      sample._added[name] = 1;
    }
    return rows;
  }

  /* ========================== 回归规格 ========================== */
  function specOf(sample, opts) {
    var rows = ensureDerived(sample, opts.derive || []);
    var idx = [], i;
    for (i = 0; i < rows.length; i++) {
      if (opts.filter && !opts.filter(rows[i], i)) continue;
      idx.push(i);
    }
    var y = [], X = [], fe = [], j;
    for (j = 0; j < (opts.fe || []).length; j++) fe.push([]);
    var cluster = opts.cluster ? [] : null;
    for (i = 0; i < idx.length; i++) {
      var r = rows[idx[i]], xr = [1];
      for (j = 0; j < opts.x.length; j++) xr.push(num(r[opts.x[j]]));
      X.push(xr); y.push(num(r[opts.y]));
      for (j = 0; j < (opts.fe || []).length; j++) fe[j].push(r[opts.fe[j]]);
      if (cluster) cluster.push(r[opts.cluster]);
    }
    return {
      id: opts.id, title: opts.title || opts.id,
      y: y, X: X, xNames: ['常数项'].concat(opts.x),
      fe: fe, cluster: cluster,
      yVar: opts.y, xVars: opts.x.slice(), feVars: (opts.fe || []).slice(),
      clusterVar: opts.cluster || null, nRows: idx.length,
      filterNote: opts.filterNote || null, derive: (opts.derive || []).slice()
    };
  }
  function fitSpec(spec) {
    return E().fitOLS({
      y: spec.y, X: spec.X, xNames: spec.xNames,
      fe: spec.fe.length ? spec.fe : null, cluster: spec.cluster
    });
  }
  function specSummary(spec) {
    return {
      id: spec.id, title: spec.title, y: spec.yVar, x: spec.xVars,
      fe: spec.feVars, cluster: spec.clusterVar, nRows: spec.nRows,
      filter: spec.filterNote || null
    };
  }
  /** 基准规格。可用 ctx.clusterVar 覆盖聚类层级（默认 firm_id，用于演示"聚类数不足"的失败路径） */
  function baselineSpecOf(sample, ctx) {
    var cl = (ctx && ctx.clusterVar && sampleHas(sample, ctx.clusterVar)) ? ctx.clusterVar : 'firm_id';
    return specOf(sample, { id: 'baseline', title: '基准回归', y: 'ln_innov', x: BASE_X, fe: ['firm_id', 'year'], cluster: cl });
  }

  function buildSpec(stepId, ctx) {
    ctx = ctx || {};
    var sample = (ctx.sample && ctx.sample.ok) ? ctx.sample : prepareSample(ctx);
    if (!sample.ok) return { stepId: stepId, ok: false, code: sample.code, message: sample.message, specs: [], sample: null };
    var specs = [];
    try {
      if (stepId === 'baseline') {
        specs = [baselineSpecOf(sample, ctx)];
      } else if (stepId === 'descriptive') {
        specs = [specOf(sample, { id: 'vif-design', title: 'VIF 辅助设计矩阵（无 FE）', y: 'ln_innov', x: BASE_X.filter(function (v) { return sampleHas(sample, v); }), fe: [], cluster: null })];
      } else if (stepId === 'robustness') {
        specs = robustnessItems(sample, ctx).map(function (it) { return it.spec; });
      } else if (stepId === 'endogeneity') {
        specs = [baselineSpecOf(sample, ctx),
          specOf(sample, { id: 'lag1', title: '滞后一期解释变量（digi_lag1）', y: 'ln_innov', x: ['digi_lag1'].concat(BASE_X.slice(1)), fe: ['firm_id', 'year'], cluster: 'firm_id', derive: ['digi_lag1'] })];
        if (sampleHas(sample, 'industry_id')) {
          specs.push(specOf(sample, { id: 'iv-fs', title: 'IV 第一阶段（digi ~ z_iv + 控制变量）', y: 'digi', x: ['z_iv'].concat(BASE_X.slice(1)), fe: ['firm_id', 'year'], cluster: 'firm_id', derive: ['z_iv'] }));
          specs.push({
            id: '2sls', type: '2sls', title: '2SLS（去均值后两阶段）',
            y: 'ln_innov', endog: 'digi', controls: BASE_X.slice(1), instruments: ['z_iv'],
            fe: ['firm_id', 'year'], cluster: 'firm_id',
            filterNote: '与 iv-fs 同一样本（行级缺失剔除后）', derive: ['z_iv']
          });
        }
      } else if (stepId === 'heterogeneity') {
        specs = heterogeneityItems(sample).map(function (it) { return it.spec; });
      } else if (stepId === 'mechanism') {
        specs = mechanismItems(sample, ctx).map(function (it) { return it.spec; });
      }
    } catch (err) {
      return { stepId: stepId, ok: false, code: 'SPEC_ERROR', message: (err && err.message) ? err.message : String(err), specs: [], sample: sample };
    }
    return { stepId: stepId, ok: true, code: null, message: null, specs: specs, primary: specs.length ? specs[0] : null, sample: sample };
  }

  /* ========================== 系数表 ========================== */
  function coefTable(id, title, res, note) {
    var rows = [], labels = [], terms = [], stat = [];
    res.coefficients.forEach(function (c) {
      /* 被 FE 吸收的常数项：表内留空（不显示 0.000，避免被读成"截距为 0"），
         引擎的原始输出仍保留在 stat 元数据里 */
      rows.push([c.name, c.absorbed ? NaN : c.coef, c.absorbed ? NaN : c.se, c.absorbed ? NaN : c.t,
        c.absorbed ? NaN : c.p, c.absorbed ? '（被 FE 吸收）' : (c.stars || ''), c.ci95[0], c.ci95[1]]);
      labels.push(c.name); terms.push(c.name);
      stat.push({ coef: c.coef, se: c.absorbed ? null : c.se, t: c.absorbed ? null : c.t, p: c.absorbed ? null : c.p });
    });
    return makeTable(id, title, ['变量', '系数', '标准误', 't 值', 'p 值', '显著性', '95% CI 下限', '95% CI 上限'], rows, {
      numCols: [1, 2, 3, 4, 6, 7], formats: { 1: 'coef', 2: 'coef', 3: 'coef', 4: 'p', 6: 'coef', 7: 'coef' },
      rowLabels: labels, terms: terms, stat: stat, note: note || ''
    });
  }
  /** 真问题（会改变结论可信度）才算 warning */
  function fitDiagnostics(res, label) {
    var w = [];
    if (res.demean && res.demean.converged === false) w.push(label + '：固定效应去均值未在 ' + res.demean.iterations + ' 次迭代内收敛（最大变化 ' + res.demean.maxChange + '）');
    if (res.cluster && res.cluster.nClusters < 30) w.push(label + '：聚类数仅 ' + res.cluster.nClusters + '，聚类稳健推断偏乐观');
    return w;
  }
  /** 过程性说明（信息性，不影响可信度）进 notes */
  function fitNotes(res, label) {
    var n = [];
    if (res.droppedMissing) n.push(label + '：回归内因缺失额外剔除 ' + res.droppedMissing + ' 行');
    if (res.demean) n.push(label + '：去均值迭代 ' + res.demean.iterations + ' 次，收敛=' + res.demean.converged);
    return n;
  }
  function clusterNote(res) { return res.cluster ? ('G=' + res.cluster.nClusters) : '无聚类'; }

  /* ========================== ① 数据处理 ========================== */
  function stepDataPrep(sample, ctx) {
    var econ = E();
    var rc = sample.reconcile;
    var tRec = makeTable('data-prep.reconcile', '样本对账', ['项目', '观测数'], [
      ['原始观测（rawRows）', sample.rawRows],
      ['剔除 · 重复 firm-year 行', sample.dropped.duplicate],
      ['剔除 · lev 越界（<0 或 >1）', sample.dropped.levOutOfRange],
      ['剔除 · 关键变量缺失', sample.dropped.missing],
      ['剔除合计', sample.dropped.total],
      ['有效样本（进入全部回归）', sample.nObs],
      ['对账校验（1=通过）', rc.ok ? 1 : 0]
    ], { numCols: [1], formats: { 1: 'int' }, rowLabels: ['原始观测', '重复', 'lev越界', '缺失', '剔除合计', '有效样本', '校验'] });

    var mRows = [], mLabels = [];
    sample.missingBefore.forEach(function (m) {
      var after = 0, i;
      for (i = 0; i < sample.missingAfter.length; i++) if (sample.missingAfter[i].name === m.name) after = sample.missingAfter[i].n;
      var imp = sample.imputed.byVar[m.name] || 0;
      mRows.push([m.name, m.n, m.rate, imp, after]);
      mLabels.push(m.name);
    });
    var tMiss = makeTable('data-prep.missing', '缺失统计（清理后样本 N=' + sample.nObs + '）', ['变量', '缺失数', '缺失率', '插补数', '处理后缺失数'], mRows, {
      numCols: [1, 2, 3, 4], formats: { 1: 'int', 2: 'v', 3: 'int', 4: 'int' }, rowLabels: mLabels,
      note: '缺失率 = 缺失数 / 清理后样本量；缺失处理方式：' + sample.missingMode
    });

    var wRows = [], wLabels = [];
    sample.winsorInfo.forEach(function (wi) {
      wRows.push([wi.name, wi.lo, wi.hi, wi.changed]);
      wLabels.push(wi.name);
    });
    var tWin = makeTable('data-prep.winsor', '缩尾处理（' + sample.winsor.lo + ' / ' + sample.winsor.hi + ' 分位，econ.winsorize）',
      ['变量', '下界（分位点值）', '上界（分位点值）', '被替换观测数'], wRows, {
      numCols: [1, 2, 3], formats: { 1: 'v', 2: 'v', 3: 'int' }, rowLabels: wLabels,
      note: '上/下界由 econ.quantile 在该变量有效值上计算'
    });

    var p = sample.panel, pd = sample.panelDeclared, pRows = [], pLabels = [];
    if (pd) {
      pRows = [
        ['个体数 N（firm_id）', pd.nUnits],
        ['时期数 T（year）', pd.nPeriods],
        ['覆盖率（有效行 / N×T）', pd.coverage],
        ['平衡面板（1=是）', pd.balanced ? 1 : 0],
        ['个体×时期 组合数', pd.nUnits * pd.nPeriods],
        ['firm-year 唯一（1=是）', 1]
      ];
      pLabels = ['个体数', '时期数', '覆盖率', '平衡面板', '组合数', '唯一性'];
    } else {
      pRows = [['声明口径', '缺少 firm_id / year'], ['firm-year 唯一（1=是）', 1]];
      pLabels = ['个体数', '唯一性'];
    }
    var tPanel = makeTable('data-prep.panel', '面板结构（声明口径 firm_id × year；自动识别见 diagnostics.panel）', ['项目', '值'], pRows, {
      numCols: [1], formats: function (r) { return (r === 2) ? 'v' : 'int'; }, rowLabels: pLabels,
      note: (p && p.ok)
        ? ('econ.detectPanel 自动识别：' + p.unitId + ' × ' + p.timeId + '（N=' + p.nUnits + '，T=' + p.nPeriods + '，coverage=' + fmtNum(p.coverage, 4) + '）')
        : ('econ.detectPanel：' + ((p && p.message) || '未识别'))
    });

    var tables = [tRec, tMiss, tWin, tPanel];
    var metrics = [
      metricFrom('原始观测', cellAt(tRec, '原始观测', '观测数')),
      metricFrom('有效样本', cellAt(tRec, '有效样本', '观测数')),
      metricFrom('剔除合计', cellAt(tRec, '剔除合计', '观测数')),
      metric('缩尾观测数', fmtInt(sample.winsorTotal)),
      metric('原始缺失率（单元口径）', isFinite(sample.missingRate) ? (sample.missingRate * 100).toFixed(2) + '%' : '—')
    ];
    var ip = interp(tables, [
      '数据清洗完成：原始观测 ' + ph(tRec, '原始观测', '观测数') + ' 行，剔除重复 firm-year 行 ' + ph(tRec, '重复', '观测数') +
      ' 行、lev 越界行 ' + ph(tRec, 'lev越界', '观测数') + ' 行、关键变量缺失行 ' + ph(tRec, '缺失', '观测数') +
      ' 行，剔除合计 ' + ph(tRec, '剔除合计', '观测数') + ' 行，得到有效样本 ' + ph(tRec, '有效样本', '观测数') +
      ' 行；对账校验（原始 = 剔除 + 有效）=' + ph(tRec, '校验', '观测数') + '。',
      sample.imputed.total
        ? '缺失处理方式为行业-年份中位数插补，共插补 ' + fmtInt(sample.imputed.total) + ' 个单元。'
        : '缺失处理方式为行级剔除（不做插补）。',
      '缩尾按 ' + sample.winsor.lo + '/' + sample.winsor.hi + ' 分位执行，共替换 ' + fmtInt(sample.winsorTotal) + ' 个观测。',
      (pd)
        ? '面板结构（声明口径）：个体 firm_id ' + ph(tPanel, '个体数', '值') + ' 个 × 时间 year ' + ph(tPanel, '时期数', '值') +
          ' 期，覆盖率 ' + ph(tPanel, '覆盖率', '值') + '，平衡面板标志 = ' + ph(tPanel, '平衡面板', '值') +
          (p && p.ok ? ('；econ.detectPanel 自动识别为 ' + p.unitId + ' × ' + p.timeId + '。') : '；econ.detectPanel 未识别。')
        : '面板结构未能识别：' + ((p && p.message) || '—') + '。'
    ]);
    var diag = {
      reconcile: rc, panel: p, panelDeclared: pd, winsor: sample.winsorInfo, missingBefore: sample.missingBefore,
      missingAfter: sample.missingAfter, imputed: sample.imputed, parse: sample.parse,
      warnings: sample.warnings.slice()
    };
    if (!rc.ok) diag.warnings.push('样本量对账不一致：原始 ' + rc.raw + ' ≠ 剔除 ' + rc.dropped + ' + 有效 ' + rc.valid);
    var prov = mkProv('data-prep', sample, {
      variables: vars2prov(sample), y: null, x: [], fe: ['firm_id', 'year'], cluster: null,
      specHash: specHashOf([{ step: 'data-prep', winsor: [sample.winsor.lo, sample.winsor.hi], missing: sample.missingMode }])
    });
    if (!rc.ok) return failedResult('data-prep', sample, 'RECONCILE_FAILED', '样本量对账不一致', { diagnostics: diag, provenance: prov });
    return pack('data-prep', sample, tables, metrics, ip, diag, prov);
  }
  function vars2prov(sample) {
    return {
      all: sample.vars.slice(),
      y: sampleHas(sample, 'ln_innov') ? 'ln_innov' : null,
      x: BASE_X.filter(function (v) { return sampleHas(sample, v); }),
      fe: ['firm_id', 'year'], cluster: 'firm_id',
      alternatives: { y: sampleHas(sample, 'ln_innov_inv') ? 'ln_innov_inv' : null, x: sampleHas(sample, 'digi_alt') ? 'digi_alt' : null },
      channel: sampleHas(sample, 'fc') ? 'fc' : (sampleHas(sample, 'subsidy') ? 'subsidy' : null)
    };
  }

  /* ========================== ② 描述性统计 ========================== */
  function welch(x, y) {
    var econ = E();
    var n1 = x.length, n2 = y.length;
    var m1 = econ.mean(x), m2 = econ.mean(y), v1 = econ.variance(x, 1), v2 = econ.variance(y, 1);
    var se2 = v1 / n1 + v2 / n2;
    if (!(se2 > 0)) return { diff: m1 - m2, se: NaN, t: NaN, df: NaN, p: NaN };
    var t = (m1 - m2) / Math.sqrt(se2);
    var df = (se2 * se2) / (Math.pow(v1 / n1, 2) / (n1 - 1) + Math.pow(v2 / n2, 2) / (n2 - 1));
    return { diff: m1 - m2, se: Math.sqrt(se2), t: t, df: df, p: econ.tPValue(t, df) };
  }
  function stepDescriptive(sample, ctx) {
    var econ = E();
    var rows = sample.rows;
    var vars = DESC_VARS.filter(function (v) { return sampleHas(sample, v); });
    var dRows = [], dLabels = [];
    vars.forEach(function (v) {
      var a = finite(colOf(rows, v));
      dRows.push([v, a.length, econ.mean(a), econ.sd(a), minOf(a), econ.quantile(a, 0.25), econ.median(a), econ.quantile(a, 0.75), maxOf(a)]);
      dLabels.push(v);
    });
    var tDesc = makeTable('descriptive.stats', '描述性统计（分析样本）',
      ['变量', 'N', '均值', '标准差', '最小值', 'p25', '中位数', 'p75', '最大值'], dRows, {
      numCols: [1, 2, 3, 4, 5, 6, 7, 8], formats: { 1: 'int' }, rowLabels: dLabels,
      note: '样本已按 ' + sample.winsor.lo + '/' + sample.winsor.hi + ' 缩尾；标准差为样本标准差（ddof=1）'
    });

    var cvars = CORR_VARS.filter(function (v) { return sampleHas(sample, v); });
    var cRows = [], cLabels = [], ci, cj;
    for (ci = 0; ci < cvars.length; ci++) {
      var r2 = [cvars[ci]];
      for (cj = 0; cj < cvars.length; cj++) {
        r2.push(cj <= ci ? econ.correlation(colOf(rows, cvars[ci]), colOf(rows, cvars[cj])) : '');
      }
      cRows.push(r2); cLabels.push(cvars[ci]);
    }
    var cHead = ['']; for (ci = 0; ci < cvars.length; ci++) cHead.push(cvars[ci]);
    var cNum = []; for (ci = 1; ci <= cvars.length; ci++) cNum.push(ci);
    var tCorr = makeTable('descriptive.corr', '相关系数矩阵（下三角，Pearson）', cHead, cRows, {
      numCols: cNum, formats: (function () { var f = {}, i2; for (i2 = 1; i2 < cHead.length; i2++) f[i2] = 'coef'; return f; })(),
      rowLabels: cLabels, note: '对角线由 econ.correlation(x,x) 计算'
    });

    var pairs = [['ln_innov', 'digi'], ['ln_innov', 'size'], ['digi', 'size']].filter(function (p2) {
      return sampleHas(sample, p2[0]) && sampleHas(sample, p2[1]);
    });
    var sRows = [], sLabels = [];
    pairs.forEach(function (p2) {
      var x = colOf(rows, p2[0]), y = colOf(rows, p2[1]);
      var pl = [], i2;
      for (i2 = 0; i2 < x.length; i2++) if (isFinite(x[i2]) && isFinite(y[i2])) pl.push([x[i2], y[i2]]);
      var n = pl.length, r = econ.correlation(x, y);
      var t = (n > 2 && isFinite(r) && Math.abs(r) < 1) ? r * Math.sqrt((n - 2) / (1 - r * r)) : NaN;
      sRows.push([p2[0] + ' ~ ' + p2[1], r, n, t, econ.tPValue(t, n - 2)]);
      sLabels.push(p2[0] + '~' + p2[1]);
    });
    var tCorrSig = makeTable('descriptive.corrSig', '关键相关系数与其显著性', ['变量对', '相关系数 r', 'N', 't 值', 'p 值'], sRows, {
      numCols: [1, 2, 3, 4], formats: { 1: 'coef', 2: 'int', 3: 'coef', 4: 'p' }, rowLabels: sLabels,
      note: 't = r·sqrt((N-2)/(1-r²))，p 由 econ.tPValue(t, N-2) 给出'
    });

    var vifVars = BASE_X.filter(function (v) { return sampleHas(sample, v); });
    /* 注意：econ.vif 期望 X 是"行 × 列"矩阵（X[0].length 必须等于列数） */
    var vifMat = rows.map(function (o) { return vifVars.map(function (v) { return num(o[v]); }); });
    var vifRes = econ.vif(vifMat, vifVars);
    var vRows = [], vLabels = [];
    vifRes.forEach(function (x) { vRows.push([x.name, x.vif]); vLabels.push(x.name); });
    var maxVif = -Infinity, i3;
    for (i3 = 0; i3 < vifRes.length; i3++) if (isFinite(vifRes[i3].vif) && vifRes[i3].vif > maxVif) maxVif = vifRes[i3].vif;
    var tVif = makeTable('descriptive.vif', '方差膨胀因子（econ.vif，辅助回归无 FE）', ['变量', 'VIF'], vRows, {
      numCols: [1], formats: { 1: 'v' }, rowLabels: vLabels, note: 'VIF 在中心化后的设计矩阵上计算'
    });

    var dcol = colOf(rows, 'digi'), ycol = colOf(rows, 'ln_innov');
    var med = econ.median(finite(dcol));
    var hi = [], lo = [];
    for (i3 = 0; i3 < rows.length; i3++) {
      if (!isFinite(dcol[i3]) || !isFinite(ycol[i3])) continue;
      (dcol[i3] > med ? hi : lo).push(ycol[i3]);
    }
    var wt = welch(hi, lo);
    var gRows = [
      ['高数字化组（digi > 中位数）', hi.length, econ.mean(hi), econ.sd(hi)],
      ['低数字化组（digi ≤ 中位数）', lo.length, econ.mean(lo), econ.sd(lo)]
    ];
    var tGroup = makeTable('descriptive.group', '分组均值对比（按 digi 中位数分组）', ['组', 'N', 'ln_innov 均值', '标准差'], gRows, {
      numCols: [1, 2, 3], formats: { 1: 'int' }, rowLabels: ['高数字化组', '低数字化组'], note: '分组中位数 = ' + fmtNum(med, 4)
    });
    var tWelch = makeTable('descriptive.welch', '组间差异检验（Welch t）', ['统计量', '值'], [
      ['均值差异（高 − 低）', wt.diff],
      ['差异标准误', wt.se],
      ['t 值', wt.t],
      ['Welch 自由度', wt.df],
      ['p 值', wt.p]
    ], { numCols: [1], formats: { 1: 'v' }, rowLabels: ['差异', '标准误', 't', 'df', 'p'], note: 'econ 未提供两样本 t 检验，此处用 econ.mean/variance/tPValue 组合实现 Welch t（近似）' });

    var tables = [tDesc, tCorr, tCorrSig, tVif, tGroup, tWelch];
    var digiRow = null;
    for (i3 = 0; i3 < dLabels.length; i3++) if (dLabels[i3] === 'digi') digiRow = 'digi';
    var metrics = [
      metricFrom('相关系数 corr(digi, ln_innov)', cellAt(tCorrSig, 'ln_innov~digi', '相关系数 r')),
      metric('最大 VIF', isFinite(maxVif) ? fmtNum(maxVif, 2) : '—'),
      metricFrom('高数字化组均值', cellAt(tGroup, '高数字化组', 'ln_innov 均值')),
      metricFrom('低数字化组均值', cellAt(tGroup, '低数字化组', 'ln_innov 均值'))
    ];
    var sent = [];
    if (digiRow && cellAt(tCorrSig, 'ln_innov~digi', '相关系数 r')) {
      sent.push('ln_innov 与 digi 的 Pearson 相关系数为 ' + ph(tCorrSig, 'ln_innov~digi', '相关系数 r') +
        '（N=' + ph(tCorrSig, 'ln_innov~digi', 'N') + '，p=' + ph(tCorrSig, 'ln_innov~digi', 'p 值') + '）。');
    }
    if (digiRow) {
      sent.push('digi 的均值为 ' + ph(tDesc, 'digi', '均值') + '（标准差 ' + ph(tDesc, 'digi', '标准差') +
        '，中位数 ' + ph(tDesc, 'digi', '中位数') + '，最小 ' + ph(tDesc, 'digi', '最小值') + '，最大 ' + ph(tDesc, 'digi', '最大值') + '）。');
    }
    sent.push('多重共线性：最大 VIF = ' + (isFinite(maxVif) ? fmtNum(maxVif, 2) : '—') + '（逐变量见 VIF 表）。');
    sent.push('按 digi 中位数分组：高数字化组 ln_innov 均值为 ' + ph(tGroup, '高数字化组', 'ln_innov 均值') + '（N=' + ph(tGroup, '高数字化组', 'N') +
      '），低数字化组为 ' + ph(tGroup, '低数字化组', 'ln_innov 均值') + '（N=' + ph(tGroup, '低数字化组', 'N') +
      '），差异 ' + ph(tWelch, '差异', '值') + '，Welch t = ' + ph(tWelch, 't', '值') + '，p = ' + ph(tWelch, 'p', '值') + '。');
    var ip = interp(tables, sent);
    var diag = {
      vif: vifRes, maxVif: maxVif, welch: wt, groupMedian: med,
      digiMedian: med, note: '描述统计基于清理 + 缩尾后的分析样本；分组对仅为描述，不含因果含义',
      warnings: []
    };
    if (isFinite(maxVif) && maxVif >= 10) diag.warnings.push('存在 VIF ≥ 10 的变量，多重共线性需处理');
    var prov = mkProv('descriptive', sample, {
      variables: vars2prov(sample), y: sampleHas(sample, 'ln_innov') ? 'ln_innov' : null,
      x: vifVars, fe: [], cluster: null, specHash: specHashOf([{ step: 'descriptive', vars: vars, corr: cvars, vif: vifVars }])
    });
    return pack('descriptive', sample, tables, metrics, ip, diag, prov);
  }

  /* ========================== ③ 基准回归 ========================== */
  function stepBaseline(sample, ctx) {
    var spec = baselineSpecOf(sample, ctx);
    var res = fitSpec(spec);
    var prov = mkProv('baseline', sample, {
      variables: vars2prov(sample), y: spec.yVar, x: spec.xVars, fe: spec.feVars, cluster: spec.clusterVar,
      specHash: specHashOf([specSummary(spec)])
    });
    if (!res.ok) return failedResult('baseline', sample, res.code, res.message, { provenance: prov });
    var t = coefTable('baseline.coef', '基准回归系数', res, 'ln_innov ~ digi + size + lev + roa + age + subsidy，firm + year 双向固定效应，企业层聚类');
    var tFit = makeTable('baseline.fit', '拟合与样本信息', ['指标', '值'], [
      ['观测数 N', res.nObs],
      ['参数个数 k', res.nParams],
      ['残差自由度', res.dfResid],
      ['回归内额外剔除缺失', res.droppedMissing],
      ['聚类数 G', res.cluster ? res.cluster.nClusters : NaN],
      ['组内 R²', res.r2Within],
      ['总体 R²', res.r2Overall],
      ['调整 R²', res.adjR2],
      ['联合显著性统计量（Wald χ²）', res.fStat],
      ['Wald p 值', res.fP],
      ['去均值迭代次数', res.demean ? res.demean.iterations : 1]
    ], { numCols: [1], formats: function (r) { return (r <= 4 || r === 8 || r === 10) ? 'int' : (r === 9 ? 'p' : 'coef'); }, rowLabels: ['N', 'k', 'df', '额外剔除', '聚类数', '组内R2', '总体R2', '调整R2', 'F', 'Fp', '迭代'] });
    var tables = [t, tFit];
    var digiCell = cellAt(t, 'digi', '系数');
    var metrics = [
      metricFrom('N', cellAt(tFit, 'N', '值')),
      metricFrom('组内 R²', cellAt(tFit, '组内R2', '值')),
      metricFrom('聚类数', cellAt(tFit, '聚类数', '值')),
      metric('固定效应', spec.feVars.join(' + '))
    ];
    var ip = interp(tables, [
      '基准回归：被解释变量 ' + spec.yVar + '，核心解释变量 digi，控制变量 ' + spec.xVars.slice(1).join('、') +
      '，固定效应 ' + spec.feVars.join(' + ') + '，标准误聚类到 ' + spec.clusterVar + '。',
      'digi 的系数为 ' + ph(t, 'digi', '系数') + '（标准误 ' + ph(t, 'digi', '标准误') + '，t = ' + ph(t, 'digi', 't 值') +
      '，p = ' + ph(t, 'digi', 'p 值') + '，显著性 ' + tx(t, 'digi', '显著性') + '）。',
      '样本量 N = ' + ph(tFit, 'N', '值') + '，聚类数 G = ' + ph(tFit, '聚类数', '值') + '，组内 R² = ' + ph(tFit, '组内R2', '值') +
      '，总体 R² = ' + ph(tFit, '总体R2', '值') + '，联合显著性 Wald χ² = ' + ph(tFit, 'F', '值') + '（p = ' + ph(tFit, 'Fp', '值') + '）。',
      '去均值迭代 ' + ph(tFit, '迭代', '值') + ' 次（收敛标志 = ' + (res.demean && res.demean.converged ? 'true' : 'false') + '）。',
      '常数项被固定效应完全吸收，因此不单独估计（coef 记为 0、se/t/p 为空，避免报出一个假的显著截距）。'
    ]);
    var diag = {
      nObs: res.nObs, droppedMissing: res.droppedMissing, r2Within: res.r2Within, r2Overall: res.r2Overall,
      adjR2: res.adjR2, fStat: res.fStat, fP: res.fP, fNote: 'F/Wald p 值由 econ.chi2cdf 近似给出（Wilson–Hilferty）',
      cluster: res.cluster, demean: res.demean, absorbedConst: !!res.absorbedConst, sigma: res.sigma,
      notes: fitNotes(res, '基准回归'),
      warnings: fitDiagnostics(res, '基准回归')
    };
    var exp = ctx && ctx.expectation;
    if (exp && exp.sign) {
      var sign = res.coefficients.filter(function (c) { return c.name === 'digi'; })[0];
      var got = sign.coef > 0 ? '+' : (sign.coef < 0 ? '-' : '0');
      diag.expectation = { expected: exp.sign, got: got, signMatch: got === exp.sign, range: (exp.min !== undefined ? [exp.min, exp.max] : null) };
      if (got !== exp.sign) diag.warnings.push('核心系数符号与设计预期（' + exp.sign + '）不一致：实际 ' + got);
      if (exp.min !== undefined && (sign.coef < exp.min || sign.coef > exp.max)) {
        diag.warnings.push('核心系数 ' + fmtNum(sign.coef, 4) + ' 超出设计预期区间 [' + exp.min + ', ' + exp.max + ']');
      }
    }
    return pack('baseline', sample, tables, metrics, ip, diag, prov);
  }

  /* ========================== ④ 稳健性 ========================== */
  function robustnessItems(sample, ctx) {
    var items = [];
    var altY = sampleHas(sample, 'ln_innov_inv') ? 'ln_innov_inv' : null;
    var altX = sampleHas(sample, 'digi_alt') ? 'digi_alt' : null;
    items.push({
      id: 'baseline', label: '基准设定（对照）', required: true, kind: 'reference',
      spec: baselineSpecOf(sample, ctx)
    });
    items.push({
      id: 'alt-y', label: '替换被解释变量' + (altY ? '（' + altY + '，发明专利）' : ''), required: true, kind: 'robust',
      spec: altY ? specOf(sample, { id: 'alt-y', title: '替换被解释变量', y: altY, x: BASE_X, fe: ['firm_id', 'year'], cluster: 'firm_id' })
        : null, failCode: 'MISSING_VAR', failMessage: '数据缺少替代被解释变量列（ln_innov_inv）'
    });
    items.push({
      id: 'alt-x', label: '替换核心解释变量' + (altX ? '（' + altX + '，无形资产占比）' : ''), required: true, kind: 'robust',
      spec: altX ? specOf(sample, { id: 'alt-x', title: '替换核心解释变量', y: 'ln_innov', x: [altX].concat(BASE_X.slice(1)), fe: ['firm_id', 'year'], cluster: 'firm_id' })
        : null, coreVar: altX, failCode: 'MISSING_VAR', failMessage: '数据缺少替代核心解释变量列（digi_alt）'
    });
    items.push({
      id: 'cluster-industry', label: '更换聚类层级（行业）', required: true, kind: 'robust',
      spec: sampleHas(sample, 'industry_id')
        ? specOf(sample, { id: 'cluster-industry', title: '更换聚类层级', y: 'ln_innov', x: BASE_X, fe: ['firm_id', 'year'], cluster: 'industry_id' })
        : null, failCode: 'MISSING_VAR', failMessage: '数据缺少行业列（industry_id）'
    });
    items.push({
      id: 'placebo-lead2', label: '安慰剂 A：把 digi 提前 2 期', required: true, kind: 'placebo',
      spec: specOf(sample, { id: 'placebo-lead2', title: '安慰剂（前导解释变量）', y: 'ln_innov', x: ['digi_lead2'].concat(BASE_X.slice(1)), fe: ['firm_id', 'year'], cluster: 'firm_id', derive: ['digi_lead2'] }),
      coreVar: 'digi_lead2',
      note: '若数字化只通过当期渠道影响创新，前导项不应显著；但 digi 存在序列相关时前导项可能带有信息'
    });
    items.push({
      id: 'placebo-permute', label: '安慰剂 B：企业内随机置换 digi（seed 固定）', required: true, kind: 'placebo',
      spec: specOf(sample, { id: 'placebo-permute', title: '安慰剂（置换检验）', y: 'ln_innov', x: ['digi_perm'].concat(BASE_X.slice(1)), fe: ['firm_id', 'year'], cluster: 'firm_id', derive: ['digi_perm'] }),
      coreVar: 'digi_perm'
    });
    items.push({
      id: 'window', label: '更换样本窗（后 5 期）', required: false, kind: 'robust',
      spec: (function () {
        var yrs = finite(colOf(sample.rows, 'year')).slice().sort(function (a, b) { return a - b; });
        var cut = yrs.length ? yrs[Math.max(0, Math.floor(yrs.length * 0.4))] : NaN;
        return specOf(sample, {
          id: 'window', title: '更换样本窗', y: 'ln_innov', x: BASE_X, fe: ['firm_id', 'year'], cluster: 'firm_id',
          filter: function (r) { return num(r.year) >= cut; }, filterNote: 'year >= ' + cut
        });
      })()
    });
    items.push({
      id: 'drop-controls', label: '增删控制变量（仅 digi + size）', required: false, kind: 'robust',
      spec: specOf(sample, { id: 'drop-controls', title: '增删控制变量', y: 'ln_innov', x: ['digi', 'size'], fe: ['firm_id', 'year'], cluster: 'firm_id' })
    });
    return items;
  }
  function verdictOf(base, coef, p) {
    if (!isFinite(coef)) return '未能计算';
    var same = (base === 0) ? '—' : ((coef > 0) === (base > 0) ? '符号一致' : '符号反转');
    var sig = !isFinite(p) ? 'p 缺失' : (p < 0.05 ? '5% 显著' : (p < 0.1 ? '10% 显著' : '不显著'));
    return same + '，' + sig;
  }
  function stepRobustness(sample, ctx) {
    var items = robustnessItems(sample, ctx), runs = [], i;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.spec) { runs.push({ item: it, core: it.coreVar || 'digi', ok: false, code: it.failCode || 'MISSING_VAR', message: it.failMessage || '缺少必要变量' }); continue; }
      var res = fitSpec(it.spec);
      var core = it.coreVar || 'digi';
      var c = null, j;
      if (res.ok) for (j = 0; j < res.coefficients.length; j++) if (res.coefficients[j].name === core) c = res.coefficients[j];
      runs.push({ item: it, res: res, core: core, coef: c, ok: !!res.ok && !!c });
      if (res.ok && !c) runs[runs.length - 1].code = 'NO_CORE_COEF';
      if (res.ok && !c) runs[runs.length - 1].message = '回归结果中没有核心变量的系数（' + core + '）';
      if (!res.ok) { runs[runs.length - 1].code = res.code; runs[runs.length - 1].message = res.message; }
    }
    var baseRun = runs[0], baseCoef = (baseRun.coef && isFinite(baseRun.coef.coef)) ? baseRun.coef.coef : NaN;
    var rows = [], labels = [], stat = [], requiredFailed = [], placeboSig = [];
    for (i = 0; i < runs.length; i++) {
      var r = runs[i], ok = r.ok && r.coef && isFinite(r.coef.coef);
      if (!ok) {
        rows.push([r.item.label, r.core || 'digi', NaN, NaN, NaN, NaN, NaN, NaN, NaN, '失败：' + (r.code || 'UNKNOWN') + ' —— ' + (r.message || '')]);
        labels.push(r.item.id); stat.push(null);
        if (r.item.required) requiredFailed.push(r.item.id + '：' + (r.code || 'UNKNOWN') + ' ' + (r.message || ''));
        continue;
      }
      var v = verdictOf(baseCoef, r.coef.coef, r.coef.p);
      if (r.item.kind === 'placebo' && isFinite(r.coef.p) && r.coef.p < 0.1) placeboSig.push(r.item.id + '（p=' + fmtP(r.coef.p) + '）');
      if (r.res.cluster && r.res.cluster.nClusters < 30) v += '；聚类数 ' + r.res.cluster.nClusters + '，推断偏乐观';
      if (r.core !== 'digi') v += '；核心变量已替换为 ' + r.core + '，系数与基准不可直接比大小';
      rows.push([r.item.label, r.core || 'digi', r.coef.coef, r.coef.se, r.coef.t, r.coef.p, r.res.nObs,
        r.res.cluster ? r.res.cluster.nClusters : NaN, r.res.r2Within, v]);
      labels.push(r.item.id); stat.push({ coef: r.coef.coef, se: r.coef.se, t: r.coef.t, p: r.coef.p });
    }
    var t = makeTable('robustness.matrix', '稳健性矩阵（逐项为一次真实估计）',
      ['检验项', '核心变量', '系数', '标准误', 't 值', 'p 值', 'N', '聚类数', '组内 R²', '结论'], rows, {
      numCols: [2, 3, 4, 5, 6, 7, 8], formats: { 2: 'coef', 3: 'coef', 4: 'coef', 5: 'p', 6: 'int', 7: 'int', 8: 'coef' },
      rowLabels: labels, terms: labels, stat: stat,
      note: '每行都是一次真实估计；失败行以引擎返回的 code/message 如实标注，不填占位数字。替换核心解释变量的那一行系数与基准不同口径，不可直接比较大小'
    });
    var doneN = 0, signKeep = 0, minCoef = Infinity;
    for (i = 0; i < runs.length; i++) {
      if (!runs[i].ok || !runs[i].coef || !isFinite(runs[i].coef.coef)) continue;
      doneN++;
      if (baseCoef !== 0 && ((runs[i].coef.coef > 0) === (baseCoef > 0))) signKeep++;
      if (runs[i].core === 'digi' && runs[i].item.kind !== 'placebo' && runs[i].item.kind !== 'reference' &&
        Math.abs(runs[i].coef.coef) < Math.abs(minCoef)) minCoef = runs[i].coef.coef;
    }
    var tables = [t];
    var metrics = [
      metric('完成项', doneN + ' / ' + runs.length),
      metric('符号一致（含基准）', signKeep + ' / ' + doneN),
      metric('同口径（digi）非安慰剂项最小系数', isFinite(minCoef) ? fmtNum(minCoef, 4) : '—'),
      metric('安慰剂是否通过（p≥0.1）', placeboSig.length ? '否' : '是')
    ];
    var sent = ['稳健性检验共 ' + runs.length + ' 项，全部为真实估计。'];
    for (i = 0; i < runs.length; i++) {
      var rr = runs[i];
      if (!(rr.ok && rr.coef && isFinite(rr.coef.coef))) continue;
      sent.push(rr.item.label + '：' + (rr.core || 'digi') + ' 系数 ' + ph(t, rr.item.id, '系数') + '（标准误 ' + ph(t, rr.item.id, '标准误') +
        '，p ' + ph(t, rr.item.id, 'p 值') + '，N = ' + ph(t, rr.item.id, 'N') + '，聚类数 ' + ph(t, rr.item.id, '聚类数') + '）。');
    }
    /* 安慰剂判定：逐项按真实 p 值给出结论（不预设立场） */
    var placeboDetail = [];
    for (i = 0; i < runs.length; i++) {
      var pl = runs[i];
      if (pl.item.kind !== 'placebo' || !(pl.ok && pl.coef && isFinite(pl.coef.p))) continue;
      var pass = pl.coef.p >= 0.1;
      placeboDetail.push({ id: pl.item.id, coef: pl.coef.coef, p: pl.coef.p, pass: pass, kind: pl.item.id === 'placebo-permute' ? 'permute' : 'lead' });
      sent.push('安慰剂「' + pl.item.label + '」系数 ' + ph(t, pl.item.id, '系数') + '（p ' + ph(t, pl.item.id, 'p 值') + '）：' +
        (pass
          ? '不显著，未发现该设定下的伪相关。'
          : (pl.item.id === 'placebo-permute'
            ? '在 10% 水平显著 —— 置换检验本应无系统性相关，出现显著系数说明设定或推断存在问题，不能采信。'
            : '在 10% 水平显著 —— 前导/滞后期并非干净的外生检验：当被解释变量存在真实动态（或 digi 序列相关）时，前导项会经序列相关与真实解释变量相关，因此该结果只能作为"存在动态设定风险"的证据，不能据此宣称或否定因果。')));
    }
    var ip = interp(tables, sent);
    var diag = {
      items: runs.map(function (r2) {
        return {
          id: r2.item.id, label: r2.item.label, required: !!r2.item.required, kind: r2.item.kind,
          status: (r2.ok && r2.coef && isFinite(r2.coef.coef)) ? 'done' : 'failed',
          code: (r2.ok && r2.coef) ? null : (r2.code || 'UNKNOWN'),
          message: (r2.ok && r2.coef) ? null : (r2.message || ''),
          spec: r2.item.spec ? specSummary(r2.item.spec) : null,
          cluster: r2.res && r2.res.cluster ? r2.res.cluster.nClusters : null,
          nObs: r2.res ? r2.res.nObs : null,
          demean: r2.res && r2.res.demean ? r2.res.demean : null
        };
      }),
      completed: doneN, total: runs.length, failedRequired: requiredFailed, placeboSignificant: placeboSig,
      placebo: placeboDetail,
      notes: [], warnings: []
    };
    for (i = 0; i < runs.length; i++) if (runs[i].res && runs[i].res.ok) {
      diag.warnings = diag.warnings.concat(fitDiagnostics(runs[i].res, runs[i].item.label));
      diag.notes = diag.notes.concat(fitNotes(runs[i].res, runs[i].item.label));
    }
    if (placeboSig.length) diag.warnings.push('安慰剂检验出现显著系数（' + placeboSig.join('、') + '）：该设定可能捕捉了趋势/序列相关，而非因果效应');
    if (requiredFailed.length) diag.warnings.push('必需稳健性项失败：' + requiredFailed.join('；').replace(/;\s*$/, ''));
    var prov = mkProv('robustness', sample, {
      variables: vars2prov(sample), y: 'ln_innov', x: BASE_X, fe: ['firm_id', 'year'], cluster: 'firm_id',
      specHash: specHashOf(runs.map(function (r2) { return r2.item.spec ? specSummary(r2.item.spec) : { id: r2.item.id, failed: r2.code }; }))
    });
    if (requiredFailed.length || !(baseRun.ok && baseRun.coef)) {
      var code = requiredFailed.length ? 'ROBUSTNESS_ITEM_FAILED' : (baseRun.code || 'ENGINE_FAILED');
      var msg = requiredFailed.length ? ('必需稳健性项失败 —— ' + requiredFailed.join('；')) : (baseRun.message || '基准设定未能估计');
      var failed = failedResult('robustness', sample, code, msg, { diagnostics: diag, provenance: prov });
      failed.tables = tables; failed.cells = tables[0].cells; failed.metrics = metrics;
      failed.primaryTableId = t.id;
      failed.primaryTable = { head: t.head.slice(), rows: t.formattedRows, numericRows: t.rows, numCols: t.numCols.slice(), note: t.note };
      failed.table = failed.primaryTable;
      failed.interpretation = ip; failed.summary = ip.text;
      failed.diagnostics.failedItems = requiredFailed;
      return failed;
    }
    return pack('robustness', sample, tables, metrics, ip, diag, prov);
  }

  /* ========================== ⑤ 内生性 ========================== */
  /** 通用 OLS（矩阵已就绪）；Xresid 用于计算残差（2SLS 第二阶段传真实回归元） */
  function olsRaw(y, X, cluster, Xresid) {
    var econ = E();
    var n = y.length, k = X[0].length, i, j;
    var XtXi = econ.inverse(econ.xtx(X));
    if (!XtXi) return { ok: false, code: 'SINGULAR', message: '设计矩阵奇异：可能存在完全共线', nObs: n };
    var Xty = new Array(k).fill(0);
    for (i = 0; i < n; i++) for (j = 0; j < k; j++) Xty[j] += X[i][j] * y[i];
    var beta = new Array(k).fill(0);
    for (i = 0; i < k; i++) { var s = 0; for (j = 0; j < k; j++) s += XtXi[i][j] * Xty[j]; beta[i] = s; }
    var Xr = Xresid || X, resid = new Array(n), ssr = 0;
    if (Xr.length !== n || (n && Xr[0].length !== k)) {
      return { ok: false, code: 'MATRIX_MISMATCH', message: '残差矩阵宽度与估计矩阵不一致（' + (Xr[0] ? Xr[0].length : 0) + ' vs ' + k + '）', nObs: n };
    }
    for (i = 0; i < n; i++) {
      var f = 0;
      for (j = 0; j < k; j++) f += Xr[i][j] * beta[j];
      resid[i] = y[i] - f;
      ssr += resid[i] * resid[i];
    }
    var df = n - k;
    if (df <= 0) return { ok: false, code: 'NO_DF', message: '自由度不足：k=' + k + ' ≥ n=' + n, nObs: n };
    var V, G = null, note = '';
    if (cluster) {
      var buckets = Object.create(null);
      for (i = 0; i < n; i++) { var key = String(cluster[i]); (buckets[key] = buckets[key] || []).push(i); }
      G = Object.keys(buckets).length;
      if (G < 2) return { ok: false, code: 'TOO_FEW_CLUSTERS', message: '聚类数不足（G=' + G + '）', nObs: n, nClusters: G };
      var meat = [];
      for (i = 0; i < k; i++) meat.push(new Array(k).fill(0));
      Object.keys(buckets).forEach(function (gk) {
        var idx = buckets[gk], s = new Array(k).fill(0), m, a, b;
        for (m = 0; m < idx.length; m++) {
          var ii = idx[m], u = resid[ii];
          for (a = 0; a < k; a++) s[a] += X[ii][a] * u;
        }
        for (a = 0; a < k; a++) for (b = 0; b < k; b++) meat[a][b] += s[a] * s[b];
      });
      var scale = (G / (G - 1)) * ((n - 1) / (n - k));
      for (i = 0; i < k; i++) for (j = 0; j < k; j++) meat[i][j] *= scale;
      V = econ.matMul(econ.matMul(XtXi, meat), XtXi);
      note = 'G=' + G + '，有限样本校正 G/(G-1)×(n-1)/(n-k)';
    } else {
      var sigma2 = ssr / df;
      V = XtXi.map(function (row) { return row.map(function (v) { return v * sigma2; }); });
      note = '同方差假设';
    }
    var se = [], tv = [], pv = [];
    for (i = 0; i < k; i++) {
      se.push(Math.sqrt(Math.max(V[i][i], 0)));
      tv.push(se[i] > 0 ? beta[i] / se[i] : NaN);
      pv.push(econ.tPValue(tv[i], df));
    }
    return { ok: true, beta: beta, se: se, t: tv, p: pv, vcov: V, resid: resid, nObs: n, dfResid: df, ssr: ssr, nClusters: G, clusterNote: note };
  }
  /**
   * 2SLS（含 FE 去均值 + 聚类稳健标准误）。econ 未提供 2SLS，因此在此用
   * econ.demean / econ.inverse / econ.xtx / econ.matMul / econ.waldStat 组装，
   * 第一阶段 F 由 econ.waldStat 给出（单工具时等于 t²）。
   */
  function twoSLS(sample, cfg) {
    var econ = E();
    var rows = ensureDerived(sample, cfg.derive || []);
    var idx = [], i, j;
    for (i = 0; i < rows.length; i++) if (!cfg.filter || cfg.filter(rows[i], i)) idx.push(i);
    var names = [cfg.endog].concat(cfg.controls).concat(cfg.instruments);
    var use = idx.filter(function (ix) {
      if (!isFinite(num(rows[ix][cfg.y]))) return false;
      for (var q = 0; q < names.length; q++) if (!isFinite(num(rows[ix][names[q]]))) return false;
      return true;
    });
    if (use.length < names.length + 2) return { ok: false, code: 'TOO_FEW_OBS', message: '有效观测不足以估计 2SLS（剩余 ' + use.length + '）', nObs: use.length };
    var y = use.map(function (ix) { return num(rows[ix][cfg.y]); });
    var M = use.map(function (ix) { return names.map(function (nm) { return num(rows[ix][nm]); }); });
    var feDims = (cfg.fe || []).map(function (nm) { return use.map(function (ix) { return rows[ix][nm]; }); });
    var dm = feDims.length ? econ.demean(M, y, feDims) : { X: M, y: y, iterations: 1, maxChange: 0, converged: true };
    var Md = dm.X, yd = dm.y;
    var p = cfg.controls.length, q = cfg.instruments.length;
    var hasConst = !feDims.length;
    var cIdx = function (a) { return 1 + a; }, zIdx = function (a) { return 1 + p + a; };
    /* 第一阶段：endog ~ controls + instruments；XsRows = 结构方程回归元 [endog, controls] */
    var Zrows = [], XsRows = [], XhRows = [];
    var ones = hasConst ? 1 : 0;
    for (i = 0; i < Md.length; i++) {
      var zr = hasConst ? [1] : [], xr = hasConst ? [1] : [], a;
      xr.push(Md[i][0]);                                   /* 内生变量（实际值，用于残差） */
      for (a = 0; a < p; a++) { zr.push(Md[i][cIdx(a)]); xr.push(Md[i][cIdx(a)]); }
      for (a = 0; a < q; a++) zr.push(Md[i][zIdx(a)]);
      Zrows.push(zr); XsRows.push(xr);
    }
    var endogD = Md.map(function (r) { return r[0]; });
    var cl = cfg.cluster ? use.map(function (ix) { return rows[ix][cfg.cluster]; }) : null;
    var f1 = olsRaw(endogD, Zrows, cl);
    if (!f1.ok) return f1;
    var pi = f1.beta;
    /* 第二阶段：X̂ = [常数?, digi 拟合值, 控制变量]；残差用真实 digi（XsRows） */
    for (i = 0; i < Zrows.length; i++) {
      var fv = 0;
      for (j = 0; j < pi.length; j++) fv += Zrows[i][j] * pi[j];
      var hr = hasConst ? [1] : [], a2;
      hr.push(fv);
      for (a2 = 0; a2 < p; a2++) hr.push(Md[i][cIdx(a2)]);
      XhRows.push(hr);
    }
    var f2 = olsRaw(yd, XhRows, cl, XsRows);
    if (!f2.ok) return f2;
    /* 第一阶段排除性工具的 Wald 检验（econ.waldStat），F = Wald / q */
    var base = ones, R = [], rr = [];
    for (i = 0; i < q; i++) {
      var rowR = new Array(pi.length).fill(0);
      rowR[base + p + i] = 1;
      R.push(rowR); rr.push(0);
    }
    var wald = econ.waldStat(pi, f1.vcov, R, rr);
    var F = (wald === null || !isFinite(wald)) ? NaN : wald / q;
    var FP = isFinite(F) ? 1 - econ.chi2cdf(F * q, q) : NaN;
    return {
      ok: true, nObs: use.length, droppedMissing: idx.length - use.length,
      beta: f2.beta, se: f2.se, t: f2.t, p: f2.p, dfResid: f2.dfResid, nClusters: f2.nClusters,
      firstStage: {
        beta: pi, se: f1.se, t: f1.t, p: f1.p, nObs: f1.nObs, nClusters: f1.nClusters,
        F: F, Fq: q, Fp: FP, wald: wald,
        names: (hasConst ? ['常数项'] : []).concat(cfg.controls).concat(cfg.instruments),
        endog: cfg.endog
      },
      demean: dm,
      spec: { y: cfg.y, endog: cfg.endog, controls: cfg.controls, instruments: cfg.instruments, fe: cfg.fe || [], cluster: cfg.cluster || null }
    };
  }
  function stepEndogeneity(sample, ctx) {
    var econ = E();
    var rows = [], labels = [], stat = [], tables = [], warnings = [];
    var specOls = baselineSpecOf(sample, ctx);
    var rOls = fitSpec(specOls);
    var specLag = specOf(sample, { id: 'lag1', title: '滞后一期解释变量', y: 'ln_innov', x: ['digi_lag1'].concat(BASE_X.slice(1)), fe: ['firm_id', 'year'], cluster: 'firm_id', derive: ['digi_lag1'] });
    var rLag = fitSpec(specLag);
    var fLag = function () { var c = null, i; if (rLag.ok) for (i = 0; i < rLag.coefficients.length; i++) if (rLag.coefficients[i].name === 'digi_lag1') c = rLag.coefficients[i]; return c; }();
    var ivReady = sampleHas(sample, 'industry_id');
    var specIv = ivReady ? specOf(sample, { id: 'iv-fs', title: 'IV 第一阶段', y: 'digi', x: ['z_iv'].concat(BASE_X.slice(1)), fe: ['firm_id', 'year'], cluster: 'firm_id', derive: ['z_iv'] }) : null;
    var rIv = specIv ? fitSpec(specIv) : null;
    var fIv = null, i;
    if (rIv && rIv.ok) for (i = 0; i < rIv.coefficients.length; i++) if (rIv.coefficients[i].name === 'z_iv') fIv = rIv.coefficients[i];
    var F = (fIv && isFinite(fIv.t)) ? fIv.t * fIv.t : NaN;
    var two = ivReady ? twoSLS(sample, { y: 'ln_innov', endog: 'digi', controls: BASE_X.slice(1), instruments: ['z_iv'], fe: ['firm_id', 'year'], cluster: 'firm_id', derive: ['z_iv'] }) : { ok: false, code: 'MISSING_VAR', message: '数据缺少行业列（industry_id），无法构造同行业同年度工具变量' };

    function pushRow(label, cell, n, G, Fv, note, ok) {
      labels.push(label);
      if (!ok) {
        rows.push([label, NaN, NaN, NaN, NaN, NaN, NaN, NaN, note]); stat.push(null); return;
      }
      rows.push([label, cell.coef, cell.se, cell.t, cell.p, n, G, Fv, note]);
      stat.push({ coef: cell.coef, se: cell.se, t: cell.t, p: cell.p });
    }
    var cOls = null;
    if (rOls.ok) for (i = 0; i < rOls.coefficients.length; i++) if (rOls.coefficients[i].name === 'digi') cOls = rOls.coefficients[i];
    pushRow('OLS（基准）', cOls, rOls.ok ? rOls.nObs : NaN, rOls.ok && rOls.cluster ? rOls.cluster.nClusters : NaN, NaN, rOls.ok ? '报告' : ('失败：' + rOls.code), !!cOls);
    pushRow('滞后一期解释变量', fLag, rLag.ok ? rLag.nObs : NaN, rLag.ok && rLag.cluster ? rLag.cluster.nClusters : NaN, NaN,
      rLag.ok ? ('滞后一期系数 ' + fmtNum(fLag.coef, 4)) : ('失败：' + rLag.code + ' ' + rLag.message), !!(rLag.ok && fLag));
    var weak = isFinite(F) && F < IV_F_THRESHOLD;
    var ivNote;
    if (two.ok) ivNote = weak ? ('弱工具（F=' + fmtNum(F, 2) + ' < ' + IV_F_THRESHOLD + '），2SLS 估计不可作因果解读') : '报告（第一阶段 F 通过经验门槛）';
    else ivNote = '失败：' + two.code + ' —— ' + two.message;
    var b0 = two.ok ? two.beta[0] : NaN, s0 = two.ok ? two.se[0] : NaN, t0 = two.ok ? two.t[0] : NaN, p0 = two.ok ? two.p[0] : NaN;
    rows.push(['2SLS（同行业同年度均值工具）', b0, s0, t0, p0, two.ok ? two.nObs : NaN, two.ok ? two.nClusters : NaN, F, ivNote]);
    stat.push(two.ok ? { coef: b0, se: s0, t: t0, p: p0 } : null);
    labels.push('2sls');
    var tMain = makeTable('endogeneity.iv', '内生性处理对比（核心变量 digi）',
      ['设定', 'digi 系数', '标准误', 't 值', 'p 值', 'N', '聚类数', '第一阶段 F', '结论'], rows, {
      numCols: [1, 2, 3, 4, 5, 6, 7], formats: { 1: 'coef', 2: 'coef', 3: 'coef', 4: 'p', 5: 'int', 6: 'int', 7: 'v' },
      rowLabels: labels, terms: labels, stat: stat,
      note: '第一阶段 F 由 econ.waldStat 给出（q=1 时等于 t²，聚类稳健）；弱工具门槛 ' + IV_F_THRESHOLD + ' 为经验约定'
    });
    tables.push(tMain);
    var tFs = null;
    if (rIv && rIv.ok) {
      tFs = coefTable('endogeneity.firstStage', '第一阶段：digi ~ 工具变量 + 控制变量（被解释变量为 digi）', rIv,
        '同行业同年度其他企业 digi 均值（留一法）为排除性工具；F = t² = ' + fmtNum(F, 3));
      tables.push(tFs);
    }
    if (two.ok) {
      var fsRows = [], fsLabels = [], fsStat = [], k;
      for (k = 0; k < two.firstStage.names.length; k++) {
        fsRows.push([two.firstStage.names[k], two.firstStage.beta[k], two.firstStage.se[k], two.firstStage.t[k], two.firstStage.p[k]]);
        fsLabels.push(two.firstStage.names[k]);
        fsStat.push({ coef: two.firstStage.beta[k], se: two.firstStage.se[k], t: two.firstStage.t[k], p: two.firstStage.p[k] });
      }
      fsRows.push(['第一阶段 F（排除性工具）', F, NaN, NaN, isFinite(two.firstStage.Fp) ? two.firstStage.Fp : NaN]);
      fsLabels.push('F');
      fsStat.push(null);
      var tFs2 = makeTable('endogeneity.ivFirstStage', '2SLS 第一阶段（去均值后估计，独立于上方 OLS 路径）',
        ['变量', '系数', '标准误', 't 值', 'p 值'], fsRows, {
        numCols: [1, 2, 3, 4], formats: { 1: 'coef', 2: 'coef', 3: 'coef', 4: 'p' }, rowLabels: fsLabels, terms: fsLabels, stat: fsStat,
        note: '2SLS 的第一阶段与第二阶段都基于 econ.demean 后的数据；F 行只填系数（F 值），标准误/t/p 留空'
      });
      tables.push(tFs2);
    }
    var metrics = [
      metric('第一阶段 F', isFinite(F) ? fmtNum(F, 3) : '—'),
      metric('经验门槛', String(IV_F_THRESHOLD)),
      metric('判定', !isFinite(F) ? '未能计算' : (weak ? '弱工具' : '通过门槛')),
      metric('处置', weak ? '退回 OLS + 降措辞（不作因果解读）' : '可报告 2SLS 结果')
    ];
    var sent = ['内生性处理对比：'];
    if (rOls.ok && cOls) sent.push('OLS 基准 digi 系数 ' + ph(tMain, 'OLS（基准）', 'digi 系数') + '（p = ' + ph(tMain, 'OLS（基准）', 'p 值') + '）；');
    if (rLag.ok && fLag) sent.push('滞后一期设定系数 ' + ph(tMain, '滞后一期解释变量', 'digi 系数') + '（p = ' + ph(tMain, '滞后一期解释变量', 'p 值') + '，N = ' + ph(tMain, '滞后一期解释变量', 'N') + '）；');
    if (isFinite(F)) sent.push('工具变量第一阶段 F = ' + phOr(tMain, '2sls', '第一阶段 F', '—') + '，' + (weak ? ('低于经验门槛 ' + IV_F_THRESHOLD + '，属弱工具') : ('高于经验门槛 ' + IV_F_THRESHOLD)) + '；');
    if (two.ok) sent.push('2SLS 的 digi 系数为 ' + ph(tMain, '2sls', 'digi 系数') + '（标准误 ' + ph(tMain, '2sls', '标准误') + '，p = ' + ph(tMain, '2sls', 'p 值') + '）' + (weak ? '，在弱工具下该数值不可用于因果解读' : '') + '。');
    else sent.push('2SLS 未能估计：' + two.code + ' —— ' + two.message + '。');
    var ip = interp(tables, sent);
    var diag = {
      firstStageF: F, weakInstrument: weak, weakThreshold: IV_F_THRESHOLD, waldQ: 1,
      firstStageIV: fIv ? { name: 'z_iv', coef: fIv.coef, se: fIv.se, t: fIv.t, p: fIv.p, nObs: rIv.nObs, clusters: rIv.cluster ? rIv.cluster.nClusters : null } : null,
      twoSLS: two.ok ? { coef: b0, se: s0, t: t0, p: p0, nObs: two.nObs, clusters: two.nClusters, demean: two.demean, firstStageF: two.firstStage.F } : null,
      lag1: { coef: fLag ? fLag.coef : NaN, se: fLag ? fLag.se : NaN, p: fLag ? fLag.p : NaN, nObs: rLag.ok ? rLag.nObs : null },
      pValueDF: '聚类稳健 p 值沿用 econ 的 df = N − k 约定（Stata 常用 G−1，p 值会略小）',
      twoSLSReliable: !weak && two.ok,
      twoSLSNote: two.ok ? (weak ? '弱工具（F=' + fmtNum(F, 3) + ' < ' + IV_F_THRESHOLD + '）：2SLS 点估计不可解读，仅作存档' : 'F 通过经验门槛，可报告') : ('未能估计：' + two.code),
      notes: [], warnings: warnings
    };
    if (weak) diag.warnings.push('弱工具：第一阶段 F = ' + fmtNum(F, 2) + ' < ' + IV_F_THRESHOLD + '，本步结论不可作因果解读');
    if (rIv && rIv.ok && fIv && fIv.coef < 0) diag.warnings.push('工具变量第一阶段系数为负（' + fmtNum(fIv.coef, 4) + '），该工具在本样本内方向异常，进一步削弱其可用性');
    if (rLag.ok) { diag.warnings = diag.warnings.concat(fitDiagnostics(rLag, '滞后一期')); diag.notes = diag.notes.concat(fitNotes(rLag, '滞后一期')); }
    if (rIv && rIv.ok) { diag.warnings = diag.warnings.concat(fitDiagnostics(rIv, 'IV 第一阶段')); diag.notes = diag.notes.concat(fitNotes(rIv, 'IV 第一阶段')); }
    var prov = mkProv('endogeneity', sample, {
      variables: vars2prov(sample), y: 'ln_innov', x: BASE_X, fe: ['firm_id', 'year'], cluster: 'firm_id',
      specHash: specHashOf([specSummary(specOls), specSummary(specLag), specIv ? specSummary(specIv) : { id: 'iv-fs', failed: 'MISSING_VAR' },
        { id: '2sls', y: 'ln_innov', endog: 'digi', instruments: ['z_iv'], controls: BASE_X.slice(1) }])
    });
    if (!rOls.ok) return failedResult('endogeneity', sample, rOls.code, rOls.message, { diagnostics: diag, provenance: prov });
    return pack('endogeneity', sample, tables, metrics, ip, diag, prov);
  }

  /* ========================== ⑥ 异质性 ========================== */
  function heterogeneityItems(sample) {
    var items = [];
    items.push({
      id: 'size-large', label: '大型企业（firm 均值 size > 中位数）', group: 'size', required: true,
      spec: specOf(sample, {
        id: 'size-large', title: '规模分组 · 大型', y: 'ln_innov', x: BASE_X, fe: ['firm_id', 'year'], cluster: 'firm_id',
        derive: ['large'], filter: function (r) { return num(r.large) === 1; }, filterNote: 'large = 1'
      })
    });
    items.push({
      id: 'size-small', label: '中小企业（参照组）', group: 'size', required: true,
      spec: specOf(sample, {
        id: 'size-small', title: '规模分组 · 中小', y: 'ln_innov', x: BASE_X, fe: ['firm_id', 'year'], cluster: 'firm_id',
        derive: ['large'], filter: function (r) { return num(r.large) === 0; }, filterNote: 'large = 0'
      })
    });
    items.push({
      id: 'size-diff', label: '组间差异检验（交互项 digi×large）', group: 'size', required: true, interaction: true,
      spec: specOf(sample, {
        id: 'size-diff', title: '规模组间差异（交互项）', y: 'ln_innov', x: ['digi', 'digi_x_large'].concat(BASE_X.slice(1)),
        fe: ['firm_id', 'year'], cluster: 'firm_id', derive: ['digi_x_large']
      }), coreVar: 'digi_x_large'
    });
    var ownVar = null, cands = ['soe', 'own', 'state', 'soe_dummy'], i;
    for (i = 0; i < cands.length; i++) if (sampleHas(sample, cands[i])) { ownVar = cands[i]; break; }
    if (ownVar) {
      items.push({
        id: 'own-1', label: '国有企业（' + ownVar + ' = 1）', group: 'own', required: false,
        spec: specOf(sample, {
          id: 'own-1', title: '所有制分组 · 国有', y: 'ln_innov', x: BASE_X, fe: ['firm_id', 'year'], cluster: 'firm_id',
          derive: ['own'], filter: function (r) { return num(r.own) === 1; }, filterNote: ownVar + ' = 1'
        })
      });
      items.push({
        id: 'own-0', label: '非国有企业（参照组）', group: 'own', required: false,
        spec: specOf(sample, {
          id: 'own-0', title: '所有制分组 · 非国有', y: 'ln_innov', x: BASE_X, fe: ['firm_id', 'year'], cluster: 'firm_id',
          derive: ['own'], filter: function (r) { return num(r.own) === 0; }, filterNote: ownVar + ' = 0'
        })
      });
      items.push({
        id: 'own-diff', label: '组间差异检验（交互项 digi×' + ownVar + '）', group: 'own', required: false, interaction: true,
        spec: specOf(sample, {
          id: 'own-diff', title: '所有制组间差异（交互项）', y: 'ln_innov', x: ['digi', 'digi_x_own'].concat(BASE_X.slice(1)),
          fe: ['firm_id', 'year'], cluster: 'firm_id', derive: ['digi_x_own']
        }), coreVar: 'digi_x_own'
      });
    }
    return items;
  }
  function coreCoefOf(res, name) {
    if (!res || !res.ok) return null;
    for (var i = 0; i < res.coefficients.length; i++) if (res.coefficients[i].name === name) return res.coefficients[i];
    return null;
  }
  function stepHeterogeneity(sample, ctx) {
    var econ = E();
    var items = heterogeneityItems(sample);
    var results = {}, k, i;
    for (k = 0; k < items.length; k++) {
      var it = items[k];
      var res = fitSpec(it.spec);
      var core = it.coreVar || 'digi';
      results[it.id] = { item: it, res: res, core: core, coef: coreCoefOf(res, core) };
    }
    var rows = [], labels = [], stat = [];
    var groups = {};
    for (k = 0; k < items.length; k++) {
      var id = items[k].id, r = results[id], ok = !!(r.res.ok && r.coef);
      var diffCell = null, ownGroup = items[k].group, diffId = (ownGroup === 'size') ? 'size-diff' : 'own-diff';
      if (ownGroup && results[diffId] && results[diffId].coef) diffCell = results[diffId].coef.p;
      if (!ok) {
        rows.push([r.item.label, NaN, NaN, NaN, NaN, NaN, NaN, isFinite(diffCell) ? diffCell : NaN, '失败：' + (r.res.code || 'UNKNOWN') + ' —— ' + r.res.message]);
        labels.push(id); stat.push(null);
        continue;
      }
      var verdict = (r.item.interaction ? '交互项（组间差异）' : '分组系数') + '：' + verdictOf(results[ownGroup === 'size' ? 'size-large' : 'own-1'] && results[ownGroup === 'size' ? 'size-large' : 'own-1'].coef ? results[ownGroup === 'size' ? 'size-large' : 'own-1'].coef.coef : NaN, r.coef.coef, r.coef.p);
      rows.push([r.item.label, r.coef.coef, r.coef.se, r.coef.t, r.coef.p, r.res.nObs,
        r.res.cluster ? r.res.cluster.nClusters : NaN, isFinite(diffCell) ? diffCell : NaN, verdict]);
      labels.push(id); stat.push({ coef: r.coef.coef, se: r.coef.se, t: r.coef.t, p: r.coef.p });
    }
    var tMain = makeTable('heterogeneity.groups', '分组回归与组间差异（核心变量 digi / 交互项）',
      ['分组', '系数', '标准误', 't 值', 'p 值', 'N', '聚类数', '组间差异 Wald p', '结论'], rows, {
      numCols: [1, 2, 3, 4, 5, 6, 7], formats: { 1: 'coef', 2: 'coef', 3: 'coef', 4: 'p', 5: 'int', 6: 'int', 7: 'p' },
      rowLabels: labels, terms: labels, stat: stat,
      note: '组间差异 p 来自全样本交互项回归的聚类稳健 t 检验（digi×分组虚拟变量）'
    });
    /* 独立样本 z 检验（Chow 型近似）：d = b1 − b2，se = sqrt(se1² + se2²) */
    var chowRows = [], chowLabels = [];
    [['size', 'size-large', 'size-small'], ['own', 'own-1', 'own-0']].forEach(function (spec3) {
      var g = spec3[0], a = results[spec3[1]], b = results[spec3[2]];
      if (!a || !b || !(a.res.ok && a.coef && b.res.ok && b.coef)) {
        chowRows.push([g === 'size' ? '规模分组' : '所有制分组', NaN, NaN, NaN, NaN, '该分组无法估计']);
        chowLabels.push(g); return;
      }
      var d = a.coef.coef - b.coef.coef;
      var se = Math.sqrt(a.coef.se * a.coef.se + b.coef.se * b.coef.se);
      var t = se > 0 ? d / se : NaN;
      var df = a.res.nObs + b.res.nObs - 2 * a.res.nParams;
      var p = econ.tPValue(t, df);
      chowRows.push([g === 'size' ? '规模分组（大 − 中小）' : '所有制分组（国有 − 非国有）', d, se, t, p, '独立样本近似']);
      chowLabels.push(g);
    });
    var tChow = makeTable('heterogeneity.chow', '组间系数差异（独立样本近似）', ['分组', '系数差异', '差异标准误', 't 值', 'p 值', '说明'], chowRows, {
      numCols: [1, 2, 3, 4], formats: { 1: 'coef', 2: 'coef', 3: 'coef', 4: 'p' }, rowLabels: chowLabels,
      note: '两组样本相互独立，se(差异)=sqrt(se1²+se2²)，p 由 econ.tPValue(t, n1+n2−2k) 给出；与交互项检验可能不同'
    });
    var tables = [tMain, tChow];
    var pSize = results['size-diff'] && results['size-diff'].coef ? results['size-diff'].coef.p : NaN;
    var pOwn = results['own-diff'] && results['own-diff'].coef ? results['own-diff'].coef.p : NaN;
    var metrics = [
      metric('规模分组差异 p', isFinite(pSize) ? fmtP(pSize) : '—'),
      metric('所有制分组差异 p', isFinite(pOwn) ? fmtP(pOwn) : '未提供所有制变量'),
      metric('有效分组数', (function () {
        var c2 = 0, tot = 0, q;
        for (q = 0; q < items.length; q++) {
          if (items[q].interaction) continue;
          tot++;
          if (results[items[q].id].res.ok && results[items[q].id].coef) c2++;
        }
        return c2 + ' / ' + tot;
      })())
    ];
    var sent = ['异质性分析（核心变量 digi）：'];
    [['size-large', 'size-small'], ['own-1', 'own-0']].forEach(function (pair) {
      var a = results[pair[0]], b = results[pair[1]];
      if (!a || !b || !(a.res.ok && a.coef && b.res.ok && b.coef)) return;
      sent.push('「' + a.item.label + '」系数 ' + ph(tMain, pair[0], '系数') + '（p = ' + ph(tMain, pair[0], 'p 值') + '，N = ' + ph(tMain, pair[0], 'N') +
        '），「' + b.item.label + '」系数 ' + ph(tMain, pair[1], '系数') + '（p = ' + ph(tMain, pair[1], 'p 值') + '，N = ' + ph(tMain, pair[1], 'N') + '）。');
    });
    var dSize = results['size-diff'], dOwn = results['own-diff'];
    if (dSize && dSize.res.ok && dSize.coef) {
      sent.push('规模组间差异：交互项 digi×large 系数 ' + ph(tMain, 'size-diff', '系数') + '，p = ' + ph(tMain, 'size-diff', 'p 值') + '，即' +
        (dSize.coef.p < 0.1 ? '两组系数在 10% 水平存在统计差异' : '两组系数没有统计差异（不能声称"对大型企业作用更强"）') + '。');
    }
    if (dOwn && dOwn.res.ok && dOwn.coef) {
      sent.push('所有制组间差异：交互项系数 ' + ph(tMain, 'own-diff', '系数') + '，p = ' + ph(tMain, 'own-diff', 'p 值') + '，即' +
        (dOwn.coef.p < 0.1 ? '两组系数在 10% 水平存在统计差异' : '两组系数没有统计差异（不能声称组间强弱）') + '。');
    }
    var ip = interp(tables, sent);
    var diag = {
      sizeMedian: sample.largeMedian, ownVar: sample.ownVar,
      sizeGroup: { large: results['size-large'] && results['size-large'].res.ok ? results['size-large'].res.nObs : null, small: results['size-small'] && results['size-small'].res.ok ? results['size-small'].res.nObs : null },
      ownGroup: results['own-1'] ? { one: results['own-1'].res.ok ? results['own-1'].res.nObs : null, zero: results['own-0'].res.ok ? results['own-0'].res.nObs : null } : null,
      interactionP: { size: pSize, own: pOwn },
      chow: (function () {
        var out = {};
        for (var q = 0; q < chowRows.length; q++) out[chowLabels[q]] = { diff: chowRows[q][1], se: chowRows[q][2], t: chowRows[q][3], p: chowRows[q][4] };
        return out;
      })(),
      notes: [], warnings: []
    };
    for (k = 0; k < items.length; k++) {
      var rr = results[items[k].id];
      if (rr.res.ok) {
        diag.warnings = diag.warnings.concat(fitDiagnostics(rr.res, rr.item.label));
        diag.notes = diag.notes.concat(fitNotes(rr.res, rr.item.label));
      } else if (rr.item.required) diag.warnings.push(rr.item.label + ' 失败：' + rr.res.code + ' ' + rr.res.message);
    }
    if (!sample.ownVar) diag.warnings.push('数据中没有所有制变量（soe/own/state），所有制分组未执行 —— 如实标注，不用代理变量冒充');
    var prov = mkProv('heterogeneity', sample, {
      variables: vars2prov(sample), y: 'ln_innov', x: BASE_X, fe: ['firm_id', 'year'], cluster: 'firm_id',
      groupVars: { size: 'firm 平均 size 的中位数分组', own: sample.ownVar },
      specHash: specHashOf(items.map(function (x) { return specSummary(x.spec); }))
    });
    var requiredFail = items.filter(function (x) { return x.required && !(results[x.id].res.ok && results[x.id].coef); });
    if (requiredFail.length) {
      var code = 'HETEROGENEITY_ITEM_FAILED', msg = '必需分组无法估计：' + requiredFail.map(function (x) { return x.id + '（' + results[x.id].res.code + '）'; }).join('；');
      var fl = failedResult('heterogeneity', sample, code, msg, { diagnostics: diag, provenance: prov });
      fl.tables = tables; fl.cells = tables[0].cells; fl.metrics = metrics;
      fl.primaryTableId = tMain.id;
      fl.primaryTable = { head: tMain.head.slice(), rows: tMain.formattedRows, numericRows: tMain.rows, numCols: tMain.numCols.slice(), note: tMain.note };
      fl.table = fl.primaryTable;
      fl.interpretation = ip; fl.summary = ip.text;
      return fl;
    }
    return pack('heterogeneity', sample, tables, metrics, ip, diag, prov);
  }

  /* ========================== ⑦ 机制分析 ========================== */
  function mechanismItems(sample, ctx) {
    var items = [], chans = [];
    var ch = (ctx && ctx.channelVar) || null;
    if (ch && !sampleHas(sample, ch)) {
      items.push({ id: 'channel-missing', spec: null, label: '渠道变量 ' + ch, failCode: 'MISSING_VAR', failMessage: 'ctx.channelVar 指定的渠道变量在数据中不存在：' + ch, required: true });
      return items;
    }
    if (ch) chans.push({ name: ch, label: '指定渠道（' + ch + '）' });
    else {
      if (sampleHas(sample, 'fc')) chans.push({ name: 'fc', label: '融资约束渠道（fc 指数）' });
      if (sampleHas(sample, 'subsidy')) chans.push({ name: 'subsidy', label: '政府补贴渠道（subsidy）' });
    }
    chans.forEach(function (c) {
      var ctrls = BASE_X.slice(1).filter(function (v) { return v !== c.name; });
      items.push({
        id: 'a:' + c.name, chan: c.name, chanLabel: c.label, path: 'a', required: true,
        spec: specOf(sample, { id: 'a:' + c.name, title: c.label + ' · a 路径（' + c.name + ' ~ digi）', y: c.name, x: ['digi'].concat(ctrls), fe: ['firm_id', 'year'], cluster: 'firm_id' }),
        coreVar: 'digi', n: null
      });
      items.push({
        id: 'b:' + c.name, chan: c.name, chanLabel: c.label, path: 'b', required: true,
        spec: specOf(sample, { id: 'b:' + c.name, title: c.label + ' · b 路径（ln_innov ~ digi + ' + c.name + '）', y: 'ln_innov', x: ['digi', c.name].concat(ctrls), fe: ['firm_id', 'year'], cluster: 'firm_id' }),
        coreVar: c.name, n: null
      });
      items.push({
        id: 'c:' + c.name, chan: c.name, chanLabel: c.label, path: 'c', required: true,
        spec: baselineSpecOf(sample, ctx), coreVar: 'digi'
      });
    });
    return items;
  }
  function stepMechanism(sample, ctx) {
    var econ = E();
    var items = mechanismItems(sample, ctx);
    var results = {}, k;
    for (k = 0; k < items.length; k++) {
      var it = items[k];
      if (!it.spec) { results[it.id] = { item: it, res: { ok: false, code: it.failCode || 'MISSING_VAR', message: it.failMessage || '缺少渠道变量' }, coef: null }; continue; }
      var res = fitSpec(it.spec);
      results[it.id] = { item: it, res: res, coef: coreCoefOf(res, it.coreVar) };
    }
    var chanNames = [];
    for (k = 0; k < items.length; k++) if (items[k].chan && chanNames.indexOf(items[k].chan) < 0) chanNames.push(items[k].chan);
    var rows = [], labels = [], stat = [];
    var decomp = [], decompLabels = [];
    var errs = [];
    chanNames.forEach(function (cn) {
      var a = results['a:' + cn], b = results['b:' + cn], c = results['c:' + cn];
      var label = a.item.chanLabel;
      function push(path, varName, cell, n, ok, note) {
        if (!ok) { rows.push([label, path, varName, NaN, NaN, NaN, NaN, NaN, note]); labels.push(cn + ':' + path); stat.push(null); return; }
        rows.push([label, path, varName, cell.coef, cell.se, cell.t, cell.p, n]);
        labels.push(cn + ':' + path); stat.push({ coef: cell.coef, se: cell.se, t: cell.t, p: cell.p });
      }
      push('a 路径（digi → ' + cn + '）', 'digi', a.coef, a.res.ok ? a.res.nObs : NaN, !!(a.res.ok && a.coef), a.res.ok ? '' : ('失败：' + a.res.code + ' ' + a.res.message));
      push('b 路径（' + cn + ' → ln_innov）', cn, b.coef, b.res.ok ? b.res.nObs : NaN, !!(b.res.ok && b.coef), b.res.ok ? '' : ('失败：' + b.res.code + ' ' + b.res.message));
      var cDirect = null;
      if (b.res.ok) for (var q = 0; q < b.res.coefficients.length; q++) if (b.res.coefficients[q].name === 'digi') cDirect = b.res.coefficients[q];
      rows.push([label, '直接效应 c′（digi → ln_innov，控制 ' + cn + '）', 'digi', cDirect ? cDirect.coef : NaN, cDirect ? cDirect.se : NaN,
        cDirect ? cDirect.t : NaN, cDirect ? cDirect.p : NaN, b.res.ok ? b.res.nObs : NaN]);
      labels.push(cn + ':cp'); stat.push(cDirect ? { coef: cDirect.coef, se: cDirect.se, t: cDirect.t, p: cDirect.p } : null);
      var cTot = c.res.ok ? c.coef : null;
      rows.push([label, '总效应 c（digi → ln_innov，不含 ' + cn + '）', 'digi', cTot ? cTot.coef : NaN, cTot ? cTot.se : NaN,
        cTot ? cTot.t : NaN, cTot ? cTot.p : NaN, c.res.ok ? c.res.nObs : NaN]);
      labels.push(cn + ':c'); stat.push(cTot ? { coef: cTot.coef, se: cTot.se, t: cTot.t, p: cTot.p } : null);

      var okAll = !!(a.res.ok && a.coef && b.res.ok && b.coef && c.res.ok && c.coef);
      if (!okAll) {
        decomp.push([label, NaN, NaN, NaN, NaN, '路径不完整，不做中介分解']);
        decompLabels.push(cn);
        if (a.res.ok === false) errs.push(cn + ' a 路径：' + a.res.code);
        if (b.res.ok === false) errs.push(cn + ' b 路径：' + b.res.code);
        return;
      }
      var ind = a.coef.coef * b.coef.coef;
      var seInd = Math.sqrt(Math.pow(a.coef.coef, 2) * Math.pow(b.coef.se, 2) + Math.pow(b.coef.coef, 2) * Math.pow(a.coef.se, 2));
      var z = seInd > 0 ? ind / seInd : NaN;
      var pSobel = isFinite(z) ? 1 - econ.chi2cdf(z * z, 1) : NaN;
      var prop = c.coef.coef !== 0 ? ind / c.coef.coef : NaN;
      var judge = !isFinite(pSobel) ? '无法判定' : (pSobel < 0.05 ? '间接效应显著（但仍受渠道内生性限制）' : '间接效应不显著');
      decomp.push([label, ind, z, pSobel, prop, judge]);
      decompLabels.push(cn);
    });
    var tPath = makeTable('mechanism.paths', '渠道回归（a / b / 直接 / 总效应）',
      ['渠道', '路径', '变量', '系数', '标准误', 't 值', 'p 值', 'N'], rows, {
      numCols: [3, 4, 5, 6, 7], formats: { 3: 'coef', 4: 'coef', 5: 'coef', 6: 'p', 7: 'int' },
      rowLabels: labels, stat: stat, note: '所有路径均为真实估计；渠道变量本身受 digi 影响（内生），b 路径不构成因果证据'
    });
    var tDec = makeTable('mechanism.decomp', '中介效应分解（Sobel）',
      ['渠道', '间接效应 a×b', 'Sobel z', 'Sobel p', '中介占比 a×b/c', '判定'], decomp, {
      numCols: [1, 2, 3, 4], formats: { 1: 'coef', 2: 'coef', 3: 'p', 4: 'coef' }, rowLabels: decompLabels,
      note: 'Sobel p 由 econ.chi2cdf(z², 1) 给出（正态近似）；中介占比仅在 c 与 a×b 同号时才有解释力'
    });
    var tables = [tPath, tDec];
    var metrics = [];
    if (decomp.length && isFinite(decomp[0][1])) {
      metrics.push(metricFrom('间接效应（' + decompLabels[0] + '）', cellAt(tDec, decompLabels[0], '间接效应 a×b')));
      metrics.push(metricFrom('Sobel p（' + decompLabels[0] + '）', cellAt(tDec, decompLabels[0], 'Sobel p')));
      metrics.push(metricFrom('中介占比（' + decompLabels[0] + '）', cellAt(tDec, decompLabels[0], '中介占比 a×b/c')));
    }
    metrics.push(metric('措辞限制', '渠道变量内生，本步只允许"与…一致"表述'));
    var sent = ['机制分析（中介/渠道回归）：'];
    chanNames.forEach(function (cn) {
      var a = results['a:' + cn], b = results['b:' + cn], c = results['c:' + cn];
      if (a.res.ok && a.coef) sent.push('「' + a.item.chanLabel + '」a 路径：digi → ' + cn + ' 系数 ' + ph(tPath, cn + ':a 路径（digi → ' + cn + '）', '系数') + '（p = ' + ph(tPath, cn + ':a 路径（digi → ' + cn + '）', 'p 值') + '）；');
      if (b.res.ok && b.coef) sent.push('b 路径：' + cn + ' → ln_innov 系数 ' + ph(tPath, cn + ':b 路径（' + cn + ' → ln_innov）', '系数') + '（p = ' + ph(tPath, cn + ':b 路径（' + cn + ' → ln_innov）', 'p 值') + '）；');
      if (c.res.ok && c.coef) sent.push('总效应 ' + phOr(tPath, cn + ':c', '系数', '—') + '，直接效应 c′ ' + phOr(tPath, cn + ':cp', '系数', '—') + '。');
    });
    for (k = 0; k < decomp.length; k++) {
      if (!isFinite(decomp[k][1])) { sent.push('「' + decomp[k][0] + '」路径不完整，未做中介分解。'); continue; }
      sent.push('「' + decomp[k][0] + '」间接效应 a×b = ' + ph(tDec, decompLabels[k], '间接效应 a×b') + '，Sobel z = ' + ph(tDec, decompLabels[k], 'Sobel z') +
        '，Sobel p = ' + ph(tDec, decompLabels[k], 'Sobel p') + '，中介占比 = ' + ph(tDec, decompLabels[k], '中介占比 a×b/c') + '；' + decomp[k][5] + '。');
    }
    var ip = interp(tables, sent);
    var diag = {
      channels: chanNames, channelLabels: chanNames.map(function (cn) { return results['a:' + cn].item.chanLabel; }),
      decomposition: decomp.map(function (d, ix) { return { channel: decompLabels[ix], indirect: d[1], z: d[2], p: d[3], proportion: d[4], verdict: d[5] }; }),
      channelExogenous: false,
      note: '渠道变量由数字化转型影响，属事后（post-hoc）探索；Sobel 检验假设 a、b 独立，为近似做法',
      notes: [], warnings: []
    };
    for (k = 0; k < items.length; k++) {
      var rr = results[items[k].id];
      if (rr.res.ok) {
        diag.warnings = diag.warnings.concat(fitDiagnostics(rr.res, rr.item.id));
        diag.notes = diag.notes.concat(fitNotes(rr.res, rr.item.id));
      }
    }
    diag.warnings.push('中介变量内生：本步结论不能写成"通过…渠道"，只能用"与…一致"');
    if (errs.length) diag.warnings.push('部分路径失败：' + errs.join('；'));
    var prov = mkProv('mechanism', sample, {
      variables: vars2prov(sample), y: 'ln_innov', x: BASE_X, fe: ['firm_id', 'year'], cluster: 'firm_id',
      channelVar: chanNames.length ? chanNames[0] : null,
      specHash: specHashOf(items.filter(function (x) { return x.spec; }).map(function (x) { return specSummary(x.spec); }))
    });
    var requiredFailed = items.filter(function (x) { return x.required && !(results[x.id].res && results[x.id].res.ok && results[x.id].coef); });
    if (!chanNames.length || requiredFailed.length) {
      var msg = !chanNames.length ? '数据中没有可用的渠道变量（fc / subsidy），请用 ctx.channelVar 指定' :
        ('渠道路径无法估计：' + requiredFailed.map(function (x) { return x.id + '（' + (results[x.id].res.code || 'UNKNOWN') + '）'; }).join('；'));
      var fl = failedResult('mechanism', sample, 'MECHANISM_CHANNEL_FAILED', msg, { diagnostics: diag, provenance: prov });
      fl.tables = tables; fl.cells = tables[0].cells; fl.metrics = metrics;
      fl.primaryTableId = tPath.id;
      fl.primaryTable = { head: tPath.head.slice(), rows: tPath.formattedRows, numericRows: tPath.rows, numCols: tPath.numCols.slice(), note: tPath.note };
      fl.table = fl.primaryTable;
      try { fl.interpretation = ip; fl.summary = ip.text; } catch (e) { /* 解释模板可能因缺列失败，保留失败说明 */ }
      return fl;
    }
    return pack('mechanism', sample, tables, metrics, ip, diag, prov);
  }

  /* ========================== 调度 ========================== */
  function runStep(stepId, ctx) {
    ctx = ctx || {};
    var locals = ctx;
    var sample;
    try {
      sample = (ctx.sample && ctx.sample.ok) ? ctx.sample : prepareSample(ctx);
    } catch (err) {
      return {
        stepId: stepId, status: 'failed', tables: [], cells: [], metrics: [], primaryTableId: null, primaryTable: null, table: null,
        interpretation: { text: '样本准备失败：' + (err && err.message ? err.message : String(err)), refs: [] },
        summary: '样本准备失败：' + (err && err.message ? err.message : String(err)),
        warning: '样本准备失败', diagnostics: { error: { code: 'PREPARE_THROW', message: String(err && err.message || err) }, warnings: [] },
        provenance: null, error: { code: 'PREPARE_THROW', message: String(err && err.message || err) }
      };
    }
    if (!sample.ok) return failedResult(stepId, null, sample.code, sample.message, {});
    locals.sample = sample;
    try {
      switch (stepId) {
        case 'data-prep': return stepDataPrep(sample, locals);
        case 'descriptive': return stepDescriptive(sample, locals);
        case 'baseline': return stepBaseline(sample, locals);
        case 'robustness': return stepRobustness(sample, locals);
        case 'endogeneity': return stepEndogeneity(sample, locals);
        case 'heterogeneity': return stepHeterogeneity(sample, locals);
        case 'mechanism': return stepMechanism(sample, locals);
        default: return failedResult(stepId, sample, 'UNKNOWN_STEP', '未知步骤 id：' + stepId + '（可用：' + STEP_ORDER.join(', ') + '）', {});
      }
    } catch (err) {
      return failedResult(stepId, sample, 'STEP_THROW', (err && err.message) ? err.message : String(err), {});
    }
  }
  function runAll(ctx, onProgress) {
    ctx = ctx || {};
    var sample = prepareSample(ctx);
    var locals = copy(ctx);
    locals.sample = sample;
    var steps = {}, failedList = [], i;
    for (i = 0; i < STEP_ORDER.length; i++) {
      var id = STEP_ORDER[i];
      var st = runStep(id, locals);
      steps[id] = st;
      if (st.status !== 'done') failedList.push({ stepId: id, code: st.error ? st.error.code : 'UNKNOWN', message: st.error ? st.error.message : '' });
      if (onProgress) onProgress({ index: i, total: STEP_ORDER.length, stepId: id, status: st.status, result: st });
    }
    var prov = sample.ok ? mkProv('runAll', sample, {
      variables: vars2prov(sample),
      steps: STEP_ORDER.map(function (id) { return { stepId: id, status: steps[id].status, code: steps[id].error ? steps[id].error.code : null }; })
    }) : null;
    return {
      ok: sample.ok && failedList.length === 0,
      status: !sample.ok ? 'failed' : (failedList.length ? 'partial' : 'done'),
      order: STEP_ORDER.slice(),
      steps: steps,
      failed: failedList,
      error: sample.ok ? null : { code: sample.code, message: sample.message },
      provenance: prov
    };
  }

  ZY.pipeline = {
    VERSION: VERSION,
    STEP_ORDER: STEP_ORDER.slice(),
    BASE_X: BASE_X.slice(),
    REQUIRED_VARS: REQUIRED.slice(),
    IV_F_THRESHOLD: IV_F_THRESHOLD,
    /* 合成面板 DGP 真值（仅供测试校准/文档引用，不是结果表里的数字） */
    SYNTHETIC_DGP: DGP,
    /* 对外 API */
    prepareSample: prepareSample,
    buildSpec: buildSpec,
    runStep: runStep,
    runAll: runAll,
    makeSyntheticPanel: makeSyntheticPanel,
    /* 工具（供 UI/测试复用，非核心契约） */
    util: {
      hash32: hash32, fmtNum: fmtNum, fmtInt: fmtInt, fmtP: fmtP, fmtVal: fmtVal,
      mulberry32: mulberry32, gauss: gauss, welch: welch, twoSLS: twoSLS,
      cellAt: cellAt, ensureDerived: ensureDerived, specOf: specOf, specSummary: specSummary,
      robustnessItems: robustnessItems, heterogeneityItems: heterogeneityItems, mechanismItems: mechanismItems
    }
  };
})(window);
