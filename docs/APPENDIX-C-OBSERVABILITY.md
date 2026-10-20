# 附录 C · 进度与可观测语义

> 配套主文档：[`经管论文助手-纯前端Demo产品设计PRD.md`](经管论文助手-纯前端Demo产品设计PRD.md)
> 本附录定义"阶段可查 / 关联同步 / 进度追踪"三条要求的**数据契约与更新纪律**：进度事件的统一形状、投影的三条铁律、订阅的三条纪律、以及每个可观测面的字段清单与订阅来源。
>
> **重要前提**：本产品对 DSH 的进度模型做了一处**显式的、有理由的扩展**（见 §1.2）。这是"框架一致"原则下唯一需要迁移时回改的地方，已登记在附录 A §15 的 `X1`。

---

## 1. 进度与可观测的事实基线

### 1.1 【DSH】一切可观测面都是同一条日志的同步纯折叠

**没有第二个数据源。** DSH 的 Trajectory 视图不是独立页面，而是注册进 `conversation.view` 槽的一个 View，它自己注册事件定义把会话事件折成节点。

> 证据：`dsh-client-ui-trajectory/lib/client.js:8706-8715`、`:8738`；`dsh-client-ui-conversation/README.zh.md:34`
> `dsh-client-ui-trajectory/README.zh.md:54`：**视图是纯投影**

**对前端的含义**：复刻只需「事件数组 + 一组 `apply(state,event)` + snapshot/subscribe」，**零 Node 依赖**。

### 1.2 【DSH】进度的真实形状：一行字符串（必须如实指出的缺口）

| 项 | 事实 | 证据 |
|---|---|---|
| 发布入口 | `JobHandle.updateProgress(line)` | `dsh-jobs-local/lib/index.js:433-435` |
| 类型 | `state.progress = line`，**没有任何结构化字段** | `:717-728` |
| 事件 | `{ type: "progress", job: this.view(job) }` | `:724-727` |
| 结算 | **清除**进度行 | `:741` |
| 对已结算 job 写进度 | 丢弃并记日志 | `:719-722` |
| **全仓 ETA 概念** | **不存在** | `dsh-goal/README.zh.md:159`（明确不计量挂钟时间） |

**结论**：DSH 的后台作业**没有**百分比 / 阶段名 / 剩余时间的结构化进度事件。

**本产品的处置（有意扩展，理由必须写清）**：DSH 的 `progress` 是给**人**看的一行提示；而本产品的"阶段可查"要求**机读**的阶段名与百分比。因此把 `progress` 升级为结构化对象——**只扩展这一个字段**，机制（事件溯源、投影契约、job 生命周期、诚实披露纪律）完全复用。

> **若要严格"零扩展"**：把"剩余时间"降级为**不可用状态**（照抄 `timing.notAvailable` 的做法），而不是展示估算值。这是可接受的退路，已在 PRD §5.3 与附录 A §15 登记。

---

## 2. 进度事件的统一形状（`ProgressEvent`）

```ts
type ProgressEvent = {
  // ── 身份 ──────────────────────────────────────────────
  jobId: string;              // 稳定任务 id，全生命周期不变，形如 'pdf-parse-3'
  kind: string;               // 'pdf-parse' | 'index-build' | 'retrieve' | 'papercard' | 'draft' | 'execute' | 'robustness' | 'package'
  label: string;              // 一行人类可读标签

  // ── 生命周期 ──────────────────────────────────────────
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed';
  cause?: 'producer' | 'kill' | 'teardown';    // 仅终态：结算原因

  // ── 阶段（机读，本产品新增） ────────────────────────────
  phase: string;              // lower-kebab-case，稳定可枚举
  phaseLabel: string;         // 可本地化的人类可读名
  phaseIndex: number;         // 阶段序号，全任务内单调
  phaseTotal?: number;        // 阶段总数；未知时省略（而非估一个）

  // ── 阶段内子步骤 ──────────────────────────────────────
  stepIndex?: number;
  stepTotal?: number;

  // ── 计量（只在确有可计量分母时给出） ─────────────────────
  percent?: number;           // 0–100
  completedUnits?: number;
  totalUnits?: number;
  unit?: string;              // 'doc' | 'page' | 'chunk' | 'item' | 'spec'

  // ── 人类可读 ──────────────────────────────────────────
  message?: string;           // 一行实时进度文本（DSH 的 `progress` 等价物）
  detail?: string;            // 终态详情（如 'cancelled by the user'）

  // ── ETA（估不准就给区间 + 置信度） ──────────────────────
  etaMs?: [number, number];
  etaConfidence?: 'high' | 'medium' | 'low';

  // ── 能力与降级 ────────────────────────────────────────
  cancellable: boolean;
  resumable: boolean;
  degradations: string[];     // 例：['语义索引未就绪，仅 BM25']

  // ── 阻塞 ──────────────────────────────────────────────
  blockedReason?: { code: string; message: string };   // code 为 lower-kebab-case

  // ── 时间与序号 ────────────────────────────────────────
  startedAt: number;
  finishedAt?: number;        // 仅终态
  elapsedMs?: number;         // 运行中由 now - startedAt 计算，不得伪装成已结算值
  outputBytes?: number;       // 增量产出总量（用于"还在动"的心跳判据）
  seq: number;                // 本任务事件流内单调序号
  at: number;
};
```

