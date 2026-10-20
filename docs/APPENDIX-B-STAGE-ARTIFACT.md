# 附录 B · 阶段 / 产物 / 进度模型

> 配套主文档：[`经管论文助手-纯前端Demo产品设计PRD.md`](经管论文助手-纯前端Demo产品设计PRD.md)
> 本附录是**可直接转 TypeScript 实现**的字段级规格：13 个阶段的完整定义、七步实证流水线、产物 schema、拒答码表、进度形态总表。
> 事件名与枚举值应与附录 A 的 `SESSION_EVENT_TYPES` / `STAGE_IDS` / `PIPELINE_STEP_IDS` 常量表**保持同一份来源**。
>
> **v2.0 变化**：阶段模型从 v1.0 的"语料→检索→起草"9 阶段，改为**"命题 → 文献 → 实验设计 → 门禁 → 七步实证 → 论文初稿"13 阶段**。原 §B/§C 的**经管学科知识底座**与**拒答码表**基本沿用——它们是领域知识，与流水线结构无关。

---

## 1. 阶段总表（13 个）

| # | 阶段 ID | 中文名 | 进入条件（硬） | 核心产物 | 退出判据（一句话） | 进度形态 | 档位 |
|---|---|---|---|---|---|---|---|
| **S0** | `corpus-intake` | 资源入库与体检 | 用户选文件夹或上传；配额预检通过；OCR 已显式表态（默认否） | `CorpusManifest` `DocParseDiagnostic[]` `CorpusHealthReport` `DatasetProfile[]` | 每篇文献有健康度标签（无"未知"）+ 每个数据集有剖析报告 | 分钟级 · **可中断可续** | MVP |
| **S1** | `question-scoping` | 命题解析 | 文献库 BM25 就绪（≥1 篇可用文献） | `ResearchQuestionCard` `TopicProbeReport` | RQ 五槽位无空缺（不确定须显式 `unknown`）；`claim_type` 已定；用户已确认 | 瞬时 + 秒级 | MVP |
| **S2** | `evidence-mapping` | 文献检索与匹配 | `rq.locked` 存在 | `RetrievalHitSet` `LiteratureMatrix` `PaperCard[]` `EvidenceGapList` | 三类探针完成；每章有显式证据状态（0 篇 → 显式 `none`）；用户已确认或手改 | 分钟级 · 可中断 | MVP |
| **S3** | `design-authoring` | 实验设计 | `claim_type` 已知；可读数据集结构；S2 命中集可用 | `ExperimentDesign`（七分区）`DataStructureCard` `PrecheckReport` `HypothesisSet`+`HypothesisLock` | 七分区齐备；`HypothesisLock` 已写；无未处置 `fail` | 秒级–分钟级 | MVP |
| **S4** | `design-gate` | **设计确认门 ★** | `ExperimentDesign` 完整 | `GateDecision` + `design.confirmed` 事件 | **`DataStructureCard` 必填齐 + 无未处置 fail + 用户显式确认**；未过则 `gate.blocked` | 瞬时 | MVP |
| **S5** | `data-prep` | ① 数据清洗 | `design.confirmed` 存在且 hash 一致 | 三件套 + 清洗日志 | 清洗日志记录删行数与理由；变量全部构造成功；无静默丢数据 | 秒级–分钟级 | MVP |
| **S6** | `descriptive` | ② 描述性统计 | ① 完成 | 三件套 + `DescriptiveTable` | 均值/标准差/最值/中位数/相关系数矩阵齐备 | 秒级 | MVP |
| **S7** | `baseline` | ③ 基准回归 | ① 完成；`HypothesisLock` 已写 | 三件套 + `ResultTable` + `NumberInventory` | 按设计跑完；系数/SE/t/p/N/组内R²/聚类数/FE 清单齐备且每数字有 `cell_id` | 秒级–分钟级 | MVP |
| **S8** | `robustness` | ④ 稳健性检验 | ③ 完成且已对账 | 三件套 + `RobustnessTable` + `SpecificationCurve` | **计划项状态齐全（含 `cannot_do` + 理由）**；不稳健已显式披露 | 分钟级长任务 · 可中断 | MVP |
| **S9** | `endogeneity` | ⑤ 内生性分析 | ③ 完成 | 三件套 + `EndogeneityTable` + 诊断 | 做了的报诊断（第一阶段 F / 弱识别检验）；**未做的必须写"未做及原因"** | 秒级–分钟级 | MVP |
| **S10** | `heterogeneity` | ⑥ 异质性分析 | ③ 完成 | 三件套 + `HeterogeneityTable` | 分组系数 + **组间差异检验**（不得只看分别显著） | 秒级–分钟级 | MVP |
| **S11** | `mechanism` | ⑦ 机制分析 | ③ 完成；`HypothesisSet` 含机制假说 | 三件套 + `MechanismTest` | 机制措辞按证据强度降级；事后新增机制标 `post_hoc=true` | 秒级–分钟级 | MVP |
| **S12** | `paper-drafting` | 论文撰写 | ③–⑧ 至少完成（未做已标 `skipped` + 理由） | `PaperDraft` 九章 + `StyleProfile` + `CitationCheckReport` | 九章齐备；每句有 chip 或『此处待补文献』；四门质量门通过 | 秒级/段 · **流式** | MVP |

**回退边与失效传播**：

```
paper-drafting ─► mechanism ─► … ─► baseline ─► design-gate ─► design-authoring ─► question-scoping
      ▲                                                                                  │
      └──────────────── 回退必须产出 InvalidationReport（哪些失效/保留/重算代价）──────────┘
```

| 从 → 到 | 触发 | 失效范围 |
|---|---|---|
| `design-authoring` 改动 | 用户改了假设/变量/模型 | **`design.confirmed` 自动失效** → S5–S12 产物标 `invalidated`；已写入正文的数字标"待更新" |
| `question-scoping` 改动 | 用户换了 `claim_type` | 措辞强度重算 → S3 检查清单重跑 → S12 相关段落措辞降级 |
| 数据集变更 | 用户换了数据文件 | `data_hash` 变化 → S5–S11 全部重跑 |

> ⚠️ **`design.confirmed` 的失效必须自动**：设计 hash 一变，门禁立即回到未确认状态，执行器拒绝读数据——**不能靠用户记得手动取消确认**。

---

## 2. 七步实证流水线（S5–S11 的展开）

七步共用同一套执行契约，差别只在**执行项清单**与**结果形态**。

### 2.1 共同契约

**每步必须产出三件套**（命名严格）：

```
<NN>-<step-id>/
├─ code__<step-id>.py            # 可执行代码（含 seed / data_hash / env_lock / cluster / sample_filter 头）
├─ result__<step-id>.md          # 结果（人读，Markdown 表格）
├─ result__<step-id>.csv         # 结果（机读，供后续步骤与对账）
└─ interpret__<step-id>.md       # 结果解读（含 boundCells 绑定）
```

**每步的执行契约**：

| 环节 | 动作 | 门 |
|---|---|---|
| 执行前 | `engine_plan()` 告知耗时/内存/是否快通道 → **用户确认** | 不确认不跑 |
| 执行 | Pyodide 在 Web Worker 内跑；stdout/stderr 实时可见 | 执行失败**必须展示失败**（不静默吞 traceback） |
| 结果登记 | `numbers_register()` 每个数字登记 `cell_id` | 无 `cell_id` 的数字**禁止进入正文** |
| 解读 | `interpret_build()` 规则先出结构化结论 → 可选 LLM 润色 | **数值一致性校验**：解读中每个数字必须绑定 `cell_id`，否则降级为规则版 |
| 质量门 | `quality_gate()` 四门校验（数值/措辞/引用/披露） | 任一门 fail → 打回（`maxRetries = 2`） |
| 落盘 | 三件套写 OPFS + `step.artifact` 事件 | 可单步下载，也可整包下载 |

### 2.2 各步的执行项清单

