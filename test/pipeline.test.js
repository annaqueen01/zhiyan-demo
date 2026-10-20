/* ============================================================================
   七步实证流水线 · 独立自测                      test/pipeline.test.js
   ----------------------------------------------------------------------------
   运行：在 frontend-demo 目录下  node test/pipeline.test.js
        （如需指定 econ.js：ZY_ECON_PATH=<绝对路径> node test/pipeline.test.js）
   本测试刻意"不复用被测代码的内部实现"：
     · 基准回归的系数 / 聚类标准误由测试自带的去均值 + 高斯消元 + 聚类三明治独立算一遍
     · 2SLS 用 just-identified 的 IV 比率（FWL 残差化）独立算一遍
     · 三重差分：p 值用 econ.tPValue 复算；F 用 t² 复算；Sobel 用 econ.chi2cdf 复算
   控制台仅输出 ASCII 标记（PASS / FAIL / INFO），避免 GBK 控制台报错。
   失败时会把明细写入 pipeline.test.failures.txt（UTF-8），全绿则不生成。
   ============================================================================ */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var crypto = require('crypto');

/* ============================ 加载被测代码 ============================ */
var ECON_PATH = process.env.ZY_ECON_PATH || path.join(__dirname, '..', 'scripts', 'econ.js');
var PIPELINE_PATH = path.join(__dirname, '..', 'scripts', 'pipeline.js');
var econSrc = fs.readFileSync(ECON_PATH, 'utf8');
var pipeSrc = fs.readFileSync(PIPELINE_PATH, 'utf8');

var win = { console: console };
win.window = win;
var sandbox = vm.createContext(win);
vm.runInContext(econSrc, sandbox, { filename: 'econ.js' });
vm.runInContext(pipeSrc, sandbox, { filename: 'pipeline.js' });
var ZY = win.ZY;
var E = ZY && ZY.econ;
var P = ZY && ZY.pipeline;

var TEST_SEED = 20240113;
var N_SMALL = 2400;          /* 主测试规模：200 家企业 × 12 期 */

/* ============================ 迷你测试框架 ============================ */
var tests = [];
function T(id, name, fn) { tests.push({ id: id, name: name, fn: fn }); }
function ascii(s) { return String(s).replace(/[^\x20-\x7e]/g, '?'); }
var failures = [];

function fail(msg) { throw new Error(msg); }
function ok(cond, msg) { if (!cond) fail(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) fail((msg || 'eq') + ' :: got ' + a + ' expected ' + b); }
function close(a, b, tol, msg) {
  if (!(isFinite(a) && isFinite(b))) fail((msg || 'close') + ' :: non-finite ' + a + ' vs ' + b);
  if (Math.abs(a - b) > tol) fail((msg || 'close') + ' :: ' + a + ' vs ' + b + ' (tol ' + tol + ')');
}
function relClose(a, b, tol, msg) {
  var d = Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
  if (!(d <= tol)) fail((msg || 'relClose') + ' :: ' + a + ' vs ' + b + ' (rel ' + d + ' > ' + tol + ')');
}
function info(msg) { console.log('INFO ' + ascii(msg)); }

/* ============================ 独立数学实现（不用 econ 内部函数） ============================ */
/** 二维固定效应去均值（交替投影，自己实现） */
function ownDemean(mat, g1, g2, maxIter, tol) {
  var n = mat.length, k = mat[0].length, M = mat.map(function (r) { return r.slice(); });
  var l1 = g1.map(String), l2 = g2.map(String);
  function sweep(col, labels) {
    var sum = {}, cnt = {}, i, key;
    for (i = 0; i < n; i++) {
      key = labels[i];
      sum[key] = (sum[key] || 0) + col[i];
      cnt[key] = (cnt[key] || 0) + 1;
    }
    for (i = 0; i < n; i++) col[i] -= sum[labels[i]] / cnt[labels[i]];
    return col;
  }
  var it, c, i, maxChange;
  for (it = 0; it < maxIter; it++) {
    maxChange = 0;
    var dims = [l1, l2], d;
    for (d = 0; d < 2; d++) {
      for (c = 0; c < k; c++) {
        var col = M.map(function (r) { return r[c]; });
        var before = col.slice();
        sweep(col, dims[d]);
        for (i = 0; i < n; i++) {
          M[i][c] = col[i];
          var ch = Math.abs(col[i] - before[i]);
          if (ch > maxChange) maxChange = ch;
        }
      }
    }
    if (maxChange < tol) break;
  }
  return M;
}
/** 高斯-约当求逆（自己实现） */
function ownInv(A) {
  var n = A.length, M = A.map(function (row, i) {
    return row.slice().concat(A.map(function (_, j) { return i === j ? 1 : 0; }));
  });
  for (var c = 0; c < n; c++) {
    var piv = c, r;
    for (r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-13) return null;
    var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
    var d = M[c][c];
    for (var q = 0; q < 2 * n; q++) M[c][q] /= d;
    for (r = 0; r < n; r++) {
      if (r === c) continue;
      var f = M[r][c];
      if (f === 0) continue;
      for (var q2 = 0; q2 < 2 * n; q2++) M[r][q2] -= f * M[c][q2];
    }
  }
  return M.map(function (row) { return row.slice(n); });
}
function ownMatMul(A, B) {
  var n = A.length, m = B[0].length, p = B.length, C = [], i, j, k;
  for (i = 0; i < n; i++) { C.push(new Array(m).fill(0)); }
  for (i = 0; i < n; i++) for (k = 0; k < p; k++) { var a = A[i][k]; if (a === 0) continue; for (j = 0; j < m; j++) C[i][j] += a * B[k][j]; }
  return C;
}
function ownXtX(X) {
  var n = X.length, k = X[0].length, A = [], i, a, b;
  for (a = 0; a < k; a++) A.push(new Array(k).fill(0));
  for (i = 0; i < n; i++) for (a = 0; a < k; a++) for (b = a; b < k; b++) A[a][b] += X[i][a] * X[i][b];
  for (a = 0; a < k; a++) for (b = 0; b < a; b++) A[a][b] = A[b][a];
  return A;
}
function ownOLS(y, X) {
  var inv = ownInv(ownXtX(X));
  if (!inv) return null;
  var k = X[0].length, Xty = new Array(k).fill(0), i, j;
  for (i = 0; i < y.length; i++) for (j = 0; j < k; j++) Xty[j] += X[i][j] * y[i];
  var beta = new Array(k).fill(0);
  for (i = 0; i < k; i++) { var s = 0; for (j = 0; j < k; j++) s += inv[i][j] * Xty[j]; beta[i] = s; }
  return beta;
}
function ownResid(y, X, beta) {
  return y.map(function (yi, i) {
    var f = 0;
    for (var j = 0; j < beta.length; j++) f += X[i][j] * beta[j];
    return yi - f;
  });
}
/** 聚类稳健标准误（G/(G-1) × (n-1)/(n-k) 有限样本校正），与 econ 的约定一致 */
function ownClusterSE(y, X, beta, cluster) {
  var n = y.length, k = X[0].length, i, j, a, b;
  var inv = ownInv(ownXtX(X));
  if (!inv) return null;
  var u = ownResid(y, X, beta);
  var buckets = {}, keys = [];
  for (i = 0; i < n; i++) {
    var key = String(cluster[i]);
    if (!buckets[key]) { buckets[key] = []; keys.push(key); }
    buckets[key].push(i);
  }
  var G = keys.length;
  var meat = [];
  for (a = 0; a < k; a++) meat.push(new Array(k).fill(0));
  keys.forEach(function (kk) {
    var idx = buckets[kk], s = new Array(k).fill(0), m;
    for (m = 0; m < idx.length; m++) {
      var ii = idx[m];
      for (a = 0; a < k; a++) s[a] += X[ii][a] * u[ii];
    }
    for (a = 0; a < k; a++) for (b = 0; b < k; b++) meat[a][b] += s[a] * s[b];
  });
  var scale = (G / (G - 1)) * ((n - 1) / (n - k));
  for (a = 0; a < k; a++) for (b = 0; b < k; b++) meat[a][b] *= scale;
  var V = ownMatMul(ownMatMul(inv, meat), inv);
  return { se: V.map(function (row, ix) { return Math.sqrt(Math.max(row[ix], 0)); }), G: G };
}

