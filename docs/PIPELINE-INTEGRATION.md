# 七步实证流水线接线说明 · `scripts/pipeline.js`

> 版本 `pipeline.js@1.0.0` ｜ 依赖 `scripts/econ.js`（必须先加载）｜ 零构建、ES5、classic script
> 本文件面向接线方（`app.js` / `render.js` / `stages/*` 的改造者），说明 **ctx 结构、每步规格、返回字段、provenance、近似与未实现项**。

---

## 0. TL;DR：三行接线

```html
<script src="scripts/econ.js"></script>
<script src="scripts/pipeline.js"></script>
```

```js
/* 1) 跑完七步（onProgress 可用于驱动进度条） */
var run = ZY.pipeline.runAll({ n: 6000, seed: 20240113 }, function (p) {
  console.log(p.index + '/' + p.total, p.stepId, p.status);   // p.result 是该步完整结果
});

/* 2) 每一步的结果可直接替换 D.STEPS[stepId] 的展示字段 */
var st = run.steps.baseline;
st.summary          // 解释文本（= interpretation.text）
st.metrics          // [{ k, v, cellId, value }]，v 已是格式化字符串
st.table            // { head, rows, numericRows, numCols, note }，rows 为字符串化表格（可直接渲染）
st.tables           // 全部表（含 cells 元数据），用于多表展示
st.provenance       // 复现信息（样本量/变量/FE/聚类/种子/数据与代码 hash）

/* 3) 失败时如实展示，绝不兜底造数 */
if (st.status === 'failed') { /* st.error.code / st.error.message / st.diagnostics */ }
```

---

## 1. 对外 API 签名

```js
window.ZY.pipeline = {
  VERSION: 'pipeline.js@1.0.0',
  STEP_ORDER: ['data-prep','descriptive','baseline','robustness','endogeneity','heterogeneity','mechanism'],
  BASE_X: ['digi','size','lev','roa','age','subsidy'],
  REQUIRED_VARS: ['firm_id','year','ln_innov','digi','size','lev','roa','age'],
  IV_F_THRESHOLD: 10,
  SYNTHETIC_DGP: { ... },          // 合成面板真值（仅供测试校准/文档引用，不进入结果表）

  makeSyntheticPanel(n, seed),      // -> rows[]（长度精确 = n）
  prepareSample(ctx),               // -> sample | { ok:false, code, message }
  buildSpec(stepId, ctx),           // -> { stepId, ok, specs:[...], primary, sample } | { ok:false, code, message }
  runStep(stepId, ctx),             // -> stepResult（见 §4）
  runAll(ctx, onProgress),          // -> { ok, status, order, steps:{id:stepResult}, failed:[...], provenance }

  util: {                           // 附加工具（非核心契约，Lead 可选用）
    hash32, fmtNum, fmtInt, fmtP, fmtVal, mulberry32, gauss, welch, twoSLS,
    cellAt, ensureDerived, specOf, specSummary,
    robustnessItems, heterogeneityItems, mechanismItems
  }
}
```

### `buildSpec(stepId, ctx)` 的返回

```js
{
  stepId, ok: true,
  specs: [ spec, ... ],     // 该步用到的全部回归规格
  primary: spec,            // = specs[0]
  sample                    // 清洗后的样本对象
}
// spec（普通回归）:
{
  id, title,
  y: [Number],              // 与 X 行对齐，已做行级筛选；缺失值为 NaN（交给 econ 剔除）
  X: [[Number]],            // 第一列恒为常数项 1（有 FE 时被 econ 吸收并如实标注）
  xNames: ['常数项', 'digi', ...],
  fe: [ [labels], [labels] ],   // 与 y 行对齐的固定效应标签（可为 []）
  cluster: [labels] | null,
  yVar, xVars, feVars, clusterVar, nRows, filterNote, derive
}
// endogeneity 还包含：
//   { id:'iv-fs', ... }                     第一阶段 OLS 规格
//   { id:'2sls', type:'2sls', y, endog, controls, instruments, fe, cluster }   2SLS 描述（非单一回归）
```