| 步 | 执行项 | 结果形态 | 常见"做不了" |
|---|---|---|---|
| ① `data-prep` | 读取 → 类型转换 → 缺失处理 → 异常值处理（缩尾/截尾）→ 变量构造 → 样本筛选 → 面板结构验证 | 清洗日志 + 变量描述表 | 列名不匹配、单位不一致、面板不唯一（个体×时间有重复） |
| ② `descriptive` | 描述统计表 → 相关系数矩阵 → 分组均值对比（处理组/对照组） | 三张表 | 变量全缺失 |
| ③ `baseline` | 主回归（按设计的 FE + 聚类）→ 报告 N / 组内R² / 聚类数 / FE 清单 | 主回归表 | 固定效应吸收核心变异（`R-ID-05`） |
| ④ `robustness` | 替换被解释变量度量 → 替换核心解释变量度量 → 更换样本窗 → 增删控制变量 → 安慰剂检验 → 更换聚类层级 → 更换 FE 组合 | 稳健性矩阵 + 设定曲线 | 期数不足做不了事件研究（`R-ID-09`） |
| ⑤ `endogeneity` | 工具变量 2SLS（含第一阶段 F）→ 滞后解释变量 → Heckman 两步（若设计有） | 内生性表 + 第一阶段诊断 | 弱工具（`R-ID-02`）→ 改报 AR 区间或退回 OLS + 降措辞 |
| ⑥ `heterogeneity` | 按设计的分组变量分组回归 → **组间系数差异检验**（交互项 / 似无相关） | 分组件 + 差异检验 | 某组样本过少 |
| ⑦ `mechanism` | 机制变量回归 → 区分机制/异质性/中介 → 措辞降级 | 机制表 + 措辞声明 | 中介内生（`R-ID-11`）→ 只能写"与…一致" |

### 2.3 流水线状态机

```ts
type StepStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'skipped';

// 允许的转移
pending → running            // 前置完成或用户手动开始
running → done               // 三件套落盘 + 质量门通过
running → failed             // 执行异常，或质量门打回超过 maxRetries
running → paused             // 用户暂停（当前执行项跑完后停）
paused  → running            // 继续
done    → running            // 重跑（step.rerun，旧结果保留可对比）
any     → skipped            // 用户跳过（必须带理由，且会写进论文初稿的"未做"声明）
```

**依赖图（并行机会）**：③ 完成 → ④⑤⑥⑦ **互不依赖**，可并行（Demo 先串行，接口预留）；⑦ 机制额外依赖 `HypothesisSet` 的机制假说存在。

---

## 3. 入口（Entry，非阶段）

| 入口 ID | 触发方式 | 复用内核 | 产物 | 挂载点 |
|---|---|---|---|---|
| `study-probe` | 任意界面划词 → 追问 / 找出处 / 存为笔记 | `Retriever` + chunk 级引用 | `ProbeAnswer`（含 `grounded` 标志） | 任意阶段 |
| `paper-card` | 单篇 PDF 右键"解读"；或 S2 批量 | `Generator.paperCard()` | `PaperCard` | S2 为主，任意阶段可读 |
| `why-trace` | 任意产物/结论旁"为什么" | `Ledger.query()` | `WhyAnswer` | 任意阶段 |
| `health-recheck` | 体检报告"重算"（阈值变更 / OCR 后） | `CorpusStore.health()` | `CorpusHealthReport@v2` | S0 |
| `note` | 划词 → 存为笔记 | 无（用户自述） | `Note`（`author=user`） | 任意，**导出时必须与文献证据分栏** |
| `random-audit` | 设置页「随机突袭自检」 | 全部投影 | 自检报告 | 任意阶段 |

> **设计红线**：入口**一律用抽屉/浮层，不得成为 Tab**，不得拥有独立会话、独立索引。产物挂当前阶段，事件进**同一本 Ledger**。

---

## 4. 逐阶段定义

> **本章覆盖 S0–S4 的完整定义**（资源入库 → 命题解析 → 文献检索 → 实验设计 → **设计确认门**）。
> **S5–S11（七步实证）的规格见 §2**——七步共用同一套执行契约，差别只在执行项清单与结果形态，因此不为每步重复写一遍定义。
> **S12（论文撰写）见 §4.14**（在本章末尾）。

### S0 `corpus-intake` 语料入库与体检

**一句话任务**：把一堆来路不明的 PDF，变成一份**你知道哪些能用、哪些不能用**的可检索语料，并让用户亲眼看到坏在哪里。

#### 进入条件

| 类型 | 条件 |
|---|---|
| 硬 | 用户已选本地文件夹（FS Access 不可用时退回 `<input webkitdirectory>`，须提示"本次会话结束后需重新选择"） |
| 硬 | `navigator.storage.estimate()` 配额 ≥ 预估占用的 **2 倍**（预估 = 文件字节数 × 1.5） |
| 硬 | OCR 表态：默认关闭；开启需**逐项勾选**并看到时长与配额代价 |
| 软 | 若用户已有上次的导出包，**优先走"导入恢复"而不是重跑解析** |

#### Agent 动作

| # | 动作 | 调用 | 输出 |
|---|---|---|---|
| 1 | 目录扫描 + 文件校验（magic bytes `%PDF-`、加密位、页数上限）+ 去重 | `CorpusStore.ingest()` | `CorpusManifest`（含 `excluded[]` 及理由） |
| 2 | 逐篇**按页流式**抽取（**禁止整文件读入 ArrayBuffer**），每页落诊断 | 同上 | `DocParseDiagnostic` |
| 3 | 归一化 + 结构化分块（~350–700 中文字，重叠 15%，不跨章节） | `CorpusStore` | chunk 元数据 + OPFS 分片 |
| 4 | 建索引：BM25（字符二元组）**先就绪** → 向量后台补建 | `Retriever` | `IndexStatus`（`bm25: ready` / `vector: x%`） |
| 5 | OCR 路由：仅对用户勾选的扫描件排队；**给出区间时长 + 明确"可随时中断"** | `Executor` | OCR 文本（`text_trust = medium`） |
| 6 | 汇总体检报告：逐篇红/黄/绿 + 全库统计（年份分布、来源类型、方法关键词分布） | `Artifacts.write()` | `CorpusHealthReport` |
| 7 | **停**：把体检报告作为继续与否的门 | — | 用户决策 |

#### 退出判据（可观测、可复现）

1. **无"未知"**：每篇 PDF 都有 `text_trust ∈ {high, medium, low}`，没有一栏空白；
2. **绿黄率门槛**：`high + medium` 占比 ≥ 80% 可通过；50%–80% 必须弹"降级提示"；**< 50% 触发 `R-PARSE-01`**，产品定位降级为"半自动标注工作台"，**不允许**继续承诺逐句回溯；
3. **可复现**：同一批文件重跑体检，`doc_id` 与诊断结论一致（哈希幂等），失败项只在缺失 chunk 上重算；
4. **用户已确认**：`Ledger` 中存在 `corpus.health.confirmed` 事件，带用户 id 与**当时的报告哈希**。

#### 人机交互点（结构化提问，不是开放式闲聊）

| 时刻 | 提问 |
|---|---|
| 入库前 | 「本批含 N 篇疑似扫描件（占比 x%）。OCR 会让入库从约 5 分钟变成约 40–90 分钟，且占用额外配额。**[只处理你勾选的 3 篇] / [全部处理] / [先跳过，之后再说]**」 |
| 体检后 | 「体检完成：绿灯 A 篇、黄灯 B 篇、红灯 C 篇（红灯主要是字体子集导致的乱码）。**[全部继续] / [剔除红灯 C 篇后继续] / [看看红灯的原文页再决定]**」 |
| 索引期间 | 「关键词检索已就绪，可以直接开始；语义检索还在建（约 x 分钟后可用）。**[现在就开始] / [等语义索引]**」 |

#### 拒答点

| 码 | 条件 | 话术要点 |
|---|---|---|
| `R-PARSE-01` | 绿黄率 < 50%，或全库乱码率中位数 > 15% | 拒答"以本库为依据的逐句回溯"这一**承诺**；建议换 PDF 版本 / 提高扫描件比例 / 改定位 |
| `R-CORPUS-02` | 用户跳过体检直接提问，而 top-20 RRF 分数全部低于阈值 | 「我无法在你这批文献上回答这个问题」+ 给出检索证据 + 三个可补选项 |
| `R-COMPUTE-01` | 配额或内存不足 | **不拒答，降级**：停向量保 BM25，状态条常驻显示"语义检索未就绪" |

#### 进度形态

分钟级（纯文本 3–8 分钟；含 OCR 30–90 分钟），**可中断可续**。进度事件必须带 `etaConfidence ∈ {high, medium, low}`；**ETA 禁止假精确**（估不准时给区间 + 置信度，不给秒表）。

#### 最容易被做错的地方

- 把"入库完成"当成"语料可用"（**体检报告是门，不是装饰**）；
- 体检只给全库平均分，掩盖单篇崩坏（必须逐篇可见，红标可点进原文页）；
- 扫描件"未 OCR"与"OCR 了但质量低"混为一谈，用户无法判断该不该信。

---

### S1 `question-scoping` 选题收敛

**一句话任务**：把一个模糊想法压成一张**带可行性判断**的研究问题卡，并且在动手前就告诉用户"你想说的话，你手上的语料和数据撑不撑得住"。

#### 进入条件

`CorpusHealthReport` 已确认；至少 1 篇 `text_trust ∈ {high, medium}` 的文献（否则先回 S0）。

#### Agent 动作