/* ============================ 共用小工具 ============================ */
function col(spec, name) {
  var i = spec.xNames.indexOf(name);
  eq(i >= 0, true, 'spec 缺少变量 ' + name);
  return spec.X.map(function (r) { return r[i]; });
}
function coefRow(step, tableId, rowLabel) {
  var t = step.tables.filter(function (x) { return x.id === tableId; })[0];
  ok(t, 'table not found: ' + tableId);
  var r = t.rowLabels.indexOf(rowLabel);
  ok(r >= 0, 'row not found: ' + rowLabel);
  var n = 0, i;
  for (i = 0; i < t.cells.length; i++) if (t.cells[i].row === r) n++;
  ok(n > 0, 'row has no numeric cell: ' + rowLabel);
  return { table: t, row: r };
}
function cellVal(t, row, headerName) {
  var c = t.head.indexOf(headerName);
  var v = t.rows[row][c];
  return v;
}
/** 组装"引擎口径"的 2SLS 输入：与 pipeline 相同的数据 + 相同的 FE/聚类 */
function buildIVInputs(sample) {
  var b = P.buildSpec('endogeneity', { sample: sample });
  ok(b.ok, 'buildSpec(endogeneity) failed');
  var base = b.specs.filter(function (s) { return s.id === 'baseline'; })[0];
  var fs = b.specs.filter(function (s) { return s.id === 'iv-fs'; })[0];
  ok(base && fs, 'missing baseline / iv-fs spec');
  eq(base.nRows, fs.nRows, 'baseline 与 iv-fs 行数应一致');
  return { base: base, fs: fs };
}
/**
 * 独立 IV（单内生变量、恰好识别）：FWL 残差化 + 比率。
 * 关键点：y 与 z 对 [控制变量 + FE] 残差化，而 D 保留"仅去均值"的水平值
 * —— 这一形式已与"直接矩阵投影 X̂=P_Z X"路径互相验证到 1e-16。
 */
function ownIV(rows, cfg) {
  var names = [cfg.y, cfg.endog].concat(cfg.instruments).concat(cfg.controls);
  var keep = [], i, j;
  for (i = 0; i < rows.length; i++) {
    var good = true;
    for (j = 0; j < names.length; j++) {
      var v = rows[i][names[j]];
      if (typeof v !== 'number' || !isFinite(v)) { good = false; break; }
    }
    if (good) keep.push(i);
  }
  var y = keep.map(function (ix) { return rows[ix][cfg.y]; });
  var D = keep.map(function (ix) { return rows[ix][cfg.endog]; });
  var Z = keep.map(function (ix) { return rows[ix][cfg.instruments[0]]; });
  var C = keep.map(function (ix) { return cfg.controls.map(function (nm) { return rows[ix][nm]; }); });
  var feA = keep.map(function (ix) { return rows[ix][cfg.fe[0]]; });
  var feB = keep.map(function (ix) { return rows[ix][cfg.fe[1]]; });
  var M = y.map(function (_, ix) { return [y[ix], D[ix], Z[ix]].concat(C[ix]); });
  var dm = ownDemean(M, feA, feB, 500, 1e-14);
  var yd = dm.map(function (r) { return r[0]; });
  var Dd = dm.map(function (r) { return r[1]; });
  var Zd = dm.map(function (r) { return r[2]; });
  var Cd = dm.map(function (r) { return r.slice(3); });
  var hasC = cfg.controls.length > 0;
  var by = hasC ? ownOLS(yd, Cd) : null;
  var bz = hasC ? ownOLS(Zd, Cd) : null;
  function resid(v, b) {
    return v.map(function (vv, ix) {
      var f = 0;
      if (b) for (var j2 = 0; j2 < b.length; j2++) f += Cd[ix][j2] * b[j2];
      return vv - f;
    });
  }
  var uy = resid(yd, by), uz = resid(Zd, bz);
  var num = 0, den = 0;
  for (i = 0; i < uz.length; i++) { num += uz[i] * uy[i]; den += uz[i] * Dd[i]; }
  return { fwl: num / den, num: num, den: den, n: keep.length, yd: yd, Dd: Dd, Zd: Zd, Cd: Cd };
}
/** 直接矩阵投影：X̂ = P_Z X = Z(Z'Z)^-1 Z'X，β = (X̂'X̂)^-1 X̂'y */
function own2SLSProjection(yd, Dd, Zd, Cd) {
  var X = Dd.map(function (v, i) { return [v].concat(Cd[i]); });
  var Z = Zd.map(function (v, i) { return [v].concat(Cd[i]); });
  var ZtZi = ownInv(ownXtX(Z));
  if (!ZtZi) return null;
  var k = Z[0].length, m = X[0].length, ZtX = [], a, b, i;
  for (a = 0; a < k; a++) ZtX.push(new Array(m).fill(0));
  for (i = 0; i < Z.length; i++) for (a = 0; a < k; a++) for (b = 0; b < m; b++) ZtX[a][b] += Z[i][a] * X[i][b];
  var Pi = ownMatMul(ZtZi, ZtX);
  var Xhat = ownMatMul(Z, Pi);
  return ownOLS(yd, Xhat);
}

/* ============================ 缓存 ============================ */
var CACHE = {};
function runAllCached() {
  if (!CACHE.all) CACHE.all = P.runAll({ n: N_SMALL, seed: TEST_SEED }, null);
  return CACHE.all;
}