### 2.1 字段来源参照（"与 DSH 一致"的逐条锚点）

| 字段 | 来源参照 |
|---|---|
| `jobId` | `dsh-jobs`：`JobView.id`，由 `<kind>-N` 生成（`dsh-jobs-local/lib/index.js:420-422`） |
| `kind` / `label` | `JobView.kind` / `JobView.label`（`:415`、`:576`、`:416` 非空校验） |
| `status` | `JobStatus` / `isTerminal`（`:347-349`）；终态 = `completed\|killed\|failed` |
| `phase` / `phaseLabel` / `phaseIndex` / `phaseTotal` | **【本产品新增】**；形态照抄 `goal.blockedReason.code` 的 lower-kebab-case 约束（`dsh-goal/lib/types/fold.js:49`）与 `goal.roundsStarted` 的单调计数（`dsh-goal/lib/types/index.js:61`） |
| `stepIndex` / `stepTotal` | 参照 `turnBoundary.lastStepBoundary.seq`（`dsh-agent-loop/lib/index.js:1359-1362`）与 Trajectory 的"第 {step} 步"分组 |
| `percent` / `completedUnits` / `totalUnits` / `unit` | **【本产品新增】**（DSH 的 `progress` 只有一行字符串） |
| `message` | `dsh-jobs`：`JobView.progress`（`:433`、`:717-728`）—— **DSH 的等价物** |
| `detail` | `JobView.detail`；kill 原因合并进 detail（`:739`） |
| `blockedReason` | `dsh-goal`：`blockedReason`（`dsh-goal/lib/types/fold.js:45-57`），code 正则 `/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/` |
| `startedAt` / `finishedAt` | `JobView.startedAt` / `finishedAt`（`:581`、`:582`） |
| `elapsedMs` | 参照 `subagentTiming` 双段算法 `settledMs + (running ? now : active.through) - active.since`（`dsh-client-ui-subagent/lib/client.js:68-76`） |
| `etaMs` | **【本产品新增】**（DSH 无 ETA 概念） |
| `cancellable` | 参照 `dsh-jobs` 的 kill 只对未终态有效（`:612`） |
| `resumable` | 参照 goal 的 resume 只在额度有剩余时接受（`dsh-goal/README.zh.md:68`） |
| `seq` | 参照 `dsh-jobs` 输出环绝对偏移 `output.total`（`:193-196`）与 `SessionSeq` |
| `at` | `dsh-session` 事件信封的 `time` |

### 2.2 三条发布纪律（来自投影注册表，必须遵守）

| # | 纪律 | 理由 |
|---|---|---|
| 1 | 进度事件必须携带**变更后的完整状态**，绝不携带裸增量 | UI 不需要自己合并增量 |
| 2 | 无关事件必须返回**同一状态引用** | 否则造成无意义的界面重渲染 |
| 3 | **未上报的可选字段必须省略该键**，不要写 `0` 或空串 | DSH 三条投影一致采用此法则 |

> 证据：`dsh-session-projection/README.zh.md:54`
> 法则实例：`contextPressure`（`dsh-token-meter/lib/types/usage-projection.js:52-56`）、`subagentTiming`（`dsh-subagent/lib/types/projection.js:18-22`）、`JobView` 的 `progress`/`detail`/`finishedAt`（`dsh-jobs-local/lib/index.js:579-586`）

### 2.3 三条不得越界的诚实规则