| # | 动作 | 调用 | 输出 |
|---|---|---|---|
| 1 | 结构化补槽：现象 / 对象与层级 / 时间窗 / 变异来源 / 期望贡献类型 | 模板问卷（**非自由闲聊**） | `ResearchQuestionCard` 草稿 |
| 2 | 三类探针检索：① 主题覆盖度 ② 方法覆盖度 ③ **分歧探测**（相反结论） | `Retriever.probe()` | `TopicProbeReport` |
| 3 | **`claim_type` 定强度**：描述性 / 相关性 / 因果性 / 机制性 / 政策评估 | 规则映射 | `ResearchQuestionCard.claim_type` |
| 4 | 生成 2–3 个候选题目，每个带"语料支撑度"与"识别可行性预判" | `Generator.assemble()` | `CandidateQuestions[]` |
| 5 | 生成 `OutlineTree@v0`（**只到章节骨架，不含主张**） | 模板 | `OutlineTree@v0` |
| 6 | **停**：候选题目三选一 | — | 用户决策 |

#### 退出判据

1. RQ 五槽位**无空缺**；无法确定的槽位显式写 `unknown` 并进入"待用户确认"列表（**不许 Agent 猜**）；
2. `claim_type` 与"语料支撑度 + 变异来源"的组合通过可行性预检（见 §5.4）。例如 `claim_type = causal` 而语料中零篇因果设计、且用户未声明数据变异来源 → 立刻产出**识别可行性预警**（不是拒答）；
3. 用户点选一个主问题，`Ledger` 记录 `rq.locked`（含 RQ 哈希）；
4. 至少有**一句"本文不做什么"**的边界句（防范围蔓延）。

#### 人机交互点

| 时刻 | 提问 |
|---|---|
| 开场 | 五槽位问卷，每格给常见选项 + **"我不确定"**（"我不确定"是**合法答案**，会转成 `unknown` 而不是逼用户瞎编） |
| 强度选择 | 「你最终想说的是哪一句？（单选）**[A 有 X 会显著影响 Y]（因果） / [A 与 Y 正相关]（相关） / [描述 A 与 Y 的共同趋势] / [A 通过 M 影响 Y]（机制）**」← **这句话是所有下游措辞的开关** |
| 三选一 | 「三个方向里选一个；我按你选的继续，也可以说'都不对，我要的是…'」 |

#### 拒答点

| 码 | 条件 | 话术要点 |
|---|---|---|
| `R-CORPUS-01` | 用户坚持"已有研究普遍认为…"，而语料内检索无支撑 | 拒答该前提；给出 top-k 与 RRF 分数作为证据；要求"把对应文献拖进来"或改写 |
| `R-SCOPE-01` | 「帮我把这个领域最新文献下载下来」 | 拒答越界请求 + 说明边界 + 给替代路径 |
| 预警（非拒答） | `claim_type = causal` 但无变异来源声明 | 明确告知"按现在的信息，我只能支持相关性表述"，并列出补什么才能升级为因果 |

#### 最容易被做错的地方

把选题做成开放式闲聊；候选题目不带语料支撑度（用户选完才发现没材料）；**不问 `claim_type`**，导致下游措辞强度失控——**这是"AI 写出因果结论"的最上游原因**。

---

### S2 `evidence-mapping` 证据地图与文献矩阵

**一句话任务**：把"章节"和"文献"接上，并且**让空章节显形**。综述不是把 300 篇排成队，而是按流派、按识别策略、按结论分歧组织。

#### 进入条件

`ResearchQuestionCard` 已确认（`rq.locked` 事件存在）；`CorpusManifest` 可用。

#### Agent 动作

| # | 动作 | 输出 |
|---|---|---|
| 1 | 章节↔文献候选打分：BM25 + 向量 + 参考文献显式提及 + 年份/来源启发式 → RRF | `SectionLiteratureMap`（**可手改**） |
| 2 | 按「理论流派 / 识别策略 / 结论方向」聚类，产出**分歧矩阵** | `LiteratureMatrix` |
| 3 | 逐篇生成 `PaperCard`，抽不到的字段留空并标 `未抽到` | `PaperCard[]` |
| 4 | 缺口分析：每章输出"0 篇 / 仅 1 篇 / 结论互相矛盾未解释" | `EvidenceGapList` |
| 5 | **停**：让用户确认映射，并必须让"哪一章是空的"**一眼可见** | 用户决策 |

#### 退出判据

1. `OutlineTree@v0` 的**每一章**都有 `evidence_status ∈ {ok, thin, none}`，`none` **不许静默**；
2. 分歧矩阵每一行至少绑定 **1 条可引用原句**（`chunk_id` + 页码 + 字符区间），否则该行标 `未定位原句`；
3. 用户已确认或手改过映射；**手改写 `DecisionRecord`（含改前改后）**；
4. `EvidenceGapList` 里的 0 篇章节已经被用户看到（事件 `gap.acknowledged`）。

#### 人机交互点

| 时刻 | 提问 |
|---|---|
| 映射确认 | 「第 2 章（文献综述）候选 27 篇；第 4 章（机制）只有 2 篇且都是同一数据源。**[接受映射] / [我来删几篇] / [看第 4 章凭什么只有 2 篇]**」 |
| 低置信字段 | 「这 6 篇的样本期我没能从 PDF 里可靠抽到（表格页丢失）。**[逐个手填] / [留空并标注未抽到] / [我去看原文页确认]**」 |
| 缺口处置 | 「第 4 章没有支撑文献。**[我补文献进来] / [这章改成'研究缺口'写法] / [这章只做方法借鉴，不做结论对照]**」 |

#### 拒答点（以**局部拒答**为主，不是整段罢工）

| 码 | 条件 | 话术要点 |
|---|---|---|
| `R-CORPUS-01`（局部） | 某章 `evidence_status = none` | 该章**只能**写"研究缺口"或"方法借鉴"句式，**禁止**出现"已有研究表明…"。技术实现：`ClaimSlot.evidence_status` 直接决定 S7 可用模板集 |
| `R-CORPUS-01` | 用户要求在综述里写某篇**不在库中**文献的具体结论 | 拒答 + 给"把它拖进来后我可以给你带出处的写法" |
| `R-PARSE-01`（局部） | 该篇为红灯（乱码/未 OCR） | 该篇可被"提及"，但其原句引用**必须带 `解析质量低·请人工核对` 徽标** |

#### 最容易被做错的地方

把综述做成"每篇一段的流水账"（映射表必须支持**按流派/策略分组**，而不是按文献列举）；`PaperCard` 抽不到就**猜**；映射表做成只读（**用户必须能手改，且手改要留痕**）。

---

### ⛔ v1.0 的 S3–S8 已移除（内容去向见下）

> v1.0 的这一段（~~`design-identification`~~ → ~~`analysis-execution`~~ → ~~`robustness-mechanism`~~ → ~~`outline-architecting`~~ → ~~`section-drafting`~~ → ~~`evidence-package`~~）描述的是**旧的"语料→检索→起草"主链**。v2.0 主链改为 **"命题 → 文献 → 实验设计 → 门禁 → 七步实证 → 论文初稿"**，对应关系：

| v1.0 旧阶段 | v2.0 去向 |
|---|---|
| `design-identification` 识别策略与研究设计 | → **S3 `design-authoring`**（上方）+ **S4 `design-gate`**（下方） |
| `analysis-execution` 脚本生成与执行 | → **S5–S11 七步实证流水线**（§2） |
| `robustness-mechanism` 稳健性与机制检验 | → 拆为 **S8 `robustness`** 与 **S11 `mechanism`** 两步 |
| `outline-architecting` 提纲与论证链 | → 并入 **S12 `paper-drafting`** 的九章结构与"论证链" |
| `section-drafting` 逐段起草与引用校验 | → **S12 `paper-drafting`**（逐段生成 + 四查校验） |
| `evidence-package` 证据包与答辩台账 | → **导出物**（§4 S12 末的"导出物"一节） |

> **领域知识已完整迁移、未丢失**：上述 6 节里真正有价值的是**识别策略检查清单、拒答码、措辞强度阶梯、可复现性规范**——它们已逐项保留在本附录 **§6 经管学科知识底座** 与 **§7 拒答机制**中。它们与流水线结构无关，因此不受本次改版影响。

### S4 `design-gate` 设计确认门 ★ 全流程唯一硬门禁

> **v1.0 的 S4–S8（脚本执行 / 稳健性 / 提纲 / 起草 / 证据包）已由下文的七步流水线与论文撰写取代**；七步的规格统一在 §2，本节的 S4 专讲**门禁**——它是"用户确认实验设计之后才开始跑数据"这条产品承诺的技术实现。