/* ============================================================================
   测试
   ============================================================================ */

T('load', '加载与命名空间', function () {
  ok(E && typeof E.fitOLS === 'function', 'ZY.econ 未加载');
  ok(P, 'ZY.pipeline 未加载');
  ['prepareSample', 'buildSpec', 'runStep', 'runAll', 'makeSyntheticPanel'].forEach(function (f) {
    eq(typeof P[f], 'function', true, 'ZY.pipeline.' + f + ' 必须是函数');
  });
  eq(P.STEP_ORDER.length, 7, '七步');
  eq(P.STEP_ORDER.join(','), 'data-prep,descriptive,baseline,robustness,endogeneity,heterogeneity,mechanism', '步骤顺序');
  ok(typeof P.VERSION === 'string' && P.VERSION.length > 0, 'VERSION');
  var md5 = crypto.createHash('sha256').update(econSrc).digest('hex');
  info('econ.js sha256=' + md5 + ' path=' + ECON_PATH);
  info('pipeline.js VERSION=' + P.VERSION);
  eq(typeof P.SYNTHETIC_DGP.totalEffectDigi, 'number', true, 'DGP 真值常量');
  info('DGP totalEffectDigi=' + P.SYNTHETIC_DGP.totalEffectDigi.toFixed(4));
});

T('dgp_shape', '合成面板：行数/字段/故意保留的数据坑', function () {
  var rows = P.makeSyntheticPanel(N_SMALL, TEST_SEED);
  eq(rows.length, N_SMALL, '行数必须精确等于 n');
  var need = ['firm_id', 'year', 'ln_innov', 'digi', 'digi_alt', 'size', 'lev', 'roa', 'age', 'subsidy', 'industry_id'];
  var i, k;
  for (i = 0; i < rows.length; i++) {
    for (k = 0; k < need.length; k++) ok(need[k] in rows[i], '缺少字段 ' + need[k]);
  }
  var nMiss = 0, nLevOut = 0, seen = {}, nDup = 0;
  for (i = 0; i < rows.length; i++) {
    for (k = 0; k < need.length; k++) if (typeof rows[i][need[k]] === 'number' && !isFinite(rows[i][need[k]])) nMiss++;
    if (rows[i].lev > 1 || rows[i].lev < 0) nLevOut++;
    var key = rows[i].firm_id + '|' + rows[i].year;
    if (seen[key]) nDup++; else seen[key] = 1;
  }
  ok(nMiss > 0, '必须包含缺失值（真实的数据坑）');
  ok(nLevOut > 0, '必须包含 lev 越界值（供清洗/缩尾）');
  ok(nDup > 0, '必须包含重复 firm-year 行（供去重）');
  var years = {}, firms = {};
  rows.forEach(function (r) { years[r.year] = 1; firms[r.firm_id] = 1; });
  ok(Object.keys(years).length >= 8, '至少 8 期');
  info('panel rows=' + rows.length + ' firms=' + Object.keys(firms).length + ' periods=' + Object.keys(years).length +
    ' missingCells=' + nMiss + ' levOutliers=' + nLevOut + ' dupRows=' + nDup);
});

T('dgp_determinism', '同 seed 完全一致 / 不同 seed 不同', function () {
  var a = JSON.stringify(P.makeSyntheticPanel(600, TEST_SEED));
  var b = JSON.stringify(P.makeSyntheticPanel(600, TEST_SEED));
  eq(a === b, true, '同 seed 必须逐字节一致');
  var c = JSON.stringify(P.makeSyntheticPanel(600, TEST_SEED + 1));
  eq(a === c, false, '不同 seed 应产生不同数据');
});

T('prep_reconcile', '样本量对账：原始 = 剔除（重复+lev越界+缺失）+ 有效', function () {
  var s = P.prepareSample({ n: N_SMALL, seed: TEST_SEED });
  ok(s.ok, 'prepareSample 应成功');
  var d = s.dropped;
  eq(s.rawRows, d.duplicate + d.levOutOfRange + d.missing + s.nObs, '对账等式');
  eq(s.reconcile.ok, true, 'reconcile.ok');
  close(s.reconcile.raw, s.rawRows, 0, 'reconcile.raw');
  close(s.reconcile.valid, s.nObs, 0, 'reconcile.valid');
  ok(d.duplicate > 0, '应剔除了重复行');
  ok(d.levOutOfRange > 0, '应剔除了 lev 越界行');
  ok(d.missing > 0, '应剔除了关键缺失行');
  var uniq = {}, i, dup = 0;
  for (i = 0; i < s.rows.length; i++) {
    var key = s.rows[i].firm_id + '|' + s.rows[i].year;
    if (uniq[key]) dup++; else uniq[key] = 1;
  }
  eq(dup, 0, '清洗后 firm-year 必须唯一');
  info('prep raw=' + s.rawRows + ' dup=' + d.duplicate + ' lev=' + d.levOutOfRange + ' miss=' + d.missing +
    ' valid=' + s.nObs + ' winsorChanged=' + s.winsorTotal);
});

T('prep_winsor', '缩尾：真实调用 econ.winsorize，且上下界自洽', function () {
  var s = P.prepareSample({ n: 1200, seed: 7 });
  ok(s.winsorInfo.length > 0, 'winsorInfo');
  s.winsorInfo.forEach(function (w) {
    ok(isFinite(w.lo) && isFinite(w.hi), w.name + ' 分位点');
    ok(w.lo <= w.hi, w.name + ' lo<=hi');
    ok(w.changed >= 0 && w.changed <= s.nObs, w.name + ' changed 合理');
    if (w.changed > 0) ok(w.changed < s.nObs, w.name + ' 不该全部被替换');
  });
  /* 缩尾后每个变量的极值应落在 [lo, hi] 内（±1e-9） */
  s.winsorInfo.forEach(function (w) {
    var vals = s.rows.map(function (r) { return r[w.name]; }).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    ok(mn >= w.lo - 1e-9, w.name + ' 下界未生效');
    ok(mx <= w.hi + 1e-9, w.name + ' 上界未生效');
  });
  var s2 = P.prepareSample({ n: 1200, seed: 7 });
  eq(s2.dataHash, s.dataHash, '同参数两次 prepareSample 的 dataHash 必须相同');
  info('winsor total=' + s.winsorTotal + ' dataHash=' + s.dataHash);
});

