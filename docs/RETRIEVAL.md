# 检索与 PDF 解析（RETRIEVAL.md）

本文件说明 `frontend-demo` 新增的真实检索能力：**PDF 文本抽取 → 分块 → 中文 BM25 → RRF 融合 → 可核验引用出处**。

- 代码：`scripts/pdftext.js`、`scripts/bm25.js`、`scripts/corpus.js`
- 测试：`test/retrieval.test.js`（`node test/retrieval.test.js`，52 项，全过）
- 依赖：**零**。没有 ES module、没有构建步骤、没有 npm 包、没有后端。

---

## 0. 一句话结论与诚实边界

| 能力 | 状态 |
|---|---|
| 中文 bigram 分词 + BM25 + RRF 融合检索 | **已实现并单测对拍**（含手算期望值） |
| 引用出处：`charRange` 切原文 === 返回的 `quote` | **已实现并真测**（含反向对照：篡改后必须失败） |
| 分块（不跨页、可回切原文、带页码） | **已实现并单测** |
| 质量诊断（覆盖率/乱码率/扫描件/双栏/页数/字符数） | **已实现并单测**（含构造样本手算） |
| 内置离线 PDF 解析器（经典 PDF：未压缩 / FlateDecode、Type0+ToUnicode 中文） | **已实现，并用自造的最小合法 PDF 真测通过** |
| pdf.js 运行时加载（本地 vendor → CDN UMD → CDN ESM） | **代码已实现，但 CDN 网络路径未验证**（本机无网络，见 §6.1） |
| pdf.js 抽取管线（getTextContent → 行/页/几何） | 已用**注入式假引擎**验证适配器；**未用真实 pdf.js 验证** |
| 扫描件 OCR | **未做**（明确不做，只标记） |
| 向量/语义检索 | **未做**（本 Demo 只有词法检索） |

> 上图里凡是写「未验证」的，就是真的没验证过，不要当成已验证。

---

## 1. PDF 加载策略与降级行为

### 1.1 三级引擎

`ZY.pdftext.extract(input, opts)` 按可用性依次尝试：

1. **pdf.js**（`opts`/全局已注入 → `window.pdfjsLib` → 本地 `vendor/pdf.min.js` → CDN UMD `pdfjs-dist@3.11.174` → CDN ESM `pdfjs-dist@4.10.38`）
   - UMD/ESM 走 `<script>` 注入 / 动态 `import()`，并设置 `GlobalWorkerOptions.workerSrc`。
   - 候选 URL 全部写在 `CONFIG.umd` / `CONFIG.esm` / `CONFIG.local`，可整体替换（换镜像、锁版本）。
2. **内置降级解析器**（`engine: 'builtin'`）：pdf.js 不可用或抛错时的兜底。
3. **纯文本**（`ZY.pdftext.extractText(text)`，`engine: 'plaintext'`）：按 `\f` 分页。

### 1.2 降级行为（必须"永不炸页面"）

- `loadEngine()` **永远 resolve**，失败返回 `{ok:false, source:'unavailable', message:'…'}`，`message` 明确写出「离线环境或 CDN 不可达」+ 尝试过的 URL + 最后错误，并说明「文献库检索/索引/引用出处不受影响」。
- `extract()` **永远 resolve**：引擎同步抛错、返回被拒 promise、拿到坏字节，三种情况都走同一套降级链，不会让调用方的 `await` 抛异常。
- 在完全没有 `document` / `fetch` / `DecompressionStream` / 定时器的沙箱里（测试就是这么跑的），`loadEngine()` 仍返回 `ok:false` 且不抛异常，其余功能照常工作（见测试 `offline default`）。

### 1.3 内置降级解析器能吃什么

