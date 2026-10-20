# 附录 A · 多 Agent 架构 与 框架一致性契约

> 配套主文档：[`经管论文助手-纯前端Demo产品设计PRD.md`](经管论文助手-纯前端Demo产品设计PRD.md)
> 本附录回答两个问题：
> 1. **【§2】整个 Agent 框架长什么样** —— 8 个专职 Agent、LangGraph 状态图、节点契约、状态定义、质量门。这是"AI 能不能按预期产出一篇合格论文"的技术基础。
> 2. **【§3 起】"纯前端 Demo 的 agent 框架与本地 DeepSeek Harness App 保持一致"具体一致在哪、怎么验证。**
>
> 事实来源：从本地 DSH App 的 `app.asar` 抽取的 289 个 `@deepseek-ai/*` 包源码与官方 README（见 §3 证据基线），以及 LangGraph.js 前端入口的官方文档。文中每条契约都标注来源；本产品新增的部分标注 **【本产品新增】**。

---

## 0. 本附录导读

| 章节 | 内容 | 谁该读 |
|---|---|---|
| **§2 多 Agent 架构** | 8 Agent 职责、LangGraph 状态图、状态 schema、节点契约、质量门、浏览器落地 | 架构师、Agent 开发者 |
| §3–§11 | DSH 框架契约：证据基线、事件词汇、turn/step、工具管线、投影、取消恢复 | 内核开发者 |
| §9 | 模型配置面（Provider / 凭据 / 模型目录） | 前后端对接 |
| §14 | 与本地 App 的一致性验收（`T-CONF-*`） | 质量、迁移负责人 |
| §15 | 显式扩展登记（迁移时必须处置的 9 条） | 迁移负责人 |
| §16 | 前端专属实现约束（踩坑清单） | 全体开发 |

---

## 2. 多 Agent 架构（LangGraph）

> **为什么要有多个 Agent，而不是一个大 Agent + 一堆工具？**
> 因为本产品要保证的不是"能聊"，而是**流程不跑偏、结果不夸大、引用不编造**。这三件事靠一个 Agent 的自觉做不到，必须靠**职责分离 + 独立质量门**。拆分依据是**可独立校验的产物边界**：每个 Agent 的产出都必须能被 Reviewer 单独验证。

### 2.1 架构总图

```
                              ┌─────────────────────────────────────┐
                              │        Supervisor（总控）             │
                              │  · 阶段路由与推进                     │
                              │  · 门禁判定（gate）                   │
                              │  · 人机交互点调度（interrupt）         │
                              │  · 失败重试与降级                     │
                              └───────────────┬─────────────────────┘
                                              │  (状态图边)
   ┌──────────────┬──────────────┬────────────┴────────────┬──────────────┐
   ▼              ▼              ▼                         ▼              ▼
┌──────────┐ ┌──────────┐ ┌──────────────┐        ┌──────────────┐ ┌──────────────┐
│ RQ-Agent │ │Lit-Agent │ │ Design-Agent │        │Writing-Agent │ │ Resource-    │
│ 命题解析  │ │文献检索   │ │ 实验设计      │        │ 论文撰写      │ │ Agent        │
│          │ │与匹配     │ │              │        │              │ │ 资源入库      │
└────┬─────┘ └────┬─────┘ └──────┬───────┘        └──────┬───────┘ └──────┬───────┘
     │            │              │                       │                │
     │            │              ▼                       │                │
     │            │      ┌─────────────────┐             │                │
     │            │      │ Empirics-Agent  │             │                │
     │            │      │ 七步流水线调度    │             │                │
     │            │      └────────┬────────┘             │                │
     │            │               │                      │                │
     │            │   ┌───────────┼───────────┐          │                │
     │            │   ▼           ▼           ▼          │                │
     │            │ ┌────────┐┌────────┐┌───────────┐    │                │
     │            │ │Data-   ││Model-  ││Interp-    │    │                │
     │            │ │Agent   ││Agent   ││Agent      │    │                │
     │            │ │数据清洗 ││计量模型 ││结果解读    │    │                │
     │            │ └────────┘└────────┘└───────────┘    │                │
     │            │               │                      │                │
     └────────────┴───────────────┴──────────────────────┴────────────────┘
                                              │
                              ┌───────────────▼─────────────────────┐
                              │   Reviewer-Agent（独立质量门）        │
                              │  四门：数值一致性/措辞强度/           │
                              │        引用真实性/披露完整性          │
                              │  不通过 → 打回对应 Agent（带理由）    │
                              └─────────────────────────────────────┘
```

### 2.2 八个 Agent 的职责契约

| Agent | 职责 | 输入 | 输出（产物） | **明确不做什么** |
|---|---|---|---|---|
| **Supervisor** | 阶段路由、门禁判定、交互点调度、失败重试 | 用户输入 + 事件日志 | `stage.enter` / `stage.exit` / `gate.blocked` | **不产出任何学术内容**（防止总控越权"补全"） |
| **RQ-Agent** | 命题五槽位解析、`claim_type` 判定、可行性预警 | 用户命题文本 | `ResearchQuestionCard` | **不猜填槽位**；不确定必须标 `unknown` |
| **Lit-Agent** | 混合检索、三类探针、分歧探测、缺口分析 | RQ + 文献库索引 | 命中集 + `EvidenceGapList` | **不编造文献**；零命中必须明说 |
| **Design-Agent** | 假设、变量、模型设定、检查清单、七步执行项 | RQ + 文献命中 + 数据库结构 | `ExperimentDesign` + `PrecheckReport` | **缺必填字段不推进**（唯一绝对硬门） |
| **Empirics-Agent** | 七步流水线调度、步骤状态机、重跑与跳过留痕 | 已确认的设计 | 七个 `PipelineStepArtifacts` | **不发散到设计之外**（不许自己加检验） |
| **Data-Agent** | 数据读取清洗、变量构造、样本筛选、质量诊断 | 数据库 + 变量定义 | 清洗日志 + 变量描述表 | **不静默丢数据**（删行必须记数与理由） |
| **Model-Agent** | 按设计跑计量模型 | 清洗后数据 + `EstimatorSpec` | `ResultTable` + `NumberInventory` | **不自造计量轮子**；环境无成熟实现则拒跑 |
| **Interp-Agent** | 规则驱动结构化解读 + 可选 LLM 润色 | `ResultTable` + 措辞强度 | 解读文件（含 `boundCells`） | **不引入结果外的数字或断言** |
| **Writing-Agent** | 九章初稿、风格画像、逐段生成、引用绑定 | 全部产物 + `StyleProfile` | `PaperDraft` | **不一次吐全文**、不越措辞强度 |
| **Reviewer-Agent** | 四类质量门 | 任意产物 | `QualityReport`（pass / reject + 理由） | **不做内容生成**（只校验） |

### 2.3 LangGraph 状态图

**状态 schema（`GraphState`）**：

```ts
type Stage =
  | 'corpus-intake' | 'question-scoping' | 'evidence-mapping' | 'design-authoring'
  | 'design-gate'   | 'data-prep'        | 'descriptive'       | 'baseline'
  | 'robustness'    | 'endogeneity'      | 'heterogeneity'     | 'mechanism'
  | 'paper-drafting';

interface GraphState {
  // ── 项目身份 ──
  projectId: string;
  sessionId: string;                    // 与 DSH 会话同构
  stage: Stage;                         // 当前阶段
  stageRunNo: number;                   // 阶段内执行序号（重跑 +1）

  // ── 资源 ──
  corpusIndex: { bm25: 'ready'|'building'; vector: number };   // 0–100
  database: { datasets: DatasetRef[]; panelShape: PanelShape };

  // ── 阶段产物（按阶段填充，全部可空） ──
  rq?: ResearchQuestionCard;
  hits?: RetrievalHit[];
  gaps?: EvidenceGap[];
  design?: ExperimentDesign;
  designConfirmed?: { hash: string; at: number; by: string };
  steps?: Record<PipelineStepId, PipelineStepArtifacts>;
  numbers?: NumberInventory;
  draft?: PaperDraft;
  style?: StyleProfile;

  // ── 质量与留痕 ──
  quality: QualityReport[];
  refusals: RefusalNotice[];
  decisions: DecisionRecord[];
  invalidations: InvalidationReport[];

  // ── 控制 ──
  retryCount: Record<string, number>;   // 每个节点的重试计数（防死循环）
  maxRetries: number;                   // 默认 2
  degradations: string[];               // 例 ['语义索引未就绪，仅 BM25']
}
```

**图的边与路由**：

| 节点 | 出口条件 | 去向 |
|---|---|---|
| `resource-intake` | 资源就绪（BM25 ready 即可） | `question-scoping` |
| `question-scoping` | 五槽位非空 | **interrupt：用户确认** → `evidence-mapping` |
| `evidence-mapping` | 检索完成 | `design-authoring` |
| `design-authoring` | 设计七分区齐备 | `design-gate` |
| **`design-gate`** | `DataStructureCard` 必填齐 **且** 无未处置 fail | **interrupt：用户确认** → `data-prep`；否则 `gate.blocked` 回 `design-authoring` |
| `data-prep` → `descriptive` → `baseline` | 每步 `step.status === 'done'` | 下一步 |
| `baseline` | 完成 | `robustness`（**④⑤⑥⑦ 都只依赖③**，接口预留并行） |
| `robustness` → `endogeneity` → `heterogeneity` → `mechanism` | 每步完成或显式 `skipped`（带理由） | 下一步 |
| 每个实证步 | 产出三件套 | `reviewer`（质量门） |
| `reviewer` | 四门全过 | 继续下一步 |
| `reviewer` | 任一门 fail | **打回**对应 Agent（带拒绝理由），`retryCount++`；超 `maxRetries` → 标记 `failed` 并请用户处置 |
| `mechanism` | 完成 | `paper-drafting` |
| `paper-drafting` | 九章 `done` | **导出**（论文 + 七步三件套 + 数据哈希 + 环境锁 + 写作说明，走 `present_deliverable`） |