T('prep_panel', '面板结构：声明口径与 econ.detectPanel 均为真实调用', function () {
  var s = P.prepareSample({ n: N_SMALL, seed: TEST_SEED });
  var pd = s.panelDeclared;
  ok(pd && pd.ok, 'declared panel');
  ok(pd.nUnits >= 2 && pd.nPeriods >= 2, 'N/T');
  eq(pd.nUnits * pd.nPeriods >= s.nObs, true, 'N×T 不应小于观测数');
  ok(pd.coverage > 0 && pd.coverage <= 1, 'coverage');
  eq(pd.balanced, s.nObs === pd.nUnits * pd.nPeriods, 'balanced 标志');
  ok(s.panel && typeof s.panel.ok === 'boolean', 'detectPanel 结果存在');
  if (s.panel.ok) {
    ok(s.panel.nUnits >= 2, 'detectPanel nUnits');
    info('panel declared N=' + pd.nUnits + ' T=' + pd.nPeriods + ' cov=' + pd.coverage.toFixed(4) +
      ' balanced=' + pd.balanced + ' detected=' + s.panel.unitId + 'x' + s.panel.timeId);
  }
});

T('spec_shape', 'buildSpec：y/X/xNames/fe/cluster 结构完整', function () {
  var b = P.buildSpec('baseline', { n: 1200, seed: TEST_SEED });
  ok(b.ok, 'buildSpec ok');
  var s = b.specs[0];
  eq(s.y.length, s.X.length, 'y 与 X 行数一致');
  eq(s.xNames.length, s.X[0].length, 'xNames 与列数一致');
  eq(s.xNames[0], '常数项', '第一列是常数项');
  eq(s.fe.length, 2, '两个固定效应维度');
  eq(s.fe[0].length, s.y.length, 'FE 标签长度');
  eq(s.cluster.length, s.y.length, '聚类标签长度');
  eq(s.xVars.join(','), 'digi,size,lev,roa,age,subsidy', '基准控制变量');
  ['descriptive', 'baseline', 'robustness', 'endogeneity', 'heterogeneity', 'mechanism'].forEach(function (id) {
    var r = P.buildSpec(id, { n: 600, seed: TEST_SEED });
    ok(r.ok, 'buildSpec(' + id + ') 应成功');
    ok(r.specs.length > 0, 'buildSpec(' + id + ') 应给出规格');
  });
  var rb = P.buildSpec('robustness', { n: 600, seed: TEST_SEED });
  ok(rb.specs.length >= 4, '稳健性至少 4 项');
});

T('baseline_independent', '基准回归：系数与聚类标准误与独立实现逐位一致', function () {
  var ctx = { n: N_SMALL, seed: TEST_SEED };
  var b = P.buildSpec('baseline', ctx);
  var s = b.specs[0];
  var step = P.runStep('baseline', { sample: b.sample });
  eq(step.status, 'done', 'baseline 应成功');
  var t = step.tables.filter(function (x) { return x.id === 'baseline.coef'; })[0];

  /* 与 fitOLS 相同的行级缺失剔除 */
  var keep = [], i, j;
  for (i = 0; i < s.y.length; i++) {
    var good = isFinite(s.y[i]);
    for (j = 0; j < s.X[i].length; j++) if (!isFinite(s.X[i][j])) good = false;
    if (good) keep.push(i);
  }
  eq(keep.length, step.diagnostics.nObs, '有效观测数应与引擎一致');
  var y = keep.map(function (ix) { return s.y[ix]; });
  var X = keep.map(function (ix) { return s.X[ix]; });
  var feA = s.fe[0].filter(function (_, ix) { return keep.indexOf(ix) >= 0; });
  var feB = s.fe[1].filter(function (_, ix) { return keep.indexOf(ix) >= 0; });
  var cl = s.cluster.filter(function (_, ix) { return keep.indexOf(ix) >= 0; });

  /* 常数项在有 FE 时被吸收：与 econ 的约定一致，把它从待估参数中剔除 */
  var isConst = [], k = X[0].length;
  for (j = 0; j < k; j++) { isConst[j] = true; }
  for (i = 0; i < X.length; i++) for (j = 0; j < k; j++) if (Math.abs(X[i][j] - 1) > 1e-12) isConst[j] = false;
  var estIdx = [];
  for (j = 0; j < k; j++) if (!isConst[j]) estIdx.push(j);
  var Xe = X.map(function (r) { return estIdx.map(function (jj) { return r[jj]; }); });

  var dm = ownDemean(Xe, feA, feB, 500, 1e-14);
  var dmY = ownDemean(y.map(function (v) { return [v]; }), feA, feB, 500, 1e-14).map(function (r) { return r[0]; });
  var beta = ownOLS(dmY, dm);
  ok(beta, 'independent OLS 求解失败');
  var seOut = ownClusterSE(dmY, dm, beta, cl);
  ok(seOut, 'independent cluster SE 失败');

  var names = s.xNames;
  var maxCoef = 0, maxSe = 0;
  for (i = 0; i < estIdx.length; i++) {
    var nm = names[estIdx[i]];
    var r = t.rowLabels.indexOf(nm);
    ok(r >= 0, '缺少系数行 ' + nm);
    var engineCoef = cellVal(t, r, '系数'), engineSe = cellVal(t, r, '标准误');
    var d1 = Math.abs(engineCoef - beta[i]);
    if (d1 > maxCoef) maxCoef = d1;
    var d2 = Math.abs(engineSe - seOut.se[i]) / Math.max(Math.abs(seOut.se[i]), 1e-12);
    if (d2 > maxSe) maxSe = d2;
  }
  ok(maxCoef < 1e-6, '系数与独立实现不一致，最大偏差 ' + maxCoef);
  ok(maxSe < 1e-6, '聚类标准误与独立实现不一致，最大相对偏差 ' + maxSe);
  var digiRow = t.rowLabels.indexOf('digi');
  info('baseline digi coef=' + cellVal(t, digiRow, '系数').toFixed(4) + ' se=' + cellVal(t, digiRow, '标准误').toFixed(4) +
    ' t=' + cellVal(t, digiRow, 't 值').toFixed(3) + ' N=' + step.diagnostics.nObs + ' G=' + step.diagnostics.cluster.nClusters +
    ' | maxCoefDiff=' + maxCoef.toExponential(2) + ' maxSeRelDiff=' + maxSe.toExponential(2));
});