- 经典 PDF：`%PDF-` 头（允许前 1024 字节前导垃圾）、**xref 表**（xref 流回退到全文件对象扫描）、`trailer`/`Root`/`Pages`/`Kids` 页面树（含资源继承）。
- 内容流：**未压缩** 或 **FlateDecode**（用浏览器/Node 自带的 `DecompressionStream('deflate')`）。其他过滤器（`DCTDecode`、`JPXDecode`、`LZWDecode`…）会被记为 `parse.unsupported`，对应页面文本缺失并给出警告。
- 字体：简单字体（Type1/TrueType，WinAnsi/Latin-1 近似）与 **Type0 + Identity-H 两字节码**；`/ToUnicode` CMap 支持 `beginbfchar` 与 `beginbfrange`（含目的地自增与数组形式）。**没有 ToUnicode 的 Type0 字体产出 U+FFFD**，并被计入乱码率（这是诚实降级，不是静默错误）。
- **不支持**：对象流（`/ObjStm`）、xref 流（PDF 1.5+）、加密文件（`/Encrypt`，明确报「已加密」）、LZW/JPEG 等过滤器、OCR。
- 解析结果里带 `parse.via`（`'xref'` / `'scan'`）与 `parse.objects`，可判断走的哪条路。

### 1.4 引用出处（页码 + 字符区间）

- 页 `pages[i].charStart/charEnd` 是**全局字符偏移**，满足 `fullText.slice(charStart, charEnd) === pages[i].text`（页间用单个 `\n` 连接）。
- pdf.js 路径保留每页 `width/height` 与文本项几何，用 `x`（升序）拼行、`y`（降序）排行；CJK 之间不插空格，拉丁词之间按间隙插空格，`hasEOL` 强制换行。
- 内置降级解析器**不做版式几何分析** → `twoColRisk` 记为 `'unknown'`（不是伪装成 `'none'`）。

---

## 2. 分词规则（`ZY.bm25.tokenize`）

中文没有空格，本实现**不用 jieba**，用 **bigram + 单字 + 英文/数字单词** 的混合方案：

1. **归一化**：去零宽字符 → NFKC（全角→半角）→ 小写（仅英文/数字受影响）。
2. **CJK 连续段**：先输出全部 **bigram**（左→右），再输出全部**单字**（左→右）。
   - 例：`数字化转型` → `数字, 字化, 化转, 转型, 数, 字, 化, 转, 型`
   - 单字段落只出单字（如 `年`）。
3. **英文/数字**：按 `[0-9A-Za-z]` 连续段取词，小写归一（`DiD` → `did`）。
4. **停用规则**
   - 单字停用字表（`的/了/是/在/与/及/或/等/这/那/也/就/…`）：**bigram 命中任一停用字即整条丢弃**（`新与`、`与驱` 被丢掉），单字本身也丢。
   - **刻意不收** `中/上/下/内/外/前/后`——它们常出现在实体名里（中国、上市、外部性），误删直接伤召回。
   - bigram 级停用词表（`一个/进行/通过/我们/本文/因此/…`）显式列出，便于阅读。
   - 英文停用词表**刻意不含** `did / fe / iv / rdd / psm / tfp` 等方法缩写（`DiD`、`FE` 是识别策略关键词，误删会让相关检索归零）。
5. **查询侧分词与索引侧不同**（`ZY.bm25.queryTerms`，附加 API）：
   - 索引侧保留单字（让「数」这种单字查询可用）；
   - 查询侧对**多字 CJK 段只出 bigram**。否则查询「扫描件」会命中任何含「件」的文档（例如「…重要条件。」），把真正的扫描件压下去。实测修复前 `扫描件` 的 top3 全是无关文献，修复后唯一命中 d10。
   - 代价（已知）：查询「创新」不会命中「创造新的价值」这类**不连续**出现（bigram 方案的固有取舍）。

---

## 3. BM25（`ZY.bm25`）

标准实现，参数 `k1 = 1.5`、`b = 0.75`：

```
idf(t)      = ln(1 + (N - df + 0.5) / (df + 0.5))
score(t, d) = idf(t) · tf·(k1+1) / (tf + k1·(1 - b + b·dl/avgdl))
```