- `baseline`：`specs = [baseline]`
- `descriptive`：`specs = [vif-design]`（VIF 辅助设计矩阵，`fe: []`）
- `robustness`：8 个规格（基准对照 + 7 项检验）
- `endogeneity`：`[baseline, lag1, iv-fs, 2sls]`
- `heterogeneity`：6 个规格（规模组 ×2 + 交互 + 所有制组 ×2 + 交互）
- `mechanism`：每个渠道 3 个规格（a 路径 / b 路径 / 总效应）

---

## 2. `ctx` 结构（全部可选，有默认值）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `rows` / `panel` | `Object[]` | — | 外部面板行对象（列名需与 `REQUIRED_VARS` 一致）。给了就用它，不再合成 |
| `csvText` | `string` | — | 原始 CSV 文本，走 `econ.csvToTable` 真实解析（空串→NaN 保留缺失语义） |
| `n` | `number` | `6000` | 无外部数据时合成面板行数（≈ 500 企业 × 12 期） |
| `seed` | `number` | `20240113` | 随机种子。**同 seed 同输入 → 结果逐字节一致** |
| `datasetLabel` | `string` | 自动生成 | 数据集名称，写入 provenance |
| `winsor` | `{lo, hi}` | `{0.01, 0.99}` | 缩尾分位点（`econ.winsorize`） |
| `missing` | `'drop' \| 'impute-median'` | `'drop'` | 缺失处理：行级剔除 / 行业-年份中位数插补（组内 < 5 个有效值时退回全样本中位数） |
| `clusterVar` | `string` | `'firm_id'` | 覆盖基准回归的聚类层级（该列必须存在；`fe` 仍为 firm + year） |
| `channelVar` | `string` | `fc` → `subsidy` | 机制步骤的渠道变量；指定的列不存在时该渠道如实失败（`MISSING_VAR`） |
| `expectation` | `{sign, min, max}` | 无 | 若提供，则把基准 digi 系数与设计预期对比，只写进 `diagnostics.expectation`，**不修改任何结果数字** |
| `sample` | `sample` | — | 已由 `prepareSample` 生成的样本（`runStep` 内部复用，避免重复清洗） |

### `prepareSample(ctx)` 返回的关键字段

```js
{
  ok, code, message, kind: 'synthetic'|'rows'|'csv', datasetLabel, parse,
  seed, winsor:{lo,hi}, missingMode,
  rawRows, dropped:{duplicate, levOutOfRange, missing, total},  // rawRows = total + nObs（有断言）
  imputed:{ total, byVar, mode }, nObs,
  reconcile:{ ok, formula, raw, dropped, valid },
  rows: [ 分析样本行（已清洗 + 缩尾） ],
  vars: [列名...], missingBefore:[{name,n,rate}], missingAfter:[...],
  winsorInfo:[{name, lo, hi, changed}], winsorTotal,
  panel: econ.detectPanel 结果, panelDeclared:{ nUnits, nPeriods, balanced, coverage },
  missingRate, dataHash, warnings
}
```

**派生列**（`ensureDerived` 按需生成，全部确定性）：
`digi_lag1`（企业内滞后一期）、`digi_lead2`（提前 2 期）、`digi_perm`（企业内随机置换，seed+991）、
`z_iv`（同行业同年度其他企业 digi 均值，留一法）、`large`（企业均值 size 的中位数分组）、
`own`（所有制：`soe`/`own`/`state`/`soe_dummy`）、`digi_x_large`、`digi_x_own`。

---

## 3. 每步规格与产物