**一句话任务**：把"我打算这么研究"变成"我确认这么研究，可以开始了"——**在用户点确认之前，一行数据都不许读**。

#### 进入条件

| 类型 | 条件 |
|---|---|
| 硬 | S3 `design-authoring` 已产出完整的 `ExperimentDesign`（七分区） |
| 硬 | `DataStructureCard` 12 个必填字段全部有值 |
| 硬 | `PrecheckReport` 中**无未处置的 `fail`** |
| 硬 | `HypothesisLock` 已写（假设已冻结） |

#### Agent 动作

| # | 动作 | 产出 |
|---|---|---|
| 1 | 校验门禁四条件；不满足则 `gate.blocked` 并列出缺什么 | `GateDecision{status:'blocked', blockers[]}` |
| 2 | 汇总**警告项**（不阻断但必须让用户看到）：聚类层级建议、平行趋势只能画点、样本量偏小等 | `GateDecision{warnings[]}` |
| 3 | **`interrupt()` 停下等用户显式确认** | 用户决策 |
| 4 | 用户确认 → 写 `design.confirmed{design_hash, by, at, warnings[]}` → 解锁 S5 | 事件 |
| 5 | 用户改设计 → 重新校验；设计 hash 变化则**确认自动失效** | `design.invalidated` |

#### 退出判据

1. `design.confirmed` 事件已写入，且其 `design_hash` **等于当前设计的 hash**；
2. 所有警告项在确认界面**逐条可见**（知情同意）；
3. 任一阻断项未处置时，确认动作在**执行层**被拒绝（不是只置灰按钮）。

#### 人机交互点

| 时刻 | 提问 |
|---|---|
| 门禁校验后 | 「确认后我将开始跑数据。以下是我的理解，请核对：✅研究问题 ✅样本 ⚠️聚类层级 ⚠️平行趋势 ⛔1 项 fail 未处置 → **[确认并开始实证] / [返回修改] / [导出设计方案]**」 |
| 改设计后 | 「设计已变更（hash 变化），需要重新确认」 |

#### 拒答点

| 码 | 条件 | 行为 |
|---|---|---|
| `R-DATA-01`～`R-DATA-06` | `DataStructureCard` 字段缺失或不满足 | `gate.blocked` + 列出需要的字段（**不拒答整个课题**，是拒答"现在开始跑"） |
| `R-ID-*` | 检查清单有未处置 `fail` | 同上；并给替代路径（补数据 / 换策略 / 降措辞 / 先不做） |

#### 进度形态

**瞬时**（纯校验 + 等待用户）。这是全流程**唯一**不需要进度条的关键节点。

#### 最容易被做错的地方

- **把门禁做成 UI 层置灰**：必须由执行器校验 `design.confirmed` 与当前 `design_hash`；
- 让警告项被"折叠"或"默认同意"：**知情同意要求逐条可见**；
- 设计改了但确认没失效：会导致"跑的是旧设计、看的是新设计"。

---

### S5–S11 七步实证（① 数据清洗 → ⑦ 机制分析）

> **规格见 §2**。本节只强调三条跨步的硬要求：

| # | 要求 | 为什么 |
|---|---|---|
| 1 | **每步必须产出三件套**（代码 / 结果 / 解读），命名严格 | 这是产品承诺的过程性材料，也是学生交给导师的东西 |
| 2 | **解读的数值必须与结果文件逐格一致**（`boundCells` 绑定 `cell_id`） | 这是"结果解读不夸大"的机器保证 |
| 3 | **"做不了"必须写出来** | 信息量最大的一格往往是 `cannot_do`；静默跳过等于学术不诚实 |

**四类必须主动拦截的误读**（写成规则检查）：

| 误读 | 拦截规则 |
|---|---|
| 把不显著说成"无影响" | `R-ID-22` |
| 把边界显著说成"稳健" | `R-ID-10` |
| 把异质性当机制 | `R-ID-21` |
| 把相关说成因果 | `R-ID-12`（措辞强度门控：相关证据段落因果动词数必须为 0） |

---

### S12 `paper-drafting` 论文撰写

**一句话任务**：把结果与文献组装成一篇**结构完整、措辞审慎、每句有据**的九章初稿——**逐段生成，不是一次吐全文**。

#### 进入条件

≥1 个已对账 `ResultTable`（③ + 至少一项 ④–⑦）；未完成的步骤已标 `skipped` + 理由；`EvidenceGapList` 可用。

#### 九章结构（默认《中国工业经济》架构）

| # | 章节 | 内容来源 |
|---|---|---|
| 1 | 引言 | 命题 + 研究缺口 + 贡献声明 |
| 2 | 文献综述 | **按流派 / 识别策略 / 结论分歧组织**（来自 S2 分歧矩阵），不是按文献罗列 |
| 3 | 理论分析与研究假设 | S3 的假设（含机制论证）+ 文献支撑 |
| 4 | 研究设计 | 数据来源、样本、变量定义表、模型设定 |
| 5 | 实证结果 | ② 描述统计 + ③ 基准回归 + 结果解读 |
| 6 | 稳健性检验 | ④ 的稳健性矩阵 + 披露"做不了的项" |
| 7 | 内生性讨论 | ⑤ 的结果，或"未做及原因" |
| 8 | 异质性与机制分析 | ⑥⑦ 的结果 + 措辞降级 |
| 9 | 结论与政策含义 | 结论（措辞强度受限）+ 政策建议（限定在证据范围内） |

#### 风格参考

| 情形 | 行为 |
|---|---|
| 用户**指定**了参考文献（≤5 篇） | 从该文献提取**风格画像**（句长分布、连接词习惯、章节内段落数、图表引出方式、结论口吻），按其组织 |
| 用户**未指定** | **默认按《中国工业经济》期刊的文献语言风格与行文架构**组织 |

> **实现口径**：风格参考是**形式模仿**（结构/句式/语体/图表引出/结论口吻），**不是内容复制**。系统从参考文献提取 `StyleProfile`，**不搬运其句子**。UI 必须明示这条边界。

#### Agent 动作

| # | 动作 | 产出 |
|---|---|---|
| 1 | `style_extract()`：提取或加载风格画像 | `StyleProfile` + `style.extracted` 事件 |
| 2 | 对每个章节节点做**定向检索**（BM25 + 向量 → RRF → 可选 MMR）取素材槽 | 素材槽 |
| 3 | **逐段生成**（一次一段或一节）；模板里没有素材槽的句子不允许出现 | `ParagraphBlock` |
| 4 | 每句绑定 chip：文献句 → `chunk_id`；数字句 → `cell_id` | `CitationCheckReport` |
| 5 | **引用强制校验四查**；未通过 → 标红 + 降级为『此处待补文献』 | `UnverifiedClaimList` |
| 6 | 质量门四门校验（数值/措辞/引用/披露） | `QualityReport` |
| 7 | **逐段停**：用户确认后才能继续下一段 | 用户决策 |

#### 退出判据

1. **九章齐备**（未写的章节必须显式标 `deferred` + 理由）；
2. 每个事实性句子有 chip **或**显式『此处待补文献』（**两者必居其一，没有第三种状态**）；
3. `CitationCheckReport` 中 **0 个"标红未处理"**项；
4. 正文每个数字都能点到 `NumberInventory` 的一格；
5. **措辞强度未越界**：只有相关证据的段落中，因果动词数为 **0**（机器可数）；
6. 质量门四门全过。

#### 人机交互点

| 时刻 | 提问 |
|---|---|
| 风格设置 | 「**[默认：中国工业经济风格] / [指定参考文献]**（拖入 1–5 篇，我会提取它的行文风格与章节组织）」 |
| 逐段确认 | 「第 2.3 段写好了，用了 3 篇文献。**[接受] / [重写本段] / [降一档措辞] / [换素材]**」 |
| 无出处 | 「这一句我在你的文献库里找不到依据。**[换 3 个能被支持的近似说法] / [留占位『此处待补文献』] / [删掉]**」 |
| 导出前 | 「全文校验：3 处待补文献、2 段措辞已降级、④稳健性有 1 项未做。**[导出]**」 |

#### 拒答点

| 码 | 条件 | 话术要点 |
|---|---|---|
| `R-CORPUS-01` | 某论断语料中无依据 | **拒绝生成该句**，输出『此处待补文献』占位 + 3 个可被支持的近似说法 |
| `R-ID-12` | 声称因果但检查清单有未处置 `unknown` | 拒答因果措辞，只能写"相关" |
| `R-SCOPE-01` | 要求代写整篇 / 降重 / 编造参考文献 | 拒答 + 边界说明 + 给"如何自己补文献"的路径 |
| `R-CLAIM-01` | 要求"保证没有幻觉" | 拒绝该承诺并解释机制：可核查 ≠ 无幻觉；承诺是"引不到就标出来" |