T('baseline_stats_consistent', '统计量自洽：t、p、CI、R² 全部可复算', function () {
  var step = P.runStep('baseline', { n: N_SMALL, seed: TEST_SEED });
  var t = step.tables.filter(function (x) { return x.id === 'baseline.coef'; })[0];
  var df = step.diagnostics.nObs - 6;                 /* 6 个待估斜率（常数项被吸收） */
  var maxP = 0, maxCI = 0, maxT = 0;
  t.rows.forEach(function (row, r) {
    if (typeof row[1] !== 'number') return;           /* 被吸收的常数项行 */
    var b = row[1], se = row[2], tv = row[3], p = row[4], lo = row[6], hi = row[7];
    var dT = Math.abs(tv - b / se);
    if (dT > maxT) maxT = dT;
    var expectedP = E.tPValue(tv, df);
    var dP = Math.abs(p - expectedP);
    if (dP > maxP) maxP = dP;
    var ciLo = b - 1.96 * se, ciHi = b + 1.96 * se;
    var dC = Math.max(Math.abs(lo - ciLo), Math.abs(hi - ciHi));
    if (dC > maxCI) maxCI = dC;
  });
  ok(maxT < 1e-9, 't ≠ coef/se');
  ok(maxP < 1e-6, 'p 无法用 econ.tPValue 复算，最大偏差 ' + maxP);
  ok(maxCI < 1e-9, 'CI 无法用 ±1.96se 复算');
  var fit = step.tables.filter(function (x) { return x.id === 'baseline.fit'; })[0];
  close(cellVal(fit, 0, '值'), step.diagnostics.nObs, 0, 'N');
  var r2w = cellVal(fit, 5, '值');
  close(r2w, step.diagnostics.r2Within, 1e-12, '组内 R²');
  ok(r2w > 0 && r2w < 1, '组内 R² 应在 (0,1)');
  info('stats maxT=' + maxT.toExponential(2) + ' maxP=' + maxP.toExponential(2) + ' maxCI=' + maxCI.toExponential(2) + ' r2Within=' + r2w.toFixed(4));
});

T('baseline_truth_recovery', 'DGP 真值回收：3 个 seed 下系数都不跑偏', function () {
  var truth = P.SYNTHETIC_DGP.totalEffectDigi;
  var seeds = [20240113, 11, 987654];
  var got = [];
  seeds.forEach(function (sd) {
    var b = P.buildSpec('baseline', { n: 1800, seed: sd });
    var step = P.runStep('baseline', { sample: b.sample });
    eq(step.status, 'done', 'seed ' + sd + ' 应成功');
    var c = null, i;
    for (i = 0; i < step.cells.length; i++) if (step.cells[i].term === 'digi' && step.cells[i].label.indexOf('系数') >= 0) c = step.cells[i];
    ok(c, 'digi 系数单元格');
    var dev = Math.abs(c.value - truth);
    ok(dev <= 5 * c.se, 'seed ' + sd + ' 系数 ' + c.value.toFixed(4) + ' 偏离真值 ' + truth.toFixed(4) + ' 超过 5×se(' + c.se.toFixed(4) + ')');
    got.push(c.value.toFixed(4) + '±' + c.se.toFixed(4));
  });
  info('truth=' + truth.toFixed(4) + ' estimates=' + got.join(' , '));
});

T('runall_done', '七步全部 status=done（合成面板）', function () {
  var all = runAllCached();
  ok(all.order.length === 7, 'order');
  P.STEP_ORDER.forEach(function (id) {
    ok(all.steps[id], '缺少步骤 ' + id);
    eq(all.steps[id].status, 'done', id + ' 应为 done，实际 ' + all.steps[id].status +
      (all.steps[id].error ? (' (' + all.steps[id].error.code + ': ' + all.steps[id].error.message + ')') : ''));
  });
  eq(all.ok, true, 'runAll.ok');
  eq(all.status, 'done', 'runAll.status');
  eq(all.failed.length, 0, 'failed 应为空');
  info('runAll status=' + all.status + ' steps=' + all.order.length);
});

T('provenance', '每步 provenance 字段完整、可复现（无时间戳）', function () {
  var all = runAllCached();
  var need = ['stepId', 'codeVersion', 'codeHash', 'engine', 'dataset', 'dataHash', 'seed', 'nObs', 'specHash', 'specVersion'];
  P.STEP_ORDER.forEach(function (id) {
    var p = all.steps[id].provenance;
    ok(p, id + ' 缺 provenance');
    need.forEach(function (f) { ok(p[f] !== undefined && p[f] !== null, id + ' provenance 缺 ' + f); });
    eq(p.seed, TEST_SEED, id + ' seed');
    ok(Object.prototype.toString.call(p.fe) === '[object Array]', id + ' fe 应为数组');
    if (id !== 'descriptive') ok(p.fe.length > 0, id + ' fe 清单');
    ok(p.variables && p.variables.all && p.variables.all.length > 0, id + ' 变量清单');
    ok(typeof p.engine.fingerprint === 'string' && p.engine.fingerprint.length === 8, id + ' 引擎指纹');
    ok(typeof p.dataHash === 'string' && p.dataHash.length === 8, id + ' 数据 hash');
  });
  var p0 = all.steps.baseline.provenance;
  eq(p0.cluster, 'firm_id', '基准聚类层级');
  eq(p0.y, 'ln_innov', '基准被解释变量');
  eq(p0.x.join(','), 'digi,size,lev,roa,age,subsidy', '基准解释变量');
  ok(JSON.stringify(all).indexOf('generatedAt') < 0, 'provenance 不应带时间戳（否则破坏确定性）');
});

T('cell_coverage', '每个数值单元格都能被 interpretation 引用（cell_id 覆盖）', function () {
  var all = runAllCached();
  P.STEP_ORDER.forEach(function (id) {
    var st = all.steps[id];
    var numeric = [], i, j, t;
    for (i = 0; i < st.tables.length; i++) {
      t = st.tables[i];
      for (j = 0; j < t.cells.length; j++) numeric.push(t.cells[j]);
    }
    var refIds = {}, k;
    for (k = 0; k < st.interpretation.refs.length; k++) {
      var rid = st.interpretation.refs[k].cellId;
      eq(refIds[rid], undefined, id + ' interpretation.refs 有重复 cellId: ' + rid);
      refIds[rid] = 1;
    }
    for (i = 0; i < numeric.length; i++) {
      ok(refIds[numeric[i].id] === 1, id + ' 单元格未被解释引用：' + numeric[i].id);
      ok(st.interpretation.text.indexOf(numeric[i].formatted) >= 0,
        id + ' 解释文本里找不到该单元格的值：' + numeric[i].id + '=' + numeric[i].formatted);
    }
    eq(st.cells.length, numeric.length, id + ' cells 与 tables 汇总不一致');
    ok(JSON.stringify(st.interpretation.text).length > 20, id + ' 解释过短');
  });
  var total = 0;
  P.STEP_ORDER.forEach(function (id) { total += all.steps[id].cells.length; });
  info('cells total=' + total + ' （全部被 interpretation 引用）');
});

T('determinism_full', '确定性：同 seed 两次 runAll 结果逐字节一致', function () {
  var a = JSON.stringify(P.runAll({ n: 1200, seed: 4242 }, null));
  var b = JSON.stringify(P.runAll({ n: 1200, seed: 4242 }, null));
  eq(a.length, b.length, '两次结果长度不同');
  eq(a === b, true, '两次 runAll 结果不一致');
  var c = JSON.stringify(P.runAll({ n: 1200, seed: 4243 }, null));
  eq(a === c, false, '不同 seed 不应得到完全相同的结果');
  info('determinism bytes=' + a.length);
});