| 步 | 真跑的模型 | 主要表 | 关键 diagnostics | 失败条件 |
|---|---|---|---|---|
| ① data-prep | `econ.quantile` / `econ.winsorize` / `econ.inferType` / `econ.detectPanel` / `econ.countUniq` | `sample reconcile`、`missing`、`winsor`、`panel` | `reconcile`（原始 = 剔除 + 有效）、`panel`、`panelDeclared`、`winsor` | 对账不平 → `RECONCILE_FAILED`；缺必需列 → `MISSING_VAR` |
| ② descriptive | 均值/标准差/分位数/极值、`econ.correlation`、`econ.vif`、Welch t（内部组合） | `stats`、`corr`（下三角）、`corrSig`、`vif`、`group`、`welch` | `maxVif ≥ 10` 告警 | 无 |
| ③ baseline | `ln_innov ~ digi + size + lev + roa + age + subsidy`，`fe=[firm_id, year]`，`cluster=firm_id` | `coef`、`fit` | `r2Within/r2Overall/adjR2/fStat/fP/cluster/demean/absorbedConst` | 引擎 `SINGULAR/TOO_FEW_OBS/NO_DF/TOO_FEW_CLUSTERS` 原样透传 |
| ④ robustness | 8 项：基准对照、替换 y（`ln_innov_inv`）、替换 x（`digi_alt`）、换聚类（行业）、安慰剂 A（digi 提前 2 期）、安慰剂 B（企业内置换）、换样本窗（后 40% 期）、增删控制变量 | `matrix`（含"核心变量"列） | `items[]`（逐项 status/code/spec/cluster/nObs）、`placebo[]` | ≥1 个**必需项**失败 → 整步 `ROBUSTNESS_ITEM_FAILED`，逐项仍带 code |
| ⑤ endogeneity | OLS 基准、滞后一期（`digi_lag1`）、IV 第一阶段（`digi ~ z_iv + 控制`）、2SLS（去均值 + 两阶段，聚类稳健三明治） | `iv`（设定对比）、`firstStage`、`ivFirstStage` | `firstStageF`、`weakInstrument`、`twoSLSReliable`、`lag1`、`pValueDF` 说明 | 基准失败 → 整步失败；IV 失败只在表内如实标注 |
| ⑥ heterogeneity | 规模分组（企业均值 size 中位数）×2、交互项 `digi×large`、所有制分组 ×2、交互项 `digi×own` | `groups`、`chow`（独立样本近似） | `interactionP {size, own}`、`chow`、`sizeGroup/ownGroup`、`sizeMedian` | 必需项（规模组 + 交互）失败 → `HETEROGENEITY_ITEM_FAILED` |
| ⑦ mechanism | 每渠道：a 路径（M ~ digi + 控制）、b 路径（y ~ digi + M + 控制）、c 总效应；Sobel 检验 | `paths`、`decomp` | `channels`、`decomposition{a,b,indirect,z,p,proportion}` | 无可用渠道 / 必需路径失败 → `MECHANISM_CHANNEL_FAILED` |

默认渠道：`fc`（模拟的融资约束指数）→ `subsidy`（政府补贴）。可用 `ctx.channelVar` 覆盖。

---

## 4. `runStep` 返回结构

```js
{
  stepId,
  status: 'done' | 'failed',
  tables: [ { id, title, head, rows /*原始值*/, formattedRows /*字符串*/, numCols /*0 基*/, rowLabels, cells, note } ],
  cells: [ { id, cellId, tableId, row, col, label, term?, value, formatted, coef?, se?, t?, p? } ],
  primaryTableId, primaryTable: { head, rows, numericRows, numCols, note },
  table,                       // = primaryTable（兼容旧渲染的别名）
  metrics: [ { k, v /*字符串*/, value, cellId } ],
  interpretation: { text, refs: [ cell 对象 ] },
  summary,                      // = interpretation.text（兼容 D.STEPS[stepId].summary）
  warning,                      // 真问题摘要（null 表示无）
  diagnostics: { ..., notes: [], warnings: [] },
  provenance,                   // 见 §5
  error: { code, message }      // 仅 status==='failed' 时存在
}
```

### 数字到 cell 的映射（产品核心承诺）