#### 进度形态

**秒级/段 · 流式**。必须逐段流式输出，用户要看到句子怎么来的。

#### 导出物

```
paper__初稿.md / .docx          # 论文初稿
paper__写作说明.md              # 哪些段落用了模型润色、哪些是待补文献、哪些检验未做
citation__台账.csv              # 每句 → chunk_id / cell_id / 支持强度
01-data-prep/ … 07-mechanism/   # 七步三件套
data__hash.txt  env_lock.txt    # 可复现凭据
```

#### 最容易被做错的地方

- **一次性生成全文**（用户无法逐句核查 → 直接摧毁产品质量）；
- **形式引用**：chip 指向真实 chunk，但那个 chunk 并不支持这句话——所以四查必须含"支持强度"；
- **措辞强度失控**：相关性证据写成因果结论；
- 参考文献的**句子被搬运**（风格模仿变成了抄袭）。

---

## 5. 产物类型：字段级定义

### 5.1 通用约定

```ts
interface ArtifactBase {
  artifact_id: string;
  type: ArtifactType;
  schema_ver: string;          // 如 '1.0.0'
  rev: number;                 // 从 1 起，改动即 +1，不覆盖
  created_by: 'agent' | 'user';
  created_at: number;          // ms
  provenance: Provenance;
  content_hash: string;        // 内容哈希，用于幂等与对账
}

interface Provenance {
  evidence: string[];          // chunk_id[]，事实性字段必带
  cell_id?: string;            // 数字类
  rule_id?: string;            // 规则/检查项 id（如 'DID-PT-01'）
  parent_artifacts: string[];
  model_mode: 'template' | 'webllm' | 'byok' | 'rule' | 'user';
}
```

**"出处要求"列的取值含义**：

- `必带chunk` = 该字段若为事实性内容，**必须**绑定 ≥1 个 `chunk_id`；绑不到 → 该字段值只能是『无来源·待核实』或『未抽到』；
- `派生` = 由其他字段计算得出；
- `用户` = 用户输入。

### 5.2 S0 产物

| 产物 | 字段 | 类型 | 出处要求 |
|---|---|---|---|
| `CorpusManifest` | `doc_id` | str | 派生（`SHA-256(size + 首尾1MB + 文件名)`） |
| | `file_name` `bytes` `pages` `sha256_head_tail` | — | 派生 |
| | `parse_status` | enum(`pending\|parsing\|parsed\|failed\|ocr-needed`) | 派生 |
| | `included` | bool | 派生 |
| | `exclude_reason` | str? | 派生 |
| `DocParseDiagnostic` | `coverage` | float | 派生 |
| | `mojibake_rate` | float | 派生 |
| | `is_scanned` | bool | 派生 |
| | `two_column_risk` | enum(`none\|low\|high`) | 派生 |
| | `header_footer_ratio` | float | 派生 |
| | `formula_pages[]` `table_pages[]` | int[] | 派生 |
| | `text_trust` | enum(`high\|medium\|low`) | 派生（**不允许空白**） |
| `CorpusHealthReport` | `per_doc[]` | `DocParseDiagnostic` | 派生 |
| | `corpus_stats` | `{year_dist, source_types, method_keywords}` | 派生 |
| | `red_flags[]` | obj[] | 派生 |
| | `ocr_queue[]` | str[] | 派生 |
| | `recommended_action` | enum(`proceed\|degrade\|reposition`) | 派生 |

### 5.3 S1 产物

| 产物 | 字段 | 类型 | 出处要求 |
|---|---|---|---|
| `ResearchQuestionCard` | `phenomenon` `object_level` `time_window` `variation_source` `contribution_type` | str（`unknown` 合法） | 用户 |
| | `claim_type` | enum(`descriptive\|associative\|causal\|mechanistic\|policy_eval`) | 用户 |
| | `candidate_questions[]` | `{text, corpus_support, identification_feasibility}` | 必带chunk（`corpus_support`） |
| | `out_of_scope[]` | str[] | 用户 |
| `TopicProbeReport` | `topic_coverage` `method_coverage` `disagreement[]` | obj | 必带chunk |
| `OutlineTree@v0` | `nodes[]` | `{node_id, title, level, children[]}` | 派生（**不含主张**） |

### 5.4 S2 产物

| 产物 | 字段 | 类型 | 出处要求 |
|---|---|---|---|
| `SectionLiteratureMap` | `rows[]` | `{section_id, doc_ids[], scores[], evidence_status}` | 必带chunk |
| | `evidence_status` | enum(`ok\|thin\|none`) | 派生 |
| | `user_edited` | bool + `DecisionRecord` 引用 | 用户 |
| `LiteratureMatrix` | `rows[]` | `{stream, identification, conclusion, doc_id, quotable_span, relation_to_this}` | **必带chunk** |
| | `quotable_span` | `{chunk_id, page, char_range}` | 必带chunk |
| `PaperCard` | `research_question` `data_sample` `identification` `findings` `limitations` `borrowable[]` | str（抽不到标 `未抽到`） | 必带chunk（每字段独立） |
| `EvidenceGapList` | `gaps[]` | `{section_id, status, kind}` | 派生 |

### 5.5 S3 产物

| 产物 | 字段 | 类型 | 出处要求 |
|---|---|---|---|
| `DataStructureCard` | 12 字段见 §3 S3 | 见上 | 用户 |
| `IdentificationStrategy` | `strategy_id` `family` `identifying_assumption` `required_variation` `testable_diagnostics[]` `untestable_assumptions[]` `required_robustness[]` `cost` `rejected_reason?` | — | 必带chunk（文献对齐部分）/ `rule_id` |
| `PrecheckReport` | `items[]` | `{check_id, status, evidence, need_from_user, refusal_code?}` | 必带rule + 证据 |
| `HypothesisSet` | `hypotheses[]` | `{h_id, statement, direction, mechanism, outcome_var, prior_lit_ref}` | 必带chunk（`prior_lit_ref`） |
| | `locked_at` | ms | 派生 |
| `VariableSpec` | `var_name` `role` `construction` `source_field` `missing_handling` `expected_sign` `lit_measure_ref` | — | 必带chunk（`lit_measure_ref`） |
| `EstimatorSpec` | `equation_latex` `fe_terms[]` `cluster` `weights` `sample_filter` `estimator_engine` | — | 派生 |

> `PrecheckReport` 的 `check_id` 来自附录 B §5 的检查清单（`DID-01`…`GEN-06`），作为 `provenance.rule_id` 锚点。

### 5.6 S4 产物

| 产物 | 字段 | 类型 | 出处要求 |
|---|---|---|---|
| `AnalysisScript` | `script_id` `engine` `code` | — | `model_mode ∈ {template, byok}` |
| | `header` | `{seed, data_hash, env_lock, cluster, sample_filter}` | 派生（**强制**） |
| | `fast_path_flag` | bool | 派生 |
| `RunRecord` | `run_id` `script_id` `started_at` `duration_ms` `peak_mem_mb` `stdout` `stderr` `warnings[]` `diagnostics{first_stage_F?, pretrend_table?, balance_table?}` | — | 派生 |
| `ResultTable` | `rows[]` | `{term, coef, se, t, p, stars, n, within_r2, n_clusters, fe_terms, cell_ids[]}` | 派生 |
| `Figure` | `figure_id` `kind` `series[]` `x_label` `y_label` `source_cells[]` `note` | — | 派生 |
| `NumberInventory` | `cells[]` | `{cell_id, value, unit, source_table, run_id, tolerance}` | 派生 |
| `ResultNarrative` | `paragraphs[]` | `{text, wording_strength, bound_cells[]}` | **必带 cell_id** |
| `ReconciliationReport` | `items[]` | `{metric, script_value, baseline_value, diff, verdict}` | 派生 |

### 5.7 S5 产物

| 产物 | 字段 | 类型 | 出处要求 |
|---|---|---|---|
| `RobustnessPlan` | `items[]` | `{item_id, kind, excludes_alternative, status(done\|not_done\|cannot_do), reason?}` | 派生（**每项必须绑定要排除的替代解释**） |
| `RobustnessTable` | `rows[]` | `{spec_id, coef, se, n, n_clusters, passed}` | 派生 |
| `SpecificationCurve` | `points[]` | `{spec_id, coef, ci_lo, ci_hi, is_preferred}` | 派生 |
| `MechanismTest` | `claims[]` | `{claim, evidence_kind(mechanism\|heterogeneity\|mediation), post_hoc, wording_strength}` | 必带chunk / cell |
| `DisclosureNote` | `items[]` | `{item, status, reason, alternative_explanation_target}` | 派生 |

### 5.8 S6 产物

