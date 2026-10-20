# 智研（YanJing）· 经管论文研究助手 — 纯前端 Demo 复刻规格（高保真演示轨）

1. 性质：由已完成的高保真 Demo 逆向出的复刻规格，交付给 AI coding agent 照做。
2. 运行形态：单页纯前端、零构建零后端零密钥；不用框架/打包器/CDN；图形 SVG/CSS 自绘；双击 `index.html` 即可运行，无需任何服务器与外部文件。
3. 数据来源：全部内置校准样例（写在 `scripts/data.js` 一类文件里）；界面不得出现「读取本地文件」「配置模型」等会失败的入口预期。
4. 术语：`「」` 内为界面可见文案原文，逐字。
5. 暂不做：本地文件夹接入、真实 `.dta`/PDF 解析、真实模型调用、真实统计计算、联网。

## 1. 需求背景

- 范式/流程无人教：九大部分不在考纲；导师带 5–15 个学生只给一轮批注。
- 实证最黑箱：每步有方法论前提；通用 AI 代码能跑但结论不可信。
- 通用 AI Agent 不可信：编造文献、质量失控、实验设计错误（相关性写成因果，最严重）、结果解读错、无过程。
- 诚实边界：演示数据虚构；不编造文献（引不到写「此处待补文献」）；识别策略不成立给「做不了 + 理由 + 你能补什么」；问答走"检索 → 片段 → 引用"，用「演示数据」标记区分。
- 机会点：内置论文范式、以你自己的文献库为底座、从命题走到成稿的科研助手；七步各产出「可执行代码 + 结果文件 + 结果解读」三件套。

## 2. 需求目标

本节覆盖产品定位、价值说明、质量门、验收判据、明确不做、功能范围。

### 2.1 产品定位
> 以你自己的文献库为知识底座、带你从研究想法走到一篇合格论文的经管科研助手。目标不是"替你写"，而是让你第一次也能跑完一遍完整的研究流程，产出一篇至少 80 分的合格论文，并且知道每一步为什么这么做。

### 2.2 价值说明（空态原文）
> 「以你自己的文献库为知识底座，从研究想法走到一篇可投稿的论文。」
> 「文献与数据保存在本机；只有配置了在线模型后，当前问题与必要上下文才会发送给该服务商。」

### 2.3 质量门（总分 = 得分 × 权重；任一维度 < 60 即不合格）
- 结构完整度 25%：九大部分齐全。
- 实证规范度 30%：聚类标准误、固定效应声明、N 与组内 R²；稳健性 ≥3 项；内生性有交代。
- 文献支撑度 20%：引用须来自本库；综述按流派/策略/分歧组织。
- 语言风格 15%：对标《中国工业经济》。
- 结论审慎度 10%：措辞与证据强度匹配（相关不写因果）；因果动词为 0。

### 2.4 验收判据
- G1 非预置命题也能走完全链。
- G2 命中文献全部来自内置样例库，零编造。
- G3 实验设计先出方案等确认，未确认不跑数据；确认前数据处理/统计/论文页签锁定。
- G4 七步各产出「代码 + 结果 + 解读」三件套视图；下载见§4.5.9。
- G5 结果解读与结果文件数值一致。
- G6 初稿按默认风格包（《中国工业经济》）。
- G7 刷新后现场复原（F5）。
- G8 界面全中文（简体），无英文占位、无 lorem ipsum。
- 内置样例 22 篇文献（元数据 + 合成正文）。

### 2.5 明确不做
- 不联网抓取；不查重降重；不承诺零幻觉（不编造文献）；不代替学术判断；不跨设备同步；不承诺 PDF 版式 100% 正确；不代写整篇；不提供 p-hacking。
- 暂不做：本地文件夹接入、真实 `.dta`/PDF 解析、真实模型调用、真实统计计算、联网。

### 2.6 功能范围（§4 目录；F-05…F-10 = 阶段一…六；全 P0）
- F-01 应用外壳
- F-02 项目栏
- F-03 研究对话区
- F-04 成果区
- F-05 项目定义
- F-06 文献分析
- F-07 实验设计 ★
- F-08 数据处理
- F-09 统计分析 ★
- F-10 论文生成
- F-11 资源库
- F-12 模型与账号设置
- F-13 持久化/复原