- 每个数值单元格都有稳定 `cell_id = <stepId>.<tableId>.r<行>c<列>`（行列均 0 基）。
- `interpretation.refs` 覆盖**全部**数值单元格；`interpretation.text` 中一定包含每个 `formatted` 值，
  未被正文模板直接引用的会以"其余数值（按表给出 cell_id 坐标=值）"补齐。
- 因此正文中的任意数字都可点回表格的某一格（`cellAt(table, rowLabel, colHeader)` 可直接取用）。
- 系数单元格额外带 `term` / `coef` / `se` / `t` / `p`，与旧 `D.STEPS.baseline.cells` 的字段兼容。

### 表格约定

- `rows` 保留原始数值（number 仍是 number，`NaN` 显示为 `—`），`formattedRows` 是字符串化版本（可直接交给旧渲染）。
- `numCols` 是 **0 基列号**。注意：现有 `render.js` 的判断是 `numCols.indexOf(i - 1) >= 0`（比 0 基再减 1），
  接线时需要改成 `numCols.indexOf(i) >= 0`，或在适配层传 `numCols.map(c => c - 1)`。
- 被固定效应吸收的常数项不填 0，而是整行留空并标注"（被 FE 吸收）"，避免被读成"截距为 0"。

---

## 5. `provenance`（每步都有，可写进"三件套"的结果文件）

| 字段 | 说明 |
|---|---|
| `stepId` / `specVersion` | 步骤 id / 规格版本 |
| `codeVersion` / `codeHash` | `pipeline.js@1.0.0` + 关键函数源码 hash（8 位十六进制） |
| `engine` | `{ name:'econ.js', api:22, fingerprint:'xxxxxxxx', weakIVThreshold:10 }` |
| `dataset` / `dataSource` | 数据集标签 / 来源类型（`synthetic`/`rows`/`csv`） |
| `dataHash` | 分析样本（清洗 + 缩尾后）的 8 位 hash，同数据必同 hash |
| `seed` | 随机种子（合成面板、置换检验都由它决定） |
| `nObsRaw` / `nObs` / `dropped` / `imputed` / `winsor` / `missingMode` | 样本口径全链条 |
| `nUnits` / `nPeriods` / `balanced` | 面板结构 |
| `y` / `x` / `fe` / `cluster` / `variables` | 变量清单与角色 |
| `specHash` | 该步全部回归规格（含筛选条件）的 hash |

**不含时间戳**：这样"同 seed 同输入"两次运行的结果可以逐字节比对（见测试 `determinism_full`）。

---

## 6. 合成面板 DGP（`makeSyntheticPanel`）

列与 `data.js` 的 `DATASETS[0]` 一致：`firm_id, year, province_id, industry_id, ln_innov,
ln_innov_inv, ln_innov_util, digi, digi_alt, size, lev, roa, age, subsidy`，另加两列本 Demo 专用：
`soe`（所有制虚拟变量）、`fc`（模拟融资约束指数，机制步骤用）。
**真实数据接入时用 `ctx.rows` / `ctx.csvText` 替换，`fc` 用 `ctx.channelVar` 指定。**

真值（`ZY.pipeline.SYNTHETIC_DGP`，仅用于测试校准，**不进入任何结果表**）：

| 参数 | 值 | 含义 |
|---|---|---|
| `periods` / `startYear` | 12 / 2011 | 与 `DESIGN.sample.period`（2011–2022，12 期）一致 |
| `ar` / `arSd` | 0.60 / 0.075 | `digi` 的企业内 AR(1) |
| `indYearSd` | 0.009 | 行业-年份共同冲击（决定工具变量相关性） |
| `directBase` / `directLargeBonus` | -0.01 / 0.10 | digi 当期直接效应（中小 / 大型企业增量） |
| `lagDirect` | 0.05 | digi 滞后一期的直接效应 |
| `channelA` / `channelB` | -0.45 / -0.10 | fc 渠道 a 路径 / b 路径 |
| `sigmaEps` | 0.13 | 扰动标准差 |
| `totalEffectDigi` | **0.085** | 当期总效应 = 平均直接效应 (0.04) + 中介效应 a×b (0.045) |