| # | 规则 | 证据 |
|---|---|---|
| 1 | **进行中不得虚构耗时** | `dsh-client-ui-trajectory/README.zh.md:104` |
| 2 | **无法证明精确值时整个披露不可用**，而不是给近似数 | `dsh-token-meter/lib/types/turn-usage.js:108-111` |
| 3 | **启发式近似必须标注为近似**，不得呈现为总量 | `dsh-token-meter/README.zh.md:68`、`:154` |

---

## 3. 三层进度模型

不是所有等待都该画进度条。**混淆层级是进度界面最常见的设计错误。**

| 层 | 时长 | 呈现 | 进度条 | 例子 |
|---|---|---|---|---|
| **L1 瞬时** | < 1s | 阶段名 + 呼吸点 | ❌ **不画** | 规则检查、映射打分、打开产物 |
| **L2 秒级** | 1–10s | 子步骤清单逐条点亮 + 累计耗时 | 可省（用清单代替） | 检索探针、候选题目生成、单张图、单段起草 |
| **L3 长任务** | > 10s ~ 小时级 | **Job 卡片**：结构化进度 + ETA 区间 + 置信度 + 可中断 + 增量输出 + 降级徽标 | ✅ | S0 入库、索引构建、S2 逐篇抽取、S4 Pyodide 执行、S5 多设定队列、S7 整节起草 |

**为什么 L1 不画进度条**：1 秒内完成的操作画进度条会让界面闪烁，且暗示"这可能很久"——与事实相反。用呼吸点 + 阶段名即可。

### 3.1 ETA 的三档呈现规则

| 条件 | 呈现 |
|---|---|
| `completedUnits/totalUnits` 可得 **且** 已完成 ≥5 个单位的实测速率 | `etaMs` 区间 + `etaConfidence: 'high'` |
| 已完成 2–4 个单位 | 区间 + `etaConfidence: 'medium'` |
| 已完成 <2 个单位，或速率波动 > 50% | 区间 + `etaConfidence: 'low'`，或**只给"已完成 n/N"** |
| 无分母（如"等待模型响应"） | **只给已用时长**，不给 ETA |

> **禁止假精确**：估不准时给区间 + 置信度，不给秒表。

### 3.2 长任务的六条呈现要求

1. **可中断**：`cancellable: true` 时显示"暂停/取消"，并明确告知"已完成的部分会保留"；
2. **可续跑**：`resumable: true` 时刷新后显示"已恢复，剩余 N 项"；
3. **边建边用**：`degradations` 或 `message` 里明确"现在可以直接用哪部分"；
4. **降级可见**：`degradations[]` 必须显示在**进度区**，不能只在日志里；
5. **增量输出**：可展开的输出面板，**按可见性打开**（见 §5.3）；
6. **心跳**：`outputBytes` 或 `seq` 在变 = "还在动"；长时间不变则 UI 提示"仍在运行，无新输出"。

---

## 4. 进度计数的"先预留，后准入"机制

> **这是本产品最该 1:1 复刻的 DSH 机制**，因为它同时修掉研究型长任务的三个真实故障。只需两个字段 + 一个进程本地标志。

### 4.1 三条纪律

| # | 纪律 | 修掉的故障 |
|---|---|---|
| 1 | idle 时为当前 `{jobId, revision}` **预留** `completedUnits + 1`，排入队列；**只有真正进入执行的单元才增加计数**；因陈旧被拒绝的预留**不消耗编号** | **进度数字虚高**（预留失败必须回滚，而不是"点了就算"） |
| 2 | 进度计数以"**已准入的单元**"为单位**持久化在日志里** | **中断后不可续**（天然可回放） |
| 3 | 进程本地 `armed`/`disarmed` 标志 + **显式 resume**；会话恢复/刷新后 active 任务**自动 disarmed**，驱动器**绝不自行复活工作** | **刷新即自动复活**导致重复消耗 |

### 4.2 配套两条实现要点

1. `agent/pre-step` 监听器在**下游监听器前后双次校验**完整已领取记录与当前任务，使陈旧/已取消/竞争中的提示词**在其步骤进入前**被拒绝；
2. 排队工作前等 `flush()`，完成后**重新检查 revision**；额度耗尽以稳定代码记 blocker。

> 证据：`dsh-goal-round-driver/README.zh.md:53`、`:71`、`:72`、`:73`；`dsh-goal/README.zh.md:57`、`:72`

### 4.3 为什么对研究型任务特别重要