| 产物 | 字段 | 类型 | 出处要求 |
|---|---|---|---|
| `ClaimSlot` | `node_id` `claim_sentence` `evidence_need_type` | — | 派生 |
| | `evidence_status` | enum(`ok\|thin\|none`) | 派生（**非空**） |
| | `wording_strength` | enum(`causal\|associative\|descriptive`) | 派生（**非空**） |
| `ArgumentChain` | `edges[]` | `{from, to, kind}` | 派生 |
| | `broken_edges[]` | obj[] | 派生（**不许静默**） |
| `EvidenceReadinessMap` | `map` | `{node_id → {status, strength}}` | 派生 |

### 5.9 S7 产物

| 产物 | 字段 | 类型 | 出处要求 |
|---|---|---|---|
| `ParagraphBlock` | `paragraph_id` `text` | — | — |
| | `citation_chips[]` | `{chunk_id, page, char_range, support(strong\|weak\|mention), text_trust}` | **必带chunk** |
| | `number_chips[]` | `{cell_id, value}` | **必带 cell** |
| | `wording_strength` | enum | 派生 |
| | `unverified` | bool | 派生 |
| `DraftSection` | `section_id` `paragraphs[]` `claim_slots_filled[]` `deferred[]` | — | — |
| `CitationCheckReport` | `checks[]` | `{statement_id, ref_id, support, digit_bound, wording_ok, verdict}` | 派生 |
| `UnverifiedClaimList` | `items[]` | `{statement_id, text, reason, alternatives[]}` | 派生（**≥3 个替代说法**） |
| `DraftNumberBinding` | `bindings[]` | `{statement_id, cell_id}` | 派生 |

### 5.10 S8 产物

| 产物 | 字段 | 类型 | 出处要求 |
|---|---|---|---|
| `EvidencePackage` | `schema_ver` `content_hash` | — | 派生（**可再导入的地基**） |
| | `artifacts` | artifact_id[] | 派生 |
| | `must_include` | `{unverified_claims, refusals, hypothesis_deviations, robustness_omissions}` | 派生（**四项不许为空/静默**） |
| `CitationLedger` | `rows[]` | `{statement_id, statement_text, evidence_type(chunk\|cell), ref_id, support, text_trust, location}` | **必带chunk/cell** |
| `ReproducibilityReceipt` | `script_id` `data_hash` `env_lock` `expected_numbers` `tolerance` `how_to_run` | — | 派生 |
| `DefensePrepSheet` | `qa[]` | `{question, evidence_location}` | 必带 ref |
| `RefusalNotice` | 见 §6 | — | **必带 rule + 证据** |
| `DecisionRecord` | `decision_id` `at` `actor` `question` `chosen` `rejected[]` `reason` | — | 用户/Agent（**"被否决的备选 + 理由"是 why-trace 的答案来源**） |
| `StageRun` | `stage_id` `run_no` `entered_at` `exited_at` `inputs_digest` `outputs_ids` `mode` `progress_events[]` | — | 派生 |
| `InvalidationReport` | `trigger` `affected[]` `preserved[]` `recompute_cost` | — | 派生 |
| `Note` | `text` `chunk_id?` `section_id?` `author: 'user'` | — | 用户（**导出必须与文献证据分栏**） |

---

## 6. 经管学科知识底座（驱动拒答与措辞强度）

> 本部分是产品的**领域内核**：`PrecheckReport` 的检查项、`RefusalNotice` 的话术、`wording_strength` 的判定全部由这里驱动。
> **建议直接实现为规则表（JSON 驱动，不依赖模型）**。检查项 ID 作为 `provenance.rule_id` 锚点，用户点"为什么"时直接跳到对应条款。

### 6.1 判定状态只有三种

`pass`（有证据支持） / `fail`（明确不满足） / `unknown`（信息不足）。

> **`unknown` 一律不得默认为 `pass`**——经管实证的绝大部分误用都发生在"默认成立"上。

### 6.2 检查清单汇总

| 方法族 | 检查项 ID 前缀 | 项数 | 主要拒答码 |
|---|---|---|---|
| 双重差分 / 事件研究 | `DID-01`…`DID-10` | 10 | `R-DATA-01/02/04/05` `R-ID-01/07/13/14` |
| 工具变量 / 2SLS | `IV-01`…`IV-06` | 6 | `R-ID-02/15` `R-DATA-06` |
| 断点回归 | `RDD-01`…`RDD-06` | 6 | `R-ID-03/16/17` |
| 倾向得分匹配 | `PSM-01`…`PSM-06` | 6 | `R-ID-04/18/19/20` |
| 固定效应面板 | `FE-01`…`FE-08` | 8 | `R-ID-05/06/13` `R-DATA-03/06` `W-OMIT-01` `W-MEASURE-01` |
| 中介与机制 | `MED-01`…`MED-04` | 4 | `R-ID-11/21` |
| 跨方法通用红线 | `GEN-01`…`GEN-06` | 6 | `R-ID-12/22/23` `W-MULTI-01` `W-POWER-01` `R-SCOPE-01` |

### 6.3 关键检查项（示例：DID）

| 检查项 | `pass` 依据 | `fail` 码 | 替代路径（拒答必须给） |
|---|---|---|---|
| `DID-01` 双侧变异 | 同时存在处理组与未处理组（或仅时点不同） | `R-DATA-01` | 找邻近未覆盖地区作对照 / 前后均值对比 + 标注"无法分离共同冲击" |
| `DID-02` 处理时点变异 | 处理时点存在个体/地区间差异 | `R-DATA-04` | 改称"政策实施前后对比" |
| `DID-03` 处理前时期数 | 处理前 ≥ 3 期（事件研究建议 ≥ 4） | `R-DATA-02` | 补早期数据 / 只给"政策后变化"描述 |
| `DID-04` **平行趋势** | pre 期系数单独不显著 **且** 联合检验不显著 **且** 无单调趋势 | `R-ID-01` | 换对照组构造 / 换识别策略 / 降级为相关性表述并公开 pre-trend 图 |
| `DID-08` **聚类层级** | 聚类到**处理分配发生的层级**；聚类数 ≥ 约 40（低于则用 wild cluster bootstrap 或明示风险） | `R-ID-13` | 改聚类层级；若聚类数不足 → 用 bootstrap 或明确报告"推断不稳健" |
| `DID-09` **交错处理估计量** | 交错处理时使用对异质性稳健的估计量 | `R-ID-07` | **本环境无成熟实现** → 只给设计、公式与伪代码，**不给系数**；或改用"先处理后"干净子样本做两期 DID |

### 6.4 数据结构 → 可用识别策略匹配表（拒答机制的知识底座）

| `variation_source` × `treatment_timing` × `control_group` | 可用策略 | 不可用（须拒答） |
|---|---|---|
| 政策试点分批 × 交错 × 有未处理组 | 交错稳健估计量（**仅设计**）/ 干净子样本两期 DID | 裸 TWFE（`R-ID-07`） |
| 政策 × 单一时点 × 有未处理组 | 标准 DID + 事件研究（需 pre ≥3 期） | 事件研究（若 pre <3 期，`R-DATA-02`） |
| 政策 × 单一时点 × 全部被处理 | 前后对比（**不叫 DID**） | DID 命名（`R-DATA-04`） |
| 阈值断点 | 局部线性 RDD + 带宽敏感性 | 全局高阶多项式（`R-ID-17`）/ 若密度检验失败（`R-ID-03`） |
| 外生冲击 × 无对照组 | 中断时间序列 / 合成控制（**仅设计**） | DID（`R-DATA-01`） |
| 工具变量 | 2SLS + AR 区间（弱工具时） | 2SLS 因果解读（若 F < 10，`R-ID-02`） |
| 纯横截面差异 | OLS + 控制变量（**只能称相关**） | 任何因果表述（`R-ID-12`） |
| 时间序列波动 | 时间序列分析 | 面板 FE（结构不匹配） |
| 无 | **只做设计**，不跑数 | 全部估计 |

### 6.5 措辞强度阶梯（机器可校验）

| `claim_type` × `PrecheckReport` | 允许的 `wording_strength` | 允许的动词（白名单） | 禁止的动词（黑名单） |
|---|---|---|---|
| `causal` + 全部 `pass` | `causal` | 促进、抑制、提高、降低、导致、使…增加 | — |
| `causal` + 有 `unknown` 未处置 | `associative` | 与…正/负相关、伴随、同步变化 | **促进、导致、提高** |
| `associative` | `associative` | 与…相关、呈…关系 | **促进、导致** |
| `descriptive` | `descriptive` | 呈现、分布、占比、趋势 | **相关、促进、导致** |
| 某章 `evidence_status = none` | 仅"研究缺口 / 方法借鉴"句式 | 尚无研究、缺乏证据、本文借鉴其方法 | **已有研究表明…** |

