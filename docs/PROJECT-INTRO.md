# 智研 · 作品介绍（报名表可直接复制）

> **产品实现在哪**：`C:\经管论文助手\economic-research-assistant\backend\`（FastAPI + LangGraph，12 个 Agent、真实调 Stata）；
> `frontend/` 是 Electron + React 交互层，`frontend-demo/` 是把同一套流程做成零后端的高保真演示（双击 `index.html` 即可跑，用于现场演示与截图）。
>
> **检索层在哪**：**后端目前是"筛选 + LLM 语义分类"（无向量、无倒排索引，按需抽文本、用完即弃）**；
> **真正的 PDF 建库与召回实现在 `frontend-demo/scripts/{pdftext,corpus,bm25}.js`**（分块 400/重叠 80 + bigram BM25 + RRF k=60，带 `page/charRange` 引用回跳，`docs/RETRIEVAL.md` 有完整口径与"未做向量检索"的诚实边界）。
> 把前端这套索引迁到后端是下一步工程项——回答时**不要把两者混说成"已完成向量检索"**。
>
> 依据：`backend/app/agents/supervisor.py`、`agents/*.py`、`services/{pdf,llm,stata,data_summary}_service.py`、
> `utils/cssci_validator.py`、`configs/cssci_journals.json`、`api/workflow.py`、`frontend/src/renderer/`；
> 本机复跑结果：`test_parallel_execution.py` 加速比 5.91x、`test_design_confirmation.py` Ran 2 tests OK、
> 纯前端侧 `pipeline.test.js` 27/27、`retrieval.test.js` 52/52、UI 修订核对 pass=82 fail=0。

---

## 作品名称（10 字以内）

**智研**（2 字，界面品牌名已统一为「智研 · 更加懂经管问题的科研助手」）

---

## 灵感来源（100 字以内）

**我做过 3 年经管论文辅导。学生常卡在"没人教流程"：不懂范式、实证是黑箱，只能花上万找辅导，包发表要十万——信息不对称撑起高溢价。我想把经验做成产品，把流程与出处都摊开，让普通学生也用得起。**

> 字数 94（含标点，去空白后脚本核对）。

---

## 解决方案（100 字以内）

**LangGraph 编排 11 个 Agent：后端先按核心期刊白名单筛文献，前端把 PDF 切块建索引、BM25+RRF 召回、引用回跳页码；6 路分析并行跑 Stata；Prompt 分角色定契约；确认设计才读数据。**

> 字数 100（含标点，去空白后脚本核对）。已按你要求补上"文献 PDF 建库 → 检索 → 召回"：**后端做筛选与质量门，前端做分块建索引与双路融合召回**，详细机制见下表。

更强调"双路召回"的写法（99 字，去掉"先"字）：

>
> **LangGraph 编排 11 个 Agent：后端按核心期刊白名单筛文献，前端把 PDF 切块建索引、BM25+RRF 召回、引用回跳页码；6 路分析并行跑 Stata；Prompt 分角色定契约；确认设计才读数据。**

备选（更强调"垂类流程"时用，97 字）：

>
> **LangGraph 把研究拆成 8 阶段：Supervisor 调度 11 个子 Agent，文献按核心期刊白名单筛，设计须用户确认才读数据，6 路分析并行跑 Stata，双审查不过就自动回灌修订重跑，论文成稿。**

---

## 最惊艳的地方（100 字以内）

**把文献里的变量定义、模型与检验直接落成能跑的实证：6 路 Stata 代码并行执行，自动完成代码与质量审核，不通就反馈修订重跑，全程留 code、log、解读三类可复现证据——从文献到实验验证，一条链跑完。**

> 字数 95（含标点，去空白后脚本核对）。这是本作品与"AI 写论文"类产品最大的区别：**别人给文字，我们给跑通的实验**，建议保留。

备选（想突出"反复自我修订"时用）：
>
> **文献分析直接驱动实验设计：每个变量、模型、检验都要有文献依据；接着 6 路 Stata 并行执行，双审查不过就把意见回灌设计重跑，直到质量分达标才成稿——文献、代码、结果全程留证可追溯。**

---

## 关键效果截图（6 张，每张 <10MB）

现有的 6 张截图取自 `frontend-demo/`（纯前端高保真演示，界面与真实产品一致），可直接用：

| # | 截图内容 | 文件 |
|---|---|---|
| 1 | 空态首页 · 研究问题入口与三条示例流程 | `work/uishots/01-empty.png` |
| 2 | 研究问题被解析成五槽位 + 提问卡引导 | `work/uishots/02-ask-card.png` |
| 3 | **实验设计七分区**：每块都写"采用的数据 / 为什么这样选 / 参考文献" | `work/uishots/05-design.png` |
| 4 | 设计确认门：`已确认，实证执行已解锁`，改设计即失效 | `work/uishots/05b-design-vars.png` |
| 5 | **论文生成**：9/9 章、允许措辞锁定"相关"、逐段引用台账 | `work/uishots/03-paper.png` |
| 6 | 账号与设置：密钥只写不读、只存本机 | `work/uishots/04-settings.png` |

**如果面试官更看重 Agent 架构，建议替换 1–2 张为后端真实运行画面**（这些当前没有现成截图，需要启动 `backend` + `frontend` 现场截）：

- `WorkflowView` 的综合工作流页：8 阶段 Steps + 6 个分析 Agent 的实时进度条（最能直接证明"多 Agent 并行"）；
- "执行轨迹"抽屉：逐阶段 `started / completed / failed` 事件与 `duration_ms`（对应 `/api/workflow/trace/{project_id}`）；
- `文献` → `实验设计` 页：变量表里每行都带"参考文献"列的实拍（证明设计真的由文献驱动）；
- 产物目录 `01_文献分析.json`、`02_实验设计方案.md`、`04_统计分析.json` 与 `code/*.do`、`results/*_result.md` 的文件列表截图（证明三件套真的落盘）。

我暂时**没有**去启动 Electron 应用截这些图，因为它会调用真实 LLM 与 Stata、并要写 `backend/research_assistant.db` 与 `backend/logs/`，属于会改数据的动作——你要的话我再动。

备选素材：`docs/ui-concept/revised/project-1440x900.png`（1440×900，153KB，真实产品布局稿）、`work/uishots/05c-design-plans.png`。

---

## 下一步计划（100 字以内）

**demo 未上线，尚无真实用户：演示流程已跑通，但没在真机上完整跑过一份学生课题。下一步找 10 位经管学生用自己课题实测：文献能不能支撑设计、Stata 代码能不能跑通、结果敢不敢写进论文，按卡点迭代。**

> 字数 96（含标点，去空白后脚本核对）。**这段是如实陈述**（你选的是"只做过自测 + 自动化验证"），不建议为了好看写成"已获好评"。

---

## 附：可被追问时的实现证据（不必填进表格，面试被问到再答）

> 口径先对齐：**真正的产品实现在 `C:\经管论文助手\economic-research-assistant\backend\`（FastAPI + LangGraph）**；
> `frontend-demo/` 是把同一套流程做成纯前端的高保真演示（零后端可双击运行），不是另一套逻辑。

| 追问 | 可答（都可在本机复跑） |
|---|---|
| LangGraph 具体怎么编排？ | `app/agents/supervisor.py` 用 `StateGraph(ResearchState)` 建 8 个节点：literature → design → data_processing → parallel_analysis → code_review → quality_review →（条件路由）paper_writing / revise_design；`MemorySaver` 做 checkpoint，`thread_id = project_id`；`/api/workflow/graph` 可直接导出 Mermaid。 |
| 有几个 Agent、怎么分工？ | 12 个：1 个 Supervisor + 11 个子 Agent（文献 / 设计 / 数据 / 6 个分析 / 代码审查 / 质量审查 / 论文）。6 个分析 Agent 继承同一 `BaseAnalysisAgent`，各自实现 `generate_code` → `get_prompt_template` → `interpret`。 |
| 并行是真的吗？加速多少？ | 真的，`asyncio.gather` 同时跑 6 个分析；`python tests\test_parallel_execution.py` 实测 **串行 0.643s → 并行 0.109s，加速比 5.91x**（理论 6x，该脚本自带 ≥4.8x 判定并 PASS）。 |
| 人工确认门怎么实现的？ | `supervisor.run(..., require_design_approval=True)` → `app.ainvoke(..., interrupt_after=["design"])` 停在 `design_confirmation`，未确认时真不读数据；`python -m unittest tests.test_design_confirmation -v` → **Ran 2 tests OK**（未确认调 resume 抛"请先确认实验设计"且 `data.calls==0`；重启进程后仅凭 checkpoint 也能恢复）。 |
| 文献怎么从文件夹变"可检索的库"？ | 两条链路并存。**后端（LangGraph，产品主链）**：`file_scan_service.scan_pdf_paths` 递归扫 PDF → `pdf_service.extract_metadata`(PyPDF2) 取元数据 → `cssci_validator` 匹配期刊并打 `priority`(highest/supplementary) → `highest` 排序优先占用分析名额 → `extract_preview`(前 5 页) 定"阅读深度"。**前端（纯前端 demo，检索层）**：`corpus.addDocument` 逐篇入库 → `pdftext` 抽文本并按页记录字符偏移 → `chunkPages/ chunkText` 切块（**chunkSize=400 字符、chunkOverlap=80、minChunk=80**）→ `bm25.buildIndex` 建倒排索引。 |
| 分块为什么这样切？ | 块**不跨页**，每块带 `{page, charStart, charEnd}`，因此 `fullText.slice(charStart, charEnd)` 必须逐字等于 `chunk.text`（有单测守着）。这条不变式就是"引用可核验"的地基：命中块 → 回切原文 → 页码+字符区间一起给出，用户能回到 PDF 那一页。 |
| 中文怎么建索引（不分词器）？ | 不用 jieba：**bigram + 单字 + 英文/数字词**混合方案。CJK 连续段先出全部 bigram 再出单字；停用字表（的/了/是/在/与/及…）命中任一即整条丢弃；bigram 级停用词（一个/进行/通过/本文…）显式列出。**索引侧与查询侧规则不同**——查询侧多字 CJK 段只出 bigram，否则查"扫描件"会命中任何含"件"的文本（实测修复前 top3 全是无关文献，修复后唯一命中 d10）。 |
| 召回的分数怎么算？ | BM25 标准式，`k1=1.5`、`b=0.75`，`idf = ln(1+(N-df+0.5)/(df+0.5))`；**双路召回**：A 路 = 正文 BM25 + 0.5×元数据 BM25（标题权重 3、期刊 2），B 路 = idf 加权的**查询覆盖率**；再用 **RRF(k=60)** 只按名次融合。为什么第二路不选"纯元数据 BM25"：RRF 丢分数幅度，实测查"宽带中国试点"时真正覆盖该短语的 d21 掉到第 9 名、而只在期刊名含"中国"的 d19 排第 1；换成覆盖率路后 d21 在 A/B 两路都第 1（已写成回归用例）。 |
| 低质量文献怎么办？ | `pdftext.diagnose` 逐篇出覆盖率、乱码率、扫描件、双栏风险、页数、字符数（覆盖率以 900 字/页为量级基准，短页被判低覆盖是**有意为之的诚实判断**，不是 bug）；低质量篇目 `qualityPenalty=0.6` 降权而非静默丢弃。Type0 字体缺 `ToUnicode` 时产 U+FFFD 并计入乱码率——是诚实降级，不是静默错误。 |
| 检索的边界在哪？ | **只做词法检索（BM25 + 覆盖率），没有向量/语义召回**：近义改写（"创新" vs "创造新的价值"）检索不到，跨语言也检索不到；bigram 方案本身不命中不连续出现。这三点都写在 `docs/RETRIEVAL.md` 的"未做"清单里，页面与文档口径一致，不吹成"语义检索"。 |
| 后端也做检索吗？ | 后端当前是**筛选 + 语义分类**而非全文检索：只把"摘要+引言"交给分类 Agent 判 `xy/x/y/other`（`不要仅凭关键词重合分类；无法判断时用 other`），命中 `xy/x/y` 才读全文，且只拼 10 个研究性小节（每节 ≤2500 字）送进 prompt——目的是控制 token 与避免无关段落污染设计。**计划把前端那套分块 BM25/RRF 索引迁到后端**（这是"下一步"里的工程项）。 |
| 文献层面的质量门有哪些？ | ① 期刊白名单：`cssci_validator` 读 `configs/cssci_journals.json`，**30 本最高优先 + 609 本 CSSCI 补充**，先归一化精确匹配（阈值 92 兜底 fuzzywuzzy）；② 优先级治理：`highest` 优先占名额，`supplementary` 只在证据不足时补位，且 prompt 明确"不得在存在冲突时覆盖最高优先期刊的结论"；③ 失败可见：`failed_papers` 记录读不出来的 PDF，`missing` 标记找不到度量方式的变量，不用编造补齐。 |
| Prompt 工程做了什么？ | 三层：① 角色化 system prompt（文献 Agent = 经管资深学术专家、审查 Agent = 按《经济研究》《管理世界》标准的审稿人）；② 全链路 JSON 契约（分类、单篇抽取、综合、设计、审查都规定字段名与枚举，解析失败再用正则兜底）；③ 防幻觉硬约束——"禁止虚构期刊或文献""找不到度量方式标 missing""证据不足明确写出不足"，并强制每个变量与方法都带 `reference`（作者，年份）。 |
| 计量执行在哪跑？ | `stata_service` 把生成的 do 文件包上 `log using` 后走 `StataMP-64.exe /e do` 批处理，解析 log 里的 `r(...)` 错误码，超时 300s；`base.py` 用 `asyncio.to_thread` 把阻塞调用移出事件循环，所以 6 路才能真并行。 |
| 质量门与自动修订？ | `_check_quality_review`：**≥80 直接写论文；60–79 且修订次数 <3 → 回 `revise_design` 重跑数据处理；<60 或已修 3 次 → 停下等人工**。`revise_design` 会把审查的 issues/suggestions 连同原设计回灌给设计 Agent，并写 `revision_history`。 |
| 复现性怎么留痕？ | 每次运行一个 `workflow_run_id`，`utils/workflow_trace.py` 逐阶段追加 `started / completed / failed` 事件（含 `duration_ms`、paper 数、quality score），`/api/workflow/trace/{project_id}` 可读回；前端 `WorkflowView` 有"执行轨迹"抽屉直接展示。产物按 `01_文献分析.json → 02_实验设计方案.md → 03_数据处理.json → 04_统计分析.json → 05_论文章节.json` 落盘。 |
| 交互设计上做了什么？ | 8 阶段 Steps + 每阶段卡片 + 6 个分析 Agent 的实时进度；确认门做成横幅"等待确认实验设计 + 确认设计并继续"；也支持在对话里直接说"确认设计 / 改一下模型"（正则识别 `确认设计|确认方案|同意设计|设计没问题|按此设计继续`）；没有 supervisor 实例时用 `workflow_state.json` 兜底恢复状态。 |
| 边界在哪？ | 需要本机装 Stata 与 LLM Key；向量召回、OCR、DiD/事件研究/RDD/PSM 尚未接入；`parallel_execution` 脚本第 4 段集成测试因 mock state 缺 `output_folder` 报错（脚本自身问题，1–3 段结论有效）。纯前端 demo 侧的向量检索、OCR、真实 `.docx` 导出同样标注为"待迭代"。 |

## 附：字数统计命令（改完文案可自查）

```powershell
$s = '把这段文案粘到这里'
($s -replace '\s','').Length
```