| 场景 | 没有该机制 | 有该机制 |
|---|---|---|
| S0 索引到 60% 时刷新 | 重启后从头再来（或数字虚高到 100% 却无索引） | 从第 187 篇续跑，计数正确 |
| S5 稳健性跑了 3/7 项时崩溃 | 已完成 3 项结果丢失 | 3 项结果保留，resume 时确认后续跑 |
| 用户误刷新 | 自动复活，重新消耗 40 分钟 OCR | 保持 disarmed，等用户确认 |

---

## 5. 订阅纪律

### 5.1 三条订阅规则（直接借鉴 DSH，正好解决研究型 Agent 最容易出的三个界面 bug）

| # | 纪律 | 修掉的 bug |
|---|---|---|
| 1 | **名册跟随挂载，观测跟随可见性**——名册流在控件存活期间保持打开；只为**展开的行**打开输出观测流，收起/卸载/弹层关闭即关闭 | 泄漏的轮询 |
| 2 | **一个会话只开一条名册流、一个 job 只开一条观测流**，不论多少查看器（引用计数保证，最后一个释放才丢弃） | 重复的流 |
| 3 | **实时事件 epoch 让在途读取失效**，较旧的响应不能覆盖较新的实时变化；running 刷新会保留最后一次已知值直到读取完成 | 「旧响应覆盖新实时状态」 |

> 证据：`dsh-client-ui-jobs/README.zh.md:48`；`dsh-api-job-controller/README.zh.md:29`；`dsh-client-ui-goal/README.zh.md:46`

### 5.2 "边跑边看输出"的两条流协议（照抄）

**（a）名册流**：打开时一帧**整集**，之后每轮**聚合过的生命周期提交**一帧（聚合窗口 **100ms**）。

> ⚠️ **关键**：**输出追加从不刷新名册**。任务单纯在写输出时名册流是安静的——否则索引 300 篇会产生上万次列表重渲染。
> 证据：`dsh-api-job-controller/lib/types/rows.js:5-8`、`:29`、`:36`、`:21-27`（订阅过滤掉 `output` 事件）；`lib/types/index.js:49`

**（b）观测流**：锚点 + 增量 + 终态。

```
opened { job, from }                  // 锚帧，from 默认 job.output.earliest
output { chunks, next, lossy? }       // 聚合输出帧
status { job }                        // 结算且排干后一帧，随后流正常关闭
```

- **续读方式**：把上一帧的 `next` 作为 `from` 传回；
- **帧字节预算**：默认 **65536**（软预算，更大的单块整块发送）；按块切帧；
- **两条读取都非消耗**（不影响"模型已读到哪"的游标）；
- 若通告 removed（拥有者 teardown），以被移除 job 的**终态投影**收尾，而不是读失败。

> 证据：`dsh-api-job-controller/lib/types/observe.js:49`、`:56-63`、`:87-105`、`:12-16`；`lib/types/index.js:51`

**输出环的淘汰语义**（照抄，但用码点而非字节）：

| 项 | DSH | Demo |
|---|---|---|
| 索引单位 | **绝对 UTF-8 字节偏移** | **块数组 + 逻辑序号**（JS 字符串是 UTF-16，不该按字节记账） |
| 淘汰 | 头部淘汰，`earliest` **只前进** | 同 |
| 保留上限 | 运行期 256 KiB；结算后 16 KiB（**绝不低于模型游标未消费的字节**） | 同量级 |
| 超限读取 | 给 `lossy` 结果而非报错 | 同 |
| 单块超限 | 保留 **UTF-8 安全尾部** + `gapBefore: true` | **按码点切**，不切开代理对 |
| 客户端渲染尾部 | `RENDER_TAIL_LIMIT = 128 * 1024` UTF-16 码元，裁剪不切开代理对 | 同 |

> 证据：`dsh-jobs-local/lib/index.js:188-218`、`:224-241`、`:259-261`；`dsh-api-job-controller/lib/types/client/model.js:10`、`:74-89`、`:95-115`、`:103-111`

### 5.3 通道语义

| 通道 | 是否到达模型 | 用途 |
|---|---|---|
| `stdout` / `stderr` | ✅ | 脚本输出（**执行失败也要展示失败**——不要静默吞 traceback） |
| `log` | ❌ **只到达观察者** | 调试/进度信息 |

> 证据：`dsh-jobs/README.zh.md:34`

---

## 6. 可复用字段清单（照抄 DSH）

### 6.1 `turnOutline`（会话导航）

```ts
Array<{ turn: number; seq: number; prompt: string; response: string }>
```