> 校验实现为**动词白/黑名单的机器检查**（`strength_violation`）：相关证据的段落中出现的因果动词数必须为 **0**。现场可演示、观众可亲手破坏。

### 6.6 可复现性规范（脚本头强制字段）

```
seed            # 随机种子
data_hash       # 输入数据内容哈希
env_lock        # 实际使用的包与版本锁（如 pandas / numpy / statsmodels）——必须写真实用到的，否则"可复现"是假的
cluster         # 聚类层级 + 聚类数
sample_filter   # 样本筛选条件（可复现地写出）
```

**"结果可对账"三步**：① 同 seed + 同 `data_hash` → 同数字（容差 **1e-6**）；② 每个正文数字绑定 `cell_id`；③ 导出 `ReproducibilityReceipt`（预期数字 + 容差 + 如何跑）。

---

## 7. 拒答机制（`RefusalNotice`）

### 7.1 原则

**拒答不是错误处理，是学科判断的输出形态。** 因此 `RefusalNotice` 是一等公民产物：进证据包、进台账、可被 `why-trace` 追问。

### 7.2 字段

| 字段 | 类型 | 必填 | 出处要求 |
|---|---|---|---|
| `refusal_id` / `at` / `stage_id` | str / ms / enum | ✔ | 派生 |
| `code` | enum（§6.4） | ✔ | 必带 rule |
| `conclusion` | str（一句话：**做不到什么**） | ✔ | 派生 |
| `missing_evidence` | `{type(rule\|chunk\|data_field\|corpus), ref, text}[]` | ✔（≥1） | **必带证据**（拒答必须可核查） |
| `what_user_can_add` | `{action, effort, unlocks}[]` | ✔（≥1） | 派生（"需要你补什么"必须**可执行**） |
| `weaker_alternative` | `{output, wording_strength, caveat}` | ✔ | 派生（**拒答必须给降级路径**，否则用户只会换个说法绕过去） |
| `explicitly_not_doing` | str[] | ✔ | 派生（避免被理解成"暂时没做"） |
| `user_decision` | `{chosen, at}` | ✔ | 用户（拒答**必须被处置**：补数据 / 换策略 / 降措辞 / 先不做） |

### 7.3 四段话术结构（所有阶段统一，**禁止客服腔**）

```
【结论】     一句话说清"这个我现在做不了"，明确做不了的是哪一件事。
【依据】     缺的是什么：哪条前置假设不成立 / 哪个字段没有 / 哪条语料里查不到。
            每一句依据都要能点开（chunk / 数据字段 / 检查项 id）。
【你可以补什么】1–3 个可执行选项，每个写清代价（丢样本 / 花时间 / 降结论强度）。
【本次不做的事】明确列出我不做的动作（如"我不会给出 β 的点估计"），
            避免用户以为"再问一次就能拿到"。
```

**反例（禁止）**：

> ❌ 「抱歉，我无法帮您完成这个分析。建议您咨询专业人士。」

**正例（推荐）**：

> ✅ 「这个 DID 我现在给不了你系数。
> **依据**：① 你的处理组在 2015 年全部被覆盖，对照组只剩 12 个个体（`DataStructureCard.control_group`）；② 处理前只有 1 期数据，平行趋势不可检验（检查项 `DID-03` = unknown）；③ 语料里我没找到用这个数据做 DID 的先例（top-20 无命中）。
> **你可以补**：**(a)** 把对照组扩到地级市（我能重跑，约 40 秒，但个体数变多后聚类层级要跟着改）；**(b)** 补 2012–2014 年数据（平行趋势就可检验）；**(c)** 接受降级：我只给"政策后 vs 政策前"的对比和事件研究图的雏形，措辞用"与政策实施同期出现变化"，不写因果。
> **本次我不做**：不给出 β 的点估计，不在正文里写"显著促进"，也不会替你选一个看起来平行的窗口。」

### 7.4 拒答码表

**`R-*` = 阻断（必须拒答或降级）**

| 码 | 类别 | 含义 | 典型阶段 |
|---|---|---|---|
| `R-CORPUS-01` | 语料 | 语料内无依据支撑该论断/前提 | S1 S2 S6 S7 |
| `R-CORPUS-02` | 语料 | 语料与问题整体不相关（检索分数全线低于阈值） | S0 S1 |
| `R-PARSE-01` | 解析 | 解析质量不足以支撑逐句回溯（该篇/全库） | S0 S2 S7 |
| `R-DATA-01` | 数据 | 无对照组 | S3 |
| `R-DATA-02` | 数据 | 样本期太短（前/后 <3 期） | S3 S5 |
| `R-DATA-03` | 数据 | 面板严重不平衡 / 非随机流失 | S3 |
| `R-DATA-04` | 数据 | 处理时点无变异 | S3 |
| `R-DATA-05` | 数据 | 溢出/污染（对照受处理影响） | S3 |
| `R-DATA-06` | 数据 | 变量缺失/不存在/单位不一致 | S4 |
| `R-ID-01` | 识别 | 平行趋势不可检验或不满足 | S3 S5 S6 |
| `R-ID-02` | 识别 | 弱工具变量 | S3 S4 |
| `R-ID-03` | 识别 | 断点操纵 / 协变量不连续 | S3 |
| `R-ID-04` | 识别 | PSM 重叠性/平衡性不满足 | S3 |
| `R-ID-05` | 识别 | 双向固定效应吸收核心变异（β 不可识别） | S3 |
| `R-ID-06` | 识别 | 动态面板 Nickell 偏误（静态 FE 不可用） | S3 |
| `R-ID-07` | 识别 | **交错处理下 TWFE 负权重（本环境无成熟实现）** | S3 S4 |
| `R-ID-08` | 识别 | 本环境无该估计量的成熟实现（引擎限制） | S3 S4 |
| `R-ID-09` | 识别 | 期数不足以做事件研究 | S5 |
| `R-ID-10` | 识别 | 稳健性/安慰剂不通过（**禁止"稳健"表述**） | S5 |
| `R-ID-11` | 识别 | 机制证据不足（只有中介显著） | S5 S6 |
| `R-ID-12` | 识别 | 存在未处置 `unknown` 却要求因果措辞 | S6 S7 |
| `R-ID-13` | 识别 | 聚类层级错误 / 聚类数不足 | S3 S5 |
| `R-ID-14` | 识别 | 同期冲击无法分离 | S3 S5 |
| `R-ID-15` | 识别 | 不可检验假设未给论证（排他性/单调性） | S3 |
| `R-ID-16` | 识别 | 断点带宽内样本量不足 | S3 |
| `R-ID-17` | 识别 | RDD 使用全局高阶多项式 | S3 |
| `R-ID-18` | 识别 | PSM 可观测选择假设未明示 | S3 |
| `R-ID-19` | 识别 | PS 模型含结果变量 | S3 |
| `R-ID-20` | 识别 | 匹配后推断未考虑匹配过程 | S3 |
| `R-ID-21` | 识别 | 把异质性当机制证据 | S5 S6 |
| `R-ID-22` | 识别 | 把"不显著"当"无效应" | S5 S6 S7 |
| `R-ID-23` | 识别 | 外推超出样本/时期边界 | S6 S7 |
| `R-RESULT-01` | 结果 | 主结果不稳健（**须披露而非隐藏**） | S5 |
| `R-COMPUTE-01` | 执行 | 配额/内存/观测规模超限（降级或抽样） | S0 S4 |
| `R-SCOPE-01` | 越界 | 抓取第三方全文 / 查重降重 / p-hacking / 导出全文 | 全阶段 |
| `R-CLAIM-01` | 承诺 | 要求"保证没有幻觉"等超出产品承诺的担保 | S7 S8 |

**`W-*` = 警告（不阻断，但**必须在产物/正文/证据包中可见**）**

| 码 | 含义 | 典型阶段 |
|---|---|---|
| `W-OMIT-01` | 未做遗漏变量敏感度分析 | S3 S5 |
| `W-MEASURE-01` | 未说明度量与量级的经济含义 | S3 S5 |
| `W-MULTI-01` | 多重检验未调整 / 选择性报告 | S5 |
| `W-POWER-01` | 检验力不足 / 未报最小可检测效应 | S5 |

### 7.5 `R-SCOPE-01` 的统一答法（防止用户反复试探）

> 「这条我在设计上就不做，不是能力不够：**我不联网抓取任何第三方全文、不做查重降重、不担保零幻觉**。我能做的是——你手上的语料里，每个论断都给你回跳出处；找不到出处的地方，我给你标『无来源·待核实』。如果你要的是前者，我们继续；如果你要的是后者，这个工具帮不上你，我不想让你以为它能。」

---

## 8. 进度形态总表

