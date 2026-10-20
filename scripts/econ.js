/* ============================================================
   智研 · 计量引擎（真实计算，纯 JS，无后端）
   · OLS + 多维固定效应（组内去均值 / 交替投影）
   · 聚类标准误（含 G/(G-1) 与 n-1/n-k 有限样本校正）
   · 方差膨胀因子、相关系数矩阵、分位数、缩尾
   · 七步实证：每步真实跑数并产出可核对的结果对象

   诚实声明：这是为教学与快速验证写的实现，方法学上覆盖
   教科书级 OLS/FE/聚类。它不做 IV/2SLS 的完整诊断，也不替代 Stata。
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};

  /* ---------------- 矩阵基础 ---------------- */
  /** 列主序视为行数组；求解正态方程 (X'X)^-1 X'y，带主元消去与奇异性提示 */
  function inverse(A) {
    var n = A.length;
    var M = A.map(function (row, i) {
      return row.slice().concat(A.map(function (_, j) { return i === j ? 1 : 0; }));
    });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;   /* 奇异 */
      var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      var d = M[c][c];
      for (var k = 0; k < 2 * n; k++) M[c][k] /= d;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c) continue;
        var f = M[r2][c];
        if (f === 0) continue;
        for (var k2 = 0; k2 < 2 * n; k2++) M[r2][k2] -= f * M[c][k2];
      }
    }
    return M.map(function (row) { return row.slice(n); });
  }

  function xtx(X) {
    var k = X[0].length, n = X.length;
    var A = [];
    for (var a = 0; a < k; a++) { A.push(new Array(k).fill(0)); }
    for (var i = 0; i < n; i++) {
      var xi = X[i];
      for (var a2 = 0; a2 < k; a2++) {
        var v = xi[a2];
        if (v === 0) continue;
        for (var b = a2; b < k; b++) A[a2][b] += v * xi[b];
      }
    }
    for (var a3 = 0; a3 < k; a3++) for (var b2 = 0; b2 < a3; b2++) A[a3][b2] = A[b2][a3];
    return A;
  }

  function xty(X, y) {
    var k = X[0].length, out = new Array(k).fill(0);
    for (var i = 0; i < X.length; i++) {
      var xi = X[i], yi = y[i];
      for (var a = 0; a < k; a++) out[a] += xi[a] * yi;
    }
    return out;
  }

  function matVec(A, v) {
    var out = new Array(A.length).fill(0);
    for (var i = 0; i < A.length; i++) {
      var s = 0;
      for (var j = 0; j < v.length; j++) s += A[i][j] * v[j];
      out[i] = s;
    }
    return out;
  }

  /* ---------------- 学生 t 分布（用于 p 值与临界值） ---------------- */
  function logGamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    var ser = 1.000000000190015;
    for (var j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function betacf(a, b, x) {
    var MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  /** 正则化不完全贝塔函数 I_x(a,b) */
  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
                      a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  /** 双尾 p 值 */
  function tPValue(t, df) {
    if (!isFinite(t) || df <= 0) return NaN;
    return betai(df / 2, 0.5, df / (df + t * t));
  }

  function stars(p) {
    if (!isFinite(p)) return '';
    if (p < 0.01) return '***';
    if (p < 0.05) return '**';
    if (p < 0.1) return '*';
    return '';
  }

  /* ---------------- 描述统计 ---------------- */
  function mean(a) {
    var s = 0, n = 0;
    for (var i = 0; i < a.length; i++) if (isFinite(a[i])) { s += a[i]; n++; }
    return n ? s / n : NaN;
  }

  function variance(a, ddof) {
    var m = mean(a), n = 0, s = 0;
    for (var i = 0; i < a.length; i++) if (isFinite(a[i])) { var d = a[i] - m; s += d * d; n++; }
    return n > (ddof || 0) ? s / (n - (ddof || 0)) : NaN;
  }

  function sd(a) { return Math.sqrt(variance(a, 1)); }

  function quantile(a, q) {
    var v = a.filter(isFinite).slice().sort(function (x, y) { return x - y; });
    if (!v.length) return NaN;
    if (v.length === 1) return v[0];
    var pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return v[lo];
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  }

  function median(a) { return quantile(a, 0.5); }

  /** 缩尾：按分位点截断，返回新数组（不改原数据） */
  function winsorize(a, lo, hi) {
    lo = lo == null ? 0.01 : lo;
    hi = hi == null ? 0.99 : hi;
    var l = quantile(a, lo), h = quantile(a, hi);
    return a.map(function (x) { return !isFinite(x) ? x : Math.max(l, Math.min(h, x)); });
  }

  function correlation(x, y) {
    var pairs = [];
    for (var i = 0; i < x.length; i++) if (isFinite(x[i]) && isFinite(y[i])) pairs.push([x[i], y[i]]);
    if (pairs.length < 3) return NaN;
    var xs = pairs.map(function (p) { return p[0]; }), ys = pairs.map(function (p) { return p[1]; });
    var mx = mean(xs), my = mean(ys), sxy = 0, sxx = 0, syy = 0;
    for (var j = 0; j < pairs.length; j++) {
      var dx = xs[j] - mx, dy = ys[j] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : NaN;
  }

  /* ---------------- 固定效应：组内去均值 ---------------- */
  /**
   * 对 X 的每一列与 y 做多维固定效应去均值。
   * 两个及以上维度时用交替投影（MAP）迭代到收敛，并在返回里如实报告
   * 迭代次数、最大变化量、是否收敛 —— 不收敛必须能被看见。
   */
  function demean(X, y, groups, opts) {
    opts = opts || {};
    var tol = opts.tol == null ? 1e-10 : opts.tol;
    var maxIter = opts.maxIter == null ? 200 : opts.maxIter;
    var n = X.length, k = X[0].length;

    /* 归一化组标签（拼字符串，纯数字也要能当键） */
    var dims = groups.map(function (g) {
      return g.map(function (v) { return String(v); });
    });

    /* 结果容器 */
    var Xd = X.map(function (r) { return r.slice(); });
    var yd = y.slice();

    function sweep(vec, labels) {
      var sum = Object.create(null), cnt = Object.create(null);
      for (var i = 0; i < vec.length; i++) {
        var key = labels[i];
        sum[key] = (sum[key] || 0) + vec[i];
        cnt[key] = (cnt[key] || 0) + 1;
      }
      for (var j = 0; j < vec.length; j++) vec[j] -= sum[labels[j]] / cnt[labels[j]];
    }

    if (dims.length === 1) {
      /* 单一维度：一次去均值就是精确解 */
      sweep(yd, dims[0]);
      for (var c = 0; c < k; c++) {
        var col = Xd.map(function (r, i) { return r[c]; });
        sweep(col, dims[0]);
        for (var i2 = 0; i2 < n; i2++) Xd[i2][c] = col[i2];
      }
      return { X: Xd, y: yd, iterations: 1, maxChange: 0, converged: true };
    }

    /* 多维：交替投影 */
    var iter = 0, maxChange = Infinity, converged = false;
    while (iter < maxIter && !converged) {
      iter++;
      maxChange = 0;
      for (var d = 0; d < dims.length; d++) {
        var before = yd.slice();
        sweep(yd, dims[d]);
        for (var t = 0; t < n; t++) maxChange = Math.max(maxChange, Math.abs(yd[t] - before[t]));
        for (var c2 = 0; c2 < k; c2++) {
          var col2 = Xd.map(function (r) { return r[c2]; });
          var b2 = col2.slice();
          sweep(col2, dims[d]);
          for (var i3 = 0; i3 < n; i3++) {
            Xd[i3][c2] = col2[i3];
            maxChange = Math.max(maxChange, Math.abs(col2[i3] - b2[i3]));
          }
        }
      }
      if (maxChange < tol) converged = true;
    }
    return { X: Xd, y: yd, iterations: iter, maxChange: maxChange, converged: converged };
  }

  /* ---------------- OLS（可选固定效应 + 聚类） ---------------- */
  /**
   * fitOLS({ y, X, xNames, fe: [labelsA, labelsB], cluster: labels, weights })
   * 返回系数、标准误、t、p、R²、组内 R²、F、观测数、参数数、聚类数。
   */
  function fitOLS(spec) {
    var y0 = spec.y, X0 = spec.X, xNames = spec.xNames || X0[0].map(function (_, i) { return 'x' + i; });
    var nAll = y0.length;

    /* 1) 先按缺失值剔除（行级完整） */
    var keep = [];
    for (var i = 0; i < nAll; i++) {
      if (!isFinite(y0[i])) continue;
      var ok = true;
      for (var j = 0; j < X0[i].length; j++) if (!isFinite(X0[i][j])) { ok = false; break; }
      if (ok) keep.push(i);
    }
    var droppedMissing = nAll - keep.length;
    if (keep.length < xNames.length + 2) {
      return { ok: false, code: 'TOO_FEW_OBS', message: '有效观测不足以估计（剩余 ' + keep.length + '）', nObs: keep.length, droppedMissing: droppedMissing };
    }

    var y = keep.map(function (i) { return y0[i]; });
    var X = keep.map(function (i) { return X0[i].slice(); });
    var cluster = spec.cluster ? keep.map(function (i) { return String(spec.cluster[i]); }) : null;
    var feDims = (spec.fe || []).filter(Boolean).map(function (g) {
      return keep.map(function (i) { return g[i]; });
    });

    /* 2) 固定效应去均值
       注意：常数项与固定效应完全共线。标准做法是先把常数项列从待估参数中剔除，
       报告时置 0 并标记 absorbed，否则会撞上"设计矩阵奇异"的假失败。 */
    var demeanInfo = null;
    var absorbedConst = false;
    var isConst = X.map(function () { return true; });
    for (var ci = 0; ci < X.length; ci++) {
      for (var cj = 0; cj < X[ci].length; cj++) {
        if (Math.abs(X[ci][cj] - 1) > 1e-12) isConst[cj] = false;
      }
    }
    var estIdx = [];
    for (var ck = 0; ck < X[0].length; ck++) {
      if (feDims.length && isConst[ck]) { absorbedConst = true; continue; }
      estIdx.push(ck);
    }

    if (feDims.length) {
      /* 只对真正要估计的列做去均值，常数项天然被吸收 */
      var Xsub = X.map(function (r) { return estIdx.map(function (j) { return r[j]; }); });
      var dm = demean(Xsub, y, feDims, spec.demeanOpts);
      X = dm.X; y = dm.y;
      demeanInfo = { dims: feDims.length, iterations: dm.iterations, maxChange: dm.maxChange, converged: dm.converged };
    }

    /* 3) OLS */
    var XtX = xtx(X);
    var XtXi = inverse(XtX);
    if (!XtXi) {
      return { ok: false, code: 'SINGULAR', message: '设计矩阵奇异：可能存在完全共线（例如某个虚拟变量与固定效应重复，或某变量在样本内无变异）', nObs: keep.length, droppedMissing: droppedMissing };
    }
    var Xty = xty(X, y);
    var beta = matVec(XtXi, Xty);

    /* 4) 残差与拟合优度 */
    var resid = new Array(keep.length);
    var yhat = new Array(keep.length);
    var ssr = 0;
    for (var r = 0; r < keep.length; r++) {
      var fit = 0;
      for (var c = 0; c < beta.length; c++) fit += X[r][c] * beta[c];
      yhat[r] = fit;
      resid[r] = y[r] - fit;
      ssr += resid[r] * resid[r];
    }
    var my = mean(y), sst = 0;
    for (var r2 = 0; r2 < y.length; r2++) { var d = y[r2] - my; sst += d * d; }
    var n = keep.length, k = beta.length;
    var dfResid = n - k;
    if (dfResid <= 0) {
      return { ok: false, code: 'NO_DF', message: '自由度不足：参数个数（' + k + '）不小于观测数（' + n + '）', nObs: n, droppedMissing: droppedMissing };
    }
    var sigma2 = ssr / dfResid;

    /* 两个 R² 必须分开报告，否则读数会误导：
       - r2Within：基于去均值后的 y（Stata 的 "R-squared within"，FE 模型的主报数）
       - r2Overall：基于原始 y 的总平方和（含固定效应的解释力，近似 Stata 的 "R-squared overall"）
       去均值后 y 的均值恒为 0，因此 sst 就是"组内总平方和"。 */
    var r2Within = sst > 0 ? 1 - ssr / sst : NaN;

    var sstOverall = 0;
    if (feDims.length) {
      var myRaw = mean(keep.map(function (i) { return y0[i]; }));
      for (var ro = 0; ro < keep.length; ro++) {
        var dro = y0[keep[ro]] - myRaw;
        sstOverall += dro * dro;
      }
    } else {
      sstOverall = sst;
    }
    var r2Overall = sstOverall > 0 ? 1 - ssr / sstOverall : NaN;

    /* FE 模型的主报数是组内 R²（Stata 的 R-squared within）；无 FE 时两者相等。
       三个数都返回，UI 按模型类型选主报数，避免把组内 R² 当总体 R² 读。 */
    var r2Primary = feDims.length ? r2Within : r2Overall;

    /* 5) 标准误：聚类 or 普通 */
    var se = new Array(k), tstat = new Array(k), pval = new Array(k);
    var vcov = null, nClusters = null, clusterNote = '';

    if (cluster) {
      var buckets = Object.create(null);
      for (var i2 = 0; i2 < n; i2++) {
        var key = cluster[i2];
        (buckets[key] = buckets[key] || []).push(i2);
      }
      var G = Object.keys(buckets).length;
      nClusters = G;
      if (G < 2) {
        return { ok: false, code: 'TOO_FEW_CLUSTERS', message: '聚类数不足（G=' + G + '）：无法计算聚类稳健标准误，请换聚类层级', nObs: n, droppedMissing: droppedMissing, nClusters: G };
      }
      /* meat = Σ_g (X_g' u_g)(X_g' u_g)' */
      var meat = [];
      for (var a = 0; a < k; a++) meat.push(new Array(k).fill(0));
      Object.keys(buckets).forEach(function (gKey) {
        var idx = buckets[gKey];
        var s = new Array(k).fill(0);
        for (var m = 0; m < idx.length; m++) {
          var ii = idx[m], u = resid[ii];
          for (var a2 = 0; a2 < k; a2++) s[a2] += X[ii][a2] * u;
        }
        for (var a3 = 0; a3 < k; a3++) for (var b = 0; b < k; b++) meat[a3][b] += s[a3] * s[b];
      });
      /* 有限样本校正：G/(G-1) × (n-1)/(n-k) */
      var c1 = G / (G - 1);
      var c2 = (n - 1) / (n - k);
      var scale = c1 * c2;
      for (var a4 = 0; a4 < k; a4++) for (var b2 = 0; b2 < k; b2++) meat[a4][b2] *= scale;
      vcov = matMul(matMul(XtXi, meat), XtXi);
      clusterNote = '聚类数 G=' + G + '，修正因子 G/(G-1) × (n-1)/(n-k) = ' + c1.toFixed(4) + ' × ' + c2.toFixed(4);
    } else {
      vcov = XtXi.map(function (row) { return row.map(function (v) { return v * sigma2; }); });
    }

    for (var c2 = 0; c2 < k; c2++) {
      se[c2] = Math.sqrt(Math.max(vcov[c2][c2], 0));
      tstat[c2] = se[c2] > 0 ? beta[c2] / se[c2] : NaN;
      pval[c2] = tPValue(tstat[c2], dfResid);
    }

    /* 6) F 检验（所有斜率联合为零），聚类时用 Wald */
    var fStat = NaN, fP = NaN;
    if (k > 1) {
      var R = [], r = [];
      for (var c3 = 1; c3 < k; c3++) {
        var row = new Array(k).fill(0); row[c3] = 1; R.push(row); r.push(0);
      }
      fStat = waldStat(beta, vcov, R, r);
      fP = fStat == null ? NaN : (1 - chi2cdf(fStat, R.length));
    }

    return {
      ok: true,
      absorbedConst: absorbedConst,
      coefficients: xNames.map(function (name, i) {
        /* 被吸收的常数项：如实报告 coef=0 / se=NaN，而不是给一个假的显著系数 */
        if (absorbedConst && estIdx.indexOf(i) < 0) {
          return { name: name, coef: 0, se: NaN, t: NaN, p: NaN, stars: '', absorbed: true, ci95: [NaN, NaN] };
        }
        var pos = estIdx.indexOf(i);
        return {
          name: name, coef: beta[pos], se: se[pos], t: tstat[pos], p: pval[pos],
          stars: stars(pval[pos]), absorbed: false,
          ci95: [beta[pos] - 1.96 * se[pos], beta[pos] + 1.96 * se[pos]]
        };
      }),
      nObs: n, nParams: k, dfResid: dfResid, droppedMissing: droppedMissing,
      ssr: ssr, sst: sst, sstOverall: sstOverall, sigma: Math.sqrt(sigma2),
      r2: r2Primary, r2Primary: r2Primary, r2Within: r2Within, r2Overall: r2Overall,
      hasFe: feDims.length > 0,
      adjR2: 1 - (1 - r2Primary) * (n - 1) / dfResid,
      fStat: fStat, fP: fP,
      cluster: cluster ? { nClusters: nClusters, note: clusterNote } : null,
      fe: spec.feDims || (feDims.length ? feDims.length : 0),
      demean: demeanInfo,
      vcov: vcov
    };
  }

  function matMul(A, B) {
    var n = A.length, m = B[0].length, p = B.length;
    var C = [];
    for (var i = 0; i < n; i++) {
      C.push(new Array(m).fill(0));
      for (var k = 0; k < p; k++) {
        var a = A[i][k];
        if (a === 0) continue;
        for (var j = 0; j < m; j++) C[i][j] += a * B[k][j];
      }
    }
    return C;
  }

  /** Wald 统计量 (Rb-r)'(R V R')^-1 (Rb-r) */
  function waldStat(beta, V, R, r) {
    var q = R.length;
    var Rb = R.map(function (row, i) {
      var s = 0;
      for (var j = 0; j < row.length; j++) s += row[j] * beta[j];
      return s - r[i];
    });
    var RVRt = [];
    for (var i2 = 0; i2 < q; i2++) {
      RVRt.push(new Array(q).fill(0));
      for (var j2 = 0; j2 < q; j2++) {
        var s2 = 0;
        for (var a = 0; a < beta.length; a++) {
          if (R[i2][a] === 0) continue;
          for (var b = 0; b < beta.length; b++) {
            if (R[j2][b] === 0) continue;
            s2 += R[i2][a] * V[a][b] * R[j2][b];
          }
        }
        RVRt[i2][j2] = s2;
      }
    }
    var inv = inverse(RVRt);
    if (!inv) return null;
    var tmp = matVec(inv, Rb), stat = 0;
    for (var m = 0; m < q; m++) stat += Rb[m] * tmp[m];
    return stat;
  }

  /** 卡方分布上尾概率（Wilson–Hilferty 近似，足够用于 F 报告） */
  function chi2cdf(x, df) {
    if (x <= 0) return 0;
    var z = (Math.pow(x / df, 1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  function erf(x) {
    var s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    var t = 1 / (1 + p * x);
    var y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return s * y;
  }

  /**
   * 方差膨胀因子：VIF_j = 1/(1-R²_j)，R²_j 由 X_j 对其余 X 回归得到。
   * 注意：VIF 必须在**去均值后**计算。把常数项留在设计矩阵里会人为压低 R²_j，
   * 得出偏小的 VIF（经典误用）。各列先中心化，再跑辅助回归。
   */
  function vif(X, names) {
    var k = X[0].length, out = [];
    if (k < 2) return names.map(function (nm) { return { name: nm, vif: 1 }; });

    /* 逐列去均值（不动原数据） */
    var Xc = X.map(function (r) { return r.slice(); });
    for (var c = 0; c < k; c++) {
      var mu = 0, cnt = 0;
      for (var i = 0; i < Xc.length; i++) if (isFinite(Xc[i][c])) { mu += Xc[i][c]; cnt++; }
      mu = cnt ? mu / cnt : 0;
      for (var i2 = 0; i2 < Xc.length; i2++) Xc[i2][c] -= mu;
    }

    for (var j = 0; j < k; j++) {
      var yj = Xc.map(function (r) { return r[j]; });
      var Xo = Xc.map(function (r) {
        return r.filter(function (_, i) { return i !== j; });
      });
      var f = fitOLS({ y: yj, X: Xo, xNames: names.filter(function (_, i) { return i !== j; }) });
      var r2j = (f.ok && isFinite(f.r2)) ? f.r2 : 0;
      out.push({ name: names[j], vif: r2j >= 1 ? Infinity : 1 / (1 - r2j) });
    }
    return out;
  }

  /* ---------------- CSV 解析（含引号与 BOM） ---------------- */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else if (ch === '\r') {
        /* 忽略，等 \n */
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length && !(r.length === 1 && r[0] === ''); });
  }

  /** 推断列类型：id / int / float / text */
  function inferType(values) {
    var n = 0, num = 0, allInt = true, uniq = Object.create(null), ucount = 0;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v === '' || v == null) continue;
      n++;
      if (uniq[v] === undefined) { uniq[v] = 1; ucount++; }
      var f = Number(v);
      if (isFinite(f) && String(v).trim() !== '') {
        num++;
        if (!Number.isInteger(f)) allInt = false;
      }
    }
    if (!n) return 'text';
    if (num / n > 0.95) {
      if (ucount <= Math.max(20, n * 0.05)) return 'id';
      return allInt ? 'int' : 'float';
    }
    return 'text';
  }

  /** 把 CSV 文本转成 { names, types, columns, rows } */
  function csvToTable(text, opts) {
    opts = opts || {};
    var maxRows = opts.maxRows || 200000;
    var raw = parseCSV(text);
    if (raw.length < 2) return { ok: false, code: 'EMPTY', message: '文件没有数据行（只有表头或为空）' };
    var names = raw[0].map(function (h, i) { return (h || '').trim() || ('col' + (i + 1)); });
    var body = raw.slice(1, maxRows + 1);
    var truncated = raw.length - 1 > maxRows;

    /* 转置一次便于按列推断类型 */
    var byCol = names.map(function () { return []; });
    for (var r = 0; r < body.length; r++) {
      for (var c = 0; c < names.length; c++) byCol[c].push(body[r][c] === undefined ? '' : body[r][c]);
    }
    var types = byCol.map(inferType);

    /* 数值列转 number，空串转 NaN（保留"缺失"语义） */
    var numeric = types.map(function (t) { return t === 'int' || t === 'float' || t === 'id'; });
    var cols = names.map(function (nm, c) {
      return {
        name: nm, type: types[c],
        values: byCol[c].map(function (v) {
          if (!numeric[c]) return v;
          var f = Number(v);
          return (v === '' || v == null || !isFinite(f)) ? NaN : f;
        }),
        missing: byCol[c].filter(function (v) { return v === '' || v == null; }).length / Math.max(body.length, 1)
      };
    });

    return { ok: true, names: names, cols: cols, nRows: body.length, truncated: truncated, rawRows: raw.length - 1 };
  }

  /* ---------------- 面板结构识别 ---------------- */
  /**
   * 识别个体与时间维度。
   * 优先级：时间 = 像年份的列；个体 = 文本型标识列（取值最多者）> 整数型高基数列。
   * 关键约束：个体不能是"数值且像年份"的列 —— 否则 firm_id 这种纯数字编码
   * 会被误当成时间，而把被解释变量误当成个体（这会让整个面板设定失效）。
   */
  function detectPanel(cols) {
    var yearCols = cols.filter(function (c) { return c.type !== 'text' && isYearLike(c); });
    if (!yearCols.length) return { ok: false, message: '未识别到时间维度：没有取值落在 1900–2200 的整数列' };
    var time = yearCols.slice().sort(function (a, b) { return countUniq(a) - countUniq(b); })[0];

    /* 个体候选必须排除"像年份"的列：某些被解释变量（如 addit 指标、指数）取值
       恰好落在 1900–2200，若只按类型判断会被误当成个体，整个面板设定随之失效。 */
    var others = cols.filter(function (c) {
      if (c === time) return false;
      if (c.type === 'float') return false;
      if (isYearLike(c)) return false;
      return true;
    });
    /* 文本型标识优先（明确的 id 语义），其次整数型高基数 */
    var textIds = others.filter(function (c) { return c.type === 'text'; })
                        .sort(function (a, b) { return countUniq(b) - countUniq(a); });
    var numIds = others.filter(function (c) { return c.type === 'id' || c.type === 'int'; })
                       .sort(function (a, b) { return countUniq(b) - countUniq(a); });
    var unit = textIds[0] || numIds[0];
    if (!unit) return { ok: false, message: '未识别到个体维度：除了时间列，没有可作个体的标识列' };

    var nU = countUniq(unit), nT = countUniq(time), n = unit.values.length;
    var expected = nU * nT;
    return {
      ok: true, unitId: unit.name, timeId: time.name,
      nUnits: nU, nPeriods: nT, balanced: n === expected,
      coverage: expected ? n / expected : NaN,
      unitType: unit.type,
      message: '个体 ' + unit.name + '（' + nU + '）× 时间 ' + time.name + '（' + nT + '）' +
               (n === expected ? '，平衡面板' : '，不平衡面板，覆盖率 ' + (n / expected * 100).toFixed(1) + '%')
    };
  }

  function countUniq(c) {
    var s = Object.create(null), n = 0;
    for (var i = 0; i < c.values.length; i++) {
      var v = c.values[i];
      if (v === '' || v == null || (typeof v === 'number' && !isFinite(v))) continue;
      if (s[v] === undefined) { s[v] = 1; n++; }
    }
    return n;
  }

  function isYearLike(c) {
    var mn = Infinity, mx = -Infinity;
    for (var i = 0; i < c.values.length; i++) {
      var v = c.values[i];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
    return mn >= 1900 && mx <= 2200;
  }

  ZY.econ = {
    /* 基础 */
    mean: mean, sd: sd, variance: variance, median: median, quantile: quantile,
    winsorize: winsorize, correlation: correlation,
    /* 分布 */
    tPValue: tPValue, stars: stars, chi2cdf: chi2cdf,
    /* 线代 */
    inverse: inverse, xtx: xtx, matMul: matMul, waldStat: waldStat,
    /* 计量 */
    demean: demean, fitOLS: fitOLS, vif: vif,
    /* 数据 */
    parseCSV: parseCSV, csvToTable: csvToTable, detectPanel: detectPanel,
    inferType: inferType, countUniq: countUniq
  };
})(window);