故意保留的"数据坑"（供清洗/缩尾/去重真实发挥作用）：
缺失值（各列缺失率对齐 `DATASETS[0].columns[].missing`）、`lev > 1` 与 `lev < 0` 的行、
重复 `firm-year` 行、因缺失剔除后**不平衡**的面板。

`makeSyntheticPanel(n, seed)` **精确返回 n 行**：末尾少数行被替换成上述两类脏行（不是额外追加）。

> 已知性质（如实说明，不是 bug）：
> - **IV 强度对"每个行业-年份单元的企业数"高度敏感**：n=6000（约 50 家/单元）时第一阶段 F ≈ 5.7（弱工具）；
>   n=2400（约 17 家/单元）时 F ≈ 0.01（几乎无相关）。留一均值型工具的这个性质是真实的，
>   pipeline 只如实报告算出的 F，并在 `diagnostics.twoSLSReliable` 标注点估计是否可用。
> - **滞后一期设定的识别力受短面板限制**：T=12 + 企业固定效应会吸收掉大部分持续性变异，
>   即便 DGP 里有真实的滞后效应，系数也会被明显衰减（本例 0.089 vs 当期 0.093）。
> - **安慰剂 A（digi 提前 2 期）在有真实动态效应时会被"污染"**：前导项经序列相关与真实滞后项相关，
>   因此它不是一个干净的外生检验；本例 p ≈ 0.06 触发告警，pipeline 如实给出"存在动态设定风险"的解释，
>   而不是把它当成"安慰剂通过"。干净的外生检验是安慰剂 B（企业内置换，p ≈ 0.81）。

---

## 7. 失败语义与 `code` 对照

| `code` | 触发条件 | 来源 |
|---|---|---|
| `SINGULAR` | 设计矩阵奇异（完全共线、变量无组内变异） | econ.fitOLS |
| `TOO_FEW_OBS` | 有效观测 < 参数个数 + 2 | econ.fitOLS |
| `NO_DF` | 残差自由度 ≤ 0 | econ.fitOLS |
| `TOO_FEW_CLUSTERS` | 聚类数 < 2 | econ.fitOLS |
| `MISSING_VAR` | 缺必需列（含 `channelVar` / `clusterVar` 指定的列） | pipeline |
| `EMPTY_DATA` / `PARSE_FAILED` | 没有数据行 / CSV 解析失败 | pipeline |
| `RECONCILE_FAILED` | 样本量对账不平（原始 ≠ 剔除 + 有效） | pipeline |
| `ROBUSTNESS_ITEM_FAILED` | 稳健性必需项失败（整步失败，逐项仍带 code） | pipeline |
| `HETEROGENEITY_ITEM_FAILED` | 异质性必需分组失败 | pipeline |
| `MECHANISM_CHANNEL_FAILED` | 渠道缺失或必需路径失败 | pipeline |
| `STEP_THROW` / `PREPARE_THROW` | 内部异常（含异常信息，便于定位） | pipeline |

规则：**单模型步骤**算不出来就是 `status:'failed'`；**多模型步骤**（稳健性/异质性/机制）保留已完成部分，
仅当"必需项"失败时整步标 failed，且失败行不填任何占位数字（数值列为 NaN → 显示 `—`）。

---

## 8. 近似 / 未实现清单（诚实清单）

**近似（已在 diagnostics 里标注）**