**LangGraph 落地要点（浏览器内）**：

| 项 | 方案 | 依据 |
|---|---|---|
| 库 | `@langchain/langgraph` **前端入口**（有浏览器构建） | [LangGraph.js 前端文档](https://docs.langchain.com/oss/javascript/langgraph/frontend/overview) |
| 人机交互 | `interrupt()` 实现设计确认门与逐段确认；恢复靠 checkpointer | [Persistence 文档](https://docs.langchain.com/oss/javascript/langgraph/persistence) |
| 持久化 | checkpointer 落 **IndexedDB**；崩溃后从最后检查点续跑 | 同上 |
| 循环 | Reviewer 打回是**有界循环**（`maxRetries = 2`），超限升级为用户处置 | 本产品新增 |
| 计算 | 计量执行走 **Web Worker + Pyodide**，不阻塞主线程 | 架构评审 §2.2b 工程纪律 |
| 流式 | 节点内 `stream` 事件 → 前端进度，与附录C 的 `ProgressEvent` 对齐 | — |
| **状态与日志同构** | **每次节点执行写一条 `node.enter` / `node.exit` 事件**；GraphState 可从事件日志折叠重建 | 与 DSH 事件溯源同构（§4 内核形态） |

> ⚠️ **W0 必须验证**：LangGraph 浏览器端体积与首屏性能。若超出预算（> 300 KB gzip），退化为**同构状态图**（自实现 node/edge/checkpoint/interrupt，保留全部语义）。**退化不影响本附录的架构描述**——架构是语义层的，实现对库无强依赖。

### 2.4 质量门（Reviewer-Agent 的四门）

| 门 | 校验什么 | 判定 | 不通过的处理 |
|---|---|---|---|
| **门一：数值一致性** | 解读/正文中每个数字必须绑定 `cell_id` 且与结果文件一致 | `interp.consistency === 'pass'` | **降级为规则版解读**；正文数字标"待更新"；**不得放行** |
| **门二：措辞强度** | 相关证据段落中因果动词数 = 0；`wording_strength` 未越界 | 机器可数 | 强制降级措辞；重写该段 |
| **门三：引用真实性** | 四查：chip 指向真实 chunk / 支持强度 / 数字绑定 / 措辞一致 | `citation.check.verdict !== 'invalid'` | 该句替换为『此处待补文献』+ 给 3 个可被支持的近似说法 |
| **门四：披露完整性** | "做不了的项"必须显式披露（拒答 / 未做检验 / 未核实清单） | 清单非空即通过；为空需证明真无 | 补披露；**静默丢弃一律判失败** |

> **门的独立性是这套架构的关键**：Reviewer 不参与生成，只校验；它的判定依据是**产物本身**，不是生成者的自述。

### 2.5 与 DSH 框架的关系（同构点）

多 Agent 编排**跑在 DSH 同构的内核之上**，不是另起一套：

| DSH 内核概念 | 在多 Agent 架构中的角色 |
|---|---|
| Session 事件日志 | **GraphState 的真源**：节点执行、产物、质量门、拒答全部落日志 |
| 投影（Projection） | 阶段看板 / 产物树 / 引用台账 / 进度 / 质量报告都由投影折叠 |
| 工具管线（8 阶段） | 每个 Agent 的工具调用走同一管线（校验/权限/审批/超时/结果截断） |
| `turn` / `step` | 用户可感知的交互单元 / 一次模型请求+工具执行；**Agent 节点执行落在 step 边界内** |
| `agent/pre-step` 钩子 | **门禁在这里实现**（`design-gate` 未过 → `reject` + `gate.blocked`） |
| 取消与恢复 | 协作式取消 + 三种补记码 + 崩溃恢复（checkpointer 等价物） |

> **一句话**：**LangGraph 负责"该谁干、按什么顺序干、谁把关"；DSH 同构内核负责"干了什么、凭什么这么干、怎么复原"。** 两者是分层关系，不是替代关系。

---

## 3. 证据基线与标注规则

| 标注 | 含义 |
|---|---|
| **【DSH】** | 本地 App 的真实行为，有包/文件/行号证据，**照抄** |
| **【DSH·简化】** | DSH 有，但浏览器环境需换实现，**接口形状保持同构** |
| **【本产品新增】** | DSH 没有，本产品显式扩展，**需在迁移时回改或双写** |
| **【推断】** | 无直接代码证据的工程判断 |

**抽取的包**（在 `work/dshsrc/`，由 `app.asar` 解出）：

```
dsh-agent-loop/  dsh-agent/  dsh-session/  dsh-session-projection/  dsh-tools/
dsh-llm/  dsh-settings/  dsh-credentials/  dsh-credentials-local/
dsh-agent-default-model/  dsh-client-ui-model-selection/  dsh-client-ui-settings-models/
dsh-api-settings-controller/  dsh-client-ui-trajectory/  dsh-llm-pi-ai/  dsh-jobs/  dsh-goal/ …
```

**关键前提证据（决定前端复刻可行）**

> `dsh-session/lib/types/surface.js:5-7`：
> **Browser-safe**: web clients consume this subpath export, so it must stay free of `node:` imports

`node:` 依赖面实测：

| 包 | node 依赖 | 前端处置 |
|---|---|---|
| `dsh-session-projection` | **零** | 契约直接复用 |
| `dsh-tools` | **零** | 契约直接复用 |
| `dsh-agent-loop` | 仅 `node:crypto`（`randomUUID`） | `crypto.randomUUID()` |
| `dsh-agent` | `node:async_hooks`（AsyncLocalStorage 发起方归因） | **放弃**（DSH 自述"仅进程内、非语义必需"） |

> ⚠️ **"零 Node"只对子路径成立**：`dsh-session` **主入口**有 `node:path` 依赖（本附录 §4.1 引的 `dsh-session/lib/index.js:1400-1403` 即主入口）。复用方式是**改走 `surface.js` 这类 browser-safe 子路径导出，而不是整包 import**。
| `dsh-client-ui-trajectory` | 自述"**视图是纯投影**" | 已是浏览器实践 |
| `dsh-token-meter`（`deriveTurnTokenUsage`） | 无（`Buffer\|node:\|process.` 仅命中对象键） | 纯函数直接复用 |

---

## 4. 内核形态：事件溯源状态机

```
用户输入 ──► Inbox(投影) ──► Turn ──► Step ──► 请求构造 ──► LLM 流 ──► 工具管线 ──► 回写日志
                ▲                                                                      │
                └──────────── 一切可观察状态都从 Session 日志 fold 出来 ◄─────────────────┘
```

**【DSH】唯一真源是仅追加的 `Session` 日志。** 没有"内存里的对话数组"这种一等状态；连"待办的用户输入"都是日志投影（投影 key `inbox`）。

> 证据：`dsh-session/README.zh.md:88`「该包建立在事件溯源之上：`Session` 是类型化 `SessionEvent` 的仅追加日志，其他一切——模型历史、transcript、遥测、标题、持久化——都从这条流派生。」
> 证据：`dsh-agent-loop/lib/index.js:26-62`（`inbox` 投影片段的 `apply` 只消费 `agent/inbox/spliced`）

**对前端的直接含义**：

1. "刷新后恢复现场"**免费**——持久化事件日志即可，无需另设计状态持久化；
2. 阶段面板、轨迹面板、证据台账、进度条**共用同一个数据源**，不需要四套状态；
3. **反例警告**：`agent/assistant-stream` 的实时帧（`start`/`chunk`/`end`）是**呈现数据，不是回放来源**。刷新恢复**必须**从日志重建，**不得**依赖内存帧缓冲。

> 证据：`dsh-agent-loop/README.zh.md`（实时事件语义）；`dsh-session-projection/README.zh.md:133`

---

## 5. 事件信封与事件词汇

### 5.1 信封

```ts
type SessionEvent = {
  type: string;              // 闭合清单成员
  seq: number;               // 0 基连续下标，seq = log.length
  time: number;              // 毫秒时间戳
  data: unknown;             // 事件载荷
  surfaceOp?: SurfaceOp;     // {op:'append'} | {op:'replace', startSeq, endSeq}
  sourceEventSeqs?: number[];// 配对用（如 tool/result ↔ tool/call）
  ignorable?: boolean;       // 读路径允许跳过未知类型
};
```

**【DSH】** `seq = log.length`，0 基连续。

> 证据：`dsh-session/lib/index.js:1400-1403`、`:1453-1459`

### 5.2 严格 append-only，历史"遮蔽"而非删除

**【DSH】** 日志层**严格 append-only**。压缩与替换通过 `surfaceOp: {op:'replace', startSeq, endSeq}` 实现，**被遮蔽的事件永久留在日志里**。

> ⚠️ **最容易踩的 UI 坑**：人类 transcript **必须取 `surfaceOp === 'append'` 的事件**。surface 视图会抹掉用户已看过的对话（压缩后），直接把整个日志渲染出来会给用户看到"被删掉又重新拼接"的错乱内容。
> 证据：`dsh-session/lib/types/surface.js:39-52`、`:441-445`；`dsh-compaction-basic/lib/index.js:634-661`

### 5.3 事件词汇表（Demo 版）

**【DSH 子集，照抄 25 种】**

| 组 | 事件 |
|---|---|
| 会话/轮次 | `session/title` `turn/start` `turn/end` `step/start` `step/end` |
| 消息 | `user/message` `assistant/message` `assistant/attempt` `developer/message` `system/message` |
| 模型 | `model/selection` `request/header` `request/context` `llm/retry` `llm/retry-started` |
| 工具 | `tool/call` `tool/result` |
| 审批 | `approval/asked` `approval/decided` |
| 交接 | `agent/inbox/spliced` `deliverables/presented` `todo/write` |
| 压缩 | `compaction/start` `compaction/summary` `compaction/end` |

**【本产品新增，34 种】**

| 组 | 事件 | 载荷要点 |
|---|---|---|
| **多 Agent**（4） | `node.enter` | `{node_id, agent, stage_id, run_no, inputs_digest}` |
| **多 Agent** | `node.exit` | `{node_id, agent, status: 'ok'\|'failed'\|'rejected', outputs_ids[], duration_ms}` |
| **多 Agent** | `agent.handoff` | `{from_agent, to_agent, reason, state_digest}` |
| **多 Agent** | `review.verdict` | `{gate: 'consistency'\|'wording'\|'citation'\|'disclosure', verdict: 'pass'\|'reject', ref, reasons[], retry_no}` |
| 阶段（4） | `stage.enter` | `{stage_id, run_no, inputs_digest, mode}` |
| 阶段 | `stage.exit` | `{stage_id, run_no, outputs_ids[], criteria_met[], verdict}` |
| 阶段 | `stage.progress` | 结构化 `ProgressEvent`（附录 C §2） |
| 阶段 | `gate.blocked` | `{stage_id, reason_code, missing_fields[], need_from_user[]}` |
| **设计门**（2） | `design.confirmed` | `{design_hash, by, at, warnings[]}` —— **唯一门禁的事件载体**；未写此事件前执行器拒绝读数据 |
| **设计门** | `design.invalidated` | `{old_hash, new_hash, reason}` —— 设计变更后确认失效 |
| **流水线** | `step.enter` | `{step_id, run_no, planned_items[]}` |
| **流水线** | `step.artifact` | `{step_id, kind: 'code'\|'result'\|'interpretation', artifact_id, path, bytes}` |
| **流水线** | `step.exit` | `{step_id, run_no, status: 'done'\|'failed'\|'skipped', reason?, cell_ids[]}` |
| **流水线** | `step.rerun` | `{step_id, from_run, to_run, reason}` |
| 产物 | `artifact.write` | `{artifact_id, type, rev, content_hash, provenance}` |
| 产物 | `artifact.revise` | `{artifact_id, from_rev, to_rev, patch_digest, actor, reason}` |
| 产物 | `artifact.invalidate` | `{artifact_id, cause, invalidation_report_id}` |
| 语料 | `corpus.manifest` | `{docs[], excluded[]}` |
| 语料 | `corpus.health.confirmed` | `{report_id, report_hash, user_decision: {chosen, at}}` |
| 数据集 | `dataset.profile` | `{dataset_id, rows, cols, col_types[], missing_stats, panel_shape}` |
| 检索 | `retrieval.trace` | `{query, mode, topk[], rrf_scores[], dropped_by_mmr[], degradations[]}` |
| 引用 | `citation.check` | `{statement_id, ref_id, support, digit_bound, wording_ok, verdict}` |
| 学术判断 | `refusal.raised` | `RefusalNotice` |
| 学术判断 | `refusal.resolved` | `{refusal_id, user_decision: {chosen, at}}` —— **`G-14`「拒答必须被处置」的事件载体**；`refusals` 投影靠它折叠出"已处置/未处置"。**`user_decision` 统一用 `{chosen, at}` 对象形状**（`corpus.health.confirmed` / `outline.approved` / `design.confirmed` 同此约定） |
| 学术判断 | `decision.record` | `{decision_id, question, chosen, rejected[], reason, actor}` |
| 学术判断 | `hypothesis.lock` | `{hypotheses[], locked_at, rq_hash, design_hash}` |
| 学术判断 | `hypothesis.deviation` | `{h_id, deviation, at, disclosed_in_package}` |
| 学术判断 | `invalidation.report` | `{trigger, affected[], preserved[], recompute_cost}` |
| 学术判断 | `rq.locked` | `{rq_hash, claim_type}` |
| 学术判断 | `gap.acknowledged` | `{section_id, evidence_status}` |
| 写作 | `style.extracted` | `{mode: 'journal-default'\|'user-reference', journal?, reference_doc_ids[], profile}` |
| 写作 | `section.generated` | `{section_id, paragraph_ids[], wording_strength, unverified_count}` |
| 入口 | `probe.answer` | `{question, grounded, refs[], answer}` |
| 入口 | `papercard.write` | `{doc_id, card, missing_fields[]}` |
| 结果 | `number.bind` | `{cell_id, statement_id, value, run_id}` |
| 结果 | `robustness.disclose` | `{plan_item, status, reason, alternative_explanation_target}` |

> **`design.confirmed` 是门禁的唯一真源**：它不是 UI 状态，而是日志事件。执行器在读取任何数据文件前必须先校验该事件存在且 `design_hash` 与当前设计一致——这样即使有人绕过 UI，门禁依然成立。

**校验规则（框架一致性的第一道可验证关口）**：

```ts
// 两端共同 import 同一份常量表
export const SESSION_EVENT_TYPES: ReadonlySet<string> = new Set([...DST_EVENTS, ...PRODUCT_EVENTS]);

// 13 个阶段 ID：资源入库（前置）+ 命题/文献/设计/门禁 + 七步实证 + 写作
export const STAGE_IDS = [
  'corpus-intake',      // 资源入库（前置）
  'question-scoping',   // 命题解析
  'evidence-mapping',   // 文献检索匹配
  'design-authoring',   // 实验设计
  'design-gate',        // 设计确认门（★门禁）
  'data-prep',          // ① 数据清洗
  'descriptive',        // ② 描述统计
  'baseline',           // ③ 基准回归
  'robustness',         // ④ 稳健性检验
  'endogeneity',        // ⑤ 内生性分析
  'heterogeneity',      // ⑥ 异质性分析
  'mechanism',          // ⑦ 机制分析
  'paper-drafting',     // 论文撰写
] as const;

// 七步实证的步骤 ID（stage_id 的子集，供流水线使用）
export const PIPELINE_STEP_IDS = [
  'data-prep', 'descriptive', 'baseline', 'robustness',
  'endogeneity', 'heterogeneity', 'mechanism',
] as const;

// 多 Agent 节点（与 §2.2 的 8 个 Agent 对应）
export const AGENT_IDS = [
  'supervisor', 'rq-agent', 'lit-agent', 'design-agent', 'empirics-agent',
  'data-agent', 'model-agent', 'interp-agent', 'writing-agent', 'reviewer-agent',
] as const;
```

- 事件名一律 `lower.kebab` 单层命名空间；
- `stage_id` 取值只能是 `STAGE_IDS` 成员（类型层面用字面量联合强制）；
- 读路径遇到表外类型：**拒绝解释**，除非 `ignorable === true`。
  > 证据：`dsh-session/lib/types/known-event-types.js:7-20`（拒绝理由："静默跳过一个必需事件会重建出一个错误的会话"）

---

## 6. turn / step 状态机

### 6.1 语义对照

| 维度 | turn | step |
|---|---|---|
| 事件 | `turn/start` / `turn/end` | `step/start` / `step/end` |
| 语义 | **用户可感知的交互单元**，可含多个模型往返 | **一次"模型请求 + 其工具执行"** |
| 边界输入 | 一条排队 prompt **加上**全部 next-step 输入 | 只领 next-step 输入 |

### 6.2 五条必须照抄的判定规则

| # | 规则 | 证据 |
|---|---|---|
| 1 | `turn/end` 在 `finally` 中**恰好追加一次**，任何路径（完成/失败/取消）都闭合 | `dsh-agent-loop/lib/index.js:1025-1034` |
| 2 | `turn/end.reason` 是闭合联合 `completed \| blocked \| aborted \| error \| max-tokens`（另有恢复合成的 `interrupted \| forked`） | `:963-966`、`:1153`、`:1155`、`:1008-1016`、`:1017-1024`、`:1151`；`dsh-session/lib/types/repair.js:187-189` |
| 3 | **step 准入三门**：`agent/pre-step` 不拒绝、非首步时消息非空、首步消息为空则直接以 `completed` 收尾且**不开 step** | `:958-966` |
| 4 | **一旦出现 `max-tokens`，不被后续 step 结果覆盖**（唯一一处 reason 优先级逻辑） | `:979` |
| 5 | 关闭 turn 前先跑 `agent/turn-stopping`（**serial**），监听器可借 steer 让轮次继续 | `:998-1005` |

### 6.3 本产品对阶段的映射

| 概念 | 映射 |
|---|---|
| **Stage** | 跨越多个 **turn** 的长生命周期（用户会追问、会纠偏、会离开再回来） |
| **StageRun** | 一次 `stage.enter` → `stage.exit` 的区间记录 |
| **Step** | 阶段内的最小可观测工作单位（一次模型请求 + 工具） |
| **Gate** | 在 `agent/pre-step` 里判断，不满足则 `reject` + `gate.blocked` |

> **设计要点**：阶段不是 turn。用户在 S2 阶段里问了 5 个问题、纠偏 2 次，这可能是 8 个 turn，但只有一个 `stage.run_no = 1`。把阶段做成 turn 会导致"每问一句就换阶段"的荒谬行为。

---

## 7. 工具注册与执行管线

### 7.1 工具定义形状（照抄 `defineTool`）

```ts
type ToolDefinition<A, R> = {
  name: string;                          // 模型可见名
  description: string;
  parameters: Record<string, ParamSpec>; // 统一 schema DSL，自动生成 JSON Schema
  output: { schema: JsonSchema; render: (args: A, value: R) => ContentBlock[] };
  execute: (args: A, exec: ToolExecContext) => Promise<R>;
  isConcurrencySafe?: (args: A) => boolean;   // ★ 并行安全的唯一判据
  timeout?: number;                            // 协作式超时
  presentAs?: 'native' | 'ptc' | 'both';       // 呈现模式
};
```

**【DSH】** 参数在 `execute` **之前**校验；非法输入变成**普通错误结果**，**不结束轮次**。

> 证据：`dsh-tools/README.zh.md:32`；`dsh-tools/lib/index.js:3057-3065`

### 7.2 管线固定顺序

```
tool/call
  → 参数校验（JSON Schema）
  → tools/pre-execute          ← 可改写/短路（waterfall）
  → 权限 guard：allow / deny / ask
  → [ask → 审批 → approval/asked · approval/decided]
  → tools/execute              ← 唯一能替换 AbortSignal 的阶段
  → tools/post-execute         ← waterfall
  → 结果截断 / spill / presentation 组装
  → 工具状态快照
  → tool/result
```

> 证据：`dsh-tools/README.zh.md:12`；`dsh-tools/lib/index.js:3225`、`:3331`、`:3504`

### 7.3 并发规则（一元 fail-closed 分类）

| 规则 | 说明 |
|---|---|
| 并行安全的判据 | **只有** `isConcurrencySafe(args) === true` 才是 parallel |
| 其余一律 | **exclusive**（未声明 / 未知名 / 抛异常 → fail-closed） |
| exclusive | **自成排序屏障**（它运行时不允许别的工具并行） |
| `maxParallelToolCalls` | 默认 **10**；**只约束 parallel 调用**；在**下一个工具组开始时**读取 |
| 结果提交顺序 | **严格按模型顺序**，与完成顺序无关 |

> 证据：`dsh-tools/lib/index.js:3057-3065`；`dsh-agent-loop/lib/index.js:521-530`、`:553`、`:565-576`、`:1285`
> **UI 含义**：工具卡片**不能按完成时间排序**，否则与模型看到的历史不一致，用户会困惑。

**本产品的工具并发分类表**：

| 工具 | 分类 | 理由 |
|---|---|---|
| `corpus_status` `corpus_read` `chunk_get` `dataset_profile` | **parallel** | 只读 |
| `search` `probe` `gap_analyze` `papercard_get` | **parallel** | 只读检索/分析 |
| `citation_verify` `precheck_run` `design_gate_check` `style_extract` `quality_gate` | **parallel** | 纯校验 / 纯函数 |
| `corpus_ingest` `corpus_health` | **exclusive** | 长任务 / 写索引 |
| `design_write` `artifact_write` `section_map_write` | **exclusive** | 写产物，需排序 |
| `stage_enter` `stage_exit` `design_confirm` | **exclusive** | 改阶段/门禁状态（**门禁必须串行**） |
| `engine_plan` `engine_run` `numbers_register` `chart_create` | **exclusive** | 独占计算资源 / 写结果登记表 |
| `interpret_build` `draft_section` | **exclusive** | 流式生成 + 写产物 |
| `refusal_raise` `decision_record` `todo_write` `present_deliverable` | **exclusive** | 追加台账 / 交接动作 |
| `ask_user` | **exclusive** | 阻塞等用户 |

> **分类规则**：只有显式声明 `isConcurrencySafe(args) === true` 才是 `parallel`；其余（未声明 / 未知名 / 抛异常）**一律 exclusive**（一元 fail-closed）。
> 上表覆盖 §5.4 的全部 30 个工具（`stage_enter` / `stage_exit` 与 `refusal_raise` / `ask_user` 各合并为一行）。`vector_search` **不是独立工具**——向量检索是 `search` 的一个内部模式（由 `Retriever.fuse()` 统一融合）。

### 7.4 Demo 的工具集（28 个）

> 阶段列用新阶段 ID（见 §5.3 的 `STAGE_IDS`）；`全` = 任意阶段可调用。

| # | 工具 | 阶段 | 真实/模板 | 说明 |
|---|---|---|---|---|
| 1 | `corpus_status` | 全 | 真实 | 语料/数据集清单 + 索引就绪状态 + 降级项 |
| 2 | `corpus_ingest` | `corpus-intake` | 真实 | 批量入库（长任务，返回 jobId） |
| 3 | `corpus_health` | `corpus-intake` | 真实 | 逐篇体检报告 |
| 4 | `corpus_read` | 全 | 真实 | 读原页文本 + 诊断 |
| 5 | `chunk_get` | 全 | 真实 | 按 `chunk_id` 取块（含 page/bbox/char_range） |
| 6 | `dataset_profile` | `corpus-intake` `data-prep` | 真实 | 数据文件剖析：行/列/类型/缺失/面板结构识别 |
| 7 | `search` | `question-scoping`→`paper-drafting` | 真实 | BM25 + 向量 + RRF 混合检索 |
| 8 | `probe` | `question-scoping` | 真实 | 三类探针（主题/方法/分歧覆盖度） |
| 9 | `papercard_get` | `evidence-mapping` / 入口 | **模板 + 可选 LLM** | 结构化抽取；抽不到留空标"未抽到" |
| 10 | `gap_analyze` | `evidence-mapping` | 真实 | 缺口分析（每章 `ok/thin/none`，`none` 不许静默） |
| 11 | `design_write` | `design-authoring` | 真实 | 写实验设计七分区（可手改，留痕） |
| 12 | `precheck_run` | `design-authoring` | 真实 | 识别策略前置检查清单逐项 `pass/fail/unknown` |
| 13 | `design_gate_check` | `design-gate` | 真实 | **门禁校验**：`DataStructureCard` 必填齐 + 无未处置 fail |
| 14 | `design_confirm` | `design-gate` | 真实 | 写 `design.confirmed`（**唯一解锁执行的动作**） |
| 15 | `artifact_write` | 全 | 真实 | 追加写 + 内容哈希 |
| 16 | `stage_enter` / `stage_exit` | 全 | 真实 | 阶段状态机（走 gate 检查） |
| 17 | `engine_plan` | 各实证步 | 真实 | 执行前告知耗时/内存/是否快通道 |
| 18 | `engine_run` | 各实证步 | 真实 | Pyodide 执行；产出 stdout/stderr/结果表/图 |
| 19 | `chart_create` | `descriptive`→`mechanism` | 真实 | 系数图/事件研究图/设定曲线（ECharts 或 Vega-Lite 择一） |
| 20 | `numbers_register` | 各实证步 | 真实 | 把结果表每个数字登记为 `cell_id`（`NumberInventory`） |
| 21 | `interpret_build` | 各实证步 | **规则（必做）+ 可选 LLM 润色** | 规则先出结构化结论，LLM 只负责措辞 |
| 22 | `citation_verify` | `paper-drafting` | 真实 | **四查**：chunk 存在 / 支持强度 / 数字绑定 / 措辞强度 |
| 23 | `style_extract` | `paper-drafting` | 真实 | 提取风格画像（默认《中国工业经济》包 / 用户参考文献） |
| 24 | `draft_section` | `paper-drafting` | **模板组装 + LLM** | **逐段**生成（禁止一次吐全文） |
| 25 | `quality_gate` | 全 | 真实 | Reviewer 四门校验（数值/措辞/引用/披露） |
| 26 | `present_deliverable` | 导出 | 真实 | 声明最终交付物（触发 `deliverables/presented`） |
| 27 | `todo_write` | 全 | 真实 | 待办清单（投影） |
| 28 | `refusal_raise` / `ask_user` | 全 | 真实 | 拒答（含拒答码）/ 结构化提问（模板提供选项） |

> 表内 28 行 = 30 个工具（第 16、28 行各合写两个）。
> **新增工具相对 v1.0 的 5 个关键项**：`dataset_profile`（数据剖析）、`precheck_run`（识别策略检查）、`design_confirm`（门禁解锁）、`numbers_register`（数字登记）、`quality_gate`（质量门）。

> **诚实标注**：`papercard_get`、`interpret_build`、`draft_section` 的 `model_mode` 必须如实写入产物的 `provenance`（`rule` / `template` / `rule+llm` / `byok`）。学生与导师可以筛出"哪些内容不是模型生成的"。

---

## 8. 请求构造不变量与模型路由

### 8.1 "模型可见 ⟺ 已记录"

> **任何进入模型请求的内容，必须能从日志重建。**

约束三件事：

1. **无隐藏注入**——时间上下文、指令、审批策略都必须表现为**持久 message 事件**；
2. **请求是日志的纯函数**；
3. **请求对象深度冻结**（只有取消信号可变）。

> 证据：`dsh-llm/README.zh.md:114`、`dsh-session/README.zh.md:88`、`dsh-agent-loop/lib/index.js:1261-1276`

### 8.2 请求对象的精确形状

```js
{
  ...header.config,           // provider, model, reasoningEffort?, temperature?, maxTokens?
  messages: deriveMessages(), // 从日志派生，深度冻结
  toolHistory: session.toolHistory(),
  ...(header.tools ? { tools: header.tools } : {}),
  sessionId,
  signal
}
```

**【DSH】没有 `system` 字段**——渲染后的系统提示词是 `system/message` **surface 节点**，不是 header 状态。

> 证据：`dsh-agent-loop/lib/index.js:1269-1276`

### 8.3 三条 header 记录线

| 事件 | 规范形 | 写入时机 |
|---|---|---|
| `request/header` | `{config, adapterDefaults?, tools?}`（**空工具列表规范化为字段缺席**） | reason = `initial`（本实例首次）/ `resume`（基线存在）/ `change`（header 变化）/ `series`（header 未变但开启新序列） |
| `request/context` | `{provider, model, contextWindow?, systemPromptUpdate?}` | **仅当某项与最新快照不同时**追加 |
| `developer/message` | 工具增删 | 仅在有添加块时带 `headerSeq` |

**"是否需要记录"的判定是字段级相等**：逐项比 `config`、`adapterDefaults` 两个布尔位、以及**按顺序**比较工具 schema（`JSON.stringify`）。

> 证据：`dsh-session/lib/types/request-header.js:17-26`、`:37-45`；`dsh-agent-loop/lib/index.js:1213-1228`

> **这一条不变量就是"可核查"在内核里的落点。** 用户能在轨迹面板看到"这一步到底发了什么"，因为模型看到的一切都必须先被记下来。

### 8.4 会话级模型选择

```ts
export function installModelSelection(agentCtx, selection) {
  // ① system-prompt/assemble：快照选中模型，写入 provider/model 变量
  // ② agent/request：用快照覆盖 provider/model/reasoningEffort（只作用于后续 step）
  // ③ agent/pre-step：若与最新 request/header 的 config 路由不同，追加一条模型切换通知
}
```

**四条照抄语义**：

| # | 语义 | 理由 |
|---|---|---|
| 1 | 在 `system-prompt/assemble` **快照**选中模型 | 并发切换只影响**后续** step，不会把一个请求劈成两个 surfaces |
| 2 | 显式 effort 缺席时**清除**继承的 effort | 恢复选中模型自身的默认行为，而不是继承上一个模型的设置 |
| 3 | provider/model 变化**追加一条持久 user-role 通知** | 「以上内容由 A 生成；会话继续使用 B」——对论文场景是可解释性资产 |
| 4 | **仅 effort 变化不追加通知**；失败在 header 持久化之前则在下次请求重复通知 | 避免噪声；保证不漏 |

**切换模型时请求序列继续**（`provider or model swap alone continues the series`）。

> 证据：`dsh-agent/lib/types/model-selection.js:12-26`、`:45-94`；`dsh-agent-loop/README.zh.md:121`

---

## 9. 配置面：Provider / 凭据 / 模型目录

### 9.1 两套注册表分离（Demo 最值得复刻的架构点）

**【DSH】** `registerAdapter(routes, adapter)`（**能发请求的路由**）与 `registerConfigurableProviders(entries)`（**配置界面能编辑的路由**）是两套注册表。支持**零路由裸挂载**（休眠姿态），用户写配置后经 `loader/volatile-update` → `registration.replace(routes)` **原子激活**，**全程不重启**。

> 证据：`dsh-llm/lib/types/index.js:278`、`:371`；`cordis-plugin-loader/lib/index.js:259-287`、`:380-382`

**产品含义**：出厂时**没有任何可用路由**是合法状态。UI 必须能优雅处理"零路由"（引导用户配置第一个 provider），而不是崩溃或显示空白 Select。

### 9.2 `ProviderProfile`（Demo 版）

```ts
type ProviderProfile = {
  id: string;              // ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$
  displayName: string;
  protocol: 'openai-chat';
  baseURL: string;         // http(s)，不含凭据/查询/fragment
  credentialRef: string;   // 默认派生 `${ID.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}_API_KEY`
  models: ModelEntry[];
  defaultContextWindow: number;   // 262144
  defaultMaxTokens: number;       // 32768
  compat: {
    thinkingFormat: 'deepseek' | 'openai' | 'qwen' | 'chat-template';
    maxTokensField: 'max_completion_tokens' | 'max_tokens';
    supportsReasoningEffort: boolean;
    supportsUsageInStreaming: boolean;
  };
  retry: { maxRetries: number; retryableCodes: string[] };
  error?: string;
};

type ModelEntry = {
  id: string; name?: string;
  contextWindow?: number; maxTokens?: number;
  reasoningEfforts?: false | Record<string, string | null>;  // 键=等级，值=线上拼写
};
```

**字段来源与处置**（DSH `pi-ai` 的 `providers[route]` profile → Demo）：

| DSH 字段 | 处置 | 理由 |
|---|---|---|
| `id`（路由名） | **保留**（含文法校验） | 必须是合法 credential ref 词干，否则引用派生失败 |
| `displayName` | **保留** | 选择器分组标题 |
| `api`（3 协议） | **改写**为 `'openai-chat'` | Demo 只实现 OpenAI 兼容 |
| `baseURL` | **保留** | — |
| `apiKeyEnv` | **改写**为 `credentialRef` | 浏览器没有环境变量通道 |
| `models[]` / `modelOverrides` | **保留** / **砍掉** | Demo 无内置目录可覆盖 |
| `compat`（25+ 开关） | **砍到 4 个** | 只留 OpenAI 兼容中转站最常需要的 |
| `defaultContextWindow/MaxTokens/Input` | **保留** | 未描述模型的回退语义 |
| `headers` | **砍掉** | DSH 自述它能携带 redactor 看不到的凭据 → 安全隐患 |
| `reasoning` / `thinkingBudgets` / `cacheRetention` / `transport` | **砍掉**（transport 只保留 sse） | 高级旋钮，Demo 不需要 |
| `timeoutMs` / `streamIdleTimeoutMs` / websocket 相关 | **改写**为单一 `requestTimeoutMs`（默认 300000） | 简化 |
| 图片预算字段 | **砍掉** | Demo 不做多模态 |
| `retryPolicy` | **改写**为 `{maxRetries, retryableCodes}` | 简化 |
| `error` | **保留** | 配置页展示诊断 |

> 证据：`dsh-llm-pi-ai/lib/index.js:1017-1049`（profile）、`:1002-1016`（model）、`:963-990` + `:306-328`（compat）、`:45508-45760`（`modelFields`）、`:802-806`（协议表）

### 9.3 DSH 的 OpenAI 兼容通道是现成的

**【DSH】** `dsh-llm-pi-ai` 的协议表只有三条：

```
openai-completions | openai-responses | anthropic-messages
```

自定义中转站 / 自托管服务走 **`openai-completions`**，全部可配（`baseURL` / `apiKeyEnv` / `models[]` / `compat.thinkingFormat`）。

> 证据：`dsh-llm-pi-ai/lib/index.js:802-806`

**两个必须知道的坑**：

1. DSH 本版本内置的 `openai` **目录路由**走的是 **Responses 协议**而非 Chat Completions。要 chat 语义必须显式声明 `api: openai-completions`。
2. pi-ai 通道**拒收 `stop` 参数**（`UNSUPPORTED_OPTION`），且**不暴露稳定 HTTP 状态**（错误只能靠文本分类器）。

> 证据：`dsh-llm-pi-ai/lib/index.js:1848`

### 9.4 凭据链路

**【DSH】** 配置里**只有引用名，绝无密钥值**；UI **只写不读**：

| 操作 | 契约 |
|---|---|
| `describe(ref)` | 返回 `{configured, source?, writable}`，**永不返回值** |
| `set(ref, value)` | 写入 |
| `unset(ref)` | 移除（不存在时为 no-op） |
| 脱敏 | **结构化**：schema 上 `role('secret')` 的节点在跨 wire 前**整段删除** + 侧车 `secrets: [{path, set}]` 供 UI 渲染只写输入框 |
| 密钥轮换 | **下一次请求即生效**，无需重启或改配置 |

> 证据：`dsh-credentials/README.zh.md:12`、`:54-61`、`:177`；`dsh-settings/lib/types/redact.js:73-83`；`dsh-api-settings-controller/lib/types/credentials.js:50-55`

**Demo 的差异化（比 DSH 更严）**：

| 项 | DSH 做法（如实报告） | Demo 做法 |
|---|---|---|
| 存储位置 | `~/.dsh/.credentials.yaml` | **`sessionStorage`（默认，刷新即失效）**；`localStorage` 仅作为用户**显式勾选**的"记住密钥"（默认关闭） |
| 存储格式 | **明文 YAML**，无加密、无 OS keyring | 明文（诚实告知），但**不落** IndexedDB/OPFS/Cookie/SW Cache |
| 权限 | 仅属主可读（**Windows 跳过检查**） | 不适用（同源） |
| 环境变量层 | 只读、优先级最高 | **砍掉**（浏览器没有） |
| 对 agent 隔离 | **明确承认做不到**（同 UID） | 同源脚本可用 → **UI 明示** + 建议用限额密钥 |
| 日志/回显 | `describe()` 永不返回值；报错点名 ref 但不含密钥 | **同**（且错误信息不含密钥的任何字符，含前缀/长度/指纹） |
| 导出/日志 | `redactSecrets` + 侧车 | 导出前跑同一个纯函数 |

> 证据：`dsh-credentials-local/README.zh.md:44-45`、`:84-111`、`:113-115`、`:162-165`；`dsh-llm-pi-ai/README.zh.md:222`

### 9.5 模型目录契约

```ts
type ModelCatalogEntry = {           // listModels() 条目
  provider: string; id: string; name: string; description?: string;
  inputModalities: ('text')[];
};

type ResolvedModelInfo = ModelCatalogEntry & {   // resolveModel() 结果
  contextWindow: number; defaultMaxTokens: number;
  reasoning?: { efforts: {id,name,description?}[]; defaultEffort?: string };
};
```

**送到 UI 的选择器契约（建议原样复刻）**：

```ts
type ModelCatalog = {
  default: { provider: string; model: string; reasoningEffort?: string };
  routableProviders: string[];
  groups: [{ id: string; name: string;
             models: [{ id, name, description?, reasoning?: { efforts, defaultEffort? } }] }];
  failures: [{ id: string; name: string; message: string }];
};
```

**四条照抄的 UI 规则**：

1. **单个 provider 失败被隔离为一行 `failure`，不拖垮整个目录**；
2. **空模型的分组被过滤**；
3. **目录成员资格是硬闸门**：`selectModel` → `requireModel` → 严格 `listModels().some(id)`，失败抛 `session/model-unavailable` + **composer 停用**；
4. **⛔ 本产品不采纳 DSH 的宽松提交路径**：DSH 允许"已保存过的选择即使条目消失仍可发送"，我们**阻断发送**并给出可操作横幅。理由：静默用目录外的模型发起请求，对研究场景不可接受（会产生无法解释的失败或错误模型输出，而"可核查"要求推理主体明确）。**这是刻意的产品差异，已记入 §15 与迁移清单。**

> ⚠️ **一个反直觉的事实**：DSH 送到浏览器的目录里**没有 `contextWindow` / `inputModalities`**，只有 `id/name/description/reasoning`。所以选择器**不显示上下文窗口**。Demo 若要显示，需要额外投影（这是 E2 用例的检查点）。
> 证据：`dsh-api-session-controller/lib/types/catalog.js:29-34`、`:52-59`；`lib/typert.host.js:579-608`

### 9.6 调用参数面

| 字段 | 处置 | 说明 |
|---|---|---|
| `provider` / `model` | **保留** | — |
| `reasoningEffort` | **保留** | 透传为 `reasoning_effort` 或 profile 的 `thinkingFormat` 拼写 |
| `temperature` | **保留** | — |
| `maxTokens` | **保留** | 映射 `max_tokens` / `max_completion_tokens`，由 `compat.maxTokensField` 决定 |
| `stop` | **砍掉** | DSH 的 pi-ai 通道本身就拒绝它 |
| `adapterDefaults: {reasoningEffort?, maxTokens?}` | **保留** | 区分"用户设的"与"适配器填的"，重新解析时才不会把默认值固化成显式设置 |

**校验规则**：显式的 `reasoningEffort` 在**任何 provider I/O 之前**对照该模型的能力集校验，**不 clamp**（不在集合里就报 `UNSUPPORTED_REASONING_EFFORT`）。

> 证据：`dsh-llm/lib/types/call-config.js:18-28`；`dsh-llm/lib/types/index.js:740-747`

### 9.7 模型发现

```
GET {baseURL}/models
Headers: Authorization: Bearer <key>

解析：优先 data 数组；否则 models 对象（键 = 请求用 id）
归一化（照抄 DSH 解析器）：
  name          ← name ?? display_name ?? displayName ?? id
  contextWindow ← contextWindow ?? context_window ?? context_length ?? max_input_tokens ?? limit.context
  maxTokens     ← maxOutputTokens ?? max_output_tokens ?? maxTokens ?? max_tokens ?? limit.output
                  ?? top_provider.max_completion_tokens
  缺 id 的条目跳过        ← 一行坏数据不该毁掉整个端点
上限：响应 4 MiB；非 2xx → 带状态码的错误（401/403 追加"检查 API Key"）
纪律：发现结果只做候选，用户点"添加所选"才写入配置
```

> 证据：`dsh-llm-pi-ai/lib/index.js:2140-2262`、`:2286-2336`

### 9.8 错误映射（Demo 版）

| 场景 | 稳定 code | 判定时机 / 方式 | 用户可见文案 |
|---|---|---|---|
| 未配置密钥 | `MISSING_CREDENTIAL` | **不发请求**，本地判定 | 「路由 X 没有凭据：请在设置里保存 `<REF>`」 |
| 密钥非法字符/空白 | `INVALID_CREDENTIAL` | 本地判定（空白或非 `[\x21-\x7E]`） | 「API 密钥为空白或含 HTTP 头无法携带的字符；请只粘贴原始密钥」 |
| 400 + 上下文超限 | `CONTEXT_WINDOW_EXCEEDED` | 复用 DSH 的 5 组正则 | 「请求超出模型上下文窗口」 |
| 401 / 403 | `AUTH` | 状态码 | 「鉴权失败（401/403）：检查 API 密钥」 |
| 429 | `RATE_LIMIT` | 状态码，**可重试** | 「触发速率限制，正在重试…」 |
| 402 / 余额不足 | `QUOTA` | 状态码 + 文本分类 | 「额度或余额不足」 |
| 5xx | `SERVER` | 状态码，**可重试** | 「提供方服务器错误」 |
| fetch 抛错 | `TRANSPORT` | 网络层异常 | 「无法连接到 `<baseURL>`」 |
| 用户取消 | `ABORTED` | AbortController | 「已取消」 |
| 模型不在路由配置里 | `UNKNOWN_MODEL` | **网络 I/O 之前** | 「该路由未配置模型 `<id>`」 |
| effort 不在公布集合 | `UNSUPPORTED_REASONING_EFFORT` | **网络 I/O 之前**，不 clamp | 「模型 `<id>` 不支持推理等级 `<x>`」 |
| 提交时模型不在目录 | `session/model-unavailable` | 本地判定 | 「请先选择一个可用模型」（composer 停用） |
| 目录/发现失败 | `DISCOVERY_FAILED` / `DISCOVERY_UNSUPPORTED` | — | 「无法读取端点模型列表（HTTP n）」/「该协议不支持自动发现，请手工填写」 |

**可直接复刻的正则分类器**（纯文本、零依赖）：

```
isContextWindowExceededError  →  dsh-llm/lib/types/error.js:46-82
isQuotaExceededError          →  同上
默认可重试集合                 →  EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT
                                 最多 5 次，500ms→10s，抖动 0.1
```

> 证据：`dsh-llm/lib/types/error.js:13`、`:22-81`；`dsh-llm/lib/types/retry-policy.js:12-22`

### 9.9 与 DeepSeek 官方通道共存

| 维度 | DeepSeek 官方（预置，不可删） | OpenAI 兼容（用户自建） |
|---|---|---|
| 路由名 | `deepseek-official` | 用户自定义 |
| 端点 | `https://api.deepseek.com/v1`（可改） | 用户输入 |
| 凭据引用 | `DEEPSEEK_API_KEY` | 派生 `<ROUTE>_API_KEY` |
| 模型目录 | 预置 | `GET /models` 发现或手工填写 |
| 选择器排序 | **第一** | 保持目录顺序 |

**共存实现五要点**：

1. 单一 registry `Map<route, adapter>`，重复注册抛 `DUPLICATE_ADAPTER`；
2. 单一目录 = 预置路由 ∪ 用户声明路由（用户路由带 `declared: true`，用于"不可删除预置路由"的 UI 规则）；
3. 选择器分组顺序：**DeepSeek 第一**；
4. 一个 `adaptersVersion` 计数器，任何拓扑变化 +1，UI 订阅后重拉目录（等价于 `llm/adapters-updated`）；
5. **预置路由与自定义路由走同一套凭据存储**，只按引用区分——**不给预置通道开硬编码密钥的后门**。

---

## 10. 取消、失败与恢复

### 10.1 协作式取消

| 契约 | 细节 |
|---|---|
| `cancel()` 默认行为 | **持久地**清空收件箱（`outcome: 'canceled'`）+ 中止当前活动 |
| 被取消的流 | 以 `interrupted: true` 的 `assistant/message` 终结**已交付前缀** |
| 效果 | 使**下一次请求包含用户已经看到的内容** |
| `keepInbox` | 可选保留待处理输入 |

> 证据：`dsh-agent-loop/lib/index.js:815-821`、`:1084-1100`

**产品含义**：用户点"停止"，**已经写出来的半句话不会凭空消失**，也不会在下一轮被模型"忘记"。半段草稿是用户的资产。

### 10.2 三种补记码

| 情形 | 补记 | 结果文本 |
|---|---|---|
| 取消阻止了分发 | `ABORTED_BEFORE_DISPATCH` | `Error: tool call aborted before dispatch` |
| 有 call 记录但无结果 | `TOOL_OUTCOME_UNKNOWN` | 「其结果未知」+ 只允许只读或幂等操作重试 |
| 请求无 call 记录 | `TOOL_NOT_STARTED` | 「在记录为已开始之前就被中断。如仍需要请重试。」 |

> 证据：`dsh-agent-loop/lib/index.js:663-679`；`dsh-session/lib/types/repair.js:11-24`

### 10.3 崩溃恢复

**【DSH】** `resume` 先 `persistence.open(id,'write')`（排除并发 resume 同一 id），读取物理有效日志，为中途崩溃的日志追加 `interruptedTurnClosers`（作为普通批次）。**语义修复是 agent 层的活，不是存储入口的活。**

> 证据：`dsh-agent-loop/README.zh.md:115`

**【本产品新增】浏览器版的恢复纪律**（只多两条）：

1. Worker 死亡 / 页面卸载 → 等价于"进程死亡"。恢复靠**持久化的任务快照**；
2. **默认不自动续跑**，要求用户**显式确认**（照抄 goal 的 `armed`/`disarmed` 纪律）。

> 理由：研究型长任务重跑代价高（OCR 可能几十分钟）。刷新后自动复活并重新消耗配额，是比"不自动续跑"严重得多的错误。
> 证据（DSH 同源纪律）：`dsh-goal/README.zh.md:57`、`:72`

### 10.4 【DSH·值得复刻】goal round driver 的"先预留，后准入"

这是本产品**最该 1:1 复刻的一个进度机制**，因为它同时修掉研究型长任务的三个真实故障：

| 故障 | 机制如何修 |
|---|---|
| **进度数字虚高** | idle 时**预留** `roundsStarted + 1`，但**只有真正进入步骤的 `user/message` 才增加计数**；因陈旧被拒绝的预留**不消耗编号** |
| **中断后不可续** | 进度以"已准入的单元"为单位**持久化在日志里**，天然可回放 |
| **刷新即自动复活**导致重复消耗 | 进程本地 `armed`/`disarmed` 标志 + 显式 resume |

**配套三条**：

1. `agent/pre-step` 监听器在**下游监听器前后双次校验**完整已领取记录与当前目标，使陈旧/已取消/竞争中的提示词**在其步骤进入前**被拒绝；
2. 排队工作前等 `flush()`，完成后**重新检查 revision**；
3. 额度耗尽以稳定代码 `round-limit` 记 blocker；`pause/complete/block/clear` 一律停用续行。

> 证据：`dsh-goal-round-driver/README.zh.md:53`、`:71`、`:72`、`:73`；`dsh-goal/README.zh.md:57`、`:72`

> **只需两个字段（`roundsStarted`、`maxGoalRounds`）和一个进程本地标志**，是纯前端最容易落地的机制。

### 10.5 错误码体系（完整）

```
NO_ADAPTER | MISSING_CREDENTIAL | INVALID_CREDENTIAL | AUTH | RATE_LIMIT | SERVER
TRANSPORT | TIMEOUT | EMPTY_RESPONSE | CONTEXT_WINDOW_EXCEEDED | QUOTA | ACCOUNT_QUOTA
TOOL_TIMEOUT | UNKNOWN_TOOL | ABORTED | ABORTED_BEFORE_DISPATCH
TOOL_OUTCOME_UNKNOWN | TOOL_NOT_STARTED
```

**纪律**：消费者**按 code 路由，绝不解析 message 文本**。

> 证据：`dsh-llm/lib/types/error.js:13`

---

## 11. 扩展点（钩子）

### 11.1 三种分发模式

| 模式 | 语义 | 例子 |
|---|---|---|
| `emit` | 非否决、逐监听器隔离、不等 | 遥测 |
| `serial` | 顺序等待 | `agent/turn-stopping` |
| `waterfall` | 洋葱、可改写/短路 | `agent/pre-step`、`agent/request`、`tools/*` |

> 证据：`dsh-agent/types/dispatch.js:44-72`

### 11.2 本产品的钩子落点

| 钩子 | 模式 | 用途 | 产出事件 |
|---|---|---|---|
| `agent/pre-step` | waterfall | **阶段门检查**：S3 未填齐 `DataStructureCard` → `reject`；注入阶段指令 | `gate.blocked` |
| `agent/request` | waterfall | 模型路由覆盖（会话级选择） | — |
| `system-prompt/assemble` | waterfall | 注入当前阶段、产物清单、工具说明、变量 | — |
| `tools/pre-execute` | waterfall | 引用强制校验；写操作鉴权 | `citation.check` |
| `tools/post-execute` | waterfall | 结果截断 / presentation | — |
| `agent/turn-stopping` | **serial** | 判"该阶段是否可让用户确认了" | — |
| `agent/request-error` | waterfall | 返回 `{kind:'retry'}` 触发重试 | `llm/retry` |

### 11.3 提示词分段顺序（要同构就得同样有序）

**【DSH】** 系统提示词按固定顺序装配（persona → 指令 → 技能 → 工具说明 → 运行时上下文）。前端要同构，顺序必须一致——否则同一份日志在两端派生出的请求不同，"框架一致"就不成立。

> 证据：`dsh-agent-loop/lib/index.js`（`system-prompt/assemble` 瀑布）、`dsh-system-prompt`、`dsh-agent-instructions`

---

## 12. 投影（Projection）：日志 → 读模型的唯一许可通道

### 12.1 投影单元契约

```ts
type ProjectionDefinition<S> = {
  key: string;                                  // 投影名
  stateVersion: number;                         // 状态形状版本
  init(header: SessionHeader, inheritedEventCount: number): S;
  apply(state: S, event: SessionEvent): S;      // ★ 必须同步、必须纯
  wire?: (state: S) => JsonValue;               // ★ 必须是同步的完整 JSON
};
```

### 12.2 五条铁律（照抄）

| # | 铁律 | 后果 |
|---|---|---|
| 1 | `apply` **必须同步** | 任何 async 都会破坏折叠的一致性 |
| 2 | **无关事件必须返回同一状态引用** | 否则造成无意义的界面重渲染（性能杀手） |
| 3 | **携带状态的事件必须携带完整状态，绝不携带裸增量** | UI 不需要自己合并增量 |
| 4 | `wire` 值必须是**同步**完整 JSON | 可跨线程/跨 wire 传输 |
| 5 | 读一致切面用 `snapshot()` → `{asOfSeq, values}` | **`asOfSeq` = 所有值共同反映到的最后一个事件 seq** |

**第 5 条是本产品"阶段与产物对齐同一历史切面"的官方做法**：阶段面板和证据台账必须反映同一 `asOfSeq` 的状态，否则会出现"阶段说已完成、产物还没出现"的错乱。

**检查点纪律**：检查点必须带 `stateVersion` 与水位，否则**宁可全量重折**——"丢弃任何 `ver` 不匹配或声称越过存储末尾的行"。

**一个坑**：投影单元表是**进程级**的，**key 是否存在不能当作逐会话的能力信号**。前端同样要"读值，不能把 key 缺席当作功能缺席"。

> 证据：`dsh-session-projection/README.zh.md:36-58`、`:83`、`:95`、`:131`、`:133`

### 12.3 Demo 需要的 19 个投影（9 复用 + 10 新增）

| # | 投影 key | 形状 | 渲染位置 |
|---|---|---|---|
| 1 | `turnBoundary` | `{openTurnStartSeq, lastStepStartSeq, lastStepBoundary:{kind,seq}, lastTurn}` | 判断"当前是否有开放轮次" |
| 2 | `inbox` | 待处理输入（由 `agent/inbox/spliced` 折叠） | 输入队列 |
| 3 | `turnOutline` | `Array<{turn, seq, prompt, response}>` | 会话导航（`seq` 是载入目标） |
| 4 | `sessionStats` | `{turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens}` | 底部统计条 |
| 5 | `tokenUsage` | `{uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}` | 用量徽标 |
| 6 | `contextPressure` | `{pressureTokens?, projectedTokens?, contextWindow?}` | 上下文占用条 |
| 7 | `contextBreakdown` | `{systemTokens, toolsTokens, messageTokens}` | 上下文构成明细（**标注为近似**） |
| 8 | `todos` | `Array<{content, status}> \| null` | composer 上方 Todo 卡 |
| 9 | `jobs` | `JobView[]`（结构化进度） | 进度中心 |
| 10 | **`stages`** | `Array<{stage_id, run_no, status, outputs_ids[], entered_at, exited_at}>` | 左侧阶段导航（13 个阶段） |
| 11 | **`graphNodes`** | `Array<{node_id, agent, stage_id, status, duration_ms, retry_no}>` | 多 Agent 执行轨迹（谁在干、干了多久、被打回几次） |
| 12 | **`design`** | `ExperimentDesign` + `confirmed?{hash, at}` | 实验设计页 + 门禁状态 |
| 13 | **`pipeline`** | `Record<PipelineStepId, {status, run_no, artifacts{code,result,interpretation}}>` | 七步流水线看板 |
| 14 | **`artifactGraph`** | 产物 + provenance 边 | 产物树 + 关联同步 |
| 15 | **`citationLedger`** | 每句一行：`{statement_id, ref_id, support, verdict}` | 引用台账面板 |
| 16 | **`qualityReport`** | `QualityReport[]`（四门判定 + 打回理由） | 质量门面板（导师最关心） |
| 17 | **`decisions`** | `DecisionRecord[]`（含 `rejected[]`） | why-trace 抽屉 |
| 18 | **`refusals`** | `RefusalNotice[]` + 处置状态 | 拒答卡 + 台账 |
| 19 | **`numbers`** | `NumberInventory`（每数字一 `cell_id`） | 数字 chip + 结果表面板 |

> 前 9 个字段名与形状**全部照抄 DSH**（`dsh-session-stats/README.zh.md:40-49`、`dsh-session-turn-outline/README.zh.md:42-47`、`dsh-token-meter/README.zh.md:49`）；后 10 个是 **【本产品新增】**。
> **`graphNodes` 与 `qualityReport` 是多 Agent 架构专属**：前者让用户看见"8 个 Agent 里现在是谁在工作、被打回过几次"，后者让用户（和导师）看见"质量门放行了什么、拦下了什么"。
> **本表的订阅源必须与附录 C §7 一一对应**（附录 C §7 把同一份数据按"更新时机 → 渲染位置"重排，两个 `jobs` 流拆成两行）。
> **刻意不做**：`plan` 投影（其 `command/*`、`plan/mode` 事件不在闭合词汇表内，照抄会得到永远折叠不出来的死代码——见附录 C §6.5）。

---

## 13. 子代理（Subagent）：要不要复刻

**【DSH】** `spawn` / `sendMessage` / `listChildren`；owner 关系；"兑现即发布"语义。

**【DSH·简化】** 浏览器无多进程、无跨进程租约（Activation 图不可复刻）。

**前端等价物**：单线程 async 交错的子 agent 注册表，**接口名/事件名照抄**（`spawn`/`sendMessage`/`listChildren` + `subagent/start·end`），保留"兑现即发布"语义。

**本产品的判断**：**Demo 不做子代理**。理由：

1. 研究流程是**串行阶段**，不是可并行的独立子任务；
2. 并行度已经有更好的去处——Worker 池（解析/索引/向量），那是**计算并行**，不是**agent 并行**；
3. 多一个 agent 维度会让"阶段可查"的 UI 复杂度翻倍，而验收价值几乎为零。

**但接口保留**：`SubagentRegistry` 端口留空实现，以便本地 App 侧启用时不改架构。这条要写进主文档 §15 迁移清单。

> 证据：`dsh-subagent/README.zh.md:193`（跨进程 Activation 不可复刻）

---

## 14. 与本地 App 的一致性验收

### 14.1 共享契约包

```
packages/protocol/                 ← Demo 与本地 App 共同 import
  session-event-types.ts           SESSION_EVENT_TYPES + STAGE_IDS
  session-event.ts                 SessionEvent 信封类型
  reduce-session.ts                reduceSession(events) 纯函数
  derive-messages.ts               deriveMessages(log) 纯函数
  projections/*.ts                 ProjectionDefinition 实现（15 个：9 复用 + 6 产品新增）
  tool-definition.ts               defineTool 形状
  ports/*.ts                       8 个端口接口声明
  artifacts/*.ts                   领域产物 schema（附录 B）
  progress.ts                      ProgressEvent 类型（附录 C）
```

### 14.2 一致性验收用例（`T-CONF-*`）

> **分两档，不要混为一谈**：
> - **`M14（Demo 侧门）`**：下表「Demo 可独立」列标 **✅** 的 **8 条**，Demo 团队自己就能跑完，**这是 MVP 门**；
> - **`M14b（双端里程碑门）`**：标 **❌** 的 **4 条**（`T-CONF-03` `06` `09` `10`）需在 Demo 与本地 App adapter 上同时通过，**需本地 App 侧排期**——它们要求 App 侧存在对应实现（3 个产品新增投影、领域产物 schema、共享常量表、共享端口接口），不是 Demo 团队能单方面完成的。
>
> "框架一致"唯一诚实的验收方式仍是双端跑同一套 `describe`；但**不要把它写成 Demo 的交付前提**，否则会变成一个团队无法独立关闭的门。
>
> **判据写法约定**：✅ 行的判据一律写成**单端形式**（Demo 侧对"共享实现 + 基线哈希向量"断言）；"两端等价"归 `M14b`。避免出现「标 ✅ 但判据写'两端'」的自相矛盾。

| ID | 用例 | 判据（Demo 单端形式） | Demo 可独立 |
|---|---|---|---|
| `T-CONF-01` | 事件折叠确定性 | 给定事件序列 → `reduceSession` 结果**逐字节相同**（规范化 JSON 哈希等于基线向量） | ✅ |
| `T-CONF-02` | 消息派生确定性 | 给定日志 → `deriveMessages` 消息数组**逐元素相同**（等于基线向量） | ✅ |
| `T-CONF-03` | 19 个投影各自的 `apply` | 同一序列 → 同一状态哈希。⚠️ **其中 10 个产品新增投影（`stages`/`graphNodes`/`design`/`pipeline`/`artifactGraph`/`citationLedger`/`qualityReport`/`decisions`/`refusals`/`numbers`）的 schema 是本产品特有，App 侧尚无对应实现** → 需双端 | ❌ 需 App 侧 |
| `T-CONF-04` | `apply` 的纯性与引用复用 | 无关事件返回**同一引用**（`Object.is`） | ✅ |
| `T-CONF-05` | `wire()` 同步性 | 返回值不含 Promise / function | ✅ |
| `T-CONF-06` | 事件词汇表 | `SESSION_EVENT_TYPES` 集合**等于基线向量**；与 App 侧集合相等需双端 | ❌ 需 App 侧 |
| `T-CONF-07` | 表外事件 | 读路径拒绝，除非 `ignorable === true` | ✅ |
| `T-CONF-08` | 工具定义可注册 | 同一 `defineTool` 形状在 Demo 注册表校验通过 | ✅ |
| `T-CONF-09` | 端口接口符合性 | Demo adapter 满足共享 TS 接口（编译期）；App adapter 同断言需双端 | ❌ 需 App 侧 |
| `T-CONF-10` | 领域产物 schema | 同一 schema 校验 Demo 侧产物通过。**schema 全为本产品特有，App 侧须先建立同一 schema** → 需双端 | ❌ 需 App 侧 |
| `T-CONF-11` | `snapshot().asOfSeq` 语义 | 等于共同反映到的最后一个事件 seq | ✅ |
| `T-CONF-12` | 崩溃恢复 | 日志尾部有未闭合 turn → 合成 closers，结果等于基线向量 | ✅ |

**统计：8 条 Demo 可独立（`M14`）／4 条必须双端（`M14b`：`T-CONF-03` `06` `09` `10`）。**

### 14.3 显式扩展登记（迁移时必须处置）

| # | 扩展点 | DSH 原状 | 本产品 | 迁移处置 |
|---|---|---|---|---|
| **X1** | 进度事件 | `JobView.progress: string?`，无百分比/阶段/ETA；**全仓无 ETA 概念** | 结构化 `ProgressEvent`（附录 C §2） | **双写或回改**；若严格零扩展，则"剩余时间"降级为不可用状态 |
| **X2** | 阶段状态机 | 无 stage 概念（只有 turn/step） | **13 个阶段 ID**（见 §5.3）+ `stage.*` 3 个事件 + `gate.blocked`（命名上不属 `stage.*` 前缀）+ `stages` 投影 | 本地 App 侧新增同一组事件（**纯增量，不冲突**） |
| **X9** | **多 Agent 编排层** | 单 Agent + `dsh-subagent`（进程内 Activation 图） | **LangGraph 8 Agent 状态图**（§2）：`node.enter/exit`、`agent.handoff`、`review.verdict` 事件 + `graphNodes`/`qualityReport` 投影 | **本地 App 侧可复用同一张状态图**（LangGraph 有 Python 版）；若 App 侧改用 DSH 的 subagent 机制承载，**必须保留"Reviewer 独立把关 + 有界打回循环"语义**，这比换编排库重要 |
| **X3** | 引用粒度 | 引用 chip 是**文件级**，地址无行号 | **行级/块级**：`{doc_id, page, bbox, char_range}` | 本地 App 侧扩展地址 grammar（`dsh-resource://` 三段式 + 新增段） |
| **X4** | 凭据存储 | 明文 YAML `~/.dsh/.credentials.yaml` | **`sessionStorage`（默认，刷新即失效）**；`localStorage` 为用户显式选择的"记住密钥" | 本地 App 用系统钥匙串（接口不变） |
| **X5** | `headers` 配置项 | 支持自由 headers | **砍掉**（安全） | 本地 App 若需要，走独立配置并强制脱敏 |
| **X6** | 子代理 | 完整 Activation 图 | **不做**，仅留端口 | 本地 App 侧启用实现 |
| **X7** | 目录外模型的提交 | **宽松**：已保存的选择即使条目消失仍可发送 | **收紧**：阻断发送 + 可操作横幅（§9.5 规则 4） | 本地 App 若沿用 DSH 行为，需在此处显式对齐；`C-13` 按本决策验收。**这是唯一一条"语义分歧"（其余是增量或实现替换），迁移时最易被漏** |
| **X8** | "记住密钥"opt-in | 无此概念（凭据在凭据库） | 默认 `sessionStorage`，用户可显式开启 `localStorage` 持久化 | **属相对决策卡「BYOK 仅 `sessionStorage`」的显式偏离，W0 冻结时须一并修订架构评审 §3.3 与决策卡** |

> **X1 与 X3 是真正的"非对称扩展"，必须在 PRD 与迁移清单里可见。** 其余是"实现替换"，接口不变。

---

## 15. 前端专属实现约束（踩坑清单）

| # | 约束 | 理由 |
|---|---|---|
| 1 | 主线程**永不做**解析/embedding/统计 | UI 冻结是 demo 的头号死因 |
| 2 | 刷新恢复**必须**从日志重建，**不得**依赖内存流帧 | 实时帧是呈现数据，不是回放来源 |
| 3 | 人类 transcript **必须**过滤 `surfaceOp === 'append'` | 压缩后的 replace 会遮蔽历史 |
| 4 | 工具卡片**不得**按完成时间排序 | 结果严格按模型顺序提交 |
| 5 | 长列表**必须**虚拟化（对话、台账、产物树） | 1000+ 条仍要流畅 |
| 6 | 进度条的 `aria-live` 用 **polite**，不用 assertive | assertive 会打断屏幕阅读器 |
| 7 | 焦点切换后**不要**整树重渲染 | 靠投影的引用复用 + 细粒度订阅 |
| 8 | IndexedDB 大对象**不要**当 blob 库用 | 大 Blob 读写性能与事务开销都差 → OPFS 分片 |
| 9 | `chunk_id` **必须**用内容哈希 | 幂等与可续跑的地基 |
| 10 | 同步访问句柄只能在 **Dedicated Worker** 内用 | 规范约束；且旧实现可能是异步，需特性适配 |
| 11 | Service Worker 只缓存**同源静态资源** | 去掉 CDN 依赖 + 避免"语料发往外部"的嫌疑 |
| 12 | 索引元数据**必须**写死可迁移头信息 | 否则索引是一次性垃圾 |

---

## 16. 一句话总结

> **共用的不是实现，是契约**：
> 一本仅追加的事件日志、一套同步纯折叠的投影、一张闭合的事件词汇表、一份深度冻结的请求派生规则、一条"模型可见 ⟺ 已记录"的不变量、八个宿主无关的接口。
>
> 做到这六件，迁移到本地 App 时**换掉的是 adapter，不是产品**。