- `seq` 是"向后分页载入整轮"的**目标**；
- 锚点是 `turn/start` 而非 prompt；
- 每轮**至多推送 3 次**（开轮、提示词、落定回复）；
- `prompt` 50 字符 / `response` 120 字符封顶。

> 证据：`dsh-session-turn-outline/lib/types/projection.js:54-58`、`:85-95`；`dsh-session-turn-outline/README.zh.md:42-47`

### 6.2 `sessionStats`（底部统计条）

```ts
{ turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
```

> 证据：`dsh-session-stats/lib/types/projection.js:27-36`；`README.zh.md:40-49`

### 6.3 `tokenUsage` / `contextPressure` / `contextBreakdown`

```ts
tokenUsage       = { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
contextPressure  = { pressureTokens?, projectedTokens?, contextWindow? }
contextBreakdown = { systemTokens, toolsTokens, messageTokens }        // 标注为近似
```

- 占用率 = `projectedTokens / contextWindow`；
- **同一次尝试内替换**（不是累加）；
- `llm/retry-started` 结束替换范围。

> 证据：`dsh-token-meter/lib/types/usage-projection.js:30-56`、`breakdown-projection.js:12-16`、`README.zh.md:49`

### 6.4 可照抄的启发式常数

```
4 字符 / token          块开销 4        角色开销 4
```

> 证据：`dsh-token-meter/lib/types/estimate.js:9`、`:11`、`:13`

> `deriveTurnTokenUsage(events)` 是**浏览器安全的纯 JS**（`dsh-token-meter/lib/types/client.js:6` 为唯一导出；全包 grep `Buffer|node:|process.` 只命中两处对象键 `node:`）。**可直接复用。**

### 6.5 `todos`

```ts
todos = Array<{content, status: 'pending'|'in_progress'|'completed'}> | null
        // todo/write 写入；turn/start 清空；turn/end 保留
```

> **⚠️ 刻意不做：`plan` 投影。** DSH 的 `plan` 徽章由 `command/run` → `command/done` 与 `plan/mode` 驱动，但这三个事件**都不在本产品的闭合事件词汇表里**（附录 A §5.3 只收了 25 个 DSH 子集事件），而 A §5.3 明写"表外类型拒绝解释"——照抄这个投影会得到一个**永远折叠不出来的死代码**。
> 本产品**不采纳 DSH 的 plan-mode 审批机制**：阶段门的审批由 **`gate.blocked` + 结构化 `ask_user`** 承担（见附录 B §8.4），PRD §9.3 的组件表里也没有 plan 徽章。若日后确实需要，必须**先把三个事件登记进闭合表**（并同步 `T-CONF-06` 的基线），再实现投影。

---

## 7. 「阶段可查」：UI 需订阅的数据源清单