- A 路（证据强度）分数 = `BM25(正文) + metaBoost × BM25(元数据)`，`metaBoost = 0.5`。
- 元数据字段文档 = **标题 ×3 + 期刊 ×2 + (年份/作者/方法/结论/关键词) ×1**（重复次数即权重）。
- 查询词去重后求和；无命中的文档不进结果；同分按 `id` 升序（确定性）。
- 可覆盖：`opts.k1 / opts.b / opts.metaBoost / opts.titleBoost / opts.journalBoost`。

### 3.1 手算对拍（测试里逐字写死了这些数字）

语料：`d1 = "apple banana cherry"`、`d2 = "apple apple banana"`、`d3 = "cherry date"`。
`N = 3`，`avgdl = 8/3 = 2.666…`

```
idf(apple, df=2) = ln(1 + 1.5/2.5) = ln(1.6) = 0.47000362924573558
idf(date,  df=1) = ln(1 + 2.5/1.5) = ln(8/3) = 0.98082925301172641

d1: norm = 0.25 + 0.75·(3/(8/3)) = 1.09375
    score = 0.47000362924573558 · 2.5/(1 + 1.5·1.09375) = 0.44497385017347751
d2: score = 0.47000362924573558 · 5/(2 + 1.5·1.09375) = 0.64549854660358541   （tf 饱和：0.645 < 2×0.4449）
d3: norm = 0.25 + 0.75·0.75 = 0.8125
    score = 0.98082925301172641 · 2.5/(1 + 1.5·0.8125) = 1.10515972170335375
```

其他已测性质：`k1=0` 时分数恒等于 `idf`（与 tf 无关）；`b=0` 时 d2/d1 分数比 = `(5/3.5)/(2.5/2.5) = 1.4285714285714286`；所有文档等长（`dl == avgdl`）时单词语义分数恰好等于 `idf`；稀有词 `idf` > 常见词 `idf`。

---

## 4. RRF 融合与「第二路是什么」

`ZY.bm25.rrf(rankings, k)`：`score = Σ 1/(k + rank)`，`rank` 从 1 开始，`k = 60`。
同一路内重复 id 只取最好名次；输入分数被忽略；同分按 `id 升序`（确定性）。

两路：

| 路 | 定义 | 性质 |
|---|---|---|
| **A 路（证据强度）** | 正文 BM25 + `0.5 ×` 元数据 BM25 | 有 tf 饱和与长度归一，看「出现得多不多、稠不稠」 |
| **B 路（查询覆盖率）** | `Σ_t idf(t)·boost(t)`，`t` 为去重后的查询词；`boost = 1 + 2·[命中标题] + 1·[命中期刊]` | **不看 tf、不做长度归一**，看「查询词被覆盖了多少」 |

**为什么第二路不选「纯元数据 BM25」**：RRF 只看名次、丢掉分数幅度，所以「两路都沾一点」的宽泛文档会压过「只有一路但极强」的专业文献。实测样例库查询 **「宽带中国试点」**：只有 d21 真正覆盖该短语，但在「纯 meta 第二路」下它掉到**第 9 名**（用户在前 8 条里看不到），而只在期刊名里含「中国」的 d19 排到了第 1。改成覆盖率第二路后，d21 在 A 路和 B 路**都排第 1**。这条回归用例已写进测试（`RRF relevance regression`）。

字段加权并没有丢：标题/期刊命中由 A 路的 `metaBoost` 与 B 路的 `boost` 共同承担，两路都保留可手算的单测。

### 4.1 RRF 手算对拍

`k=60`，`1/61 = 0.01639344262295082`、`1/62 = 0.01612903225806452`、`1/63 = 0.01587301587301587`

```
rrf([['a','b','c'], ['b','c','a']], 60)
  a = 1/61 + 1/63 = 0.03226645849596670
  b = 1/62 + 1/61 = 0.03252247488101534   ← 最大
  c = 1/63 + 1/62 = 0.03200204813108039
  ⇒ 排序 b > a > c
k=1 时同一输入：a = 0.75、b = 5/6、c = 7/12 ⇒ 仍 b > a > c
```