| 阶段 | 典型时长 | 形态 | 可中断 | 续跑粒度 | 必须进度化的对象 | ETA 呈现要求 |
|---|---|---|---|---|---|---|
| S0 `corpus-intake` | 3–8 min（含 OCR 30–90 min） | 分钟级长任务 | ✔ | 单篇 / 单页 | 逐篇解析、逐页 OCR、索引分片、数据文件剖析 | **区间 + 置信度；禁止假精确** |
| S1 `question-scoping` | <1 s（探针）/ 10–60 s（候选生成） | 瞬时 + 秒级 | ✔ | 单次探针 | 检索探针、候选生成 | 秒级不确定时给"约 x 秒" |
| S2 `evidence-mapping` | 1–10 min（300 篇） | 分钟级长任务 | ✔ | **单篇 PaperCard** | 检索打分、逐篇抽取、缺口分析 | 已完成 n/N + 剩余区间 |
| S3 `design-authoring` | <1 s（规则）/ 10–60 s（数据特征扫描） | 秒级 | ✔ | 单检查项 | 检查清单逐条出结果 | 逐条出结果，无需 ETA |
| **S4 `design-gate`** | **瞬时（等用户）** | **瞬时** | — | — | — | **无 ETA**（这是纯等待用户的节点） |
| S5 `data-prep` | 10 s–5 min | 秒级–分钟级 | ✔ | 单执行项 | 读取、清洗、变量构造、筛选各自一项 | **执行前必须 `engine_plan()` 告知** |
| S6 `descriptive` | <5 s | 秒级 | ✔ | 单张表 | 描述统计 / 相关系数 / 分组对比 | 可省 |
| S7 `baseline` | 30 s–5 min | 秒级–分钟级 | ✔ | 单设定 | Pyodide 冷启动、主回归、诊断 | 执行前告知；跑中给 n/N |
| S8 `robustness` | 2–20 min | 分钟级长任务 | ✔ | **单检验** | 每个稳健性检验一项 | n/N + 每项状态 |
| S9 `endogeneity` | 30 s–5 min | 秒级–分钟级 | ✔ | 单设定 | 第一阶段、主回归、诊断 | 执行前告知 |
| S10 `heterogeneity` | 30 s–5 min | 秒级–分钟级 | ✔ | 单分组 | 每个分组一项 + 差异检验 | n/N |
| S11 `mechanism` | 30 s–5 min | 秒级–分钟级 | ✔ | 单设定 | 机制回归 + 措辞判定 | 执行前告知 |
| S12 `paper-drafting` | 秒级/段；九章分钟级 | **流式** | ✔ | **单段** | 检索 → 组装 → 四查校验三段 | 显示"正在检索 / 正在校验" |
| 导出 | <1 s–1 min | 秒级 | ✔ | 单文件 | 打包项 | 可省 |

> **S4 是本表唯一的"无进度"节点**——它是门禁，等的是用户而不是计算。给它画进度条是设计错误，会暗示"系统在忙"。

### 三条进度纪律

1. **降级必须显示在进度区**（"仅 BM25"），不能只在日志里；
2. **中断后重进必须从已完成项续跑**（靠 `chunk_id` 内容哈希）；
3. **长时间任务必须给"现在可以直接用哪部分"**（边建边用）。

> 进度事件的**统一形状**与"先预留、后准入"的进度计数机制见 [`附录C-进度与可观测语义`](经管论文助手-附录C-进度与可观测语义.md)。

---

## 9. 阶段状态机（实现规格）

### 9.1 阶段状态

```ts
type StageStatus = 'not-entered' | 'entered' | 'in-progress' | 'awaiting-user' | 'completed' | 'blocked' | 'invalidated';
```

| 状态 | 含义 | 允许的转移 |
|---|---|---|
| `not-entered` | 未进入（进入条件未满足） | → `entered`（条件满足）/ `blocked`（硬门被拒） |
| `entered` | 已进入，尚未产出 | → `in-progress` |
| `in-progress` | Agent 正在工作 | → `awaiting-user` / `completed` / `blocked` |
| `awaiting-user` | **等用户决策**（每个阶段必须至少有一次） | → `in-progress` / `completed` |
| `completed` | 退出判据全部满足 | → `invalidated`（上游纠偏） |
| `blocked` | 硬门被拒（如 `DataStructureCard.incomplete`） | → `entered`（补齐后） |
| `invalidated` | 因上游变更而失效 | → `in-progress`（重算） |

### 9.2 转移事件

| 转移 | 事件 | 载荷 |
|---|---|---|
| → `entered` | `stage.enter` | `{stage_id, run_no, inputs_digest, mode}` |
| → `completed` | `stage.exit` | `{stage_id, run_no, outputs_ids[], criteria_met[], verdict}` |
| → `blocked` | `gate.blocked` | `{stage_id, reason_code, missing_fields[], need_from_user[]}` |
| → `invalidated` | `invalidation.report` | `{trigger, affected[], preserved[], recompute_cost}` |

### 9.3 回退与失效传播

**允许的回退边**：S7→S6→S3→S1。

**回退必须产出 `InvalidationReport`**，含四要素：

1. **`trigger`**：什么变了（用户输入 / 数据变更 / 上游产物修订）；
2. **`affected[]`**：哪些产物失效（**点名到具体对象**，例如"已写入草稿的 7 个数字"）；
3. **`preserved[]`**：哪些保留（不必重算）；
4. **`recompute_cost`**：重算代价分档（如 10 秒 / 5 分钟 / 8 分钟）。

**示例**（用户把样本期从 2012–2019 改成 2010–2020）：

| 失效 | 保留 |
|---|---|
| `DataStructureCard.n_periods`（须更新） | `CorpusHealthReport`（语料未变） |
| `PrecheckReport`（期数变化 → 平行趋势结论可能变） | `LiteratureMatrix`（文献未变） |
| `ResultTable` / `RobustnessTable`（须重跑） | `HypothesisSet`（假说未变） |
| `NumberInventory` 中 7 个 `cell_id`（**点名**） | `PaperCard[]` |
| `DraftSection` 中绑定这些 cell 的 7 处数字（**须标记"待更新"**） | 不涉及数字的段落 |

**重算代价**：S3 检查 ≈10 秒；主回归 ≈5 分钟；稳健性全量 ≈8 分钟。

### 9.4 硬门清单

| 阶段 | 硬门 | 不满足 | 说明 |
|---|---|---|---|
| S1 | `CorpusHealthReport` 已确认 + ≥1 篇绿/黄标 | 回 S0 | — |
| S2 | `rq.locked` 存在 | 回 S1 | — |
| S3 | `claim_type` 已知 + `SectionLiteratureMap` 存在 | 回 S2 | — |
| **S4** | **`DataStructureCard` 12 字段全有值** | **`gate.blocked`** | **唯一绝对硬门**（统计误用的上游） |
| S4 | `HypothesisLock` 已写 | 回 S3 | 未冻结不许跑数 |
| S4 | 无未处置 `fail` | 逐项处置 | — |
| S5 | 主结果已对账 | 回 S4 | — |
| S6 | ≥1 已对账 `ResultTable`（综述型可豁免但须声明） | 回 S4/S5 | — |
| S7 | `outline.approved` 存在 | 回 S6 | — |
| S8 | ≥1 `DraftSection` + `RunRecord` + `CitationCheckReport` | — | — |

---

## 10. 尚未解决的设计风险（诚实列出）

| # | 风险 | 表现 | 建议处置 |
|---|---|---|---|
| 1 | **拒答过度** | 检查项过严 → 用户寸步难行，转去用不受约束的工具 | 把 `W-*` 与 `R-*` 的比例做成可观测指标；`unknown` 给"先按最弱措辞继续"的出路 |
| 2 | **可核查的演示成本** | 逐段确认 + 逐项处置会让 15 分钟演示跑不完 | 演示脚本预设"快速通道"；但**快速通道不得跳过引用校验** |
| 3 | **12 字段问卷偏重** | 用户可能嫌烦而随手乱填 | 提供"从数据文件自动推断"预填（csv/xlsx 可推断面板结构），用户只做确认与修正 |
| 4 | **`PaperCard` 演示档被当成 MVP 承诺** | 抽取质量有限，用户以为产品能自动读懂论文 | UI 明确标注档位；抽不到的字段显式标『未抽到』而不是留白 |
| 5 | **用户绕过拒答** | 换个说法再问一次 | 拒答记录进台账并在证据包披露；同一 `rule_id` 的重复拒答在 UI 上合并显示 |
| 6 | **交错处理估计量缺实现** | `R-ID-07` 会频繁触发（现实中交错处理很常见） | 明确给"只给设计 + 伪代码"的定位；长期考虑接入 WASM 版实现 |