| # | 数据源 | 形状（关键字段） | 更新时机 | 渲染位置 |
|---|---|---|---|---|
| 1 | **会话事件流** | `{type, seq, time, data}` | 每次 `append`；替换用 `surfaceOp: replace` | 一切下游源头；**不直接渲染** |
| 2 | `turnBoundary` | `{openTurnStartSeq, lastStepStartSeq, lastStepBoundary:{kind,seq}, lastTurn}` | `turn/start`·`end`、`step/start`·`end` | 判断"当前是否有开放轮次" |
| 3 | `inbox` | 待处理输入 | `agent/inbox/spliced` | 输入队列 |
| 4 | `turnOutline` | 见 §6.1 | 每轮至多 3 次 | 会话导航；点击跳转该轮 |
| 5 | `sessionStats` | 见 §6.2 | 每个贡献事件 | 底部统计条 |
| 6 | `tokenUsage` | 见 §6.3 | `assistant/message`/`attempt`（同尝试内替换） | 用量徽标 |
| 7 | `contextPressure` | 见 §6.3 | 最新用量样本 + 最新 `request/context` | 上下文占用条 |
| 8 | `contextBreakdown` | 见 §6.3 | `request/header` + surface 事件 | 上下文构成（**标近似**） |
| 9 | `todos` | 见 §6.5 | `todo/write`；`turn/start` 清空 | composer 上方 Todo 卡 |
| 10 | **`jobs` 名册** | `JobView[]`（见 §2） | 打开时一帧；之后聚合生命周期提交（**100ms** 窗口） | 会话头部后台任务控件 |
| 11 | **`jobs` 观测流** | `opened` → `output{chunks,next,lossy?}` → `status` | 环推进时聚合；结算后终态帧 | **仅展开行**的内嵌输出面板 |
| 12 | **`stages`**（新增） | `Array<{stage_id, run_no, status, outputs_ids[], entered_at, exited_at}>` | `stage.enter`/`exit`/`gate.blocked` | 左侧阶段导航 |
| 13 | **`artifactGraph`**（新增） | 产物节点 + provenance 边 | `artifact.write`/`revise`/`invalidate` | 产物树 + 关联同步 |
| 14 | **`citationLedger`**（新增） | `Array<{statement_id, ref_id, support, verdict}>` | `citation.check` | 引用台账面板 |
| 15 | **`numbers`**（新增） | `NumberInventory`（每数字一 `cell_id`） | `number.bind` | 数字 chip + 结果表面板 |
| 16 | `deliverables/presented` | `{turn, callId, files:[{path, description?}]}` | 成功的 `present` 工具结果 | 回合末尾交付卡片 |
| 17 | **`decisions`**（新增） | `DecisionRecord[]`（含 `rejected[]`） | `decision.record` | why-trace 抽屉 |
| 18 | **`refusals`**（新增） | `RefusalNotice[]` + 处置状态 | `refusal.raised` / `refusal.resolved` | 拒答卡 + 台账 |
| 19 | `approval/asked`·`decided` | 审批请求与决定 | 工具 `ask` 阶段 | 审批对话框 |
| 20 | `model/selection` + `request/header` | `{lastUsed, next}`；`{config, adapterDefaults?}` | 选择器交互 / 请求构造 | 顶栏模型选择器 + 轨迹面板 |
| 21 | **多 Agent 轨迹**（v2.0 新增） | `Array<{node_id, agent, status, duration_ms, retry_no}>` | `node.enter` / `node.exit` / `agent.handoff` / `review.verdict` | 多 Agent 执行轨迹（谁在干、干了多久、被打回几次）+ 质量门面板 |

> **21 行订阅源。** 每一行订阅的事件**必须全部在附录 A §5.3 的闭合事件词汇表（25 + 34 = 59 个）内**——这是本表的自检规则。已据此**移除 `plan` 投影**（其 `command/*`、`plan/mode` 三个事件不在闭合表，照抄会得到永远折叠不出来的死代码，见 §6.5）。
> **第 21 行是 v2.0 新增**：多 Agent 编排要求用户能看见"8 个 Agent 里现在是谁在工作、被打回过几次"，否则"整个 agent 框架"就是一个黑箱。它对应附录 A §12.3 的投影 `graphNodes` 与 `qualityReport`。

### 7.1 `asOfSeq`：所有面板对齐同一历史切面

`snapshot()` 返回 `{asOfSeq, values}`，其中 **`asOfSeq` = 所有值共同反映到的最后一个事件 seq**。

**产品要求**：阶段面板、产物树、引用台账、进度中心必须**反映同一 `asOfSeq`**。否则会出现"阶段说已完成、产物还没出现"或"台账显示 142 条、草稿里只有 138 个 chip"这类错乱。

> 证据：`dsh-session-projection/README.zh.md:83`

### 7.2 可观测面的三条 UI 约束

1. **阶段轨道常驻**（9 阶段 × 状态色），任意已到达阶段可回看其产物与"为什么"；
2. **入口一律用抽屉/浮层，不得成为 Tab**（`study-probe` / `paper-card` / `why-trace` / `health-recheck` / `note`）；
3. **状态条常驻三项**：
   - 推理位置（本机/WebGPU/模型名 · 本次未联网）；
   - 检索就绪度（BM25 已就绪 / 语义未就绪 → 已降级）；
   - **证据健康度**（红标篇数 / 未核实占位数 / 未处置 `fail` 数）。

---

## 8. 「关联同步」：数据契约

### 8.1 焦点状态

```ts
type FocusTarget =
  | { kind: 'doc';      docId: string; page?: number }
  | { kind: 'chunk';    chunkId: string }
  | { kind: 'artifact'; artifactId: string; fieldPath?: string }
  | { kind: 'claim';    paragraphId: string; sentenceIndex: number }
  | { kind: 'cell';     cellId: string }
  | { kind: 'refusal';  refusalId: string }
  | { kind: 'stage';    stageId: string; runNo: number };

type SelectionState = {
  focus: FocusTarget | null;      // 栈顶 = 当前焦点
  pinned: FocusTarget[];          // 用户"钉住"做对照的次级高亮（上限 5）
  syncedPanels: PanelId[];        // 哪些面板参与联动（用户可关掉某面板的联动）
};
```