1. `F` 与 Wald p 值用 `econ.chi2cdf`（Wilson–Hilferty 近似），不是精确 F 分布。
2. Sobel 检验的 p 值用 `1 - chi2cdf(z², 1)`（正态近似）；中介占比 `a×b/c` 仅在 c 与 a×b 同号时可解释。
3. 聚类稳健 p 值沿用 econ 约定 `df = N − k`（Stata 常用 `G − 1`，`G−1` 下 p 会更小）。
4. 组间差异第一路检验用全样本交互项的聚类稳健 t 检验；第二路"独立样本近似"用 `se=sqrt(se1²+se2²)`，
   两路可能不同（都在表里给出，不挑选）。
5. Welch t 检验（描述统计的分组对比）由 `econ.mean/variance/tPValue` 组合实现（econ 未提供两样本 t 检验）。
6. 缩尾是分位点截断（改值，不删观测）；缺失插补为"行业-年份中位数，组内 < 5 个有效值时退回全样本中位数"，
   **未做插补比例的敏感性检验**。
7. `econ.detectPanel` 为启发式识别；data-prep 的面板表以"声明口径 firm_id × year"为准，
   自动识别结果仅作为诊断（两者不一致时写入 warnings），避免误判影响 FE/聚类设定。

**未实现（不要声称已做）**

1. 事件研究 / 平行趋势（连续处理强度无明确时点 → 该项无法完成）。
2. DiD、RDD、PSM、Heckman、动态面板 GMM（Arellano–Bond）。
3. 过度识别检验（Sargan/Hansen）、弱工具下的 Anderson–Rubin 置信区间、LIML。
4. 中介效应的 Bootstrap / 结构方程；只做了 Sobel（乘积系数法）。
5. 多维（双向）聚类、Wild cluster bootstrap、自抽样推断。
6. 序列相关检验（Wooldridge）、异方差检验（BP/White）、面板单位根与协整。
7. 加权最小二乘 / 稳健回归 / 分位数回归 / 非线性模型（Logit、Tobit、Poisson）。
8. 2SLS 只支持**恰好识别**（单内生变量 + 单个排除性工具）；多工具时的联合 F 由 `econ.waldStat/q` 给出，
   但第二阶段未做多内生变量支持。

---

## 9. 性能与确定性

- `runAll` 实测（Node 24，Windows，默认 12 期面板）：n=2400 → 约 7.5 s；n=6000（默认）→ 约 15 s。
  浏览器内核相近量级；`onProgress` 每步回调一次，可用于进度条（`p.result` 已是该步完整结果）。
- 同 `seed` + 同输入 → `JSON.stringify(runAll(...))` 两次逐字节相同（测试 `determinism_full`）。
- `prepareSample` 的 `dataHash` 可作为"数据有没有变"的判据。

---

## 10. 测试与验证证据

```
node --check scripts/pipeline.js      # 通过
node test/pipeline.test.js            # 27/27 PASS（约 28 s）
```

测试的**独立对拍**（不复用被测代码的内部实现）：

| 检查 | 方法 | 实测偏差 |
|---|---|---|
| 基准系数 | 自带的两维交替投影去均值 + 高斯消元 OLS | max abs diff = 7.8e-16 |
| 聚类稳健标准误 | 自带的 `(X'X)⁻¹ meat (X'X)⁻¹ × G/(G-1) × (n-1)/(n-k)` | max rel diff = 1.5e-15 |
| 2SLS | 独立的 FWL 比率 + 独立的直接矩阵投影 `X̂=P_Z X` | 相对偏差 ≤ 1e-6（良态场景 1e-16） |
| 第一阶段 F | 与 `t²` 复算 | 1e-8 |
| Sobel z / p | 由表内 a、b 系数与标准误复算 + `econ.chi2cdf` | 1e-9 |
| t / p / CI / R² | `t = coef/se`、`p = econ.tPValue(t, N-k)`、`CI = ±1.96se` | 0（精确复算） |
| DGP 真值回收 | 3 个种子下 `|β̂ − 0.085| ≤ 5·se` | 通过 |
| 单元格覆盖 | 每个数值单元格都在 `interpretation.refs` 中，且文本含其 formatted 值 | 通过（514 cells @ n=2400） |