---

## 5. 分块策略（`ZY.corpus`）

- **块不跨页**：先在页内切块，再映射成全局偏移。
- 目标块长 `chunkSize = 400`，相邻重叠 `chunkOverlap = 80`，尾部不足 `minChunk = 80` 的块并入前一块。
- 切点优先落在**句末标点**（`。！？；!?\n`）上，回看区间为 `[pos + 0.6·size, pos + size]`；找不到就硬切。
- 不变量（每个块都成立，测试逐块断言）：
  - `fullText.slice(chunk.charStart, chunk.charEnd) === chunk.text`
  - 块落在其 `page` 的 `[charStart, charEnd]` 之间（不跨页错位）
  - 每页首块从页首开始、末块到页尾结束、相邻块无缝且前进
- `overlap >= size` 时强制前进（防死循环）。

### 5.1 引用窗口（snippet）

引用窗口长度硬上限 `maxSnippet = 180`，软下限 `minSnippet = 40`；优先取完整句子（前后各回看/前看 60% 上限），句子过长则围绕命中居中截取。

**窗口选择按「覆盖查询词权重之和最大」**，同分取最靠前；权重取该词的 `idf`。只锚第一个命中会把窗口锚在标题上——实测查询「外观设计专利」原本返回的是标题行，改后返回真正回答问题的原句。这条也有测试锁定。

---

## 6. 质量诊断

`ZY.pdftext.diagnose(pages, opts)`（`ZY.corpus.diag(docId)` 复用同一套阈值，单一事实来源）。

| 指标 | 定义 | 依据 |
|---|---|---|
| `pages` | 页数 | — |
| `chars` | `fullText.length`（含页间分隔符） | — |
| `nonSpaceChars` | 去空白后的字符数 | 覆盖率的分子 |
| `avgCharsPerPage` | `非空白字符数 / 页数`（四舍五入） | — |
| `coverage` | `clamp(avgCharsPerPage / 900, 0, 1)`（用未舍入值再四舍五入到 4 位） | 中文期刊单栏一页正文量级约 900–1400 字；取 900 作为「满覆盖」基准 |
| `mojibakeRate` | 乱码字符数 / 非空白字符数（6 位小数） | 见下 |
| `scanned` | `页数>0 且 非空白字符数 === 0` | **只表达「有页但完全没有文字层」**；「文字很少」由 `coverage`/`textPageRatio` 表达，两者不混 |
| `twoColRisk` | `'none' \| 'low' \| 'high' \| 'unknown'` | 几何启发式，见下 |
| `quality` | `high \| medium \| low` | 阈值见下 |

**乱码识别**（刻意不做「重音字母=乱码」的一刀切）：
- 计入：`U+FFFD`、C0 控制符、经典 UTF-8→Latin-1 误码序列（`â€`、`ã€`）、`锟斤拷`、**连续 ≥2 个 Latin-1 字母**（如 `Ã©`）。
- 不计入：单个重音字母（`café`、`résumé`、`Müller`、`Björk` 均判 0 乱码，有测试守着）。

**双栏风险**（`ZY.pdftext.twoColRisk(items, pageWidth)`，纯函数可单测）：
把文本项按 `y`（容差 2）聚成行 → 只看 **item ≥ 4** 的行 → 以页宽一半分左右簇，要求两簇各自宽度 ≥ 页宽 25% 且中间空隙 > 页宽 4% → 记一行双栏 → 双栏行占比 ≥60% 判 `high`，≥25% 判 `low`，否则 `none`；没有几何信息（纯文本/内置解析器）→ `unknown`。

**分级阈值**（`ZY.pdftext.qualityOf`）：

```
low    : scanned  ∥ coverage < 0.70 ∥ mojibakeRate > 0.05 ∥ trust === 'low'
medium : coverage < 0.90 ∥ mojibakeRate > 0.01 ∥ twoColRisk === 'high'
high   : 其余
```