## 3. UI 设计规范
数值照抄:禁近似取色/紫蓝互换/字号取整.全局:box-sizing:border-box;html,body{ht100%};body{ovf hidden};color-scheme:light;<html lang="zh-CN">
缩写:pd bd rd bg col mg ht df ovf z bs bb bt bl gtc gtr minh maxh fs fw ls ws(属性);so=solid;if=inline-flex;fx=flex;ct=center;ab=auto;mm=minmax;tr=transition;hv=hover;隐=none;dis/sel/def=禁用/选中/默认;同盒=同.btn盒
### 3.1 原则
1 紫=状态/定位(项目选中/阶段定位/页签/状态点);蓝=操作/数据(主按钮/链接/数据标记/焦点环);禁紫提交按钮,蓝表选中
2 渐变仅Logo;例外.zy-search底纹
3 卡片不堆叠,限证据块/结果摘要/模态任务;语义色必配文案/图形
### 3.2 色板(逐字,小写;硬编码不抽变量)
--canvas:#f5f7fc;--paper:#ffffff;--rail-bg:#f9fbff(+.demo-flag);--purple:#5949b9;--purple-soft:#f0ecff;--purple-line:#d9d0ff;--purple-brand:#7a6ad4(「智研」.brand>span)
--blue:#1769be;--blue-hover:#11589f;--blue-soft:#e9f3ff;--blue-ink:#165b9e
--ink:#18243b;--ink-secondary:#526179;--ink-tertiary:#58667e;--ink-placeholder:#65738a
--line:#dce3f0(1px);--line-strong:#cdd8e8
--success:#247d65;--warning:#a86220;--danger:#bf475c(成功/警告(受阻+星号)/错误);--success-soft:#e8f4f0;--warning-soft:#fdf3e8;--danger-soft:#fdeef1
--selection-bg:#dbe7ff(::selection);--focus-ring:2px so var(--blue);--shadow-card:0 1px 2px rgba(24,36,59,.04);--shadow-pop:0 8px 28px rgba(24,36,59,.14)
补充硬编码:#eef3fc,#f2f5fc(hv 底),#e7edf7,#f2f4fa(.zy-step),#fbfaff(.zy-search)
### 3.3 字体排版(四栈逐字,顺序不改)
--font-sans:"Times New Roman", "Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif(UI:.rail-head,.panel-title,.section-heading,.subhead,.stage-label,.brand,.start-title,.tabs button,.col-resizer等)
--font-kai:"Times New Roman", "KaiTi", "STKaiti", "Kaiti SC", "Noto Serif SC", serif(正文:body,.message p,.card p,.prose,.hint,.start-note等)
--font-mono:"JetBrains Mono", "Cascadia Mono", Consolas, "Courier New", monospace(代码:code,pre,.mono,.file-name,.code-block)
--font-latin:"Times New Roman", "Liberation Serif", Georgia, serif(备用)
tabular-nums:.table td.num,.table th.num,.stat-value,.coefficient,.amount,.project-idx,.resource-row .count,.message h3 time等
字号/行高:--fs-body 14px/--lh-body 1.7;--fs-block 16px/--lh-block 1.4;--fs-title 20px/--lh-title 1.35;--fs-dense 12px;--fs-micro 11px
h3 13px;.start-title 24px/1.35/700(<=880px:22px,<=560px:20px);.result-head h1 21px(<=560px:18px);.result-sub 13px/1.6;#chat-project-path 16px/1.35;.chat-sub 12px;.paper-page h1 22px/1.5;.paper-h2 16px;.paper-h3 14px;.paper-page p 14px/1.85/text-indent 2em;h1..h4(#project-title等){mg0;fw600}
### 3.4 尺寸
--sp-1 4/--sp-2 8/--sp-3 12/--sp-4 16/--sp-5 20/--sp-6 24/--sp-8 32;--gap-group 16px;--gap-block 24px
--rail-w 248px(220/340);--chat-w 390px(320/560);--gutter 6px(线1px);--results-w-min 480px;--results-strip 44px;--w-start 820px;--w-reading 1060px;--h-topbar 64px
--h-control 38px(36-40px);--r-btn 6px/--r-card 8px/--r-chip 5px;.modal 10px;.btn-sm ht30px/pd0 10px/fs11px
.avatar 30x30圆;.user-avatar 28x28;.message .marker 27x27/rd6px;.step-dot 20x20;.step-no 22x22;.rs-icon/.file-icon 26x26
SVG viewBox 0 0 24 24/1.9:11/12/13/14/15/16
--t-fast 160ms(150-200ms);blink 1s steps(2,start) infinite;zy-spin .8s linear infinite;zy-bounce 1.2s infinite ease-in-out(.18s/.36s);zy-sweep 1.5s ease-in-out infinite;.stream-cursor 紫▍
:focus-visible{outline:var(--focus-ring);outline-offset:var(--focus-offset);rd3px};--focus-offset 2px;滚动条 scrollbar-width:thin;scrollbar-color:#c8d3e6(hv #aebbd2);prefers-reduced-motion:reduce>动画/tr 0.001ms!important
### 3.5 组件
.btn{ht38px;pd0 14px;gap6px;if;ct;bd1px so var(--line-strong);rd6px};bg paper;col ink;12px/600;no|hv bd/col blue+bg blue-soft|dis opacity .5
.btn-primary:同盒;bg/bd blue;col #fff|hv bg/bd blue-hover|dis bg/bd #c9d6e8,col #f3f6fb
.btn-ghost:同盒;bd transparent;col blue|hv bg blue-soft|dis同.btn;.btn-danger:同盒;col danger|hv bd/col danger+bg danger-soft|dis同.btn
.icon-btn 30x30/bd1px transparent/rd6px/col ink-secondary|hv bg blue-soft+bd blue+col blue;.text-action pd4px/rd3px/12px/600/col blue|hv underline
.badge:if;gap5px;pd4px 9px;bd1px;rd5px;11px/600;purple-line/purple-soft/purple;.blue #c6ddfa/blue-soft/blue-ink;.ok #bfe0d5/success-soft/success;.warn #efd5b4/warning-soft/warning;.err #f3c9d1/danger-soft/danger;.plain line/paper/ink-secondary
.chip gap5px/pd4px 8px/rd5px/11px/blue-soft/blue-ink;.purple/.ok/.warn/.plain(#eef2f9+ink-secondary)
.ref-chip mg0 1px/pd0 3px/rd3px/blue-soft/blue-ink/10px/cursor pointer|hv #d3e7ff;.unverified warning-soft/warning
点:.tabs .tab-dot,.project-stage .ps-dot,.rail-model-btn .rm-dot 6x6,.sync-status::before 7x7,.step-item .step-no;def --line-strong/#eef2f9;进行中 --purple(步骤 --blue);完成 --success;受阻/跳过 --warning;失败 --danger
.card bg paper/bd1px line/rd8px/pd18px 20px/bs --shadow-card;.card p 12px/1.75;.card+.card mg-top16px
.card-grid grid/gap16px;.two mm(0,1.3fr) mm(220px,.7fr);.three repeat(ab-fit,mm(200px,1fr));.evidence grid/repeat(ab-fit,mm(190px,1fr))/gap16px;.evidence-item strong 16px紫
.table-wrap ovf-x ab/bd1px var(--line)/rd8px/bg paper
.table width 100%/border-collapse collapse/fs12px;th,td pd10px 12px/ta left/bb1px var(--line)/ws no;th bg #f7f9fd/fs11px/fw700/col ink-secondary/pos sticky/top 0/z 1;行hv #fafcff;.sig col warning/fw700;.sig-none col ink-tertiary
.figure-link col blue/bb1px dashed #9cc4ea|hv实线
遮罩 模态 rgba(24,36,59,.42)/df grid/place-items ct/pd24px/z100;抽屉 rgba(24,36,59,.34)/z90
容器 max-width 640px(.wide 880px)/rd10px/--shadow-pop/maxh calc(100vh - 48px)/纵fx;.drawer 右min(560px,94vw)(.wide min(760px,96vw))/bl1px/z91
头/体/脚 pd18px 22px 14px(h2 16px/.modal-sub 12px kai)/pd20px 22px/pd14px 22px+bt #fbfcff;.foot-left 11px kai
role=dialog/aria-modal=true/aria-label=标题;30ms聚焦首个button|input|textarea|select|[tabindex];ESC/遮罩点击(e.target===mask)关;.icon-btn[aria-label="关闭"]
.empty-state pd40px 24px/ta ct/col ink-secondary/12px/kai;.empty-title 16px/ink/600;.empty-actions mg-top16px/gap10px
.zy-progress bg blue-soft/col blue-ink/rd6/pd9px 12px;.zy-spinner/.zy-dots 12px+13px
.zy-search pd16px/bd1px purple-line/rd8;浅渐变+3px扫光.zy-search-track+.zy-step(解析研究问题/检索文献库/归纳证据结构;当前 purple-soft/purple/600)
.meta-row fx space-between/pd8px 0/bb1px dashed line;.deflist grid/132px mm(0,1fr)/dt,dd 12px kai;.field gap6px/mg-b16px/label 12px/600/ht38px/rd6/12px kai;textarea minh84px
.file-row fx ct/gap10px/pd10px 12px/bd1px line/rd6;.file-icon见3.4/.md紫/.csv绿;.file-name…;.file-size 11px右;.res-item fx ct/gap10px/pd11px 0/bb1px dashed line;.resource-row pd9px 11px/rd6/13px/sel bg purple-soft+inset 2px 0 0 purple
.banner fx align-start/gap10px/pd11px 13px/bd1px/bl-w3px/rd6/12px/1.65;.info蓝/#fbfdff;.warn/warning-soft;.err/danger-soft;.ok/success-soft;.banner-title 12px/700;.banner-actions gap10px
.cite fx align-start/gap9px/pd10px 12px/bd1px line/rd6;.cite-idx紫700/.cite-src 11px三级;.cta-row fx ct fe/gap16px/mg-top16px/bt1px line;.cta-note 11px
.code-block bg #f7f9fd/rd8px/pd14px 16px/maxh460px/mono
Toast fixed/left 50%/bottom 28px/translateX(-50%)/z200/pd10px 16px/rd8px/bg var(--ink)/col #fff/12px/bs --shadow-pop/max-width 80vw/ok>--success,err>--danger/2600ms
**进度与状态组件（演示可见，照抄）**：`.zy-progress`（fx center gap8 pd 9 12 mt6 bg blue-soft rd --r-btn fs-dense ink blue-ink kai）；`.bar`（ht6 rd3 bg #e7edf7 ovf hidden，`>i`{ht100% bg blue tr width .3s ease}，`.purple>i` purple / `.warn>i` warning，`.quality .bar`{fx1 minw60}）；`.progress-list`（col gap2；`li`{fx center gap10 pd 8 0 fs-dense，底边 dashed line}，末项无底边）+ `.step-dot`（20×20 圆 网格居中 bg #eef2f9 ink-tertiary 10px/700 sans；`.done` success-soft/success、`.current` purple-soft/purple、`.blocked` warning-soft/warning）+ `.step-label`（fx1）+ `.step-state`（fs-micro ink-tertiary kai）；`.job`（bd line rd --r-card bg paper pd 14 16，相邻 mt10）+ `.job-head`（fx center space-between gap12 mb9，strong fs-dense sans）+ `.job-meta`（fx center space-between gap12 mt8 fs-micro ink-tertiary kai）；`.status-chip`（if center gap6 fs-micro，`::before` 6×6 圆 currentColor；`.ok/.warn/.err/.idle/.busy` => success/warning/danger/ink-tertiary/blue）。

### 3.6 布局
.app{ht100vh;df grid;gtr 64px mm(0,1fr)}
.topbar 64:gtc var(--rail-w) var(--gutter) mm(0,1fr) ab;.brand列1/pd-left 22px/33x33 logo+19px/700品牌;.crumb列3/12px kai/当前标题/单行省略;.top-actions列4/pd-right 22px/演示数据标记+本地已保存状态+30px圆头像
五列:var(--rail-w) var(--gutter) var(--chat-w) var(--gutter) mm(var(--results-w-min),1fr);.rail/.chat/.results{min-width 0;min-height 0};.results{container-type:inline-size;container-name:results}
空态:gtc var(--rail-w) var(--gutter) mm(0,1fr);.results/#split-chat隐;.chat第3列/justify-self ct/width min(820px,100%)/pd clamp(40px,30vh,300px) 24px 32px;#empty-hero显,.chat-head/.thread隐;.compose无bd/bg,textarea minh112px/maxh208px/pd15px 16px/rd6/15px
收起态:轨道 var(--rail-w) var(--gutter) mm(var(--chat-w),1fr) 0 var(--results-strip);#split-chat隐;右44px竖条.results-strip fx column/align-ct/gap10px/bl1px line/bg rail-bg;.rs-icon 26x26框;.rs-label writing-mode:vertical-rl/11px/600/ls .16em
成果区:.result-head bg paper/pd18px 28px 15px/bb>.tabs pd0 19px/bb;按钮minh46px/pd0 11px/bb 2px so transparent/sel bb-col purple/col purple/700>.content fx 1/ovf ab/pd26px 28px 40px:.content-inner{max-width 1060px;mg 0 ab}
### 3.7 响应式
<=1279.98px:.content{pd22px}
<=1039.98px:纵;body{ovf ab};.app{df block;ht ab};.topbar 58px+pos sticky/隐.crumb;.workspace{fx column};两分隔线隐;.rail下边框,.project-list横滚(.project{width 220px}),.rail-section/.rail-bottom隐;.chat{minh380px};.results{minh620px};收起态展开
<=880px:单列;.app{df block};空态.chat满宽/pd20px 16px 32px;.start-title 22px;示例卡片单列
<=560px:.brand 17px;隐.sync-status与.compose-row small;.result-head h1 18px;.start-title 20px
组件断点:1000px:.pipeline单列;900px:.card-grid.two单列;620px:.deflist单列,.demo-cards单列
容器查询:@container results (max-width:760px)>.card-grid单列/.deflist/.evidence窄/.card紧;(max-width:480px)>.deflist单列
### 3.8 单份 #prompt
#prompt全仓仅一个,两态复用同一节点,.app[data-view]切换其栅格位置与样式;禁复制第二输入框;#btn-send不重建,disabled跨态连续
### 3.9 可访问性
同§3.4:焦点环/动效降级;.sr-only(1x1,clip:rect(0 0 0 0));页签内.sr-only播报真实进度;装饰图标aria-hidden=true;图形按钮必aria-label
<button role=separator aria-orientation=vertical aria-{label,valuemin,valuemax,valuenow}>;成果区aria-expanded+aria-controls="project-view";sel=aria-current(.project/.resource-row[true],.tabs button[step],.step-item[true])
#thread role="log" aria-live="polite" aria-label="对话记录";#prompt关联<label class="sr-only" for="prompt">输入研究问题或修订意见</label>;表格<table><thead><tbody>+th/td,数字列.num;弹层a11y同§3.5;状态点必与文案并存

## 4. 产品需求详情

> 「」=界面文案原文，逐字用。→顺序；✗禁止；‖或。
> 纯前端演示：全部数字来自内置校准样例（写在代码里）。无数据→`—`或不渲染。

### 4.0 页面架构与全局规则（F-01、F-02、F-04）

本节覆盖页面架构、DOM 标识、列宽与交互、阶段状态机、持久化、交互与提交。下文引用的内部函数与状态字段均在其首次出现的「§」处定义。

#### 4.0.1 页面架构

纯前端演示：有声明值一律取声明值，✗现场计算、✗改写、✗回落成别处数值；有声明值的记录/区块统一挂`.badge.blue`「内置样例」。

单页`index.html`。`.app[data-view]`=`empty`/`project`/`resource`(`data-view="empty"`/`data-view="project"`/`data-view="resource"`)；`.app[data-results]`=`expanded`/`collapsed`；`.app`加`.app.is-resizing`(禁过渡动画/文本选择)。

- 空态：两栏`项目栏 248px │ 6px │ 主区`；成果区/对话栏分隔线全隐；主区垂直居中：「开始一项研究」→输入组→唯一示例卡片
- 项目态(默认)：四列`项目栏(220–340) │ 6px │ 对话栏(320–560) │ 6px │ 成果区(≥480)`；资源页同四列，对话栏隐藏，资源面板占对话栏+成果区
- 成果区收起：`项目栏 │ 6px │ 对话栏(自适应)`+右侧 44px竖向入口；只改可见性，不取消任务、不清空成果与对话

①输入框单份DOM`#prompt`：空态`.chat`高=内容、右列垂直居中；项目态=跨行栅格项(`.chat` header/记录/输入三段各自滚动)；✗复制第二个输入框。②「新建」=回空态`activeId = null`，不预建项目。③阶段页签/进度点/项目行阶段文案读同一状态源`workflowStatus(p)`。

#### 4.0.2 DOM与关键标识

```
body > .app[data-view][data-results]: div#overlay-root(模态/抽屉/toast 挂载点)
.topbar: .brand(img.logo+span「智研」); .crumb>b#crumb-project(未选项目时「未选择项目」); .top-actions
.top-actions: span.demo-flag「演示数据」title「本页为纯前端演示：文献、数据与结果均为虚构样例，不代表真实研究结论」; span#sync-status[data-state]「本地已保存」; button#btn-settings.avatar「研」
.workspace: aside.rail; button#split-rail; section.chat; button#split-chat; main.results; button#btn-expand-results
.rail: .rail-head(strong「研究项目」+button#btn-new-project「新建」); nav#project-list.project-list; .rail-section; .rail-bottom
.rail-section: span.rail-section-title「资源库」; button#btn-dataset「数据库」; button#btn-library「文献库」
.rail-bottom: button#btn-user.user-row(span#user-avatar+span#user-name+span#user-hint)
.chat: header.chat-head(strong#chat-project-path+span#chat-subtitle+span.chat-workbench「研究工作台」); div#thread.thread[role=log][aria-live=polite]; section#empty-hero.empty-hero; form#compose; section#empty-samples>div#demo-cards.demo-cards
.empty-hero: h1.start-title「开始一项研究」+p.start-line+p.start-note
#compose: textarea#prompt+.compose-row(small「Enter 发送 · Shift+Enter 换行」+button#btn-send.btn.btn-primary「发送」)
.results: div#resource-view.resource-view[hidden]; div#project-view[hidden]
#project-view: header.result-head; nav#tabs.tabs[aria-label=研究阶段]; div.content>div#stage-content.content-inner
.result-head: .result-head-top(h1#project-title+p#project-subtitle+.result-head-right: div#result-actions+button#btn-collapse-results.icon-btn)
#btn-expand-results.results-strip: span.rs-icon+span.rs-label「成果」
```

#### 4.0.3 列宽与交互

`--rail-w` 248px(220/340)；`--chat-w` 390px(320/560)；`--gutter = 6px`；成果区最小 480px；收起入口 44px；`window.innerWidth < 1040`→`isStacked()`，禁横向拖拽。

- 拖拽：`pointerdown`(左键、非stacked)→`pointermove`改宽(不写偏好)→`pointerup/cancel`存偏好；`.is-resizing`禁transition/文本选择，光标`col-resize`
- 双击分隔线复位+toast「项目栏宽度已恢复默认 248px」/「对话栏宽度已恢复默认 390px」
- 键盘：`ArrowLeft/ArrowRight` 16px，`Shift + 方向键` 32px，`Home`最小，`End`最大；须带`aria-valuemin / aria-valuemax / aria-valuenow`
- 可用宽=窗口宽−(2 × 6px + 480px)；超限先压对话栏再压项目栏，成果区≥480px；变宽恢复偏好
- 偏好`railW / chatW / resultsCollapsed`存独立UI键
- 收起/展开：记`.content`与`#resource-view`的`scrollTop`，展开用`requestAnimationFrame`恢复；toast「成果区已收起，研究任务继续运行」/「成果区已展开」
- resize：`requestAnimationFrame`合并防抖

#### 4.0.4 阶段状态机

6页签/13内部阶段ID：项目定义`corpus-intake`、`question-scoping`；文献分析`evidence-mapping`；实验设计`design-authoring`、`design-gate`；数据处理`data-prep`、`descriptive`；统计分析`baseline`、`robustness`、`endogeneity`、`heterogeneity`、`mechanism`；论文生成`paper-drafting`。

状态枚举(页签圆点`data-state`、项目行`.project-stage[data-state]`)：`idle`灰`--line-strong`❌(点击toast说明前置)；`active`紫`--purple`✅；`done`绿`--success`✅；`blocked`门禁未过(有设计未确认)橙`--warning`❌(点击提示确认设计)。

```
s.definition = hasRQ ? 'done' : 'active'
s.literature = hasLit ? 'done' : (hasRQ ? 'active' : 'idle')
s.design     = design ? (confirmed ? 'done' : 'blocked') : (hasLit ? 'active' : 'idle')
s.data       = 已有 data-prep 或 descriptive ? (allDone ? 'done' : 'active') : (confirmed ? 'active' : 'idle')
s.stats      = anyStep ? (allDone ? 'done' : 'active') : 'idle'
s.paper      = paper ? 'done' : (allDone ? 'active' : 'idle')
if (design && !confirmed) s.data = s.stats = s.paper = 'blocked'   # 覆盖上式；唯一硬门禁 design.confirmed
```

全局工作流状态(顶栏`#sync-status`、`#chat-subtitle`、项目行阶段文案读它，自上而下短路)：

- 无项目→`idle`「尚未开始研究」/ short`未开始`；`#chat-subtitle`用「输入研究问题，或选择下方示例开始」
- `paper`→`done`「论文初稿已生成」/`论文已生成`
- `designConfirmed && allDone`→`done`「七步实证已完成，可以生成论文初稿」/`可生成论文`
- `designConfirmed && !allDone`→`active`「实验设计已确认，七步实证执行中」/`实证执行中`
- `design && !designConfirmed`→`blocked`「实验设计待确认，数据与统计阶段锁定」/`待确认设计`
- `literatureDone`→`active`「文献分析已完成，等待生成实验设计」/`文献已完成`
- 其他→`active`「研究准备中：等待研究问题与文献分析」/`定义中`

#### 4.0.5 持久化

- 项目数据(项目列表、当前项目、消息、RQ、设计、流水线结果、论文)→`localStorage['zhiyan.demo.v1']`单一JSON快照，变更后写盘
- UI偏好→独立偏好键(`railW / chatW / resultsCollapsed`)，清项目不清布局
- 刷新：读快照→恢复`activeId / messages / rq / design / pipeline / paper / tab`→重算阶段状态→重绘；F5后一致(验收G7)

#### 4.0.6 交互与提交

- 新建→toast「输入你的研究问题，或选择一张示例卡片」→聚焦`#prompt`
- 项目行：切换+重绘；行`title = 项目名 · n/6 阶段 · 工作流短标签`
- 提交：`#prompt`值`trim()`空则return，否则清空→`handleSubmit(text)`；`#btn-send.disabled = !value.trim()`
- `Enter`提交(`preventDefault()`)/`Shift+Enter`换行；`Escape`关模态；切页签清`resourcePage`并切`tab`
- `#btn-dataset`/`#btn-library`→开资源页(同kind再点=关)，成果区已收起先展开，toast「已在右侧打开文献库 / 数据库」
- `确认设计`/`确认并开始实证`→「确认实验设计」模态；`导出项目包`→下载Markdown项目包
- 重绘对话后`thread.scrollTop = thread.scrollHeight`；流水线执行中重复触发→toast「流水线正在执行中」并return

页签门禁`switchTab(tabId)`：

```
  if (无活动项目) return; p.resourcePage = null
  if (order.indexOf(tabId) > 2 && p.design && !p.designConfirmed)     # 数据/统计/论文三页
      toast('实验设计尚未确认，数据与统计阶段锁定'); tabId = 'design'
  if (order.indexOf(tabId) > 3 && baseline 未完成 && tabId === 'paper' && !p.paper)
      toast('实证尚未完成，可先生成初稿但会披露未做项')                # 仅提示，不阻断
  p.tab = tabId; renderAll()      # order = ['definition','literature','design','data','stats','paper']
```

`handleSubmit`分支(按序短路)：选中示例卡片→按§5.4规则脚本回复。样例流程中`literatureDone`取`true`。

- 示例卡片轨（真值源为`runDemoFlow`，不经`handleSubmit`）：写用户消息→写`rq = RQ`+追加§5.4**消息 3**→**700ms**后`literatureDone = true`+追加**消息 4**→**600ms**后生成设计+toast「实验设计方案已生成，请核对后确认」
- 有设计未确认（此支属「用户自行提交」路径，不属于示例卡片轨）：设计规则回复→开确认门模态；设计刚生成的那一轮另有420ms后生成设计的分支（同属此路径）
- 已确认+七步未完：数据/统计规则回复
- 已有论文：追加「初稿已经生成。」+三条后续指引，chip「初稿已就绪」；兜底：「已记录。当前流程可以进行下一步。」

#### 4.0.7 内部函数与状态字段索引

实现名索引:

| 名称 | 语义 | 首次出现 |
|---|---|---|
| `renderAll`/`switchTab`/`isStacked`/`handleSubmit`/`runDemoFlow`/`deriveWording`/`gateCheck`/`hash32`/`failMsg` | 重绘/页签锁定/窄屏/提交入口/示例卡片轨/允许措辞/门禁/指纹/拒答理由 | §4.0.6·§4.0.3·§4.2.12·§4.3.5 |
| `PIPELINE_STEPS`/`runRest`/`runStep`/`qualityGate`/`pausePipeline`/`skipStep`/`resetStep`/`STATUS_TEXT`/`statusText` | 七步顺序/执行/四门/暂停/跳过/重跑/状态文案 | §4.5.10 |
| `verifyCitations`/`countUnverified`/`findCell` | 四查/待补计数/`cell_id` 定位 | §4.6.0·§4.6.4 |

### 4.1 阶段一项目定义（F-05）

布局：成果区→`项目定义`页签→`.content-inner`自上而下：页头→空态横幅(仅无RQ)→研究问题卡→本文不做→候选研究问题→文献检索反馈→资源绑定卡。页头`h2 项目定义`+右侧小字，按`rq.source`分叉：`研究问题识别结果`/`命题解析 · 五槽位`。

#### 4.1.1 研究问题卡

字段：类型 · 单位 · 默认值 · 边界 · 呈现。

- `researchQuestion`：string · — · 必填 · 问句末尾`?`／`？` · **演示轨固定齐全（§5.3.1），不实现抽取与阻断**；非问句→补「？」+警告
- `phenomenon`/`objectLevel`：string · — · `null` · 20–40字 · 如「中国 A 股制造业上市公司（企业-年）」
- `variationSource`：string · — · `null` · 须具体(如「企业层面数字化转型强度差异」) · 决定因果措辞
- `timeWindow`：`[number, number]` · 年 · `null` · 起始≤结束
- `outcomeVar`/`treatmentVar`：string · — · 必填 · 可观测量 · **演示轨固定齐全，不实现抽取与阻断**
- `claimType`：enum `associative` `causal`/`associative`/`descriptive` · — · 识别不出→`associative`+警告 · 因果无外生→降级`associative`
- `claimSentence`：string · — · `causal`→`A对B的因果影响（对象层级）`；`descriptive`→`B的分布特征与变化（对象层级）`；其余→`A与B的关系（对象层级）`
- `outOfScope`：string[] · 条 · `[]` · ≤4条 · 空→不渲染
- `candidateQuestions`：array · 条 · `[]` · ≤5条；元素=字符串或`{text, corpusSupport, note}` · 空且有`researchQuestion`→回填单元素
- `source`：string · 页头副题分支

8槽位=`phenomenon, researchQuestion, objectLevel, timeWindow, variationSource, claimType, outcomeVar, treatmentVar`。

- **卡片含 8 个字段，对话文案固定说「五个槽位」**（照抄 `data.js`/`app.js`）；两套口径并存，不得统一。对话文案列的 5 项=`现象/对象与层级/时间窗/变异来源/期望结论`。
- **`researchQuestion`/`outcomeVar`/`treatmentVar`/`source` 为本规格声明的修正项**：演示轨不使用 `source`（不调模型，页头固定走 `命题解析 · 五槽位` 分支）；`claimType` 固定 `'causal'`，措辞由§4.2.12锁定为「相关」。

- 整卡只读，`claimType`也只读

#### 4.1.2 本文不做

`outOfScope`非空时：小标题`本文不做`+副注`明确边界，避免读者误解`；每条=`· `+文本，13px、行高 1.8。

#### 4.1.3 候选研究问题

- `candidateQuestions[].text`：string(题目正文)：字符串直接用，对象取`text ‖ question`，都空→跳过
- `candidateQuestions[].corpusSupport`：number · 篇 · 标签`语料支撑 N 篇` · 仅对象且非`null` · 取§5.3.1声明值(`12 / 3 / 5`)
- `candidateQuestions[].note`：string(可行性说明) · →`.hint`

序号徽标`候选 N`(N从 1)；第 1条实心`.badge`，其余`.badge.plain`。副注：候选>1→`可以往这几个方向走`，否则`当前唯一候选`。

#### 4.1.4 文献检索反馈

- `litRunning`：小标题`文献检索`+检索动效(文案`小智快速检索文献中`，副文案`已完成 d/t 路检索`，缺省`0/0`)
- 有`litAnalysis.summary`：`已按你的研究问题检索：命中 N 篇。`+按钮`查看文献分析`→跳文献分析页；都没有：不渲染该区块

#### 4.1.5 资源绑定卡

- 文献库：`22 篇`；数据库：`18,042 行`
- 输出目录：`自动创建（浏览器内）`
- hint（按本期范围改写）：`资源库使用内置样例；「选择本地文件夹」「上传到浏览器」为演示态占位，不读取本地文件。`

#### 4.1.6 空态

无RQ：`.banner.info`标题`还没有研究问题`，正文`在对话区提交你的研究问题后，这里会显示识别出的五槽位。`；只渲染资源绑定卡。

### 4.2 阶段二文献分析（F-06）

布局：成果区→`文献分析`页签。页头`h2 文献分析`+副题`检索式基于：<researchQuestion ‖ phenomenon>`或`等待研究问题`；右侧挂`.badge.blue`「内置样例」。

#### 4.2.1 检索式（7 条候选，实际最多取 6 路）

|顺序|label|query 表达式|
|---|---|---|
|1|核心关系|`<treatmentVar> <outcomeVar>`|
|2|研究问题|`researchQuestion`|
|3|现象|`phenomenon`|
|4|核心解释变量|`treatmentVar`|
|5|被解释变量|`outcomeVar`|
|6|识别策略|`variationSource`|
|7|样本对象|`objectLevel`(6 路上限，通常被截掉)|

#### 4.2.2 命中数据

`perQuery[]`(`{label, query, hits}`)、`hits[]`、`summary{}`三层结构保留，取值全部取§5.3.3 `LIBRARY_STATS`。

#### 4.2.3 概览三卡

主值样式 17px/700/紫色。

|卡片标题|主值|副文案|
|---|---|---|
|命中文献|`hits.length`+` 篇`|`来自 {perQuery.filter(命中>0).length} 路检索式，共 {withQuote} 段可引用片段`|
|质量分布|`可引用 {LIBRARY_STATS.byTrust.high}`|`需核对 {LIBRARY_STATS.byTrust.medium} 篇 · 仅可提及 {LIBRARY_STATS.byTrust.low} 篇`|
|年份跨度|`{min(year)}—{max(year)}`(无年份→`—`)|`{methods 键数} 类识别策略`；无→`未标注识别策略`（取`LIBRARY_STATS.years`与`methods`声明值）|

`withQuote`=`quote`非空的命中数；`methods`=`method`非空命中的去重分组。`hits.length === 0`本区块不渲染→§4.2.10零命中。
**质量分布卡的主值与副文案一律取§5.3.3 `LIBRARY_STATS.byTrust` 声明值，禁止对`hits[].trust`或`LIBRARY.trust`列现算。**

#### 4.2.4 命中记录字段

`litAnalysis.hits[]`：

- `docId`：string · 文档id
- `title`/`journal`/`year`：string/string/number · 缺→`—`
- `method`：string · 识别策略 · 缺→`未标注识别策略`
- `conclusion`：enum `positive`/`negative`/`mixed`/`n/a` · →正向/负向/分歧/`—` · 缺→`n/a`
- `quote`：string · 可引用片段 40–180字符 · 空→不计入`withQuote`
- `page`：number · 第N页
- `score`：number · 3位小数
- `matchedBy`：string[] · 命中检索式label · `、`连接
- `diag`：object/null · `{coverage, mojibakeRate, scanned}`

`trust` enum `high`→可引用/`medium`→需核对/`low`→仅提及：有声明值(§5.3.2`LIBRARY.trust`)→用声明值；`scanned → low`；`coverage < 0.70`或`mojibakeRate > 0.05`→`low`；`coverage < 0.90`或`mojibakeRate > 0.01`→`medium`；否则`high`。

#### 4.2.5 检索式与命中

小标题`检索式与命中`+副注`命中数少的检索式说明该角度的语料薄弱`。每路一行：label徽标(命中>0→`.badge.blue`，否则`.badge.warn`)+query(楷体)+`N 篇`。

#### 4.2.6 识别策略分布

按篇数降序；每行左侧策略名+`N 篇`，右侧横条=`round(count / maxN × 100) + '%'`(`maxN`取首位篇数，至少 1)；`methods`无键整块不渲染。

#### 4.2.7 证据就绪度（`none`不静默）

小标题`证据就绪度`+副注`按你研究问题的组成部分逐项检查`。固定四项，槽位有值即出现，篇数 0也出现：研究问题组成=被解释变量的度量/核心解释变量的度量/识别策略/样本对象；对应表述=槽位原文；状态=`ok → 就绪`(绿)/`thin → 薄弱`(橙)/`none → 无证据`(红)；支撑篇数=`n`。

- 计数：`title + ' ' + quote + ' ' + method`拼串含该表述计 1；表述长度≥3时含其前两个字也计 1；只在`hits[]`上计数。
- 阈值：`n === 0 → none`；`n ≤ 2 → thin`；`n ≥ 3 → ok`。`n`为 0照样渲染并标红，✗把 0改成 3。

#### 4.2.8 反向证据

条件`summary.disagreements.length > 0`(`conclusion ∈ {negative, mixed}`)。**优先级最高（压过上一句的判定条件）：本 Demo 一律取`PROBES.disagreements`（固定 3 篇`d05 / d03 / d19`），篇数一律取`PROBES.disagreements.length`；`conclusion` 现算只在非演示链路（本 Demo 不实现）有意义，不采用**（§5.3.2 的 22 行`trust`/`conclusion`列为声明数据，不得据此改写声明值）。小标题固定为`反向证据（必须进综述，否则是选择性引用）`。每条是可点击`.cite`按钮：左侧序号`反`，主文案`《title》 year`，副文案`journal · method`(method空则`未标注识别策略`)；点击开「文献出处」抽屉。

`disagreements.length === 0`时整块不出现(不显示"0篇"，不占位)；✗造反向证据。

#### 4.2.9 命中清单

小标题`命中清单`+副注`点击查看原文片段与出处`。表格 7列，整行可点击：文献`title`(最大宽 260px，溢出省略号)/年份`year`(缺`—`)/期刊`journal`(缺`—`)/识别策略`method`(缺`—`)/命中角度`matchedBy.join('、')`(11px三级色)/质量trust徽标(可引用/需核对/仅提及)/相关度`score.toFixed(3)`(数值列右对齐)。

#### 4.2.10 空态（必须照做，不许兜底）

|场景|条件|表现|
|---|---|---|
|检索中|`litRunning`|只显示动效并 return，不显示任何旧数据|
|从未检索(有 RQ)|无`litAnalysis.summary`|标题`还没有针对这个题目做检索`；说明`研究问题已识别。检索会在生成实验设计之前自动进行；也可以点下面按钮立刻开始。`；按钮`开始检索`；下方小标题`将使用的检索式`逐路列出|
|零命中|有 summary 但`hits.length === 0`|标题`库里没有命中这个题目`；说明`已入库 N 篇文献，但 Q 路检索式都没有命中。可以换一个更贴近库内用词的说法，或继续补充相关 PDF。`；按钮`重新检索`；不得自动放宽阈值、不得塞"相近"文献充数、不得改判为命中|

#### 4.2.11 文献出处抽屉

|行标签|取值/格式|
|---|---|
|(标题)|`title`|
|作者|`authors`|
|期刊/年份|`journal + ' · ' + year`|
|识别策略|`method`|
|相关度|`score.toFixed(2)`|
|可引用片段|「`quote`」+来源行`来源：{file} · 第 {page} 页`|
|文本覆盖率|`(coverage × 100).toFixed(1) + '%'`|
|乱码率|`(mojibake × 100).toFixed(2) + '%'`|
|是否扫描件|`是（未做 OCR）`/`否`|
|质量等级|徽标`high → 可引用`(绿)/`medium → 需人工核对`(橙)/`low → 仅可提及，不可引用原句`(红)|

`page`取§5.3.2声明值；找不到文献toast`找不到该文献`且不开抽屉。

质量兜底(`low`)：`该篇为扫描件/乱码，文本层不可靠。它可以被"提及"，但原句引用必须带「解析质量低·请人工核对」徽标。`；`medium`：`该篇解析质量中等，引用页码与原文措辞建议人工核对后再写入正文。`

#### 4.2.12 措辞强度门控（本阶段起生效）

```
hasCausalEvidence = (IV-01 pass) || (DID-04 pass) || (DID-09 pass)

deriveWording(claimType, checks):
  if (claimType === 'causal' && !hasFail && !hasUnknown && hasCausalEvidence) return 'causal'
  if (claimType === 'descriptive') return 'descriptive'
  return 'associative'          # 其余一律落到「相关」
```

- **任一检查项为`fail`或`unknown`时，一律不得返回`causal`**（三个条件同时成立才放行因果措辞）。
- 无清单时(定义/文献两段)：`claimType === 'descriptive'`→`descriptive`，否则一律`associative`。
- 因果动词黑名单(10)：`促进、导致、使得、提高了、降低了、抑制了、驱动、带来、提升了、改善了`
- 结果对象词(7)：`创新、专利、产出、绩效、效率、研发、生产率`
- 豁免语境(命中即不计)：方法学 17词`估计/偏误/内生/工具变量/共同趋势/测量/测度/变量/样本/模型/设定/检验/稳健/原因/分歧/渠道/机制`；转述 17词`已有研究/现有研究/文献发现/多数文献/研究指出/研究认为/学者/张三/李四/相关研究/既有研究/前人研究/研究表明/文献指出/研究显示/被认为/有研究`(含占位人名「张三」「李四」)
- 分句符：`/[。；;!?！？，,、\n]/`
- 计数：逐分句，同一分句内同时出现因果动词与结果对象词且不含豁免词→计 1次越界
- 门控：`wording !== 'causal'`且正文因果动词数>0→质量门不通过，detail为`措辞强度为"X"，但结论中出现 N 个因果动词`

> 数据全为内置校准样例;!=阻断 ?=警告 >=流转;`反引号`=界面逐字。

### 4.3 实验设计 F-07 ★核心门禁

本节覆盖字段契约、七分区、检查清单、设计生成、确认门与处置模态（§4.3.3 的判定依据摘要不是界面文案）。

#### 4.3.1 字段(`字段:类型·单位·默认·边界·呈现`)

顶层:`version`:num·版 |`hypotheses[]`:arr·空!|`sample`:obj |`variables[]`:arr·`< 3`!|`model`:obj·无`model.cluster`!|`checks[]`:arr·不得空 |`expected`:obj |`pipeline[]`:`[{stepId, items[]}]`(默认`items: []`;未匹配>`items = []`) |`raw`:obj·入 hash
`hypotheses[]`:`id`(`H1`/`H2`) |`statement`(空>丢弃) |`direction`|`outcomeVar`(回退 RQ) |`priorLit`:str[] |`mechanism`
`sample`:`obsLevel`(回退 RQ`objectLevel`) |`period`:str·年(回退 RQ`timeWindow`,`—` 连接) |`nPlanned`:num |null·个企业-年·同行`{nPlanned} 个企业-年 · {nUnits} 家企业`|`source`
`variables[]`:`name`(空>丢弃) |`role`(`被解释变量/核心解释变量/控制变量/固定效应/聚类`) |`construction`|`source`|`missing`|`sign`(`+`/`−`/`—`) |`lit`
`model`:`equation`(代码块;缺失>!§4.3.4) |`feTerms`:str[](` + ` 连接) |`cluster`(缺失!) |`clusterNote`|`weights`(`无`) |`estimator`(`OLS`)
`checks[]`:`id`(`FE-01`/`IV-01`/`GEN-04`) |`status`:enum`pass`/`fail`/`unknown`(默认`unknown`,非枚举强转) |`label`|`need`(非空>前缀`需补：`+警告色) |`evidence`|`disposed`:bool(`false`;`fail`/`unknown` 未处置>按钮`处置`)
`failMsg`(取自内置判定规则表§5.3.5,`checks[]` 里不存):该项不通过时的一句话理由(`IV-01`→`弱工具：2SLS 有偏、标准误失真、置信区间覆盖不足`),处置模态副标题取它(§4.3.5)
`expected`:`sign`|`magnitude`|`significance`|`fallback`

#### 4.3.2 七分区

①研究问题(`claimSentence`/结论类型/允许措辞徽章/缺口) ②研究假设(确认即冻结;`方向 X · 机制：Y · 被解释变量：Z`;脚注`冻结后若在结果出来之后再改假设，会记进偏离台账并在初稿里自动披露。`) ③数据与样本 ④变量定义 ⑤模型设定 ⑥检查清单 ⑦预期结果/不符预案

#### 4.3.3 检查清单

本表为**判定依据摘要**，仅供理解判定语义；界面不渲染本表文本，界面渲染的是`checks[].evidence`（见§5.3.5）。

判定`pass`/`fail`/`unknown`;unknown 不得默认 pass.
- FE-01·组内变异充分性·组内/总标准差 > 0.4
- FE-02·面板结构明确·明确 N 与 T 量级
- FE-03·序列相关处理·标准误处理序列相关并声明聚类
- FE-04·不平衡面板与流失·报告缺失程度与流失模式
- FE-05·动态面板偏误·短 T 含滞后项用 GMM/IV
- DID-01·双侧变异·同时有处理组与未处理组
- DID-02·处理时点变异·处理时点存在差异
- DID-03·处理前时期数·处理前 ≥ 3 期
- DID-04·平行趋势·pre 系数与联合检验均不显著且无趋势
- DID-09·交错处理的估计量·用异质性稳健估计量
- IV-01·第一阶段强度·第一阶段显著且`F > 10`
- IV-02·排他性约束·机制论证:工具只通过内生变量影响结果
- RDD-01·断点处样本量·带宽内样本量足够
- RDD-02·驱动变量连续性·密度检验无断点处聚集
- PSM-02·共同支撑·处理组 PS 落在对照组范围内+报告丢弃量
- GEN-04·措辞强度匹配·因果证据用因果措辞,相关禁用因果动词
- GEN-01·不显著 ≠ 无效应·报告最小可检测效应或置信区间
- 样例只 7 项(FE-01…FE-04,DID-04,IV-01,GEN-04):`IV-01`=`fail`(F = 6.2 < 10),`DID-04`=`unknown`(`DID-04` label=`平行趋势（若声称因果）`)

#### 4.3.4 设计生成

- 非对象>`模型没有返回结构化的实验设计`|`variables` 空>`设计里没有任何变量定义，无法执行实证。`|无`model.equation`>`没有给出计量模型式，无法生成可执行代码。`
-`checks` 空>`没有给出识别策略检查清单。清单是"能不能给因果结论"的依据，不能为空。`
- 变量对不上>`变量表里找不到研究问题中的被解释变量「X」。`/`…核心解释变量「X」。`
- 串课题>`设计的被解释变量是「Y」，而研究问题里说的「X」在整份设计里都没有出现——设计可能串到了别的课题。`
-`claimType!=='causal'` 且式命中`IV/工具变量/2SLS/双重差分/DID/断点回归/RDD/平行趋势`>?`结论类型是「相关」，但模型式里出现了因果识别方法（…）。已保留你的设定，但措辞强度仍是「相关」——要用因果表述，请先把结论类型改成「因果」并补充识别依据。`
-`checks` ≥ 4 且全`pass`>?`检查清单全部通过。实证设计极少完全没有风险，请人工复核这几项：A、B、C。`
- 校验失败不得兜底,如实报错

#### 4.3.5 确认门

`gateCheck`(? 外均 !): 0 无项目>`先新建项目`|1 无设计>`先完成实验设计生成`|2 无假设>`至少 1 条研究假设`|3 变量 < 3>`变量定义不完整`|4 无`model.cluster`>`未声明聚类层级`|5`fail` 未处置>取`need`,空则`处置 {id}：{label}`|6`unknown` 未处置>? 优先`need`,空则`{label} 信息不足，建议补充`|7`FE-03` 聚类数 N 且`N < 40`>?`聚类数 N 偏少，推断可能偏乐观`|`status = blockers.length ? 'blocked' : 'ready'`
确认:`designConfirmed = true`/`designHash = hash32(JSON.stringify(design))`（哈希算法未移植，仅用于本机前后快照比对，取值无需跨实现一致，也不直接展示）/初始化七步/阶段`data-prep`/切「数据处理」页签;事件`design.confirmed{design_hash, by:'user', at, warnings}`;失效: 前两者置假,七步`invalidated = true`,已完成步`stale`(`待更新`),事件`design.invalidated`
"拒绝读取数据"出口:
- 处理页/统计页整体:`.banner.warn``实验设计尚未确认，数据阶段锁定`;正文`确认之前不会读取任何数据。请先在「实验设计」页核对方案并确认。`;按钮`前往实验设计`;其余区块不渲染
- 设计页横幅:`.banner.err``设计未确认：执行器拒绝读取数据（N 项待处置）`+逐条`· [ref] need`+按钮`处置未通过项并确认`|主按钮: 未确认`确认并开始实证`;已确认`重新确认设计`
- 运行/生成论文入口不报错,直接弹模态 |执行器拒绝并抛`设计未确认：执行器拒绝读取数据`(toast)
- 对话区: `七步实证尚未全部完成，所以我现在没有可报的系数。\n\n请在「实验设计」页确认方案后运行流水线——确认之前我不会读取任何数据。\n\n跑完后每个数字都会带出处，可点回结果表核对。`+chip `等待执行`
- 模态:`确认实验设计`/`全流程唯一硬门禁 · 未确认不读取任何数据`/`确认后我将开始跑数据。以下是我的理解，请核对：`;主按钮`g.status === 'ready' ? '确认并开始实证' : '尚有 N 项待处置'`,`disabled = (g.status !== 'ready')`

**处置模态（逐字；`fail`/`unknown` 未处置项的「处置」按钮触发）**：

```
标题  处置检查项 {id}          # 例「处置检查项 IV-01」
副标题  checks[].failMsg（无则空）
横幅  .banner.warn：{id} {label}：{status==='fail' ? '不通过' : '信息不足'}
        + {evidence}
        + 需你补：{need}（need 非空才渲染）
说明句  请选择处置方式（四选一）。这一步的处置会被记录，并影响全文允许的措辞强度。
选项（radio 四选一，显示 label + desc）
  补数据 / 补一个更强的工具变量或外生冲击
  换策略 / 改用其他识别策略（如政策试点 DID）
  降措辞 / 接受"相关"表述，不给因果结论
  先不做 / 本项留白，并在初稿中披露
按钮  取消 / 确认处置
未选就点确认处置  → toast「请选择一种处置方式」，不开任何后续
确认后（四步副作用，按序）
  1. checks[].disposed = true（保留原 status）
  2. 事件 design.invalidated（reason = '处置检查项 {id}：{chosen}'）；已确认时触发确认失效链（§4.3.5 失效段）
  3. recordDecision('处置检查项 {id}', chosen, ['不处置'], need, 'user')
  4. 关模态 → toast「已处置：{chosen}」→ 重绘
```

### 4.4 数据处理 F-08

布局：成果区→`数据处理`页签→`.content-inner`自上而下：页头→设计未确认横幅(§4.3.5)→数据源徽标行→三卡→列类型与缺失表→七个步骤块（§4.5.2 状态机）。

#### 4.4.1 数据源

徽标(`panel`>`面板数据`/`截面数据`)+文件名+`{rows} 行 × {cols} 列 · {大小}`
字段:`file`:str |`rows`/`cols`:num |`size`:num 字节 |`shape`:enum`panel`/其他>`截面`|`unitId`/`nUnits`:str/num |`timeId`/`nPeriods`:str/num |`missingRate`:num 0–1 %
样例`DATASETS[0]`: 文件名+`18,042 行 × 14 列`+字节数+`firm_id × year`+`2,847 家`+`12 期`+`2.3%`;`.badge.blue``内置样例`

#### 4.4.2 三卡

副标题`这是统计误用的第一道闸`;三卡=个体维度/时间维度/平衡性
- `firm_id`/`企业代码，共 2,847 家` ·`year`/`共 12 期（2011—2022）` ·`不平衡`/`缺失率 2.3%，随机缺失检验 p = 0.31`

#### 4.4.3 列类型/缺失

表头`字段 / 含义 / 类型 / 缺失率 / 处理方式`;缺失率`(rate × 100).toFixed(1) + '%'`;处理方式`无需处理`/`行业-年份中位数`;`rate > 0.05` 整格`var(--warning)`
- 14 列: firm_id year province_id industry_id ln_innov ln_innov_inv ln_innov_util digi digi_alt size lev roa age subsidy
- 类型`id`/`int`/`float`/`str`;空态: 表头+一行`未导入数据`

#### 4.4.4 步骤块

每块: 状态行(§4.5.2)/摘要/`.meta-row`/结果表/三件套行;未执行`该步骤尚未执行。确认设计后会自动依次执行，也可在「统计分析」页单独启动。`

#### 4.4.5 数据导入与解析

文件选择/解析/列映射/入库/真实数据解析**本期均不做**；数据页只展示内置样例数据集（§5.3.4）。

### 4.5 统计分析 F-09 ★七步流水线

本节覆盖七步定义、状态机、右栏、三卡、四门、可复现信息、cell 绑定、失败路径、交互与过程文件。

#### 4.5.1 七步

① data-prep 数据清洗 ② descriptive 描述性统计 ③ baseline 基准回归 ④ robustness 稳健性检验 ⑤ endogeneity 内生性分析 ⑥ heterogeneity 异质性分析 ⑦ mechanism 机制分析

#### 4.5.2 状态机(七态)

-`pending` 待执行: 序号格灰·`待执行`·按钮 执行本步/跳过 |`running` 执行中:`.running` 蓝·`执行中`·按钮 暂停 |`paused` 已暂停:`.running`·`已暂停`·按钮 跳过
-`done` 完成:`.done` 绿+序号位`✓`·`已完成 · 第 N 次运行`·按钮 重跑本步/下载三件套 |`failed` 失败:`.failed` 红·无标题·无按钮 |`skipped` 已跳过:`.skipped` 橙·`已跳过：{note}`·无按钮
-`stale` 待更新:`.failed`·`设计已变更，结果待更新`·按钮 执行本步/重跑本步/下载三件套
- 步骤对象:`status / no / label / runNo / itemIndex / items[] / startedAt / finishedAt / quality / note / percent / etaMs / etaConfidence / 三件套内容 / invalidated / real / simulated / elapsedMs / error`(`runNo` 每次执行 +1;`etaConfidence` <0.2s→low,<0.5s→medium,其余 high)

#### 4.5.3 右栏

右栏`① 数据清洗`+分段控件`脚本 / 结果 / 解读`(默认「结果」)+文件行`预览`;执行项`st.items[]` ○/✓;执行中`第 i/n 项`+ETA;三件套(`{done, stale, failed}`)=脚本 Python/结果 表+指标+诊断/解读 规则+`cell_id`;空态`该步骤尚未执行`

#### 4.5.4 三卡

- 进度`{done} / 7`;`{n} 项质量门未通过`/`{n} 项被跳过`/`全部通过质量门`
- 措辞强度`因果`/`相关`/`描述`;`识别策略支持因果表述`,否则`因 {未通过的检查项 id}，全文锁定为相关表述`(即`因 IV-01 弱工具，全文锁定为相关表述`)
- 数值一致性`已校验`;`每个数字均绑定结果表 cell_id`

#### 4.5.5 四门

- 一 数值一致性(每步): 数值须绑定结果表单元格;失配 > 3 才失败;detail`解读中有 N 个数字无法绑定 cell_id`
- 二 措辞强度(所有步):`wording !== 'causal'` 且因果动词数 > 0>不过;detail`措辞强度为"X"，但结论中出现 N 个因果动词`
- 三 引用真实性: 本步不涉引用
- 四 披露完整性(仅稳健性检验): 有「无法完成」项未披露>不过;detail`存在未完成项但未显式披露`
- 失败后果: 步骤`failed`,`note = reason`,事件`step.exit{status:'failed', reason}`

#### 4.5.6 可复现信息

每步: 有效行数/个体数/固定效应(` + ` 连接)/聚类层级/种子`20240113`/代码指纹/数据指纹`hash32(观测数 + 变量列表 + 各行值 toPrecision(12))`/引擎版本`engine`（对象`{name, api, fingerprint, weakIVThreshold}`，渲染前必须拼成字符串如`econ.js（22 个 API）`，否则界面出现`[object Object]`）;无时间戳,同种子同输入逐字节一致。

#### 4.5.7`cell_id` 与数值一致性

-`cell_id`=`<stepId>.<tableId>.r<行>c<列>`(例`baseline.coef.r0c1`;**r 与 c 均为 0 基，r0c1 = 首个数据行的第 1 列**);单元格`{id, cellId, tableId, row, col, label, term?, value, formatted, coef?, se?, t?, p?}`,`label = 行标签 + ' · ' + 列头`
- `tableId` 全量清单(`cell_id = tableId + '.r{r}c{c}'`,`r`/`c` 均 0 基;裸名=`<stepId>.<名>`,`()` 内是列头):

| 步 | 表 `tableId`(列头) |
|---|---|
| ① data-prep | reconcile(项目,观测数) missing(变量,缺失数,缺失率,插补数,处理后缺失数) winsor(变量,下界,上界,被替换观测数) panel(项目,值) |
| ② descriptive | stats(变量,观测数,均值,标准差,最小值,中位数,最大值) corr(空首列,变量名下三角) corrSig(变量对,相关系数r,N,t值,p值) vif(变量,VIF) group(组,N,ln_innov均值,标准差) welch(统计量,值) |
| ③ baseline | coef(变量,系数,标准误,t值,p值,显著性,95%CI下限,95%CI上限) fit(指标,值) |
| ④ robustness | matrix(检验项,核心变量,系数,标准误,t值,p值,N,聚类数,组内R²,结论) |
| ⑤ endogeneity | iv(设定,digi系数,标准误,t值,p值,N,聚类数,第一阶段F,结论) firstStage(同`baseline.coef`) ivFirstStage(变量,系数,标准误,t值,p值) |
| ⑥ heterogeneity | groups(分组,系数,标准误,t值,p值,N,聚类数,组间差异Wald p,结论) chow(分组,系数差异,差异标准误,t值,p值,说明) |
| ⑦ mechanism | paths(渠道,路径,变量,系数,标准误,t值,p值,N) decomp(渠道,间接效应a×b,Sobel z,Sobel p,中介占比a×b/c,判定) |

- 非数值单元格不生成 cell;`NaN`/`Infinity` 格式化为`—`;模板`{{cellId}}` 占位;引用不存在的单元格必须直接抛错,不得静默
- 追加未引用的数值 cell:`其余数值（按表给出 cell_id 坐标=值，可逐格回溯）：{表id：r行c列=值，…}。`
- 解读头三行:`**生成方式**：真实计算 + 规则解读`/`**措辞强度**：X`/`**数值一致性**：本步解读引用 N 个结果单元格，全部已绑定 cell_id`
- 降级`**生成方式**：rule（计量引擎未生效）`+`本步解读中的每个数字均绑定结果表单元格（cell_id）。`;提示`解读中的每个数字都绑定结果表的单元格；若一致性校验失败，会降级为规则版并标红，不会放行。`;算不出>`failed`+错误码(§4.5.8)
- 徽标`.badge.warn``内置样例数据`
- 引用 chip 行:`本段引用的数字（点击回到结果表）：`+每格`{cell.label} = {formatted}`(最多 40 个);点击>切「统计分析」页,定位该步「结果」视图+toast`已定位到结果表：{label} = {value}`

#### 4.5.8 失败路径

-`SINGULAR` 完全共线>`failed`,UI 显示引擎错误码与说明;`TOO_FEW_OBS` 观测不足>同上
-`TOO_FEW_CLUSTERS` 聚类数 < 2>拒绝估计;`MISSING_VAR` 聚类层或规格变量缺失>同上
- 弱工具(`IV-01` fail)第一阶段`F < 10`>不改报因果: 保留 OLS+措辞锁定"相关"

#### 4.5.9 交互/过程文件

点步骤项>`activeStep`;分段控件>`脚本 / 结果 / 解读`.`执行本步`/`重跑本步`/`下载三件套`(Markdown`step-{stepId}-三件套.md`,toast`Demo 以合并 Markdown 代替 zip`)/`跳过`(模态填理由,默认`用户跳过（未填理由）`);重复触发>`流水线正在执行中`
- 过程文件树:`<类型>__<步骤>.ext`;每步 4 文件`code__{sid}.py`/`result__{sid}.md`/`result__{sid}.csv`/`interpret__{sid}.md`（**内存态虚拟节点，不落磁盘**）;另`data/data__hash.txt`/`env/env_lock.txt`;`paper__初稿.md`/`paper__写作说明.md`/`citation__台账.csv`;节点+`{n} 个文件`+`已生成/待生成`+按钮`打包下载全部过程文件`

#### 4.5.10 七步动态执行契约(点下去之后发生什么)

- 顺序与互斥:`PIPELINE_STEPS`(①…⑦)即执行顺序;批量入口=结果区`运行七步实证`或确认门`确认并开始实证`→`runPipeline`,`runRest` 自首个非`done`步(`firstPending`)起逐项`runStep`,某步失败不中断;重复触发→`流水线正在执行中`;`runStep` 先判`designConfirmed`(未确认拒绝),进入即写`activeStep`

| 固定耗时 | 链路 |
|---|---|
| `700`/`600ms` | `runDemoFlow` 的命题→文献 / 文献→设计 |
| `420ms` | `handleSubmit` 的「`literatureDone` 为假」支(**不属示例卡片轨**) |
| `400`/`90`/`120ms` | 抽取→检索 / 每路之间 / 检索启动(本 Demo 不触发) |
| `120ms` | `重跑本步` |
| `STEP_MIN_MS`=2600/1400/3200/5200/2400/2200/2000ms | **仅 `ZY.pipeline` 不可用**时兜底(`simulated=true`),按①…⑦对应 |

- 进度呈现:徽标=`STATUS_TEXT`(§4.5.2);`running` 期两条`.bar` 的文案:步列表内`第 i/n 项 · {percent}% · 剩余约 {fmtDur(etaMs)}`,右栏`.job` 卡`正在执行：{label}`+`剩余约 {fmtDur(etaMs)}（置信度 高/中/低）`(空则`正在估算剩余时间`);`.zy-progress` 只用于对话区/设计页,文案取消息`progress`:`小智正在识别你的研究问题`/`小智快速检索文献中`/`小智正在生成实验设计`;`.progress-list`/`.step-dot` 有 CSS 无 JS 接线(Demo 未实现,可省略),七步用`.step-list`/`.step-item`
- `quality`/`items[]`:`{pass, issues:[{gate, ok, detail}], wording, reason}`,`gate ∈ {consistency, wording, disclosure}`;`runStep` 入口置`null`、结束写一次,`pass=false` 同时`status='failed'`、`note=quality.reason`;`items[]` 由`initPipeline`在确认设计时按`DESIGN.pipeline`一次写入,`runStep` 只推进`itemIndex`(模拟轨每 120ms 反推`min(n, ⌊elapsed/iv⌋)`,`iv=max(180, ⌊total/n⌋)`)
- 状态迁移:`pending/stale→running`(`执行本步`/重跑/批量):`quality=null`、`percent=null`、`runNo+1`,`step.enter`;`running→done`(计算返回):`percent=100`、`itemIndex=items.length`,`step.exit`;`running→failed`(失败/四门不过):`note=real.error.message`或`quality.reason`;`running→paused`(`暂停`):全部`running`→`paused`;`pending/paused→skipped`(`跳过`模态):`note=理由`(未填`用户跳过（未填理由）`);`done→stale`(仅`invalidateDesign`):`invalidated=true`+`designConfirmed=false`+`designHash=null`;`done/failed/stale→pending`(`重跑本步`→`resetStep`):`percent=0`、`itemIndex=0`、`note=''`,`step.rerun`,120ms 后`runStep`
- `activeStep`/`segView`:点步骤项或进入某步时写`activeStep`,`focusCell` 强制`activeStep='baseline'`、`segView='result'`,切项目取`pipeline.activeStep`;`segView ∈ {code,result,interpret}`默认`result`;「继续」无按钮(Demo 未实现,可省略),`paused` 靠再批量执行恢复;ETA 曲线 Demo 未实现,可省略(`etaMs` 仅模拟轨按`total − elapsed`给出)

### 4.6 论文生成 F-10
order: header `论文生成`+sub `九章初稿 · 逐段生成`/`尚未生成`; 无初稿 = 生成卡，否则 三卡 > 警示横幅 > 风格卡 > 台账 > 纸面视图 > 导出。

#### 4.6.0 初稿来源（唯一轨道：内置样例）
本 Demo 只有演示轨，全部使用内置校准样例：不读本地文件、不解析 .dta/PDF、不调模型、不做真实统计计算、无服务器、无 assets/。
- draft = 内置 PAPER；`verifyCitations(PAPER)`/`countUnverified(PAPER)` 样例上离线求值。卡片数值分别取：28 para / 20 cites（weak 5）/ **5 个 cell（`c-0001`–`c-0005`），其中正文只绑定 4 个（`c-0004` 样本量在固定样例里未绑定，绑定清单见 §5.3.7）** / cites d01…d22 / 1 unverified（六-3）。
- 卡片固定 `9 / 9` / `相关` / `5 处需处理`（sub `1 处待补文献`）。
- para { text, cites:[{docId,support,page,quote}], cells:[cellId], unverified? }

#### 4.6.1 生成卡（未生成态）
btn `生成论文初稿`（group `语言风格`；两选项，默认 中国工业经济）；design 未确认 => modal 「确认实验设计」，不生成、无假进度条。

#### 4.6.2 九章结构（章名与顺序固定，数量 ≠ 9 拒绝；{{…}} 取不到 => 降级不回填）
- `1 一 引言` 4/5/0/0: RQ.objectLevel/timeWindow；正向/负向或分歧/测度类引用；摘要取命中 quote；缺 => 此处待补文献
- `2 二 文献综述` 4/8/0/0: 每类 ≥1 引用；须含反向证据；本 Demo 的集合与篇数一律取 §4.2.8 的 `PROBES.disagreements`（3 篇），不按 `conclusion ∈ {negative, mixed}` 现算；无 => 「本次检索未命中反向证据」+ 待补
- `3 三 理论分析与研究假设` 2/4/0/0: 「正相关」；禁 促进/提升/导致
- `4 四 研究设计` 3/0/0/0: 样本量只取元数据或 cell，否则「样本规模见结果表」；措辞 neutral
- `5 五 实证结果` 4/1/4/0: （下列为**生成规则**；演示轨固定取§5.3.7 的 4 个绑定值）cells baseline.coef.r0c1/r0c4/r1c1、baseline.fit.r0c1、baseline.n.r0c1、robustness.coef.r0c1/r1c1、robustness.clusters.r0c1；显著性取绑定 cell.p；failed/skipped => 「结果未能计算，见第六章披露」
- `6 六 稳健性检验` 3/0/0/1: 检验项计数；无引用 => 此处待补文献；有跳过 => 追加 `此外，本次分析中有以下检验被跳过：{labels.join('、')}。相关结论的解释需考虑到这一限制。`（cites: []）
- `7 七 内生性讨论` 2/0/0/0: iv.r0c3/lag.r0c1；第一阶段 F < 10 => 措辞锁定「相关」
- `8 八 异质性与机制分析` 3/2/0/0: heterogeneity.group.r0c1/r1c1、diff.r0c3、diffB.r0c3、mechanism.coef.r0c1；mechanism=no => 不写中介/机制成立；p > 0.1 => 「未发现显著差异」
- `9 九 结论与政策含义` 3/0/0/0: 措辞同 4.6.3；因果动词数 = 0
- vars: `{{cell:id}}` => 3 位小数 + para.cells[]；未知 => 跳过；`{{cite:n}}` => [n] + para.cites[]；无命中 => 此处待补文献 + unverified: true + countUnverified；chapter {id,no,title,unverified,paragraphs[],wording}；wording ∈ causal/associative/descriptive/neutral

#### 4.6.3 校验摘要三卡
`章节完成` = `{sections.length} / 9` / sub `已披露跳过：{skipped.join('、')}` 或 `未跳过任何步骤`；`允许措辞强度` = `因果`/`相关`/`描述` / sub `相关证据段落中因果动词数必须为 0`；`校验结果` = `N 处需处理`/`全部通过` / sub `N 处待补文献`/`无待补文献`；17px/700/purple；样例 0 命中 => `全部通过`。

#### 4.6.4 逐句校验四查（逐段、固定顺序；每次命中记 1 条；unverified 不进 issues）
- ① invalid_ref / low_trust: docId 不存在或 trust === 'low' => `引用指向不存在的文献 {docId}` / `来源《{title}》解析质量低，仅可提及`。
- ② weak_support: support === 'weak' => `引用仅弱支持该论断`。
- ③ unbound_number: findCell(cellId) 空 => `数字 {cid} 无法绑定到结果表`。
- ④ strength_violation: 因果越界且 wording !== 'causal' => `出现 {n} 处因果断言（命中「{verbs}」），超出"{label}"强度`。
- 样例 findCell c-0001–c-0005；baseline 5 条 weak_support。

#### 4.6.5 待补文献警示条
unverified > 0 => .banner.warn `有 N 处找不到语料依据` + `这些句子已标为『此处待补文献』，而不是编造成看起来像样的结论。建议补文献或换个能被支持的近似说法。`；样例 N = 1（六-3），0 => 不显示。

#### 4.6.6 风格包卡片
`语言风格：中国工业经济（默认）`；hint `平均句长 38.4 字 · 因此、然而、进一步地、值得注意的是 · 表格引出：表 X 报告了…`；btn `改为我的参考文献` => 模态「指定参考风格文献」，选项 `按我指定的参考文献风格`。

#### 4.6.7 引用台账
`引用台账` + `逐段逐句的校验结果`；rows = 全部段落（样例 28）；5 列 `章节`（章标题，不带编号）/ `段落` = `第 {index+1} 段` / `引用数` = para.cites.length（右）/ `数字绑定` = para.cells.length（右）/ `校验` 有 issues => 橙徽标、details 以 `；` 连接，否则绿 `通过`；空 `0`/`0`/`通过`。样例基线 5 行 issues > 0，全 weak_support，位于「二章第 4 段、三章第 1、2 段、五章第 2 段、八章第 3 段」。

#### 4.6.8 正文纸面视图
- title/sub: project title / fixed `——基于 2011—2022 年中国 A 股制造业上市公司面板数据`
- `摘要`（fixed）：`本文基于 2011—2022 年中国 A 股制造业上市公司面板数据，考察数字化转型与企业创新产出之间的关系。结果表明二者存在稳健的正相关关系，且该关系在大型企业中更为明显。受识别策略限制，本文结论应理解为条件相关关系，而非因果效应。`（项目包 Markdown 去逗号：`…条件相关关系而非因果效应。`）
- 关键词：`关键词：数字化转型；企业创新；固定效应；异质性`
- .para-flag: 以 ` · ` 连接 `此处待补文献`；`措辞越界：{n} 处因果断言（命中「{verbs}」）`
- .ref-chip: [n] => chip，索引 para.cites；title `题名 · 期刊 年份（强支持 / 弱支持 / 仅提及）`；weak => .unverified（橙）；click => 「文献出处」；越界 => `[?]` + `找不到对应文献`
- .figure-link: para.cells => cell => 值（3 位小数）；title = cell.label + ` · 点击回到结果表`；click => 统计分析 page
- downgrade box: wording !== 'causal' 且因果越界：提示 `该句与「相关」强度不符。可改为以下说法（强度不可调高，只能调低）：`；3 选项（候选原文）`改成相关表述 — …与…呈显著正相关（不主张因果）` / `改成伴随表述 — …伴随…的同步变化，方向与预期一致` / `改成描述表述 — …水平较高的企业，其…也相对更高`；regex **长分支在前**，因果动词 => `与…正相关`、说明性动词 => `与…的方向一致`；log + toast `已降级为：{label}（写入决策留痕）`

#### 4.6.9 导出（纯前端）
- `导出 Markdown` => H1 项目名 + `## 摘要` + 摘要 + `**关键词**：…` + 每章 `## {no}、{title}` + 原始段落（无 chip/链接/披露段）；文件名 `{项目标题}-初稿.md`；无初稿 => toast `还没有生成初稿`。
- `导出完整项目包` => 6 节（命题解析/实验设计/七步过程文件/写作说明/拒答与留痕台账/论文初稿）+ 三条结语（`正文约 {wcount} 字，含 {tables} 张结果表。`、`本文件由「智研」导出。所有系数、标准误与显著性均为程序计算所得；若与 Stata 等权威软件存在差异，请以权威软件为准。`、样例声明：本包为内置校准样例、非真实研究结果）；文件名 `{项目标题}-项目包.md`；无初稿 => toast `还没有生成论文初稿`。
- 项目包内「附：方法与披露说明」五条固定模板：（一）措辞强度 `本文全文采用「{因果|相关|描述}」表述强度，该强度由结论类型与识别策略检查清单共同推导，不随结果是否显著而临时调整。`；（二）未做的检验（步骤串，无则 `无。`）；（三）无法完成的检验 `事件研究（连续处理强度，无明确处理时点）` 或 `无。`；（四）待补文献 `全文共 {n} 处论断在现有文献库中找不到依据，已在正文中逐处标注，未作静默删除，也未编造出处。`；（五）语言风格 `行文结构参照《{styleJournal}》的组织方式与语体，仅模仿形式，未搬运任何原句。`
- 两者均 Blob + a[download] 浏览器下载；**不做 Word / .docx**（纯前端无法可靠生成，不调本地服务）。
- 样例导出 = 内置 PAPER，**数据与文献来源声明（样例声明）保留**。

#### 4.6.10 论文页边界
design 未确认点击 => 确认门 modal，不生成；流程未完成 => toast `实证尚未完成，可先生成但会披露未做项`（不阻断）；chip 无文献 => `[?]`；figure chip 无 cell => 跳过。

### 4.7 资源库 F-11 / 账号设置 F-12
本 Demo 只有演示轨：无 assets/、无本地文件读写、无 PDF/.dta 解析、无真实请求，全部内置校准样例。

#### 4.7.1 资源库页（可见界面）
rail `资源库` 行 `数据库`/`文献库` + chips #dataset-count/#library-count；点击 => resourcePage 'dataset'|'library'（相同 = 关闭）；btn `返回研究`；`来源` 展示 `选择本地文件夹`/`上传到浏览器`（演示态：仅 toast「演示模式：使用内置样例」）。.badge.blue `内置样例`。
- 文献库表 8 列：`题名`/`期刊`/`年份`/`作者`/`方法`/`结论`/`可信度`（强/弱/仅提及）/`来源`；行由内置 LIBRARY（d01…d22）决定。
- 语料体检三卡（内置数值）：`证据条数`、`反向证据`、`方法类证据`。
- 数据库页：数据集卡 = 名称 + 形状（行 × 列）+ `单位`/`时间` + 内置样例数值（DESIGN 的 baseline/robustness 结果表）。

#### 4.7.2 账号与设置模态（可见结构与演示态）
3 入口 #btn-settings/#btn-user/#rail-model-status；title `账号与设置`，sub `用户可以在这里配置真实的模型 API`，footer btn `完成`。
> 范围注:副标题是真相源逐字文案,照抄不改;本 Demo **不调模型、不发起任何请求**,「测试连接」只切换展示态,副标题里的「真实」不构成本期承诺。
- `账号`：`用户名`（默认 `研究者`，trim() 空 => toast `用户名不能为空`）；btn `保存账号` => toast `已保存账号：{name}`。
- banner `密钥只写不读`：`本页永不回显密钥内容。`；input type="password"（`API Key`），保存后清空。
- `模型服务`：title + displayName + `{baseURL} · {models.length} 个已配置模型`；badges `预置`/`自定义`；字段 `基址（Base URL）`/`API Key`/`邮箱（可选）`；btns `保存`/`测试连接`。
- 3 条预置通道（id/名称/模型）：deepseek-official/`DeepSeek 官方`/deepseek-chat, deepseek-reasoner；glm-official/`GLM / 智谱`/glm-4-plus, glm-4-flash；my-gateway/`自有中转网关`/qwen3-max。
- 演示行为：`测试连接` **只切换展示态、不发请求**：`连接中…` => `模型已就绪 · {displayName}`（附 `设置`）；无密钥 => `演示模式：未配置密钥，使用内置样例`；`保存` 只写内存态 + toast `已保存（演示态）`。
- 通道徽标三态：configured => `模型已就绪 · {displayName}`+`设置`；unconfigured => `{displayName} · 未配置密钥`+`配置`；无通道 => `模型服务未配置`+`配置`；top-bar `本地已保存`/`本地保存失败`。

#### 4.7.3 目录结构（纯前端）
`index.html` · `styles/*.css` · `scripts/*.js` · `scripts/stages/*.js` · `scripts/data.js`（内置 LIBRARY/DATASETS/DESIGN/STEPS/PAPER 与校准数值）；无 assets/、无 vendor/、无后端。

## 5. 示例数据、结构契约与演示

本节覆盖示例卡片、全流程演示脚本、内置样例数据、对话文案、自检清单、实现顺序。下文 `scripts/*.js` 路径均为参考实现，不要求同名。

### 5.1 唯一示例卡片（空态只保留一张）

| 字段 | 值 |
|---|---|
| `id` | `demo-main` |
| `tag` | `完整流程` |
| `title` | `数字化转型与企业创新` |
| `desc` | `完整的 13 阶段流程：从命题到论文初稿，含七步实证与质量门` |
| `topic` | `数字化转型 对 企业创新 的影响` |
| `scenario` | `full` |

`13 阶段`为内部阶段数的历史文案，与 UI 的 6 页签计数并存，照抄不改（见§4.0.4）。

- DOM：`#demo-cards` 内只渲染一张 `button.demo-card` 示例卡（单列）；点击：已存在 → 进入；从未开始（无消息）→ 补首条引导消息；不存在 → 按上表新建、写引导消息、设为当前项目、重绘。

### 5.2 全流程演示脚本

| 步 | 动作 | 结果 |
|---|---|---|
| 1 | 点示例卡片 | 进入项目态（四列栅格，§4.0.1）；对话区出现引导消息（含「如何开始？」选项卡） |
| 2 | 点「运行示例流程」 | 依次自动完成：写入 RQ（五槽位）→ 追加定义回复 → 700ms → 标记文献分析完成 + 追加文献回复 → 600ms → 生成实验设计 + toast「实验设计方案已生成，请核对后确认」；页签自动落在「实验设计」 |
| 3 | 阅读设计页 7 个分区 | 检查清单可见 `IV-01 不通过`（弱工具 F = 6.2 < 10）与 `DID-04 信息不足` |
| 4 | 点「确认并开始实证」 | 打开确认门模态（副标题 `全流程唯一硬门禁 · 未确认不读取任何数据`）；`gateCheck` 因 IV-01 未处置而 `blocked`（主按钮显示 `尚有 1 项待处置` 且禁用） |
| 5 | 在 IV-01 行点「处置」，选择处置方式「降措辞 — 接受"相关"表述」 | 检查项标记已处置 → **设计确认失效链不触发**（此处为首次处置，尚未确认）→ 主按钮变为可用 |
| 6 | 再点「确认并开始实证」 → 模态内点「确认并开始实证」 | 写入确认（hash + 事件），自动切到「数据处理」，七步流水线初始化为 `pending` |
| 7 | 依次执行七步(或点顶部`运行七步实证`批量) | 按 ①…⑦ 自动推进,每步出三件套;进度/暂停/跳过/重跑见 §4.5.10;第 ⑤ 步如实报告弱工具、第 ④ 步披露 1 项「无法完成」 |
| 8 | 观察「统计分析」页质量门三卡 | `完成进度 7 / 7`、`允许措辞强度 相关`、`数值一致性 已校验` |
| 9 | 切「论文生成」→ 点「生成论文初稿」 | 生成九章初稿；三卡显示 `章节完成 9 / 9`、`允许措辞强度 相关`、`校验结果 5 处需处理`（副文 `1 处待补文献`） |
| 10 | 点台账里的橙徽标、点正文数字 chip、点引用角标 | 分别看到 weak_support 说明、跳回结果表单元格、打开文献出处抽屉 |
| 11 | 点「导出 Markdown」/「导出完整项目包」 | 下载 `数字化转型与企业创新-初稿.md` / `-项目包.md` |
| 12 | 刷新页面（F5） | 现场完整复原：当前项目、页签、七步结果、初稿、对话记录 |

### 5.3 内置样例数据

各小节依次给出 `RQ` / `LIBRARY` / `LIBRARY_STATS` / `DATASETS` / `DESIGN` / `STEPS` / `PAPER` / `PROVIDERS` 与初始状态、单测基线的声明值。

#### 5.3.1 `RQ`

```js
{
  phenomenon: '数字化转型对企业创新产出的影响',
  researchQuestion: '数字化转型是否提升了企业创新产出？',
  objectLevel: 'firm-year',
  objectLevelLabel: '中国 A 股制造业上市公司（企业-年）',
  timeWindow: [2011, 2022],
  variationSource: 'digital-transformation-intensity',
  variationSourceLabel: '企业层面数字化转型强度差异（连续强度）',
  claimType: 'causal',
  claimSentence: '数字化转型显著提升了企业创新产出（因果）',
  outcomeVar: 'ln_innov',
  treatmentVar: 'digi',
  outOfScope: [
    '不讨论服务业与非上市企业',
    '不识别数字化转型的具体技术路径',
    '不做跨国比较'
  ],
  unknownSlots: ['variationSource'],
  candidateQuestions: [
    { text: '数字化转型是否提升了企业创新产出？', corpusSupport: 12, feasibility: '中',   note: '语料中 DiD / 面板 FE 证据较多，但存在负向证据（1 篇）' },
    { text: '数字化转型通过融资约束渠道影响创新吗？', corpusSupport: 3, feasibility: '低',   note: '机制类文献仅 3 篇，且中介变量内生性难以处理' },
    { text: '数字化转型的创新效应在大型与中小企业间是否存在差异？', corpusSupport: 5, feasibility: '中高', note: '有直接可对照的异质性文献 2 篇' }
  ],
  source: 'llm'
}
```

措辞强度由 `IV-01 fail` + `DID-04 unknown` 锁「相关」；与真相源 `data.js` 的逐字差异仅上面标注的 4 个扩展字段（演示轨不使用），其余 11 键逐字一致。

#### 5.3.2 `LIBRARY`

| id | file | title | journal | year | authors | method | trust | coverage | mojibake | scanned | twoCol | design | conclusion | quote | page | charRange | rrf |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| d01 | 数字化与企业创新_张三_2021.pdf | 数字化转型与企业创新绩效：基于A股上市公司的经验证据 | 中国工业经济 | 2021 | 张三, 李四 | DiD | high | 0.982 | 0.001 | false | none | causal | positive | 数字化转型显著提升了企业创新绩效，且该效应在制造业与高技术行业中更为明显。 | 12 | [1840, 1932] | 0.91 |
| d02 | 数字经济与企业创新效率_王五_2020.pdf | 数字经济发展与企业创新效率——来自地级市层面的证据 | 管理世界 | 2020 | 王五 | 面板FE | high | 0.964 | 0.002 | false | none | associative | positive | 数字经济发展水平与企业创新效率呈显著正相关，但这一关系在控制城市固定效应后有所减弱。 | 34 | [2210, 2301] | 0.87 |
| d03 | 数字化转型的测度与争议_赵六_2022.pdf | 数字化转型测度方法的比较与再检验 | 数量经济技术经济研究 | 2022 | 赵六, 孙七 | 方法学 | high | 0.951 | 0.003 | false | none | descriptive | mixed | 不同测度方式下数字化转型与企业创新的估计结果存在明显差异，年报词频法可能高估效应。 | 8 | [640, 726] | 0.83 |
| d04 | 数字化_融资约束与创新_陈八_2019.pdf | 数字化转型、融资约束与企业创新 | 金融研究 | 2019 | 陈八 | 中介效应 | medium | 0.812 | 0.041 | false | none | mechanistic | positive | 融资约束在数字化转型影响企业创新的过程中起到部分中介作用。 | 21 | [1102, 1176] | 0.79 |
| d05 | 数字化与创新_负向证据_周九_2023.pdf | 数字化转型抑制了实质性创新吗？——基于专利结构的再考察 | 经济研究 | 2023 | 周九, 吴十 | DiD | high | 0.973 | 0.001 | false | none | causal | negative | 数字化转型显著增加了外观设计专利，但对发明专利的影响并不显著，甚至在中介检验中呈弱负向。 | 45 | [3010, 3104] | 0.81 |
| d06 | 产业政策与企业创新_2020.pdf | 产业政策、政府补贴与企业创新投入 | 中国工业经济 | 2020 | 郑一 | PSM-DID | high | 0.958 | 0.002 | false | none | causal | positive | 产业政策通过政府补贴渠道显著提高了企业的研发投入强度。 | 17 | [1508, 1580] | 0.62 |
| d07 | 公司治理与创新_2021.pdf | 股权结构与技术创新：监督还是掏空 | 南开管理评论 | 2021 | 冯二 | 面板FE | high | 0.944 | 0.002 | false | none | associative | mixed | 股权集中度与创新产出呈倒U型关系，过高集中度下监督效应被掏空效应抵消。 | 26 | [2040, 2120] | 0.58 |
| d08 | 高铁开通与创新溢出_2022.pdf | 高铁开通与区域创新溢出 | 经济学(季刊) | 2022 | 许三 | RDD | high | 0.967 | 0.001 | false | none | causal | positive | 高铁开通对沿线城市的专利授权量产生了显著的正向影响，且效应随距离衰减。 | 9 | [720, 800] | 0.49 |
| d09 | 营商环境与企业创新_2019.pdf | 营商环境优化能否促进企业创新 | 管理科学学报 | 2019 | 何四 | 面板FE | medium | 0.847 | 0.028 | false | none | associative | positive | 营商环境指数每提高一个标准差，企业专利申请量平均提高约 4.3%。 | 15 | [1330, 1402] | 0.55 |
| d10 | 扫描件_数字化案例研究_2018.pdf | 传统制造企业数字化转型的路径研究 | 案例研究 | 2018 | 吕五 | 案例研究 | low | 0.412 | 0.156 | **true** | none | descriptive | n/a | （该篇为扫描件，文本层缺失，仅可作提及，不可引用原句） | 1 | [0, 40] | 0.33 |
| d11 | 双栏排版_数字化与全要素生产率_2021.pdf | 数字化转型与全要素生产率：来自中国工业企业的证据 | 世界经济 | 2021 | 施六 | DiD | medium | 0.878 | 0.012 | false | **high** | causal | positive | 数字化转型通过降低信息摩擦提升了企业全要素生产率。 | 40 | [2600, 2668] | 0.74 |
| d12 | 创新质量与专利结构_2023.pdf | 专利质量视角下的企业创新评价 | 科研管理 | 2023 | 钱七 | 指标体系 | high | 0.939 | 0.002 | false | none | descriptive | n/a | 发明专利占比是衡量创新质量的关键指标，仅使用专利总量会掩盖结构性差异。 | 6 | [498, 570] | 0.71 |
| d13 | 组织变革与数字化_2020.pdf | 组织变革在数字化转型中的作用 | 管理评论 | 2020 | 孙八 | 问卷 | high | 0.921 | 0.003 | false | none | mechanistic | positive | 组织变革能力是数字化转型转化为创新产出的重要条件。 | 19 | [1620, 1690] | 0.66 |
| d14 | 知识产权保护与创新_2019.pdf | 知识产权保护强度与企业创新激励 | 中国软科学 | 2019 | 李九 | IV | medium | 0.851 | 0.022 | false | none | causal | positive | 以历史专利存量作为工具变量，知识产权保护显著提升了企业创新激励。 | 23 | [1890, 1972] | 0.6 |
| d15 | 数字化转型的行业异质性_2022.pdf | 数字化转型效应的行业与规模异质性 | 产业经济研究 | 2022 | 张十 | 分组回归 | high | 0.955 | 0.002 | false | none | associative | mixed | 数字化转型的创新效应在大型企业中显著，在中小企业中并不稳健。 | 11 | [1020, 1096] | 0.77 |
| d16 | 数字金融与企业创新_2021.pdf | 数字金融发展与企业创新产出 | 金融研究 | 2021 | 王一 | 面板FE | high | 0.948 | 0.002 | false | none | associative | positive | 数字金融覆盖广度每提升 10%，企业专利申请量提高约 1.8%。 | 28 | [2240, 2312] | 0.52 |
| d17 | 数据要素与创新_2023.pdf | 数据要素市场化配置与企业创新 | 经济研究 | 2023 | 柳二 | DiD | high | 0.971 | 0.001 | false | none | causal | positive | 数据交易平台设立显著提升了本地企业的创新产出，且存在明显的空间溢出。 | 37 | [2500, 2580] | 0.69 |
| d18 | 管理层认知与数字化_2022.pdf | 管理层数字化认知与战略转型 | 南开管理评论 | 2022 | 周三 | 文本分析 | high | 0.933 | 0.003 | false | none | descriptive | n/a | 管理层认知是数字化转型决策的前置条件，但在中小板企业中差异较大。 | 14 | [1230, 1300] | 0.45 |
| d19 | 创新补贴的挤出效应_2020.pdf | 政府创新补贴的激励与挤出 | 中国工业经济 | 2020 | 吴四 | PSM | medium | 0.862 | 0.018 | false | none | causal | mixed | 创新补贴对研发投入存在激励效应，但对专利产出出现部分挤出。 | 31 | [2060, 2130] | 0.43 |
| d20 | 数字化转型的长期效应_2023.pdf | 数字化转型的长期创新效应：五年追踪 | 管理世界 | 2023 | 郑五 | 事件研究 | high | 0.962 | 0.002 | false | none | causal | positive | 转型后第 2–4 年创新产出显著上升，短期效应并不明显。 | 42 | [2860, 2932] | 0.76 |
| d21 | 区域数字基础设施_2021.pdf | 区域数字基础设施与企业创新 | 数量经济技术经济研究 | 2021 | 孙六 | 面板FE | medium | 0.836 | 0.031 | false | none | associative | positive | 宽带中国试点地区的企业创新产出提升约 6.1%。 | 18 | [1560, 1628] | 0.5 |
| d22 | 综述_中国数字化转型研究进展_2022.pdf | 中国情境下数字化转型研究：一个文献综述 | 经济学动态 | 2022 | 钱七, 李九 | 综述 | high | 0.945 | 0.002 | false | none | descriptive | mixed | 现有研究在测度、样本期与识别策略上高度异质，结论分歧主要源于此。 | 5 | [360, 434] | 0.85 |

#### 5.3.3 `LIBRARY_STATS`

```js
{ total: 22, byTrust: { high: 16, medium: 5, low: 1 },
  avgCoverage: 0.912, medianMojibake: 0.002, scanned: 1, twoColRisk: 1,
  years: { min: 2018, max: 2023 },
  methods: { DiD: 5, 面板FE: 5, RDD: 1, IV: 1, PSM: 2, 事件研究: 1, 分组回归: 1,
             案例研究: 1, 方法学: 1, 综述: 1, 问卷: 1, 指标体系: 1, 文本分析: 1 } }
```

体检三卡显示：`质量分布 绿 16 / 黄 5 / 红 1`（副文 `绿灯率 72.7%（≥50% 可继续）`）、`平均覆盖率 91.2%`（副文 `乱码率中位数 0.20%`）、`版式风险 1 篇扫描 / 1 篇双栏`（副文 `扫描件未做 OCR；双栏篇目引用需人工核对页码`）。
三卡读**预置统计**（非实时）；16/5/1、0.912 照抄现值。**硬约束：文献分析页与资源库体检卡的这类数字一律取本处`LIBRARY_STATS`声明值，禁止按§5.3.2的`trust`列现算**（逐格统计为 high 15 / medium 6 / low 1，与声明值 16/5/1 不同；声明值优先，绿灯率仍为 72.7%）。

#### 5.3.4 `DATASETS`

`ds1`：`A股制造业面板_2011-2022.csv`|18042 行|14 列|4823040 字节|panel|`firm_id × year`|2847 家|12 期|缺失率 0.023。
列（名称|含义|类型|缺失率）：`firm_id`|企业代码|id|0；`year`|年份|int|0；`province_id`|省份代码|id|0；`industry_id`|行业代码|id|0；`ln_innov`|创新产出（ln 专利申请数）|float|0.004；`ln_innov_inv`|发明专利（ln）|float|0.006；`ln_innov_util`|实用新型（ln）|float|0.006；`digi`|数字化转型（年报词频占比）|float|0.031；`digi_alt`|数字化转型（无形资产占比，替代度量）|float|0.048；`size`|企业规模（ln 总资产）|float|0.002；`lev`|资产负债率|float|0.011；`roa`|总资产收益率|float|0.009；`age`|企业年龄（ln）|float|0.003；`subsidy`|政府补贴（ln）|float|0.057。
`ds2`：`城市营商环境指数_2011-2022.xlsx`|3360 行|6 列|512000 字节|panel|`city_id × year`|280 家|12 期|0.008。
列：`city_id`|城市代码|id|0；`year`|年份|int|0；`biz_env`|营商环境指数|float|0.008；`digital_infra`|数字基础设施指数|float|0.012；`gdp_pc`|人均GDP（ln）|float|0.002；`fdi`|实际利用外资占比|float|0.021。
`.badge.blue`「内置样例」；数据页与对话区显示 `18,042 行 / 14 列 / 2,847 家 / 12 期`。
演示轨以外的能力（本地文件夹、真实 .dta/PDF、真实模型调用）本期不做；界面不得出现会失败的入口预期。

#### 5.3.5 实验设计 `DESIGN`（演示轨第 3 版）

```js
{
  version: 3,
  hypotheses: [
    { id: 'H1', statement: '数字化转型显著提升企业创新产出', direction: '+',        mechanism: '降低信息摩擦与协调成本', outcomeVar: 'ln_innov', priorLit: ['d01','d11','d20'] },
    { id: 'H2', statement: '该效应在大型企业中更强',           direction: '+（大企业）', mechanism: '规模互补性',             outcomeVar: 'ln_innov', priorLit: ['d15','d02'] }
  ],
  sample: {
    source: 'A股制造业面板_2011-2022.csv',
    obsLevel: '企业-年（firm-year）',
    period: '2011–2022',
    nPlanned: 18042,
    nUnits: 2847,
    filter: '剔除金融业、ST/*ST、资产负债率 > 1 及关键变量缺失样本',
    missingHandling: '核心变量缺失按行业-年份中位数插补，插补比例 2.3% 并做敏感性检验'
  },
  model: {
    equation: 'ln_innov(i,t) = β0 + β1·digi(i,t) + γ·Controls(i,t) + μ(i) + λ(t) + ε(i,t)',
    feTerms: ['firm FE', 'year FE'],
    cluster: 'firm',
    clusterNote: '处理在**企业层**变异（连续强度），故聚类到企业层；若改用地区试点识别需聚类到城市层',
    weights: '无',
    estimator: 'OLS + 双向固定效应（within 变换）'
  },
  expected: {
    sign: '+',
    magnitude: 'β1 约 0.06 – 0.11（对数-对数半弹性）',
    significance: '5% 水平显著',
    fallback: '若符号反转或失显著：报告设定敏感性，不修改主结论；若替换度量后失显著，措辞降为"在部分设定下成立"'
  }
}
```

变量定义（10 行）：

| 变量 | 角色 | 构造 | 数据字段 | 缺失处理 | 预期符号 | 文献依据 |
|---|---|---|---|---|---|---|
| `ln_innov` | 被解释变量 | ln(1 + 专利申请总数) | `ln_innov` | 不插补 | — | d01, d12 |
| `ln_innov_inv` | 被解释变量（替代） | ln(1 + 发明专利数) | `ln_innov_inv` | 不插补 | — | d05, d12 |
| `digi` | 核心解释变量 | 年报数字化词频 ÷ 年报总词数 | `digi` | 行业-年份中位数 | + | d01, d03 |
| `digi_alt` | 核心解释变量（替代） | 数字化相关无形资产 ÷ 总资产 | `digi_alt` | 行业-年份中位数 | + | d03 |
| `size` | 控制变量 | ln(总资产) | `size` | 中位数 | + | d07 |
| `lev` | 控制变量 | 总负债 ÷ 总资产 | `lev` | 中位数 | − | d07 |
| `roa` | 控制变量 | 净利润 ÷ 总资产 | `roa` | 中位数 | + | d07 |
| `age` | 控制变量 | ln(1 + 企业年龄) | `age` | 中位数 | − | d06 |
| `firm FE` | 固定效应 | 企业个体固定效应 | `firm_id` | — | — | — |
| `year FE` | 固定效应 | 年份固定效应 | `year` | — | — | — |

检查清单（7 项）：

| id | 检查项 | 判定 | 依据 | 需要你补什么 |
|---|---|---|---|---|
| FE-01 | 组内变异充分性 | pass | digi 组内标准差 / 总标准差 = 0.61（去均值后仍有充分变异） | — |
| FE-02 | 面板结构明确 | pass | N = 2,847，T = 12（长 N 短 T） | — |
| FE-03 | 序列相关处理 | pass | 聚类到企业层，聚类数 2,847 | — |
| FE-04 | 不平衡面板与流失 | pass | 缺失率 2.3%，随机缺失检验 p = 0.31 | — |
| DID-04 | 平行趋势（若声称因果） | unknown | 连续处理强度设计，无明确处理时点，事件研究不适用 | 若要写"因果"，需改为政策试点识别或补一个外生冲击作为工具变量 |
| IV-01 | 工具变量强度 | **fail** | 备选工具（同行业同年度其他企业数字化均值）第一阶段 F = 6.2 < 10 | 更换工具变量，或接受"相关"表述。**不接受弱工具下的因果结论** |
| GEN-04 | 措辞强度匹配 | pass | 因 IV-01 未通过，措辞强度锁定为 associative（相关） | — |

`DESIGN.pipeline`（UI 显示 ○/✓ 与「第 i/n 项」）：

| 步骤 | items |
|---|---|
| `data-prep` | 类型转换与面板唯一性校验 / 缺失处理（行业-年份中位数）/ 异常值缩尾 1%/99% / 变量构造（ln_innov / digi / 控制变量）/ 样本筛选 |
| `descriptive` | 描述性统计表 / 相关系数矩阵 / 分组均值对比 |
| `baseline` | 主回归（firm + year FE，企业层聚类）/ 报告 N / 组内R² / 聚类数 / FE 清单 |
| `robustness` | 替换被解释变量（发明专利）/ 替换核心解释变量（无形资产占比）/ 更换样本窗 / 增删控制变量 / 安慰剂检验 / 更换聚类层级 / 更换 FE 组合 |
| `endogeneity` | 工具变量 2SLS（含第一阶段 F）/ 滞后一期解释变量 / 说明：弱工具故本步结论仅作参考 |
| `heterogeneity` | 按企业规模分组 / 按所有制分组 / 组间系数差异检验 |
| `mechanism` | 融资约束渠道（KZ 指数）/ 对照组直接效应 |

本期只有演示轨：全部数据为内置校准样例；本地文件/真实 .dta/PDF/模型调用不做。

#### 5.3.6 七步结果 `STEPS`（演示轨内置样例）

**数值格式（硬约束）**：

| 量 | 数值格式 |
|---|---|
| 系数 / 标准误 / t 值 | 3 位小数（`0.083`；负号用 `−`） |
| p 值 | 3 位小数（`< 0.001` 显示 `0.000`） |
| 显著性标记 | `***` p < 0.01；`**` p < 0.05；`*` p < 0.10；否则留空 |
| 样本量 / 观测数 / 聚类数 | 千分位整数（`18,042`） |
| 百分比（缺失率 / 插补比例 / 完成率） | 1 位小数（`2.3%`） |
| R²（含组内 R²） | 3 位小数 |
| 无法计算 / 无法完成 | `—`（不写 0 / `NaN` / 空串） |

> 聚类数 `2,847` 先按千分位解析为 `2847` 再与阈值比较。

**① `data-prep` 数据清洗**
- summary：`读取 18,042 行 × 14 列；剔除关键变量缺失与资产负债率 > 1 的样本 486 行；缩尾 1%/99% 处理 372 个观测。`
- metrics：`原始观测 18,528` / `有效样本 18,042` / `剔除 486` / `缩尾观测 372` / `缺失率 2.3%`
- 结果表：

| 变量 | 观测数 | 均值 | 标准差 | 最小值 | 中位数 | 最大值 |
|---|---|---|---|---|---|---|
| ln_innov | 18,042 | 1.842 | 1.106 | 0.000 | 1.792 | 6.214 |
| ln_innov_inv | 17,935 | 1.104 | 0.982 | 0.000 | 0.693 | 5.106 |
| digi | 18,042 | 0.284 | 0.176 | 0.000 | 0.261 | 1.084 |
| digi_alt | 17,180 | 0.061 | 0.048 | 0.000 | 0.052 | 0.312 |
| size | 18,042 | 22.184 | 1.246 | 18.702 | 22.041 | 27.108 |
| lev | 18,042 | 0.428 | 0.196 | 0.041 | 0.421 | 0.892 |
| roa | 18,042 | 0.041 | 0.062 | −0.284 | 0.038 | 0.226 |
| age | 18,042 | 2.612 | 0.518 | 0.693 | 2.708 | 3.611 |

**② `descriptive` 描述性统计**
- summary：`核心变量分布合理；digi 与 ln_innov 的相关系数为 0.213，未见严重多重共线性（最大 VIF = 1.84）。`
- metrics：`相关系数 corr(digi, ln_innov) 0.213` / `最大 VIF 1.84` / `处理组均值 2.104` / `对照组均值 1.638`
- 结果表（相关系数矩阵）：

| | ln_innov | digi | size | lev | roa | age |
|---|---|---|---|---|---|---|
| ln_innov | 1.000 | | | | | |
| digi | 0.213 | 1.000 | | | | |
| size | 0.318 | 0.142 | 1.000 | | | |
| lev | 0.062 | −0.031 | 0.284 | 1.000 | | |
| roa | 0.148 | 0.024 | −0.062 | −0.318 | 1.000 | |
| age | −0.048 | 0.018 | 0.146 | 0.112 | −0.084 | 1.000 |

**③ `baseline` 基准回归**
- summary：`核心解释变量 digi 的系数为 0.083，在 5% 水平显著为正；组内 R² 0.412，聚类数 2,847。`
- metrics：`N 18,042` / `组内 R² 0.412` / `聚类数 2,847（企业层）` / `固定效应 firm + year`
- 结果表：

| 变量 | 系数 | 标准误 | t 值 | p 值 | 显著性 |
|---|---|---|---|---|---|
| digi | 0.083 | 0.034 | 2.441 | 0.015 | ** |
| size | 0.142 | 0.021 | 6.762 | 0.000 | *** |
| lev | −0.068 | 0.041 | −1.659 | 0.097 | * |
| roa | 0.216 | 0.092 | 2.348 | 0.019 | ** |
| age | −0.032 | 0.028 | −1.143 | 0.253 | |
| 常数项 | −2.418 | 0.486 | −4.975 | 0.000 | *** |

- 绑定单元格 `cells`：
  `c-0001` digi 系数 = 0.083（term `digi`，coef 0.083，se 0.034，t 2.441，p 0.015）；`c-0002` digi 标准误 = 0.034；`c-0003` 组内 R² = 0.412；`c-0004` 样本量 N = 18042；`c-0005` 聚类数 = 2847。
- **脚本视图内容（逐字）**：

```python
# 03-baseline：主回归（双向固定效应 + 企业层聚类）
# seed=20240113  data_hash=8f3a91c2  env_lock=env_lock.txt
import pandas as pd, numpy as np
import statsmodels.formula.api as smf

df = pd.read_csv("data/A股制造业面板_2011-2022.csv")
df = df.dropna(subset=["ln_innov", "digi", "size", "lev", "roa", "age"])
df = df[df["lev"] <= 1]

# 组内去均值（吸收 firm FE 与 year FE）
def demean(frame, cols, by):
    g = frame.groupby(by)[cols]
    return frame[cols] - g.transform("mean")

cols = ["ln_innov", "digi", "size", "lev", "roa", "age"]
d = demean(df, cols, "firm_id")
d = demean(d.join(df[["year"]]), cols, "year")

model = smf.ols("ln_innov ~ digi + size + lev + roa + age", data=d).fit(
    cov_type="cluster", cov_kwds={"groups": df["firm_id"]})
print(model.summary())

# 组内 R²
within_r2 = 1 - model.ssr / ((d["ln_innov"] - d["ln_innov"].mean()) ** 2).sum()
print(f"within R2 = {within_r2:.3f}")
```

**④ `robustness` 稳健性检验**
- summary：`7 项稳健性检验中 6 项完成、1 项无法完成（期数不足以做事件研究）；替换核心度量后系数降至 0.061 但仍显著。`
- metrics：`完成 6 / 7` / `无法完成 1（事件研究）` / `符号稳定 是` / `最小系数 0.061`
- 结果表：

| 稳健性检验 | digi 系数 | 标准误 | N | 聚类数 | 结论 |
|---|---|---|---|---|---|
| 基准设定 | 0.083 | 0.034 | 18,042 | 2,847 | 通过 |
| 替换被解释变量（发明专利） | 0.061 | 0.029 | 17,935 | 2,842 | 通过（系数下降） |
| 替换核心解释变量（无形资产占比） | 0.094 | 0.041 | 17,180 | 2,731 | 通过 |
| 更换样本窗（2013–2022） | 0.079 | 0.036 | 15,204 | 2,588 | 通过 |
| 增删控制变量 | 0.081 | 0.033 | 18,042 | 2,847 | 通过 |
| 安慰剂检验（提前 2 期处理） | 0.012 | 0.031 | 16,880 | 2,690 | 通过（不显著） |
| 更换聚类层级（行业层） | 0.083 | 0.048 | 18,042 | 31 | **注意**：聚类数仅 31，推断偏乐观 |
| 事件研究 | — | — | — | — | 无法完成（连续处理无明确时点） |

- 脚本要点：`pandas` 逐项循环 7 项设定，每项复用 ③ 的去均值 + 聚类 OLS；输出 `result__robustness.csv` + `interpret__robustness.md`。

**⑤ `endogeneity` 内生性分析**
- summary：`工具变量第一阶段 F = 6.2，低于经验门槛 10 → 弱工具。按规范不改报因果，主结论措辞保持"相关"。`
- metrics：`第一阶段 F 6.2` / `经验门槛 10` / `判定 弱工具` / `处置 退回 OLS + 降措辞`
- 结果表：

| 设定 | digi 系数 | 标准误 | 第一阶段 F | 结论 |
|---|---|---|---|---|
| OLS（基准） | 0.083 | 0.034 | — | 报告 |
| 2SLS（同行业同年度均值作工具） | 0.142 | 0.078 | 6.2 | **弱工具，不作因果解读** |
| 滞后一期解释变量 | 0.071 | 0.038 | — | 通过 |

- 步骤警告（必须显示）：`弱工具直接决定全文只能用"相关/伴随"表述，不能用"促进/导致"。`

**⑥ `heterogeneity` 异质性分析**
- summary：`按企业规模分组的组间系数差异显著（p = 0.038）；按所有制分组的差异不显著（p = 0.412）。`
- metrics：`规模分组差异 p 0.038` / `所有制分组差异 p 0.412` / `有效分组 1 / 2`
- 结果表：

| 分组 | digi 系数 | 标准误 | N | 组间差异 p 值 |
|---|---|---|---|---|
| 大型企业（size 高于中位数） | 0.121 | 0.042 | 9,021 | 0.038 |
| 中小企业 | 0.038 | 0.045 | 9,021 | （参照组） |
| 国有企业 | 0.076 | 0.048 | 6,318 | 0.412 |
| 非国有企业 | 0.088 | 0.039 | 11,724 | （参照组） |

- 步骤警告：`p = 0.412 表示两组系数没有统计差异，不得写成"对非国有企业作用更强"。`

**⑦ `mechanism` 机制分析**
- summary：`语料中无外生机制变量的直接证据；融资约束渠道为事后探索（post-hoc），措辞降级为"与…一致"。`
- metrics：`机制证据 事后（post-hoc）` / `渠道变量内生性 存在` / `允许措辞 与…一致`
- 结果表：

| 机制变量 | 系数 | 标准误 | p 值 | 是否可称机制 |
|---|---|---|---|---|
| 融资约束（KZ 指数） | −0.046 | 0.021 | 0.029 | 否（内生，仅可称"一致"） |
| 直接效应 | 0.068 | 0.033 | 0.041 | — |

- 步骤警告：`中介变量受数字化转型影响，本步结论不能写成"通过融资约束渠道"。`

**演示轨 `cells` 与三件套**：基准回归给出 `c-0001`–`c-0005`（论文正文只绑定这 5 个）；`baseline` 解读句式 `**digi 系数 0.083**（标准误 0.034，t = 2.441，p = 0.015）`，每个数字都绑定 `cell_id`，其余步骤解读与各自结果表一致。

- `data-prep` 解读对账「原始观测 / 剔除 / 缩尾 / 有效样本」，`descriptive` 解读引用相关系数、最大 VIF、分组均值。
- 演示数据固定：28 段文案 / 20 条引用 / 5 行 `weak_support`，不随用户操作改变；三件套命名 `code__{stepId}.py` / `result__{stepId}.md` / `result__{stepId}.csv` / `interpret__{stepId}.md`，「下载三件套」合并为一个 Markdown（`step-{stepId}-三件套.md`）。

**结果表对齐标记 `numCols`（0 基数据列号，UI 比较前 `+1`）**：

| 步骤 | 表头 | `numCols`（0 基） | 对应右对齐列 |
|---|---|---|---|
| `data-prep` | 变量 / 观测数 / 均值 / 标准差 / 最小值 / 中位数 / 最大值 | `[0,1,2,3,4,5]` | 观测数起全部数值列 |
| `descriptive` | 空 / ln_innov / digi / size / lev / roa / age | 无（矩阵不设数字列） | — |
| `baseline` | 变量 / 系数 / 标准误 / t 值 / p 值 / 显著性 | `[0,1,2,3]` | 系数 / 标准误 / t 值 / p 值 |
| `robustness` | 稳健性检验 / digi 系数 / 标准误 / N / 聚类数 / 结论 | `[0,1,2]` | digi 系数 / 标准误 / N |
| `endogeneity` | 设定 / digi 系数 / 标准误 / 第一阶段 F / 结论 | `[0,1,2]` | digi 系数 / 标准误 / 第一阶段 F |
| `heterogeneity` | 分组 / digi 系数 / 标准误 / N / 组间差异 p 值 | `[0,1,2,3]` | digi 系数 / 标准误 / N / 组间差异 p 值 |
| `mechanism` | 机制变量 / 系数 / 标准误 / p 值 / 是否可称机制 | `[0,1,2]` | 系数 / 标准误 / p 值 |

> `numCols` 是去掉首列后的 0 基数据列号，渲染第 `i` 列时判断 `numCols.includes(i - 1)`；别用 `indexOf(i - 1)` 或存成 `[1,2,3,4]`。

#### 5.3.7 论文初稿 `PAPER`（演示轨内置样例）

```js
{
  id: 'paper-v1',
  styleMode: 'journal-default',
  styleJournal: '中国工业经济',
  styleProfile: { avgSentenceLen: 38.4,
                  connectors: ['因此','然而','进一步地','值得注意的是'],
                  sectionParagraphs: [4, 7],
                  figureLead: '表 X 报告了…',
                  conclusionTone: '审慎、限定样本与时期' },
  wording: 'associative',        // 全文门控与摘要卡读它
  sections: [ /* 九章，见下表；每章自带 wording，第四章为 'neutral' */ ]
}
```

九章共 **28 段**，段落结构 `{text, cites: [{docId, support}], cells: [cellId], unverified?}`：

| 章 | 段 | 引用（strong/weak） | 数字绑定 | 待补 |
|---|---|---|---|---|
| 一 引言 | 1 | d01 s / d22 s | — | — |
| | 2 | d01 s / d05 s | — | — |
| | 3 | d03 s | — | — |
| | 4 | 无 | — | — |
| 二 文献综述 | 1 | d01 s / d11 s / d20 s | — | — |
| | 2 | d05 s / d12 s | — | — |
| | 3 | d03 s / d22 s | — | — |
| | 4 | **d04 w**（弱支持 → 台账报 1 条 `weak_support`） | — | — |
| 三 理论分析与研究假设 | 1 | d01 s / **d13 w** | — | — |
| | 2 | d15 s / **d02 w** | — | — |
| 四 研究设计 | 1–3 | 无 | — | — |
| 五 实证结果 | 1 | 无 | **c-0001 / c-0002** | — |
| | 2 | **d07 w** | **c-0003 / c-0005** | — |
| | 3 | 无 | — | — |
| | 4 | 无 | — | — |
| 六 稳健性检验 | 1 | 无 | — | — |
| | 2 | 无 | — | — |
| | 3 | 无 | — | **是**（`unverified: true` → 正文标 `此处待补文献`） |
| 七 内生性讨论 | 1–2 | 无 | — | — |
| 八 异质性与机制分析 | 1 | d15 s | — | — |
| | 2 | 无 | — | — |
| | 3 | **d04 w** | — | — |
| 九 结论与政策含义 | 1–3 | 无 | — | — |

**合计**：引用条目 20（其中 weak 5）；数字绑定 4（**`baseline.n.r0c1` 即 `c-0004` 样本量在固定样例中不绑定**）；待补文献 1；台账 28 行、5 行报 `weak_support`（位置：二章第 4 段、三章第 1、2 段、五章第 2 段、八章第 3 段）。

**锚点段落（逐字）**：

| 章-段 | 正文（逐字） |
|---|---|
| 三-1 | `数字化转型通过降低信息摩擦与协调成本，可能提升企业的创新投入与产出效率。基于此，本文提出：假设 H1，数字化转型与企业创新产出正相关。` |
| 三-2 | `规模互补性理论预测，大型企业具备更充足的资源以承接数字化带来的组织变革，因而效应可能更强。据此提出：假设 H2，上述关系在大型企业中更强。` |
| 四-1 | `本文使用 2011—2022 年中国 A 股制造业上市公司面板数据，共 2,847 家企业、18,042 个企业-年观测。数据来自用户导入的本地数据文件，变量定义见表 1。` |
| 四-2 | `基准模型采用双向固定效应设定，并聚类到企业层：ln_innov(i,t) = β0 + β1·digi(i,t) + γ·Controls(i,t) + μ(i) + λ(t) + ε(i,t)。` |
| 四-3 | `需要说明的是，数字化转型强度在企业层连续变异，不存在明确的政策处理时点，因此本文的识别策略更接近条件相关分析，而非严格的因果识别。` |
| 五-1 | `表 2 报告了基准回归结果。核心解释变量 digi 的系数为 0.083，在 5% 水平上显著。由于解释变量与被解释变量均取对数形式，该系数可解释为数字化转型强度每提高 1%，企业创新产出约提高 0.083%。`（绑定 `c-0001`、`c-0002`） |
| 五-2 | `控制变量方面，企业规模与总资产收益率均显著为正，与既有研究一致。组内 R² 为 0.412，聚类数为 2,847。`（引用 `d07` weak；绑定 `c-0003`、`c-0005`） |
| 六-2 | `有一项检验未能完成：由于数字化转型为连续强度变量、不存在明确的处理时点，事件研究法不适用。这一限制意味着本文无法提供平行趋势的直接证据。` |
| 六-3 | `此外，本文未报告遗漏变量敏感度界，该分析留待后续补充。`（`unverified: true` → 正文标 `此处待补文献`） |
| 八-3 | `在机制方面，融资约束变量的系数为负且显著，但由于该变量本身可能受数字化转型影响，本文仅将其表述为与融资约束渠道一致，而不主张中介机制成立。`（引用 `d04` weak） |

> 自检：五-1 / 五-2 的 `0.083 / 0.412 / 2,847` 必须与 `cells` 一致；三-1 不得写成「促进 / 提升」（因果动词计数 0）；六-3 是唯一待补文献段。
>
> 范围注:四-1 的 `数据来自用户导入的本地数据文件` 是真相源逐字文案,**照抄不改**;本 Demo 数据为内置样例(§5.3.4),界面另有「演示数据」标记(§4.0.2)。

**其余 18 段（逐字）**：

第一章（引言）
- 一-1：`数字经济已成为中国经济增长的重要动能。企业作为创新活动的主要承担者，其数字化转型进程如何影响创新产出，是近年来产业组织与创新经济学关注的核心问题之一。`
- 一-2：`已有研究在结论上并不一致。多数文献发现数字化转型显著提升了企业创新绩效，但也有研究指出，数字化转型主要增加了外观设计专利，对发明专利的影响并不显著。`
- 一-3：`导致结论分歧的一个重要原因是测度方式的差异。年报词频法可能高估数字化转型的创新效应，而无形资产占比法则相对保守。`
- 一-4：`本文基于 2011—2022 年中国 A 股制造业上市公司面板数据，考察数字化转型与企业创新产出之间的关系，并进一步检验企业规模带来的异质性。本文的边际贡献在于：同时使用两种数字化转型测度进行交叉验证，并明确报告了识别策略的限制。`

第二章（文献综述）
- 二-1：`围绕数字化转型与创新，现有文献大致可分为三类。第一类关注数字化转型对创新总量的影响，多采用双重差分或面板固定效应方法，结论以正向为主。`
- 二-2：`第二类文献转向创新结构，强调仅使用专利总量会掩盖结构性差异，发明专利占比才是衡量创新质量的关键指标。这类研究对第一类结论提出了重要修正。`
- 二-3：`第三类文献关注测度本身。不同测度方式下估计结果存在明显差异，这提示现有结论的稳健性仍需检验。`
- 二-4：`在机制层面，融资约束被认为是潜在渠道之一，但相关研究多依赖中介效应模型，机制变量的内生性难以处理。`

第五章（实证结果）
- 五-3：`表 3 报告了稳健性检验结果。替换被解释变量为发明专利后，系数下降至 0.061，但仍在 10% 水平上显著；替换核心解释变量为无形资产占比后，系数为 0.094。安慰剂检验中提前两期的虚拟处理变量不显著，说明结果并非由共同趋势驱动。`
- 五-4：`值得注意的是，将标准误聚类到行业层时，聚类数仅为 31，此时的推断偏乐观，因此本文以企业层聚类结果为准。`

第六章（稳健性检验）
- 六-1：`本文共设计 7 项稳健性检验，实际完成 6 项。结果显示核心结论在多种设定下保持一致，但系数大小存在波动，其中替换被解释变量后的系数下降幅度最大。`

第七章（内生性讨论）
- 七-1：`数字化转型与企业创新可能同时受到企业能力等不可观测因素影响，导致估计偏误。本文尝试使用同行业同年度其他企业数字化均值作为工具变量，但第一阶段 F 统计量仅为 6.2，低于弱工具变量的经验门槛，因此 2SLS 结果仅作参考，不作为因果证据。`
- 七-2：`使用滞后一期解释变量后，系数为 0.071 且仍显著。综合来看，本文更倾向于将基准结果解释为条件相关关系。`

第八章（异质性与机制分析）
- 八-1：`按企业规模分组的结果显示，大型企业组的系数为 0.121，中小企业组为 0.038，组间系数差异检验的 p 值为 0.038，表明规模差异具有统计意义。`
- 八-2：`按所有制分组的结果则未发现显著差异（p = 0.412）。因此本文不主张数字化对非国有企业作用更强。`

第九章（结论与政策含义）
- 九-1：`本文基于 2011—2022 年中国 A 股制造业上市公司数据，发现数字化转型与企业创新产出之间存在稳健的正相关关系，且这一关系在大型企业中更为明显。`
- 九-2：`需要强调的是，受限于识别策略，本文结论应被理解为条件相关关系，而非因果效应。在数字化转型强度连续变异、缺乏外生冲击的情形下，任何因果表述都超出了数据所能支持的范围。`
- 九-3：`就政策含义而言，本文的证据支持在制造业企业中继续推进数字化改造，但样本仅覆盖上市公司，结论不宜直接外推至中小企业与服务业。`

#### 5.3.8 模型通道 `PROVIDERS`

- 通道清单照 §4.7.3 照抄 3 条：`deepseek-official` / `glm-official` / `my-gateway`（`preset: false` 的样例自定义路由），字段 `id / displayName / baseURL / credentialRef / preset / models`。
- 演示态（无密钥）：连通性显示 `演示模式：未配置密钥，使用内置样例`；用户自己提交问题时**不得假装识别**——追加助手消息（原文见 §5.4「用户自己提交研究问题时的回复」）+ chip「需要先配置模型」「未做研究问题识别」；不提供手填入口。
- 论文初稿组装不调用模型（模板 + `cell_id` + 引用拼装）；通道配置**仅用于展示**：本 Demo 不发起任何请求，不用于研究问题抽取、检索式生成或解读措辞。

#### 5.3.9 初始状态与持久化键

| 项 | 值 |
|---|---|
| 主状态键 | `localStorage['zhiyan.demo.v1']` |
| UI 偏好键 | `localStorage['zhiyan.demo.ui.v1']` = `{railW: 248, chatW: 390, resultsCollapsed: false}` |
| 会话密钥键 | `sessionStorage['zhiyan.demo.v1.keys']` |
| 持久密钥键 | `localStorage['zhiyan.demo.v1.keys.persist']`（仅勾选「记住密钥」时） |
| 初始值 | `projects` 含 `demo-main`（`数字化转型与企业创新`）、**`activeId = null`**（首屏是空态）、`resourcePage = null`、`libraryLoaded: true`、`datasetLoaded: true`、`connTest: {}`、`importedPanel: null`、`importedDocs: []`、`syncState: 'local'`、`sampleSize: 2400`（**演示轨不参与任何可见数值**）、`user.name = '研究者'`、`user.email = ''`、`rememberKeys: false`、`activeStep: 'data-prep'`、`segView: 'result'`、`focusCell: null`、`focusCite: null` |

**持久化白名单 = 真相源 `persistable()` 的全部键**：`version, projects, activeId, resourcePage, libraryLoaded, datasetLoaded, providers, rememberKeys, user, discovered, importedPanel, sampleSize, credentials（仅 rememberKeys 为真时；假时写 `{}`）、refusals, decisions, activeStep`。
刷新复原所依赖的 `tab / design / designConfirmed / designHash / rq / messages / literatureDone / paper / pipeline / segView / focusCell / focusCite` 全部在 `projects[]` 快照内，须随 `projects` 整体落盘（§4.0.5 的 G7 要求），不得只存白名单顶层键。

#### 5.3.10 单测基线（演示轨固定断言）

**演示轨基线（`demo-main`，逐值一致）**：

| 断言 | 期望值 |
|---|---|
| `deriveWording('causal', DESIGN.checks)` | `'associative'`（因 IV-01 fail + DID-04 unknown） |
| `deriveWording('causal', [{id:'IV-01',status:'pass'},{id:'DID-04',status:'unknown'}])` | `'associative'`（有`unknown`即不得放行因果，见 §4.2.12） |
| `gateCheck()`（IV-01 未处置时） | `status: 'blocked'`，blockers = 1（IV-01），warnings 不含"聚类数偏少"（千分位修好后） |
| `gateCheck()`（IV-01 已处置后） | `status: 'ready'`，blockers = 0 |
| `verifyCitations(PAPER)` | 段落数 28，`issues > 0` 的行 5（全为 `weak_support`），`strength_violation` 0，`countUnverified` 1 |
| 全文因果动词计数（口径见 §4.2.12） | `0` |
| 七步 `STEPS` 表数值 | 与 §5.3.6 逐格一致（含 `digi 系数 0.083`、`组内 R² 0.412`、`第一阶段 F 6.2`、规模组差异 p 0.038、所有制组差异 p 0.412） |
| 演示轨来源徽标 | 七步结果一律显示 `.badge.warn` `内置样例数据`，不得显示"真实计算结果" |

> **本期范围：纯前端演示**——数据全为内置校准样例，双击 `index.html` 即可运行；只有「运行示例流程」这一条链路被真正实现，无网络请求、无本地文件读取、无模型调用。

### 5.4 对话区文案脚本（逐字）

点示例卡片后对话区依次出现下列消息（`text` 的 `**` 为加粗，按纯文本渲染或转 `<strong>`）：

**消息 1（助手，示例卡片引导 + 追问卡）**
> 这是一个完整流程示例。你可以直接点「运行示例流程」，或自己输入研究问题重跑一遍。
>
> 示例研究：数字化转型 对 企业创新 的影响
>
> 我会依次完成：命题解析 → 文献检索 → 实验设计（等你确认）→ 七步实证 → 论文初稿。

chips：`示例数据已就绪`；追问卡标题「如何开始？」，选项：
- `运行示例流程` —— `用预置命题走完全链路（推荐，约 1 分钟）`
- `我想用自己的研究问题` —— `在下方输入框直接输入，我重新解析`

**消息 2（用户）**：`运行示例流程`

**消息 3（助手，命题解析完成）**
> 我按你的研究问题拆成五个槽位，有不对的直接告诉我：
> · 现象：数字化转型对企业创新产出的影响
> · 对象与层级：中国 A 股制造业上市公司（企业-年）
> · 时间窗：2011—2022
> · 变异来源：企业层面数字化转型强度差异（连续强度）
> · 期望结论：数字化转型显著提升了企业创新产出（因果）
>
> ⚠️ 按现在的信息，公司层数字化强度是**连续变异**、没有明确政策时点，所以我只能支持"相关"表述。要升级为因果，需要补一个外生的变异来源（政策试点或合格的工具变量）。

chips：`五槽位已解析`、`需确认结论强度`

**消息 4（助手，文献分析完成）**
> 在你的文献库（22 篇）里检索：主题相关 22 篇、命中片段 186 处。识别策略分布：DiD 5 篇、面板FE 5 篇、事件研究 1 篇、IV 1 篇、RDD 1 篇、PSM 2 篇、分组回归 1 篇。
> ⚠️ 有 3 篇结论与主流相反，其中 1 篇直接质疑"年报词频法高估效应"。综述必须把这三篇写进去，否则会被认为选择性引用。
> 📌 机制分析这一章在语料里**没有**可引用的直接证据（0 篇），只能写成"研究缺口"或"与…一致"。

chips：`文献分析完成`、`发现 3 篇反向证据`、`机制章无支撑`

**消息 5（助手，实验设计生成）**
> 实验设计已生成（第 3 版），共七个部分。
> ⚠️ 有 1 项检查未通过：**IV-01 弱工具**——备选工具的第一阶段 F = 6.2，低于经验门槛 10。这意味着我不能给你因果结论，措辞强度锁定为"相关"。
> 还有 1 项信息不足：DID-04 平行趋势（连续处理强度设计，事件研究不适用）。
> 请你核对整份方案，处置未通过项后点"确认并开始实证"。**确认之前我不会读取任何数据。**

chips：`待确认设计`、`1 项 fail`、`1 项 unknown`

**消息 6（助手，数据处理）**
> 数据已就绪：18,042 个企业-年观测、2,847 家企业、2011—2022 年。
> 质量提示：关键变量缺失率 2.3%（按行业-年份中位数插补），已做缩尾处理 372 个观测。
> 四步产出会依次生成：数据清洗 → 描述统计 → 基准回归，每步都有可执行代码、结果文件和解读文件。

（此句为真相源 `engine.js` 遗留文案，只列 3 个示例步骤，照抄不改；**不得**据此把 §4.5.1 的七步流水线改成四步。）

chips：`数据处理中`

**消息 7（助手，基准回归完成）**
> 基准回归完成：**digi 系数 0.083**（标准误 0.034，t = 2.441，p = 0.015，**）。
> 样本 18,042，固定效应 firm FE + year FE，聚类层级 firm。
> 组内 R² = 0.412。
> 每个数字都已绑定结果表单元格，点一下可以回到表里核对。

chips：`基准回归完成`、`样本 18,042`

**消息 8（助手，论文初稿就绪）**
> 论文初稿已生成，共 9 章、28 段。
> **风格**：中国工业经济 的语体与章节结构。
> **校验结果**：5 段存在问题（见引用台账）；1 处待补文献。
> 📌 正文里的数字可以点击回到结果表对应单元格；引用角标可以回跳原文。

chips：`9 章完成`、`1 处待补文献`

**用户自己提交研究问题时的回复（逐字 4 段，不许假装识别；`**` 为加粗）**：
> 我还没有模型通道，所以**无法真正识别你的研究问题**。
> 以前的版本会拿一个预置命题套上去（把"数字化转型与企业创新"的对象、变量、时间窗直接填给你），那等于假装理解了你的题目——我不打算这么干。
> 请先在左下角「账号与设置」里配置一个模型通道（DeepSeek / GLM / 任意 OpenAI 兼容端点），然后把你刚才的问题再发一次。
> 只想先看流程的话，点上面的示例卡片走演示数据。

chips：`需要先配置模型`、`未做研究问题识别`。（本期不做真实模型调用：该回复为固定文案，「账号与设置」为演示界面。）

### 5.5 复刻完成的自检清单（16 条，逐条勾）

- [ ] 双击 `index.html` 即可运行（无需服务器、无需外部文件）；无框架/打包/CDN、零网络请求。
- [ ] 首屏**空态两栏**（非三栏），左项目栏 248px，输入框居中、下方**只有一张**示例卡片；全仓只有一个 `#prompt`（空态与项目态共用）。
- [ ] 点「新建」回空态且不预建项目，toast 正确。
- [ ] 点示例卡片出现引导消息 + 两个选项；「运行示例流程」按 §5.2 顺序推进。
- [ ] 未确认设计时点「数据/统计/论文」页签 → 拦回设计页，toast 正确。
- [ ] 设计页 7 分区；清单含 `IV-01 不通过`、`DID-04 信息不足`；未处置 IV-01 时确认门主按钮禁用并显示 `尚有 1 项待处置`。
- [ ] 确认门通过自动切「数据处理」，七步状态待执行；每步产出三件套（脚本/结果/解读），解读数字带 cell 绑定、可点击回跳。
- [ ] 第 ⑤ 步如实显示弱工具 F = 6.2，不给因果结论；第 ④ 步显示 1 项「无法完成」且论文披露章节含该未做项。
- [ ] 质量门三卡 `7 / 7`、`相关`、`已校验`；论文页三卡 `9 / 9`、`相关`、`5 处需处理`（副文 `1 处待补文献`）。
- [ ] 台账 28 行、5 行橙徽标 `引用仅弱支持该论断`；正文 `此处待补文献` 1 处；点引用角标开出处抽屉（含页码与字符区间）。
- [ ] 措辞强度"相关"，全文因果动词数 0。
- [ ] 改设计后确认自动失效、七步转「待更新」、后续页签「受阻」。
- [ ] 资源库两页：内置样例来源标注清晰（不做真实导入）、检索预览可开出处抽屉、文献库表 8 列齐全。
- [ ] 账号与设置模态：3 条通道、密钥不回显、`测试连接` 只切换展示态（不发请求）。
- [ ] 刷新后现场完整复原（项目、页签、七步结果、初稿、对话）。
- [ ] 界面无英文占位、无 lorem ipsum、无 `[object Object]`、无 `—` 误用为缺失说明。

### 5.6 实现顺序建议（降低返工）
1. **静态骨架/CSS**：三份 CSS（tokens → layout → components）+ `index.html` 骨架 + 空态/项目态切换。
2. **状态与持久化**：状态树、快照读写、UI 偏好、刷新复原。
3. **外壳交互**：项目栏、对话区、成果区、拖拽调宽、收起展开、模态与抽屉、账号与设置模态、toast。
4. **示例卡片 + 对话脚本**：跑通 §5.4 的消息与 §5.3 的样例数据（9 条）。
5. **各阶段页面**：定义页五槽位与资源绑定；文献页六区块与三种空态；资源库两页（文献库表 8 列、出处抽屉）；设计页七分区与确认门。
6. **七步流水线**：数据页区块；七步执行、三件套、质量门、cell 绑定与回跳（阶段四/五）。
7. **论文与导出**：九章初稿、四查校验、台账、正文渲染、导出 Markdown / 项目包（阶段六）。
8. **回归自检**：跑 §5.5 清单。