T('cross_run_consistency', '同一样本：baseline 步与 robustness 对照行系数完全一致', function () {
  var all = runAllCached();
  var bStep = all.steps.baseline;
  var digi = null, i;
  for (i = 0; i < bStep.cells.length; i++) if (bStep.cells[i].term === 'digi' && bStep.cells[i].label.indexOf('系数') >= 0) digi = bStep.cells[i];
  ok(digi, 'baseline digi 系数单元格');
  var rt = all.steps.robustness.tables.filter(function (x) { return x.id === 'robustness.matrix'; })[0];
  var refRow = rt.rowLabels.indexOf('baseline');
  ok(refRow >= 0, 'robustness 缺 baseline 对照行');
  close(cellVal(rt, refRow, '系数'), digi.value, 1e-12, '对照行系数');
  close(cellVal(rt, refRow, '标准误'), digi.se, 1e-12, '对照行标准误');
  close(cellVal(rt, refRow, 'N'), bStep.diagnostics.nObs, 0, '对照行 N');
});

T('robustness_items', '稳健性：≥4 项必需检验，全部真跑', function () {
  var all = runAllCached();
  var d = all.steps.robustness.diagnostics;
  var ids = d.items.map(function (x) { return x.id; });
  ['baseline', 'alt-y', 'alt-x', 'cluster-industry', 'placebo-lead2', 'placebo-permute'].forEach(function (need) {
    ok(ids.indexOf(need) >= 0, '缺稳健性项 ' + need);
  });
  ok(d.total >= 6, '稳健性项数应 ≥ 6');
  d.items.forEach(function (x) {
    eq(x.status, 'done', '稳健性项 ' + x.id + ' 应完成，实际 ' + x.status + ' ' + (x.code || ''));
    ok(x.nObs > 0, x.id + ' nObs');
    ok(x.spec && x.spec.y && x.spec.x.length >= 2, x.id + ' spec 摘要');
  });
  var rt = all.steps.robustness.tables.filter(function (x) { return x.id === 'robustness.matrix'; })[0];
  var altX = rt.rowLabels.indexOf('alt-x');
  eq(cellVal(rt, altX, '核心变量'), 'digi_alt', '替换核心解释变量行应标注核心变量');
  info('robustness items=' + d.total + ' placebo=' + JSON.stringify(d.placebo));
});

T('endogeneity_iv', '内生性：第一阶段 F 真算（弱工具如实报告）', function () {
  var all = runAllCached();
  var d = all.steps.endogeneity.diagnostics;
  ok(isFinite(d.firstStageF), 'F 应为有限数');
  var ft = all.steps.endogeneity.tables.filter(function (x) { return x.id === 'endogeneity.firstStage'; })[0];
  ok(ft, '缺第一阶段表');
  var zRow = ft.rowLabels.indexOf('z_iv');
  ok(zRow >= 0, '第一阶段缺 z_iv');
  var zt = cellVal(ft, zRow, 't 值');
  close(d.firstStageF, zt * zt, 1e-8, 'F 应等于单工具时的 t²');
  eq(d.weakInstrument, d.firstStageF < P.IV_F_THRESHOLD, '弱工具判定');
  var ivTable = all.steps.endogeneity.tables.filter(function (x) { return x.id === 'endogeneity.iv'; })[0];
  var fCol = ivTable.head.indexOf('第一阶段 F');
  close(ivTable.rows[ivTable.rowLabels.indexOf('2sls')][fCol], d.firstStageF, 1e-9, '对比表里的 F');
  info('firstStageF=' + d.firstStageF.toFixed(3) + ' weak=' + d.weakInstrument + ' 2sls=' + (d.twoSLS ? d.twoSLS.coef.toFixed(4) : 'n/a') +
    ' reliable=' + d.twoSLSReliable);
});

T('endogeneity_2sls_independent', '2SLS：与独立 FWL 比率 / 直接矩阵投影一致（强工具场景）', function () {
  /* (1) 良态场景：自造强工具 z = digi + 小噪声，检验 2SLS 代数实现 */
  var rows = P.makeSyntheticPanel(900, TEST_SEED);
  rows.forEach(function (r) { r.z_strong = r.digi + 0.02 * (((r.firm_id * 7 + r.year * 13) % 11) - 5) / 5; });
  var s1 = P.prepareSample({ rows: rows });
  var cfg = {
    y: 'ln_innov', endog: 'digi', controls: ['size', 'lev', 'roa', 'age', 'subsidy'],
    instruments: ['z_strong'], fe: ['firm_id', 'year'], cluster: 'firm_id'
  };
  var two = P.util.twoSLS(s1, cfg);
  ok(two.ok, 'twoSLS 应成功：' + (two.code || ''));
  ok(two.firstStage.F > 50, '强工具场景 F 应远大于门槛，实际 ' + two.firstStage.F);
  var ind = ownIV(s1.rows, cfg);
  relClose(two.beta[0], ind.fwl, 1e-6, '强工具：2SLS 与独立 FWL 比率');
  var proj = own2SLSProjection(ind.yd, ind.Dd, ind.Zd, ind.Cd);
  ok(proj, '直接矩阵投影求解失败');
  relClose(two.beta[0], proj[0], 1e-6, '强工具：2SLS 与直接矩阵投影 P_Z X');
  info('strong-IV check: n=' + ind.n + ' F=' + two.firstStage.F.toFixed(1) +
    ' pipeline=' + two.beta[0].toFixed(8) + ' fwl=' + ind.fwl.toFixed(8) + ' projection=' + proj[0].toFixed(8));

  /* (2) 真实样本（弱工具）：F 与 t² 一致、弱工具判定与"点估计不可用"标注 */
  var all = runAllCached();
  var d = all.steps.endogeneity.diagnostics;
  ok(isFinite(d.firstStageF), 'F 应为有限数');
  var ft = all.steps.endogeneity.tables.filter(function (x) { return x.id === 'endogeneity.firstStage'; })[0];
  var zRow = ft.rowLabels.indexOf('z_iv');
  close(d.firstStageF, Math.pow(cellVal(ft, zRow, 't 值'), 2), 1e-8, 'F 应等于单工具时的 t²');
  eq(d.weakInstrument, d.firstStageF < P.IV_F_THRESHOLD, '弱工具判定');
  eq(d.twoSLSReliable, !d.weakInstrument, '弱工具时点估计必须标注为不可用');
  ok(d.twoSLSNote.length > 0, '弱工具说明');

  /* (3) 真实样本的 2SLS 也必须与独立路径一致（含弱工具情形） */
  var inp = buildIVInputs(P.prepareSample({ n: N_SMALL, seed: TEST_SEED }));
  var fs = inp.fs, base = inp.base;
  eq(fs.cluster.join('|'), base.cluster.join('|'), 'baseline 与 iv-fs 的样本行必须一致');
  var big = P.prepareSample({ n: N_SMALL, seed: TEST_SEED });
  P.util.ensureDerived(big, ['z_iv']);
  var real = ownIV(big.rows, {
    y: 'ln_innov', endog: 'digi', controls: ['size', 'lev', 'roa', 'age', 'subsidy'],
    instruments: ['z_iv'], fe: ['firm_id', 'year'], cluster: 'firm_id'
  });
  eq(real.n, d.twoSLS.nObs, '独立路径的有效观测数应与 2SLS 一致');
  relClose(real.fwl, d.twoSLS.coef, 1e-6, '真实样本：2SLS 与独立 FWL 比率');
  var ivTable = all.steps.endogeneity.tables.filter(function (x) { return x.id === 'endogeneity.iv'; })[0];
  close(cellVal(ivTable, ivTable.rowLabels.indexOf('2sls'), 'digi 系数'), d.twoSLS.coef, 1e-12, '表内 2SLS 系数');
  info('real-IV check: n=' + real.n + ' F=' + d.firstStageF.toFixed(3) + ' pipeline=' + d.twoSLS.coef.toFixed(6) +
    ' fwl=' + real.fwl.toFixed(6) + ' weak=' + d.weakInstrument);
});