### 8.2 反向索引（关联同步的数据基础）

```ts
interface CrossReferenceIndex {
  // chunk → 引用它的所有句子（用于"从 PDF 反向高亮"）
  claimsByChunk(chunkId: string): Array<{ paragraphId: string; sentenceIndex: number }>;
  // cell → 绑定它的所有句子（用于"改了数字要更新哪些句子"）
  claimsByCell(cellId: string): Array<{ paragraphId: string; sentenceIndex: number }>;
  // 产物 → 它参与的阶段
  stagesByArtifact(artifactId: string): Array<{ stageId: string; runNo: number }>;
  // chunk → 它支撑的产物字段
  fieldsByChunk(chunkId: string): Array<{ artifactId: string; fieldPath: string }>;
}
```

> **该索引完全由事件派生**（`citation.check` + `artifact.write` 的 `provenance.evidence` + `number.bind`），不需要额外存储。这也是"日志是真源"的又一次兑现。

### 8.3 寻址：可双向定位的地址

```ts
// 本产品新增块级锚点（DSH 的引用是文件级，地址里没有行号）
type ChunkAddress = {
  docId: string;
  page: number;            // 1 基
  bbox: [number, number, number, number];   // 页内坐标
  charRange: [number, number];              // 页内字符区间
  chunkId: string;         // 内容哈希，可校验
};
```

**照抄 DSH 的编码纪律**（这条很重要，否则地址会在往返中失真）：

> `clipboardText === ref === serialize(ref)`；**序列化永不根据可见标题重建身份**。

> 证据：`dsh-client-ui-reference/lib/client.js:198-231`、`:26-45`

**产物坐标形状（照抄）**：`{sessionId, seq, index}`——宣告事件 seq + 文件在原数组中的下标。

> 证据：`dsh-client-ui-deliverables/lib/client.js:311-317`、`:28`

### 8.4 关联同步的六条交互规格

| # | 规格 | 理由 |
|---|---|---|
| 1 | **单一焦点源**：只有 `setFocus(target)` 一个入口 | 五套选中态必然失步 |
| 2 | **反向跳转与正向跳转对称** | "从 chip 到原文"与"从原文到所有引用它的句子"必须都能做 |
| 3 | **高亮栈而非单值**：允许钉住多个 chip 做对照 | 多证据比对一个句子的场景很常见 |
| 4 | **面板级联动开关** | 用户可能只想看证据，不想草稿跟着滚 |
| 5 | **焦点切换 < 100ms** | 靠投影引用复用 + 细粒度订阅 |
| 6 | **跳转后短暂高亮 + 可撤销** | 避免用户迷失位置 |

---

## 9. 纯前端不可比之处与等价物

| # | DSH 的能力（host 才有） | 纯前端为何不可比 | 前端等价物 |
|---|---|---|---|
| 1 | **多进程后台作业**（任务随进程终止消失） | 浏览器没有可 fork 的进程 | **Web Worker 池**；"进程死亡"的等价物是 **worker 被 terminate / 页面被卸载** |
| 2 | **Node 事件循环 + 后台定时泵**（`pumpPollMs = 150`） | 主线程定时器会被渲染与长任务饿死 | Worker 内 `setInterval` / `queueMicrotask` 泵；主线程只用 `requestIdleCallback` 做渲染节流 |
| 3 | **绝对字节偏移的有界输出环** | JS 字符串是 UTF-16，不该按 UTF-8 字节记账 | **块数组 + 逻辑序号**；按**码点**切，不切开代理对 |
| 4 | **跨进程/跨重启的 job 注册表** | 刷新即归零 | **IndexedDB 任务快照 + 续跑标记**；**默认不自动续跑**，要求用户显式确认 |
| 5 | **服务端投影注册表**（进程级、checkpoint 持久化） | 没有"服务端权威值" | 同一套 `ProjectionDefinition` 契约在浏览器内实现；checkpoint 用 IndexedDB |
| 6 | **`workspace/changes` 的 git 快照与逐 hunk diff** | 浏览器没有 git / 工作树 | 文件产物改为**版本化文档对象**，diff 用纯 JS |
| 7 | **`present` 的原生桌面打开** | 浏览器只能下载或新窗口 | Blob URL / `showSaveFilePicker` + 内置预览；**保留"无桌面时隐藏原生控件但保留预览"的降级姿势** |
| 8 | **附件准入的 host 侧能力**（Buffer canonical 校验等） | `node:buffer` 不存在 | `File.arrayBuffer()` + `Uint8Array`；图片尺寸用 `createImageBitmap` |
| 9 | **`dsh-session:` URI 的 `Buffer.from(..., 'base64url')`** | 同上 | `TextEncoder` + 手写 base64url |
| 10 | **会话持久化与 fork** | 无 JSONL 落盘、无 fork 语义 | IndexedDB 存事件数组；分支用**共享前缀 + 独立后缀**（等价 `inheritedEventCount`） |
| 11 | **LLM 流式用量锚点**（提供方报告的真实 usage） | 若不做真实调用就没有提供方用量 | 保留 `deriveTurnTokenUsage` 的**"无法证明就返回 undefined"纪律**；估算一律标 `heuristicTokens` |
| 12 | **`userQuestions` 交互通道** | 无独立交互服务 | 前端自有 promise-based 审批队列；保留 **`intent` 结构化呈现意图 + `callId` 关联**，拒绝实现为**失败调用** |