测试还覆盖：七步全 done、provenance 完整性、同 seed 逐字节一致、样本量对账、
四条失败路径（`SINGULAR` / `TOO_FEW_CLUSTERS` / `MISSING_VAR` / `ROBUSTNESS_ITEM_FAILED`）、
插补模式对账、以及"结果表数值必须等于用 `ZY.econ` 现场重算的值"的反造假检查。

---

## 11. 接线方注意（含 `econ.js` 使用提醒）

1. **加载顺序**：`econ.js` 必须在 `pipeline.js` 之前。`pipeline.js` 只在调用时读取 `ZY.econ`，
   但缺 `ZY.econ` 会直接抛"未加载"。
2. **`econ.vif(X, names)` 的 `X` 必须是"行 × 列"矩阵**（`X[0].length` 被当作列数）。
   误传"列数组的数组"不会报错，但会把列数当成 2289、跑出 2000+ 行结果（实测耗时 4 s）。
   建议在引擎侧加一句校验：`if (X[0].length !== names.length) throw`。
3. **`fitOLS` 的 `fStat` 是 Wald χ²（未除以自由度）**，聚类时为聚类稳健 Wald；UI 标签建议写"Wald χ²"而非"F 值"。
4. **`fitOLS` 的聚类 p 值用 `df = N − k`**（非 `G − 1`），与 Stata 有系统差异，已在 diagnostics 里说明。
5. **`econ.detectPanel` / `inferType` 依赖"缺失记为空值"**：若传入的列把 `NaN` 变成字符串 `"NaN"`，
   会被判成 text 型并可能误选为个体维度。`pipeline.js` 内部已把 NaN 归一为缺失再交给引擎。
6. **`makeSyntheticPanel` 末尾几行是故意注入的脏行**（重复行 / `lev` 越界行），data-prep 会如实剔除并报告。
7. 失败步骤的 `tables` 可能为空（单模型步骤）或保留部分结果（多模型步骤），渲染时应同时看 `status`。

---

## 12. 默认 `n=6000, seed=20240113` 的实测结果（供 UI 文案对照）

| 步 | 关键数字（真算） |
|---|---|
| ① data-prep | 原始 6,000 → 剔除重复 4 / lev 越界 2 / 关键缺失 313–348 → 有效 5,652；缩尾替换 1,244 个观测；面板 500×12，覆盖率 94.1%（不平衡） |
| ② descriptive | corr(digi, ln_innov) = 0.305；最大 VIF = 1.08；高/低数字化组 ln_innov 均值 1.265 / 0.751（Welch t ≈ 19.9） |
| ③ baseline | digi = **0.093**（se 0.027，t 3.50，p<0.001）；组内 R² 0.206；N 5,339；聚类数 499；去均值迭代 7 次收敛 |
| ④ robustness | 8/8 完成；替换 y 0.060（p=0.018）；替换 x（digi_alt）0.178；行业聚类 0.093（G=12，推断偏乐观告警）；安慰剂 A −0.051（p=0.062，触发"动态设定风险"告警）；安慰剂 B 0.006（p=0.812）；换窗口 0.100；增删控制 0.082 |
| ⑤ endogeneity | 第一阶段 F = **5.69 < 10 → 弱工具**；滞后一期 0.089（p<0.001）；2SLS 0.076（se 0.671，标注"弱工具下不可解读"） |
| ⑥ heterogeneity | 规模组间差异 p = 0.124（大型 0.132 / 中小 0.052）；所有制组间差异 p = 0.674（国有 0.105 / 非国有 0.087） |
| ⑦ mechanism | fc 渠道：a −0.468、b −0.104、间接效应 0.049、Sobel z 7.11（p<0.001）、中介占比 0.525；subsidy 渠道间接效应 −0.009（p=0.162，不显著） |

> 这些数字随 `n` / `seed` 变化，**且必须继续由 `ZY.econ` 现场计算**——不要把它们写进 UI 文案或生成器。