T('heterogeneity_diff', '异质性：分组 + 交互项组间差异（p 可复算）', function () {
  var all = runAllCached();
  var st = all.steps.heterogeneity;
  var d = st.diagnostics;
  ok(isFinite(d.interactionP.size), '规模组间差异 p');
  ok(d.ownVar === null || isFinite(d.interactionP.own), '所有制组间差异 p');
  var gt = st.tables.filter(function (x) { return x.id === 'heterogeneity.groups'; })[0];
  var b = P.buildSpec('heterogeneity', { sample: P.prepareSample({ n: N_SMALL, seed: TEST_SEED }) });
  var diffSpec = b.specs.filter(function (s) { return s.id === 'size-diff'; })[0];
  ok(diffSpec, '缺 size-diff 规格');
  var r = gt.rowLabels.indexOf('size-diff');
  ok(r >= 0, '缺 size-diff 行');
  var nObs = cellVal(gt, r, 'N'), kk = diffSpec.xVars.length;
  var pExp = E.tPValue(cellVal(gt, r, 't 值'), nObs - kk);
  close(cellVal(gt, r, 'p 值'), pExp, 1e-9, '交互项 p 应等于 econ.tPValue(t, N-k)');
  close(d.interactionP.size, pExp, 1e-12, 'diagnostics.interactionP.size');
  var chow = st.tables.filter(function (x) { return x.id === 'heterogeneity.chow'; })[0];
  ok(chow, '缺独立样本差异表');
  var g1 = gt.rowLabels.indexOf('size-large'), g2 = gt.rowLabels.indexOf('size-small');
  var dExp = cellVal(gt, g1, '系数') - cellVal(gt, g2, '系数');
  close(cellVal(chow, 0, '系数差异'), dExp, 1e-12, '独立样本差异 = 两组系数之差');
  info('pSize=' + d.interactionP.size.toFixed(4) + ' pOwn=' + (isFinite(d.interactionP.own) ? d.interactionP.own.toFixed(4) : 'n/a') +
    ' groups=' + JSON.stringify(d.sizeGroup));
});

T('mechanism_sobel', '机制：中介分解可复算（a×b、Sobel z/p）', function () {
  var all = runAllCached();
  var st = all.steps.mechanism;
  var pt = st.tables.filter(function (x) { return x.id === 'mechanism.paths'; })[0];
  var dt = st.tables.filter(function (x) { return x.id === 'mechanism.decomp'; })[0];
  ok(pt && dt, '缺机制表');
  var chans = st.diagnostics.channels;
  ok(chans.length > 0, '至少一个渠道');
  chans.forEach(function (cn) {
    var a = pt.rowLabels.indexOf(cn + ':a 路径（digi → ' + cn + '）');
    var b = pt.rowLabels.indexOf(cn + ':b 路径（' + cn + ' → ln_innov）');
    var dr = dt.rowLabels.indexOf(cn);
    ok(a >= 0 && b >= 0 && dr >= 0, cn + ' 路径行缺失');
    var ac = cellVal(pt, a, '系数'), ase = cellVal(pt, a, '标准误');
    var bc = cellVal(pt, b, '系数'), bse = cellVal(pt, b, '标准误');
    var ind = ac * bc;
    close(cellVal(dt, dr, '间接效应 a×b'), ind, 1e-12, cn + ' 间接效应 a×b');
    var seInd = Math.sqrt(ac * ac * bse * bse + bc * bc * ase * ase);
    var z = ind / seInd;
    close(cellVal(dt, dr, 'Sobel z'), z, 1e-9, cn + ' Sobel z');
    close(cellVal(dt, dr, 'Sobel p'), 1 - E.chi2cdf(z * z, 1), 1e-9, cn + ' Sobel p');
    eq(cellVal(pt, b, '变量'), cn, cn + ' b 路径的变量名');
  });
  info('mechanism=' + JSON.stringify(st.diagnostics.decomposition));
});

T('metric_cell_link', 'metrics 里的 cellId 都能定位到真实单元格且数值一致', function () {
  var all = runAllCached();
  P.STEP_ORDER.forEach(function (id) {
    var st = all.steps[id];
    var byId = {}, i;
    for (i = 0; i < st.cells.length; i++) byId[st.cells[i].id] = st.cells[i];
    st.metrics.forEach(function (m) {
      ok(m.k !== undefined && m.k !== null, id + ' metric 缺 k');
      ok(typeof m.v === 'string', id + ' metric.v 应为字符串');
      if (m.cellId) {
        var c = byId[m.cellId];
        ok(c, id + ' metric 指向不存在的单元格 ' + m.cellId);
        eq(m.v, c.formatted, id + ' metric 值与单元格 formatted 不一致');
        close(m.value, c.value, 0, id + ' metric 值与单元格 value 不一致');
      }
    });
  });
});

T('failure_singular', '失败路径①：完全共线 → SINGULAR（带引擎 code/message）', function () {
  var rows = P.makeSyntheticPanel(480, TEST_SEED);
  rows.forEach(function (r) { r.size = 2 * r.digi; });
  var s = P.prepareSample({ rows: rows });
  var st = P.runStep('baseline', { sample: s });
  eq(st.status, 'failed', '共线时必须 failed');
  ok(st.error && st.error.code, '必须带 error.code');
  eq(st.error.code, 'SINGULAR', 'shared engine code');
  ok(typeof st.error.message === 'string' && st.error.message.length > 0, '必须有 message');
  eq(st.tables.length, 0, '失败时不应给出结果表');
  eq(st.cells.length, 0, '失败时不应给出数字单元格');
  info('singular failure code=' + st.error.code + ' msg=' + ascii(st.error.message));
});