**声明值 vs 计算值**：`D.LIBRARY` 的 22 篇样例自带声明式质量字段（`coverage/mojibake/scanned/twoCol`），这是 Demo 既有的事实来源；`corpus.diag()` 会**优先采用声明值**，并在 `diag.sources` 里逐项标注 `declared`/`computed`，同时把真实计算值完整保留在 `diag.computed`。真实上传的 PDF 没有声明值，一律用计算值。

> 因此 `d10`（扫描件样例）的 `diag.computed.scanned === false`（合成正文确实有文字）而 `diag.effective.scanned === true`（声明值生效）——两者都在结果里，不掩盖。

**低质量降权**：`corpus.search` 对 `lowQuality` 篇目的分数乘 `qualityPenalty = 0.6`，结果里 `lowQuality:true` 且 `rawScore` 保留；`includeLowQuality:false` 可整体过滤。

---

## 7. 引用可核验（产品承诺）

对任意检索结果 `r`：

```js
ZY.corpus.getDoc(r.docId).fullText.slice(r.charRange[0], r.charRange[1]) === r.quote
```

- 由「先定位、再切片」的结构保证（`quote` 就是 `fullText.slice(cs, ce)`）。
- `ZY.corpus.verify(docId, charRange, quote)` 提供运行时核验口子；测试里还有**反向对照**：`quote + 'X'`、区间减 1、未知 docId 都必须返回 `ok:false`（否则这条断言就是空的）。
- 样例库的 22 篇声明原句都能在合成正文里**精确定位**（`doc.quoteRange`，测试逐篇断言 `slice(quoteRange) === 声明原句`）。

> ⚠️ 给 Lead 的接线提醒：`D.LIBRARY` 里旧的 `page` / `charRange`（例如 d21 的「第 18 页 / 字符 1560–1628」）是**早期演示数据里的示意值，无法核验**；真实可核验的出处是 `corpus.search` 返回的 `page` / `charRange`（样例库是合成正文，页码为 1）。旧值以 `declaredPage` / `declaredCharRange` 原样保留在 Doc 上，是否继续展示由 Lead 决定。

---

## 8. 已知限制

1. **未做 OCR**：扫描件（无文字层）只能标记「仅提及」，不能引用原句。`scanned` 为 `true` 时结果里会出现相应警告。
2. **未做向量/语义检索**：只做词法（BM25 + 覆盖率）。近义改写、跨语言都检索不到。
3. **bigram 的固有取舍**：不连续出现（「创」…「新」）不命中；长词切碎后可能引入伪命中（已用停用字规则压制）。
4. **无同义词/词形还原/拼写纠错**：`DiD` 与 `双重差分` 不通。
5. **内置降级解析器覆盖窄**：对象流/xref 流（PDF 1.5+ 主流产出）、加密、LZW/JBIG2/JPEG 内容都处理不了；真实期刊 PDF 大概率需要 pdf.js。它也不做版式几何分析（`twoColRisk = unknown`）。
6. **pdf.js 路径未在真实网络/真实 PDF 上验证**（见 §9）。
7. **索引是懒重建的**：每次增删文档后首次检索会重建全量索引。22 篇样例无感；上万篇需要改成增量索引。
8. **覆盖率 900 字/页只是量级基准**：短页/短文档会被判低覆盖（例如自造的一行 PDF 只有 16 个非空白字符 → `coverage≈0.018` → `quality=low`）。这是**有意为之**的诚实判断，不是 bug；阈值可在 `pdftext.CONFIG` 里调。
9. **`pageSep = '\n'`**：页间用单个 `\n` 连接。若某页文本本身以 `\n` 结尾，切页时可能出现空行——不影响偏移正确性（偏移按页记录），但显示上会有空行。
10. **`twoColRisk` 只报警不修正**：双栏 PDF 的阅读顺序仍可能跨栏错位，页码/区间需人工核对（界面已有提示语）。

---

## 9. 测试：怎么跑，覆盖了什么，**没**覆盖什么