> 证据汇总：`dsh-jobs/README.zh.md:127`、`dsh-jobs-local/README.zh.md:47`、`:138`；`dsh-api-job-controller/lib/types/client/model.js:103-111`；`dsh-session-projection/README.zh.md:12`、`:95`；`dsh-workspace-changes/lib/types/index.js:11`、`:18`；`dsh-client-ui-deliverables/README.zh.md:37`、`:39`、`:69`；`dsh-attachment/lib/types/admission.js:2`、`:5-14`；`dsh-session-reference/lib/types/uri.js:12`、`:28`；`dsh-session/README.zh.md:68`、`:70`；`dsh-token-meter/README.zh.md:43`；`dsh-plan-mode/lib/types/index.js:249-267`、`:289-294`

### 9.1 三条产品结论

1. **不要照搬"进度 = 一行字符串"**——研究型 Agent 的解析、索引、检索、起草、执行是**可计量**的，必须用 §2 的结构化形状；
2. **不要照搬"job 即进程"**——浏览器等价物是 Worker，与页面同生共死；因此"可中断可续"必须靠**持久化任务快照 + 显式续跑确认**（§4）；
3. **可以照搬全部"可查性"骨架**——事件日志 + 同步纯折叠投影 + `asOfSeq` 一致切面 + 引用计数流 + `{seq,index}` 坐标 + 寻址 + "无法证明就不显示"的诚实纪律。**这六件在纯前端没有任何一项需要 Node。**

---

## 10. 验收清单（可观测性部分）

| # | 用例 | 判据 |
|---|---|---|
| `O-01` | 刷新恢复现场 | 阶段位置、产物、引用、进度全部复原；`asOfSeq` 一致 |
| `O-02` | 投影引用复用 | 无关事件后 `state` 引用不变（`Object.is`） |
| `O-03` | 进度事件完整性 | 长任务全程 `ProgressEvent` 字段符合 §2；未上报字段**键缺失**而非 0/空串 |
| `O-04` | ETA 不假精确 | `completedUnits < 2` 时不给秒级 ETA；`etaConfidence` 随样本量升级 |
| `O-05` | 中断续跑 | 入库 60% 时刷新 → 从已完成 chunk 续跑；计数正确 |
| `O-06` | 不自动复活 | 刷新后任务保持 disarmed，等用户确认 |
| `O-07` | 降级可见 | `degradations[]` 出现在进度区，不只出现在日志 |
| `O-08` | 名册安静 | 任务仅写输出时名册流无帧（仅观测流有帧） |
| `O-09` | 单流约束 | 一个 job 只有一个观测流（引用计数） |
| `O-10` | 陈旧读取不覆盖 | 慢的 HTTP 响应不覆盖更新的实时状态 |
| `O-11` | 输出环淘汰 | 超限读取给 `lossy` 而非报错；裁剪不切开代理对 |
| `O-12` | stdout/stderr 可见 | 执行失败展示 traceback，不静默吞掉 |
| `O-13` | 阶段可查 | 任意产物"为什么"给出：rule_id + 支撑 chunk + 检索式与融合分 + 被否决备选 + 所用模型 |
| `O-14` | 关联同步对称 | chip→原文 与 原文→所有引用句 都能跳 |
| `O-15` | 焦点性能 | `setFocus` → 五面板重绘 < 100ms |