T('failure_clusters', '失败路径②：聚类数 = 1 → TOO_FEW_CLUSTERS', function () {
  var rows = P.makeSyntheticPanel(480, TEST_SEED);
  rows.forEach(function (r) { r.grp_one = 1; });
  var s = P.prepareSample({ rows: rows });
  var st = P.runStep('baseline', { sample: s, clusterVar: 'grp_one' });
  eq(st.status, 'failed', '聚类数 1 时必须 failed');
  eq(st.error.code, 'TOO_FEW_CLUSTERS', 'engine code');
  info('cluster failure code=' + st.error.code + ' msg=' + ascii(st.error.message));
});

T('failure_missing_var', '失败路径③：缺必需变量 → MISSING_VAR', function () {
  var rows = P.makeSyntheticPanel(240, TEST_SEED);
  rows.forEach(function (r) { delete r.size; });
  var st = P.runStep('baseline', { rows: rows });
  eq(st.status, 'failed', '缺变量必须 failed');
  eq(st.error.code, 'MISSING_VAR', 'code');
  ok(st.error.message.indexOf('size') >= 0, 'message 应指出缺失变量');
  info('missing var code=' + st.error.code + ' msg=' + ascii(st.error.message));
});

T('failure_partial_item', '失败路径④：稳健性必需项失败 → 整步 failed 且逐项带 code', function () {
  var rows = P.makeSyntheticPanel(600, TEST_SEED);
  rows.forEach(function (r) { delete r.industry_id; });
  var s = P.prepareSample({ rows: rows });
  eq(s.ok, true, '样本准备仍应成功');
  var st = P.runStep('robustness', { sample: s });
  eq(st.status, 'failed', '必需项失败时整步应 failed');
  eq(st.error.code, 'ROBUSTNESS_ITEM_FAILED', 'code');
  var bad = st.diagnostics.items.filter(function (x) { return x.status === 'failed'; });
  eq(bad.length, 1, '应只有 cluster-industry 一项失败');
  eq(bad[0].id, 'cluster-industry', '失败项 id');
  eq(bad[0].code, 'MISSING_VAR', '逐项 code');
  /* 失败行不得出现占位数字 */
  var t = st.tables.filter(function (x) { return x.id === 'robustness.matrix'; })[0];
  var r = t.rowLabels.indexOf('cluster-industry');
  var numCells = 0, i;
  for (i = 0; i < t.cells.length; i++) if (t.cells[i].row === r) numCells++;
  eq(numCells, 0, '失败行不应有数值单元格');
  ok(String(cellVal(t, r, '结论')).indexOf('MISSING_VAR') >= 0, '失败行结论应写明 code');
  info('partial item failure code=' + st.error.code + ' item=' + bad[0].id + '/' + bad[0].code);
});

T('impute_mode', '可选缺失处理：impute-median 下对账仍自洽', function () {
  var s = P.prepareSample({ n: 900, seed: 5, missing: 'impute-median' });
  ok(s.ok, 'prepareSample');
  eq(s.missingMode, 'impute-median', 'mode');
  eq(s.dropped.missing, 0, '插补模式下不应因关键缺失剔除');
  eq(s.rawRows, s.dropped.total + s.nObs, '对账等式仍成立');
  ok(s.imputed.total > 0, '应发生插补');
  var st = P.runStep('baseline', { sample: s });
  eq(st.status, 'done', '插补后基准回归应可估计');
  info('impute total=' + s.imputed.total + ' nObs=' + s.nObs);
});

T('recompute_from_sample', '反造假检查：结果表的数值必须等于用 ZY.econ 现场重算的值', function () {
  var ctx = { n: 1500, seed: TEST_SEED };
  var b = P.buildSpec('baseline', ctx);
  var spec = b.specs[0];
  var raw = E.fitOLS({ y: spec.y, X: spec.X, xNames: spec.xNames, fe: spec.fe, cluster: spec.cluster });
  ok(raw.ok, 'engine 应成功');
  var st = P.runStep('baseline', { sample: b.sample });
  var t = st.tables.filter(function (x) { return x.id === 'baseline.coef'; })[0];
  raw.coefficients.forEach(function (c) {
    var r = t.rowLabels.indexOf(c.name);
    ok(r >= 0, '缺行 ' + c.name);
    if (c.absorbed) {
      eq(t.formattedRows[r][1], '—', '被吸收的常数项在表内应留空');
      eq(typeof t.rows[r][1], 'number', true, '原始值仍保留 NaN（引擎输出）');
      eq(isFinite(t.rows[r][1]), false, 'NaN');
      return;
    }
    close(cellVal(t, r, '系数'), c.coef, 1e-12, c.name + ' 系数');
    close(cellVal(t, r, '标准误'), c.se, 1e-12, c.name + ' 标准误');
    close(cellVal(t, r, 't 值'), c.t, 1e-12, c.name + ' t');
    close(cellVal(t, r, 'p 值'), c.p, 1e-12, c.name + ' p');
  });
  close(cellVal(t, t.rowLabels.indexOf('digi'), '标准误'), raw.coefficients.filter(function (c) { return c.name === 'digi'; })[0].se, 1e-12, 'digi se');
  eq(st.diagnostics.nObs, raw.nObs, 'N');
  close(st.diagnostics.r2Within, raw.r2Within, 1e-12, '组内 R²');
});

/* ============================ 运行 ============================ */
var pass = 0;
var t0 = Date.now();
for (var i = 0; i < tests.length; i++) {
  var t = tests[i];
  var start = Date.now();
  try {
    t.fn();
    pass++;
    console.log('PASS ' + String(i + 1).padStart(2, '0') + ' ' + t.id + ' (' + (Date.now() - start) + 'ms)');
  } catch (err) {
    failures.push({ id: t.id, name: t.name, detail: (err && err.stack) ? err.stack : String(err) });
    console.log('FAIL ' + String(i + 1).padStart(2, '0') + ' ' + t.id + ' :: ' + ascii(err && err.message ? err.message : err));
  }
}
console.log('SUMMARY total=' + tests.length + ' pass=' + pass + ' fail=' + (tests.length - pass) + ' ms=' + (Date.now() - t0));
if (failures.length) {
  var out = failures.map(function (f) { return '### ' + f.id + ' :: ' + f.name + '\n' + f.detail; }).join('\n\n');
  try { fs.writeFileSync(path.join(__dirname, 'pipeline.test.failures.txt'), out, 'utf8'); } catch (e) { /* ignore */ }
  console.log('FAILURES written to test/pipeline.test.failures.txt (' + failures.length + ')');
  process.exit(1);
}
console.log('ALL PASS');