```bash
node --check scripts/pdftext.js && node --check scripts/bm25.js && node --check scripts/corpus.js
node test/retrieval.test.js       # 期望输出：TOTAL 52 PASS 52 FAIL 0 / RESULT PASS
```

测试用 `vm.createContext` 造 `window` 桩加载 classic script，**不依赖浏览器**；`data.js` 直接读目标目录里的既有文件（不拷贝、不修改）。输出只用 ASCII（`PASS`/`FAIL`），避免 GBK 控制台编码问题。

覆盖（52 项，全部真断言）：

- tokenizer：bigram 顺序、单字、停用字/停用词、大小写与全角归一、`tokenizeSpans` 偏移回切原文、查询侧 vs 索引侧差异
- BM25：**idf 与逐篇分数手算对拍**、稀有词 > 常见词、tf 饱和、`k1=0`/`b=0` 行为、空/停用词/无命中查询
- 覆盖率路（B 路）：逐条手算、`tf` 无关性、与 BM25 的互补性
- RRF：手算 3 组（`k=60`、`k=1`）、忽略输入分数、同路去重、同分确定性
- 分块：不跨页、逐块回切原文、页首/页尾覆盖、重叠有界、周期文本切点手算、巨大重叠不死循环
- 引用出处：9 个查询 × 每条结果的不变量 + 声明原句区间交叉核对 + 负向对照
- 质量诊断：扫描件、乱码（手算 5/11、2/4、重音不误报）、覆盖率阶梯（450/810/800/900/1800）、双栏几何（全双栏/单栏/6:4/短行/无几何）
- 引擎降级：离线 `loadEngine` 失败语义、非 PDF/空输入、加密、无页对象、坏 `startxref` 回退扫描
- **手写最小合法 PDF**（ASCII / 中文 Type0+Identity-H+ToUnicode（bfchar+bfrange）/ FlateDecode / 空页 / `DCTDecode`）：先用**独立于被测代码**的结构校验器证明字节串合法（header、`startxref` 指向 `xref`、每条 xref 偏移都指向 `N 0 obj`、`/Size` 与对象数一致、`/Root` 解析到 Catalog、`%%EOF`），再断言抽取文本逐字相等、`parse.via === 'xref'`
- 注入式假 pdf.js：CDN 装载路由、worker 配置、行/页拼接与偏移、双栏几何、引擎抛错回退、`fallback:false` 严格模式
- 零网络端到端：引擎不可用时样例库检索 + 引用不变量照常
- API 形状：task-7 签名的存在性与参数个数

**没覆盖（不要在别处说成已验证）**：

1. **真实 CDN 下载 pdf.js**：本机无网络，测试用注入式 host + 假引擎验证「装载流程与适配器」，**不等于**验证了 pdf.js 本身。
2. **真实学术 PDF 的抽取质量**：未拿真实期刊 PDF 跑过；内置解析器只用自造 PDF 验证过。
3. **浏览器环境**：测试跑在 Node + `vm` 里，未在真实浏览器里点过界面（DOM 注入 `vendor/pdf.min.js` 那条路径只在代码里存在）。
4. **`DecompressionStream` 的真浏览器行为**：Node 24 下验证通过；浏览器实现按标准应一致，但未实测。
5. **大文件/性能**：没有大 PDF 与上万篇语料的压力测试。

---

## 10. 对外 API（与 task-7 签名的差异）

严格实现了 task-7 要求的签名：

```js
window.ZY.pdftext = {
  loadEngine(opts)                        // -> Promise<{ok, source:'cdn'|'local'|'unavailable', message, ...}>
  extract(arrayBufferOrFile, opts)        // -> Promise<{ok, pages:[{pageNo,text,chars}], fullText, diag, message, ...}>
};
window.ZY.bm25 = {
  tokenize(text), buildIndex(docs), search(index, query, opts), rrf(rankings, k)
};
window.ZY.corpus = {
  addDocument(doc, opts), addSampleLibrary(libraryArray),
  search(query, opts), stats(), diag(docId)
};
```

**与描述签名的不一致处（只有扩展，没有删改）：**

1. `loadEngine()` 的 `source` 取值**多了 `'local'`**（用于「调用方注入的引擎」「页面上预载的全局 pdf.js」「本地 `vendor/` 脚本」这三种非 CDN 来源）。原因：这几种情况确实不是从 CDN 来的，写成 `'cdn'` 会是假话；`via` 字段给出精确路由（`injected` / `global` / `local` / `cdn-umd` / `cdn-esm`）。
2. `search()` 的结果与 `extract()` 的返回是**超集**：`extract` 的页对象另带 `charStart/charEnd/width/height/lineCount`，返回另带 `engine/warnings/parse/engineStatus`；`bm25.search` 的结果另带 `bm25Score/metaScore/routeScore/coverageScore/*Rank/rrfScore`；`corpus.search` 的结果另带 `id/method/conclusion/rawScore/qualityPenalty/quality/matchedTerms/coverageScore/coverageRank/diag/rank/snippetMismatch/declaredRrf`。均为附加字段，原字段名与语义不变。
3. `corpus.diag(docId)` 返回**扁平**对象：除必填的 `pages/chars/avgCharsPerPage/coverage/mojibakeRate/scanned/twoColRisk` 外，带 `quality/lowQuality/sources/effective/declared/computed`（声明值与计算值的出处）。
4. 附加 API（描述里没有、但被测试与文档使用）：`pdftext.diagnose/qualityOf/twoColRisk/mojibakeStats/joinPages/extractText/hasEngine/engineStatus/reset/CONFIG/QUALITY`；`bm25.queryTerms/tokenizeSpans/idf/scoreTerm/DEFAULTS/STOPWORDS`；`corpus.getDoc/list/clear/ensureIndex/chunkText/verify/lastResults/DEFAULTS`。
5. `bm25.buildIndex` 的 `docs[i]` 接受**可选** `chunks: [{page,charStart,charEnd,text}]`（描述里只有 `{id,title,journal,year,text}`）。缺省时整篇视为第 1 页的一个块。

---

## 11. 接入（Lead 负责，勿由本模块擅自改其他文件）

1. `index.html` 里在 `data.js` 之后、`app.js` 之前按序加载：

   ```html
   <script src="scripts/pdftext.js"></script>
   <script src="scripts/bm25.js"></script>
   <script src="scripts/corpus.js"></script>
   ```

   （`corpus.js` 内部对 `ZY.pdftext` / `ZY.bm25` 是**延迟取用**的，所以顺序其实不敏感；但保持上面顺序最直观。）

2. `app.js` 的 `retrieveContext()` 可以整体换成：

   ```js
   ZY.corpus.addSampleLibrary(ZY.data.LIBRARY);          // 首次
   var hits = ZY.corpus.search(query, { limit: 5 });      // 结果带 quote/page/charRange
   ```

   `hits[i].quote` 就是可核验的原句，`hits[i].page` / `hits[i].charRange` 是对应出处。

3. `render.js` 的文献库预览/清单可以直接读：

   - 预览：`ZY.corpus.search(q, {limit: 6})` → `title/journal/year/page/charRange/quote/score/lowQuality`
   - 清单：`ZY.corpus.list()` → 每篇的 `diag.coverage / diag.mojibakeRate / diag.scanned / diag.twoColRisk / diag.pages / diag.chars`
   - 体检汇总：`ZY.corpus.stats()` → `docs/chunks/tokens/avgChunksPerDoc/pages/uniqueTerms/lowQualityDocs/highQualityDocs/avgCoverage`
   - 引擎状态：`ZY.pdftext.engineStatus()`（可显示「PDF 解析引擎：未加载（离线）」并把原因 `message` 展示给用户）

4. 想支持离线 PDF 解析：把 pdf.js 的 `pdf.min.js` 放到 `vendor/`（见 `vendor/README.md`），加载器会自动优先使用它，无需改代码。
