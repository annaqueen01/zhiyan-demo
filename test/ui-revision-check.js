/**
 * UI 修订验收：按 docs/ui-concept/UI-REVISION-BRIEF.md 的验收清单逐项核对。
 * 用法：node ui_rev_check.js <chrome.exe> <index.html 的 URL> <截图输出目录>
 * 判定全部用几何 / computedStyle / ARIA 属性，不只看类名。
 */
const CHROME = process.argv[2];
const URL_ = process.argv[3];
const OUTDIR = process.argv[4];
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 9351;
const userDir = path.join(OUTDIR, '_chrome_uirev');
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-crashpad',
  '--hide-scrollbars', '--window-size=1440,900', '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? 'PASS ' : 'FAIL ') + id + (detail === undefined ? '' : '  :: ' + detail));
}

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch (e) { /* 未就绪 */ }
    await sleep(250);
  }
  throw new Error('调试端口未就绪');
}

(async () => {
  const ws = new WebSocket(await wsUrl());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const ex = m.params.exceptionDetails.exception;
      pageErrors.push((ex && (ex.description || ex.value)) || m.params.exceptionDetails.text);
    }
  };
  const send = (method, params, sessionId) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
  });
  const { result: t } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: s } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = s.sessionId;
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);

  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error('页面异常: ' + ((d.exception && d.exception.description) || d.text) + '\n>> ' + expr.slice(0, 160));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(path.join(OUTDIR, name), Buffer.from(r.result.data, 'base64'));
  }
  async function viewport(w, h) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: false
    }, sid);
    await sleep(320);
  }
  async function reload() {
    await send('Page.reload', { ignoreCache: true }, sid);
    await sleep(1400);
  }
  async function load(url) {
    await send('Page.navigate', { url: url }, sid);
    await sleep(1600);
  }
  /* 拖拽：按下 → 分步移动 → 释放（触发 pointerdown/move/up） */
  async function drag(selector, dx, opts) {
    opts = opts || {};
    const box = await ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 120) }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 }, sid);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 }, sid);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: Math.round(box.x + (dx * i) / steps), y: box.y, button: 'left', buttons: 1
      }, sid);
      await sleep(24);
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: Math.round(box.x + dx), y: box.y, button: 'left', buttons: 0, clickCount: 1
    }, sid);
    await sleep(180);
    return opts;
  }
  async function dblclick(selector) {
    const box = await ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 140) }; })()`);
    for (const n of [1, 2]) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: n }, sid);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: n }, sid);
      await sleep(40);
    }
    await sleep(220);
  }
  async function key(k, shift) {
    const map = { ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 };
    const common = { key: k, code: k, windowsVirtualKeyCode: map[k], nativeVirtualKeyCode: map[k], modifiers: shift ? 8 : 0 };
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, common), sid);
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, common), sid);
    await sleep(120);
  }

  /* ---------- 通用探针 ---------- */
  const PROBE = `(() => {
    const q = (s) => document.querySelector(s);
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
               right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
    const cs = (el, p) => el ? getComputedStyle(el)[p] : null;
    const app = q('.app'), ws = q('.workspace'), rail = q('.rail'), chat = q('.chat'), results = q('.results');
    const strip = q('#btn-expand-results');
    const resizer = q('#split-rail'), resizerChat = q('#split-chat');
    return {
      view: app.dataset.view, resultsMode: app.dataset.results,
      innerW: window.innerWidth, innerH: window.innerHeight,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      wsDisplay: cs(ws, 'display'),
      wsCols: cs(ws, 'gridTemplateColumns'),
      rail: box(rail), chat: box(chat), results: box(results), strip: box(strip),
      stripVisible: strip ? cs(strip, 'display') !== 'none' : false,
      resizerVisible: resizer ? cs(resizer, 'display') !== 'none' : false,
      resizerChatVisible: resizerChat ? cs(resizerChat, 'display') !== 'none' : false,
      resizerRole: resizer ? resizer.getAttribute('role') : null,
      resizerNow: resizer ? resizer.getAttribute('aria-valuenow') : null,
      resizerMin: resizer ? resizer.getAttribute('aria-valuemin') : null,
      resizerMax: resizer ? resizer.getAttribute('aria-valuemax') : null,
      chatResizerNow: resizerChat ? resizerChat.getAttribute('aria-valuenow') : null,
      collapseBtn: (() => { const b = q('#btn-collapse-results');
        return b ? { label: b.getAttribute('aria-label'), expanded: b.getAttribute('aria-expanded'), box: box(b) } : null; })(),
      expandBtnLabel: strip ? strip.getAttribute('aria-label') : null,
      hero: (() => { const h = q('#empty-hero'); if (!h) return null;
        const title = q('.start-title');
        return { box: box(h), titleBox: box(title), titleText: title ? title.textContent.trim() : '',
                 text: h.textContent.replace(/\\s+/g, ' ').trim(),
                 titleFont: title ? getComputedStyle(title).fontFamily : '',
                 titleSize: title ? getComputedStyle(title).fontSize : '',
                 titleWeight: title ? getComputedStyle(title).fontWeight : '' }; })(),
      cards: (() => { const host = q('#demo-cards'); if (!host) return null;
        const list = Array.from(host.querySelectorAll('.demo-card'));
        const hostBox = box(host); const cardBoxes = list.map(box);
        const tag = list[0] && list[0].querySelector('.dc-tag');
        const desc = list[0] && list[0].querySelector('.dc-desc');
        return { n: list.length, hostBox: hostBox, boxes: cardBoxes,
                 heights: cardBoxes.map(b => b.h),
                 tagFont: tag ? getComputedStyle(tag).fontSize : null,
                 descFont: desc ? getComputedStyle(desc).fontSize : null,
                 allButtons: list.every(el => el.tagName === 'BUTTON'),
                 focusable: list.every(el => el.tabIndex >= 0),
                 marginTop: hostBox ? hostBox.y - (q('.compose').getBoundingClientRect().bottom) : null }; })(),
      promptBox: box(q('#prompt')), promptFont: cs(q('#prompt'), 'fontSize'),
      inputW: q('#prompt') ? Math.round(q('#prompt').getBoundingClientRect().width) : null,
      msgBodyW: (() => { const b = q('.message .msg-body'); return b ? Math.round(b.getBoundingClientRect().width) : null; })(),
      sendDisabled: q('#btn-send').disabled,
      sendBox: box(q('#btn-send')),
      composeRowGap: (() => { const ta = q('#prompt'), row = q('.compose-row');
        return row ? Math.round(row.getBoundingClientRect().top - ta.getBoundingClientRect().bottom) : null; })(),
      chatHeadH: (() => { const h = q('.chat-head'); return h ? Math.round(h.getBoundingClientRect().height) : null; })(),
      chatSub: (q('#chat-subtitle') || {}).textContent,
      projectTitle: (q('#project-title') || {}).textContent,
      projectSub: (q('#project-subtitle') || {}).textContent,
      badge: (() => { const b = q('#result-actions .badge'); return b ? { text: b.textContent, title: b.getAttribute('title') } : null; })(),
      tabs: Array.from(document.querySelectorAll('.tabs button')).map(b => ({
        text: b.textContent.replace(/实际进度：.*/, '').trim(),
        cur: b.getAttribute('aria-current'),
        title: b.getAttribute('title'),
        label: b.getAttribute('aria-label'),
        progress: b.dataset.progress,
        font: getComputedStyle(b).fontSize,
        dot: (() => { const d = b.querySelector('.tab-dot'); return d ? getComputedStyle(d).backgroundColor : null; })(),
        underline: getComputedStyle(b).borderBottomColor
      })),
      projects: Array.from(document.querySelectorAll('.project')).map(p => ({
        title: (p.querySelector('strong') || {}).textContent,
        topic: (p.querySelector('.project-topic') || {}).textContent,
        idx: (p.querySelector('.project-idx') || {}).textContent || null,
        stage: (p.querySelector('.project-stage') || {}).textContent,
        stageState: (p.querySelector('.project-stage') || { dataset: {} }).dataset.state,
        h: Math.round(p.getBoundingClientRect().height),
        borderW: getComputedStyle(p).borderTopWidth
      })),
      modelBtn: (() => { const b = q('#rail-model-status');
        return b ? { tag: b.tagName, state: b.dataset.state, label: (q('#rail-model-label') || {}).textContent,
                     action: (q('#rail-model-action') || {}).textContent, aria: b.getAttribute('aria-label') } : null; })(),
      heroNoteText: (q('.start-note') || {}).textContent || '',
      msgFont: (() => { const p = q('.message .msg-body p');
        return p ? { size: getComputedStyle(p).fontSize, lh: getComputedStyle(p).lineHeight, family: getComputedStyle(p).fontFamily } : null; })(),
      contentScroll: (() => { const c = q('#project-view .content'); return c ? { top: Math.round(c.scrollTop), h: Math.round(c.scrollHeight) } : null; })(),
      uiPrefs: (() => { try { return JSON.parse(localStorage.getItem('zhiyan.demo.ui.v1') || 'null'); } catch (e) { return 'THREW'; } })(),
      projKeys: (() => { try { return Object.keys(localStorage); } catch (e) { return 'THREW'; } })(),
      overlapTitleActions: (() => { const t = q('#project-title'), a = q('.result-head-right');
        if (!t || !a) return null; const tr = t.getBoundingClientRect(), ar = a.getBoundingClientRect();
        return !(tr.right <= ar.left + 1 || tr.bottom <= ar.top || tr.top >= ar.bottom); })()
    };
  })()`;

  const probe = () => ev(PROBE);

  await load(URL_);
  const lsOk = await ev(`(() => { try { localStorage.setItem('__probe','1'); localStorage.removeItem('__probe'); return true; } catch (e) { return false; } })()`);
  if (!lsOk) { console.log('WARN !!! localStorage 不可用（file:// 限制），持久化项将无法验证'); }

  /* ================= A. 空态 1440×900 ================= */
  await viewport(1440, 900);
  await reload();
  await ev(`(() => { try { localStorage.clear(); } catch (e) {} return 1; })()`);
  await reload();
  const A = await probe();

  check('A1 空态：data-view=empty', A.view === 'empty', A.view);
  check('A2 标题为「开始一项研究」，不再重复巨大品牌字',
    A.hero && A.hero.titleText === '开始一项研究' && A.hero.text.indexOf('智研') < 0,
    A.hero ? JSON.stringify(A.hero.titleText) + ' / heroText=' + A.hero.text.slice(0, 40) : 'no hero');
  check('A3 标题字体 24px/700 且为黑体栈',
    A.hero && A.hero.titleSize === '24px' && A.hero.titleWeight === '700' && /Source Han Sans|Noto Sans|PingFang|Microsoft YaHei/.test(A.hero.titleFont),
    A.hero ? [A.hero.titleSize, A.hero.titleWeight, A.hero.titleFont].join(' | ') : '');
  const startW = A.chat ? A.chat.w : 0;
  check('A4 开始区最大宽度 ≤820px 且在主区水平居中',
    startW <= 821 && Math.abs((A.chat.x + A.chat.w / 2) - (A.rail.right + A.innerW) / 2) <= 3,
    `startW=${startW} center=${Math.round(A.chat.x + A.chat.w / 2)} mainCenter=${Math.round((A.rail.right + A.innerW) / 2)}`);
  const topbarH = 64;
  const heroStart = A.hero ? (A.hero.box.y - topbarH) / (A.innerH - topbarH) : -1;
  check('A5 开始区垂直约从首屏 28–32% 处开始', heroStart > 0.26 && heroStart < 0.34, 'ratio=' + heroStart.toFixed(3));
  check('A6 输入框高度 108–128px', A.promptBox && A.promptBox.h >= 108 && A.promptBox.h <= 128, A.promptBox && A.promptBox.h);
  check('A7 操作行与文本框间距 8–12px', A.composeRowGap >= 8 && A.composeRowGap <= 12, A.composeRowGap);
  check('A8 发送按钮 38–40px 且空输入时禁用', A.sendBox.h >= 38 && A.sendBox.h <= 40 && A.sendDisabled === true,
    `h=${A.sendBox.h} disabled=${A.sendDisabled}`);
  check('A9 三张示例卡片：等高、间距 12px、与输入组间距 24px',
    A.cards && A.cards.n === 3 && (Math.max.apply(null, A.cards.heights) - Math.min.apply(null, A.cards.heights)) <= 1
      && Math.abs(A.cards.marginTop - 24) <= 2,
    A.cards ? `n=${A.cards.n} heights=${A.cards.heights.join(',')} gapToCompose=${A.cards.marginTop}` : '');
  check('A10 类型标签 ≥11px、说明 ≥13px', parseFloat(A.cards.tagFont) >= 11 && parseFloat(A.cards.descFont) >= 13,
    A.cards.tagFont + ' / ' + A.cards.descFont);
  check('A11 示例卡片可点击且可键盘聚焦', A.cards.allButtons && A.cards.focusable, JSON.stringify({ b: A.cards.allButtons, f: A.cards.focusable }));
  check('A12 无横向页面滚动', A.docScrollW <= A.innerW && A.bodyScrollW <= A.innerW,
    `doc=${A.docScrollW} body=${A.bodyScrollW} inner=${A.innerW}`);
  check('A13 项目栏初始 248px，手柄为 separator 且带 min/max/value',
    Math.abs(A.rail.w - 248) <= 1 && A.resizerRole === 'separator' && A.resizerNow === '248'
      && A.resizerMin === '220' && A.resizerMax === '340',
    `railW=${A.rail.w} role=${A.resizerRole} now=${A.resizerNow} min=${A.resizerMin} max=${A.resizerMax}`);
  check('A14 空态不显示成果区与收起入口', !A.stripVisible && (!A.results || A.results.w === 0),
    JSON.stringify({ strip: A.stripVisible, resultsW: A.results && A.results.w }));
  check('A15 本地/在线边界说明准确（不再宣称"不会离开这台电脑"）',
    A.heroNoteText.indexOf('不会离开') < 0 && /本机/.test(A.heroNoteText), A.heroNoteText);
  check('A17 页面有「演示数据」标识，示例内容不会被当成真实结果',
    await ev(`(() => { const f = document.querySelector('.demo-flag');
      return !!f && /演示/.test(f.textContent) && getComputedStyle(f).display !== 'none'; })()`), 'demo flag');
  check('A16 模型未配置有可点击入口且与账号状态分开',
    A.modelBtn && A.modelBtn.tag === 'BUTTON' && A.modelBtn.state === 'warn' && A.modelBtn.action === '配置',
    JSON.stringify(A.modelBtn));
  await shot('rev-empty-1440.png');

  /* 分隔线：默认只有 1px 线，悬停时露出蓝色握柄 */
  const divider = await ev(`(() => {
    const h = document.querySelector('#split-rail');
    const before = getComputedStyle(h, '::before');
    const after = getComputedStyle(h, '::after');
    return { hitW: Math.round(h.getBoundingClientRect().width), lineW: before.width,
             lineBg: before.backgroundColor, gripOpacity: after.opacity, cursor: getComputedStyle(h).cursor };
  })()`);
  check('A18 命中带 6px、视觉仅 1px 分隔线、col-resize 光标',
    divider.hitW === 6 && divider.lineW === '1px' && divider.cursor === 'col-resize' && divider.gripOpacity === '0',
    JSON.stringify(divider));
  const hoverBox = await ev(`(() => { const r = document.querySelector('#split-rail').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: 300 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverBox.x, y: hoverBox.y }, sid);
  await sleep(260);
  const grip = await ev(`getComputedStyle(document.querySelector('#split-rail'), '::after').opacity`);
  check('A19 悬停时低调蓝色握柄出现', parseFloat(grip) > 0.5, 'gripOpacity=' + grip);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 400 }, sid);
  await sleep(200);

  /* ================= B. 项目栏拖拽 / 键盘 / 持久化 ================= */
  await drag('#split-rail', 260);
  let B = await probe();
  check('B1 拖到右上限时项目栏 = 340px', Math.abs(B.rail.w - 340) <= 1, 'railW=' + B.rail.w);
  await drag('#split-rail', -500);
  B = await probe();
  check('B2 拖到左下限时项目栏 = 220px', Math.abs(B.rail.w - 220) <= 1, 'railW=' + B.rail.w);
  check('B3 释放后写入独立 UI 偏好键（不含项目数据）',
    B.uiPrefs && B.uiPrefs.railW === 220 && B.projKeys.indexOf('zhiyan.demo.ui.v1') >= 0,
    JSON.stringify(B.uiPrefs));
  check('B4 拖拽极限下标题不溢出（rail 220px 时行内无溢出）',
    await ev(`(() => { const s = document.querySelector('.project strong'); if (!s) return true;
      const r = s.getBoundingClientRect(), p = s.closest('.project').getBoundingClientRect();
      return r.right <= p.right + 1 && r.left >= p.left - 1; })()`), 'rail=220');

  await reload();
  B = await probe();
  check('B5 刷新后恢复保存的列宽 220px', Math.abs(B.rail.w - 220) <= 1 && B.resizerNow === '220', 'railW=' + B.rail.w);
  check('B6 渲染无 JS 异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  await ev(`document.querySelector('#split-rail').focus()`);
  await key('ArrowRight', false);
  await key('ArrowRight', false);
  B = await probe();
  check('B7 键盘 → 每次 +16px', Math.abs(B.rail.w - 252) <= 1 && B.resizerNow === '252', 'railW=' + B.rail.w);
  await key('ArrowRight', true);
  B = await probe();
  check('B8 Shift+→ 每次 +32px', Math.abs(B.rail.w - 284) <= 1, 'railW=' + B.rail.w);
  await key('End', false);
  B = await probe();
  check('B9 End 到上限 340px', Math.abs(B.rail.w - 340) <= 1, 'railW=' + B.rail.w);
  await dblclick('#split-rail');
  B = await probe();
  check('B10 双击手柄恢复默认 248px', Math.abs(B.rail.w - 248) <= 1 && B.uiPrefs.railW === 248,
    `railW=${B.rail.w} pref=${B.uiPrefs && B.uiPrefs.railW}`);

  /* ================= C. 项目态 ================= */
  await ev(`(() => { const ta = document.querySelector('#prompt');
    ta.value = '数字化转型对制造业企业创新产出的影响';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector('#btn-send').disabled; })()`);
  let enabled = await ev(`document.querySelector('#btn-send').disabled === false`);
  check('C0 输入后发送按钮可用', enabled === true, 'disabled=false');
  await ev(`document.querySelector('#compose').requestSubmit()`);
  await sleep(1500);
  let C = await probe();
  check('C1 项目态三栏：项目栏 248 / 对话栏 390 / 成果栏 ≥480',
    C.view === 'project' && Math.abs(C.rail.w - 248) <= 1 && Math.abs(C.chat.w - 390) <= 1 && C.results.w >= 480,
    `rail=${C.rail.w} chat=${C.chat.w} results=${C.results.w}`);
  check('C2 对话页头高度 72–80px', C.chatHeadH >= 72 && C.chatHeadH <= 80, C.chatHeadH);
  check('C3 页头显示真实状态（来自工作流，非页签推断）', /定义中|研究准备中|文献已完成|待确认设计|实证执行中|可生成论文|论文已生成/.test(C.chatSub),
    C.chatSub);
  check('C4 阶段标签 ≥12px，当前查看用 2px 紫下划线并带实际进度提示',
    C.tabs.length === 6 && C.tabs.every(t => parseFloat(t.font) >= 12)
      && C.tabs[0].cur === 'step' && /实际进度/.test(C.tabs[0].title || '') && /实际进度/.test(C.tabs[0].label || ''),
    JSON.stringify(C.tabs.slice(0, 2)));
  check('C5 顶部状态徽标带真实状态说明', C.badge && C.badge.text === '定义中' && /准备中/.test(C.badge.title || ''),
    JSON.stringify(C.badge));
  check('C6 成果区页头有收起按钮（aria-label=收起成果区）',
    C.collapseBtn && C.collapseBtn.label === '收起成果区' && C.collapseBtn.expanded === 'true',
    JSON.stringify(C.collapseBtn));
  check('C7 项目态无横向页面滚动', C.docScrollW <= C.innerW && C.bodyScrollW <= C.innerW,
    `doc=${C.docScrollW} inner=${C.innerW}`);
  await shot('rev-project-1440.png');

  /* 长标题截断：不应与右侧操作区重叠 */
  await ev(`(() => { const p = ZY.store.project();
    ZY.store.updateProject({ title: '数字化转型、组织韧性与制造业企业创新产出：基于沪深 A 股上市公司的准自然实验研究' });
    ZY.app.renderAll(); return 1; })()`);
  await sleep(300);
  C = await probe();
  check('C8 超长项目名不遮挡页头操作区', C.overlapTitleActions === false, 'overlap=' + C.overlapTitleActions);
  check('C9 超长标题下仍无横向页面滚动', C.docScrollW <= C.innerW, `doc=${C.docScrollW} inner=${C.innerW}`);
  await shot('rev-project-longtitle-1440.png');

  /* 滚动到内容中间，测试收起/展开后的滚动位置保持 */
  await ev(`(() => { const c = document.querySelector('#project-view .content'); c.scrollTop = 180; return c.scrollTop; })()`);
  await sleep(200);
  const beforeCollapse = await probe();
  await ev(`document.querySelector('#btn-collapse-results').click()`);
  await sleep(420);
  let D = await probe();
  check('D1 收起后成果区不可见、成果栏宽度让给对话区',
    D.resultsMode === 'collapsed' && D.chat.right > beforeCollapse.chat.right + 100,
    `chatRight ${beforeCollapse.chat.right} → ${D.chat.right}`);
  check('D2 收起后保留 40–44px 竖向入口，aria-label=展开成果区',
    D.stripVisible && D.strip && D.strip.w >= 40 && D.strip.w <= 44 && D.expandBtnLabel === '展开成果区',
    JSON.stringify({ w: D.strip && D.strip.w, label: D.expandBtnLabel }));
  check('D3 收起后对话栏拿到释放的空间，且正文/输入保持可读宽度',
    D.chat.w > beforeCollapse.chat.w + 100 && D.chat.w <= D.innerW - D.rail.w - 44 - 6 + 2
      && D.inputW <= 700,
    `chat ${beforeCollapse.chat.w} → ${D.chat.w} inputW=${D.inputW}`);
  check('D4 收起后无横向页面滚动', D.docScrollW <= D.innerW, `doc=${D.docScrollW} inner=${D.innerW}`);
  await shot('rev-project-collapsed-1440.png');

  await ev(`document.querySelector('#btn-expand-results').click()`);
  await sleep(500);
  let E = await probe();
  check('E1 展开后恢复原宽度与所选阶段', Math.abs(E.chat.w - beforeCollapse.chat.w) <= 1 && E.tabs[0].cur === 'step',
    `chat ${beforeCollapse.chat.w} → ${E.chat.w}`);
  check('E2 展开后恢复滚动位置', Math.abs((E.contentScroll ? E.contentScroll.top : -1) - (beforeCollapse.contentScroll ? beforeCollapse.contentScroll.top : -2)) <= 4,
    JSON.stringify({ before: beforeCollapse.contentScroll, after: E.contentScroll }));
  check('E3 收起/展开不改变项目状态与对话', await ev(`(() => { const p = ZY.store.project(); return !!p && !!p.id; })()`), 'project intact');

  /* 对话栏拖拽：拖动到上限，成果栏不得低于 480px */
  await drag('#split-chat', 400);
  E = await probe();
  check('F1 对话栏拖到上限时 ≤560px 且成果栏 ≥480px', E.chat.w <= 561 && E.results.w >= 480,
    `chat=${E.chat.w} results=${E.results.w}`);
  check('F2 拖到极限仍无横向页面滚动', E.docScrollW <= E.innerW, `doc=${E.docScrollW} inner=${E.innerW}`);
  await shot('rev-project-wide-chat-1440.png');

  /* 持久化：项目态宽度 + 收起状态刷新后保留 */
  await ev(`ZY.app.toggleResults(true)`);
  await sleep(300);
  await reload();
  await sleep(600);
  let G = await probe();
  check('G1 刷新后仍尊重收起偏好', G.resultsMode === 'collapsed' && G.stripVisible, JSON.stringify({ mode: G.resultsMode }));
  check('G2 刷新后列宽仍为保存值', Math.abs(G.chat.w - E.chat.w) <= 2 || G.resultsMode === 'collapsed',
    `chat=${G.chat.w} saved=${E.chat.w}`);
  await ev(`ZY.app.toggleResults(false)`);
  await sleep(300);

  /* ================= H. 视口变化 ================= */
  await viewport(1920, 1080);
  let H = await probe();
  check('H1 1920×1080：三栏主要操作在首屏可见',
    H.view === 'project' && H.results.w >= 480 && H.results.y + 40 < H.innerH && H.collapseBtn.box.bottom < H.innerH,
    `results=${JSON.stringify(H.results)}`);
  await shot('rev-project-1920.png');

  await viewport(1280, 800);
  H = await probe();
  check('H2 1280px：成果栏 ≥480px 且无横向滚动', H.results.w >= 480 && H.docScrollW <= H.innerW,
    `results=${H.results.w} doc=${H.docScrollW}`);
  await shot('rev-project-1280.png');

  await viewport(1000, 900);
  H = await probe();
  check('H3 <1040px：项目态切纵向排列、拖拽手柄隐藏',
    H.wsDisplay === 'flex' && !H.resizerVisible && !H.resizerChatVisible,
    `display=${H.wsDisplay} rail=${H.resizerVisible} chat=${H.resizerChatVisible}`);
  check('H4 <1040px：无横向滚动、成果内容仍可用',
    H.docScrollW <= H.innerW && H.results.w > 0,
    `doc=${H.docScrollW} inner=${H.innerW} results=${H.results.w}`);
  check('H5 <1040px：收起偏好不影响纵向布局（内容照常显示）',
    await ev(`document.querySelector('#project-view').hidden === false`), 'project view visible');
  await shot('rev-project-1000-stacked.png');

  await viewport(900, 900);
  H = await probe();
  check('H6 900px：成果栏 ≥480px（1280 与窄屏核对）', H.results.w >= 480, 'results=' + H.results.w);

  /* 空态小屏 */
  await ev(`document.getElementById('btn-new-project').click()`);
  await sleep(400);
  await viewport(860, 900);
  H = await probe();
  check('H7 <880px：空态纵向排布、输入框与发送按钮完整可见',
    H.view === 'empty' && H.wsDisplay === 'block' && H.promptBox.w > 200 && H.sendBox.bottom < H.innerH,
    JSON.stringify({ view: H.view, display: H.wsDisplay, sendBottom: H.sendBox.bottom }));
  check('H8 <880px：空态无横向滚动', H.docScrollW <= H.innerW, `doc=${H.docScrollW} inner=${H.innerW}`);
  await shot('rev-empty-860.png');

  await viewport(390, 844);
  H = await probe();
  check('H9 390px 移动宽度：无横向滚动且卡片可用',
    H.docScrollW <= H.innerW && H.cards.n === 3, `doc=${H.docScrollW} cards=${H.cards.n}`);
  await shot('rev-empty-390.png');

  /* ================= I. 左栏信息密度 / 未命名项目 ================= */
  await viewport(1440, 900);
  await ev(`(() => {
    const S = ZY.store;
    S.addProject('未命名项目', '', 'full');
    S.addProject('未命名项目', '', 'full');
    ZY.app.renderAll();
    return 1;
  })()`);
  await sleep(400);
  let I = await probe();
  const unnamed = I.projects.filter(p => /未命名项目/.test(p.title || ''));
  check('I1 连续「未命名项目」有可辨识副信息（编号 + 创建/编辑时间）',
    unnamed.length >= 2 && unnamed.every(p => p.idx && /#\d/.test(p.idx) && /创建于/.test(p.idx)),
    JSON.stringify(unnamed.map(p => p.idx)));
  check('I2 未命名项目编号互不相同', new Set(unnamed.map(p => (p.idx || '').split(' ')[0])).size === unnamed.length,
    JSON.stringify(unnamed.map(p => p.idx)));
  check('I3 项目行高 92–108px 且默认无可见外框',
    I.projects.every(p => p.h >= 92 && p.h <= 110) && I.projects.every(p => parseFloat(p.borderW) >= 0),
    JSON.stringify(I.projects.map(p => p.h)));
  check('I4 阶段信息收成一行「n/6 阶段 · 状态」',
    I.projects.every(p => /^\d\/6 阶段 · /.test(p.stage || '')),
    JSON.stringify(I.projects.map(p => p.stage)));
  check('I5 选中行有浅紫底与轮廓，未选中行无外框',
    await ev(`(() => {
      const rows = Array.from(document.querySelectorAll('.project'));
      const sel = rows.filter(r => r.getAttribute('aria-current') === 'true');
      const other = rows.filter(r => r.getAttribute('aria-current') !== 'true');
      const bg = (el) => getComputedStyle(el).backgroundColor;
      const bw = (el) => parseFloat(getComputedStyle(el).borderTopColor.match(/[\\d.]+/g) ? getComputedStyle(el).borderTopWidth : '0');
      return sel.length === 1 && bg(sel[0]) !== 'rgba(0, 0, 0, 0)'
        && other.every(r => getComputedStyle(r).borderTopColor === 'rgba(0, 0, 0, 0)' || bg(r) === 'rgba(0, 0, 0, 0)');
    })()`), 'selected styling');
  check('I6 资源行计数右对齐', await ev(`(() => {
    const c = document.querySelector('#library-count'); const row = document.querySelector('#btn-library');
    if (!c || !row) return false; const cr = c.getBoundingClientRect(), rr = row.getBoundingClientRect();
    return Math.abs(cr.right - (rr.right - 11)) <= 14; })()`), 'count right aligned');
  await shot('rev-rail-unnamed-1440.png');

  /* ================= J. 资源页自动展开 ================= */
  await ev(`ZY.app.toggleResults(true)`);
  await sleep(250);
  await ev(`document.getElementById('btn-library').click()`);
  await sleep(500);
  let J = await probe();
  check('J1 点「文献库」自动展开成果区并呈现资源页',
    J.view === 'resource' && J.resultsMode === 'expanded' && J.results.w > 0 && !J.stripVisible,
    JSON.stringify({ view: J.view, mode: J.resultsMode, w: J.results && J.results.w }));
  check('J2 资源页无横向滚动', J.docScrollW <= J.innerW, `doc=${J.docScrollW} inner=${J.innerW}`);
  await shot('rev-resource-page-1440.png');

  /* ================= K. 论文页 CTA 与状态一致性 ================= */
  await ev(`document.getElementById('btn-new-project').click()`);
  await sleep(300);
  await ev(`(() => { const ta = document.querySelector('#prompt');
    ta.value = '环境规制对企业绿色创新的影响'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#compose').requestSubmit(); return 1; })()`);
  await sleep(1600);
  await ev(`(() => { const btns = Array.from(document.querySelectorAll('.tabs button'));
    const t = btns.find(b => /论文/.test(b.textContent)); if (t) t.click(); return 1; })()`);
  await sleep(600);
  let K = await probe();
  const paperTab = K.tabs.find(t => /论文/.test(t.text));
  check('K1 选中「论文生成」只表示正在查看，不表示已生成',
    paperTab && paperTab.cur === 'step' && paperTab.progress !== 'done' && /未开始|进行中/.test(paperTab.label || ''),
    JSON.stringify(paperTab));
  check('K2 顶部状态不因切到论文页而变成「已生成」', K.badge && !/已生成/.test(K.badge.text), JSON.stringify(K.badge));
  check('K3 生成初稿主操作在成果卡末尾右侧，且说明欠缺项',
    await ev(`(() => { const row = document.querySelector('.cta-row'); if (!row) return false;
      const btn = row.querySelector('.btn'); const note = row.querySelector('.cta-note');
      if (!btn || !note) return false;
      const br = btn.getBoundingClientRect(), rr = row.getBoundingClientRect();
      const card = row.closest('.card').getBoundingClientRect();
      return br.right <= rr.right + 1 && Math.abs(rr.bottom - card.bottom) < 60 && /欠缺|已完成/.test(note.textContent); })()`),
    'cta-row');
  await shot('rev-paper-cta-1440.png');

  /* ================= L. 窄成果栏下逐页签核对（不出现逐字竖排） ================= */
  await viewport(1280, 800);
  await ev(`document.getElementById('btn-new-project').click()`);
  await sleep(300);
  await ev(`(() => { const ta = document.querySelector('#prompt');
    ta.value = '数字化转型对企业创新产出的影响'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#compose').requestSubmit(); return 1; })()`);
  await sleep(1500);
  const tabCount = await ev(`document.querySelectorAll('.tabs button').length`);
  const narrowRows = [];
  for (let i = 0; i < tabCount; i++) {
    await ev(`document.querySelectorAll('.tabs button')[${i}].click()`);
    await sleep(420);
    narrowRows.push(await ev(`(() => {
      const stage = document.getElementById('stage-content');
      let minDefW = Infinity, minCardW = Infinity, minP = Infinity;
      stage.querySelectorAll('.deflist dd').forEach(d => { minDefW = Math.min(minDefW, d.getBoundingClientRect().width); });
      stage.querySelectorAll('.card, .evidence-item').forEach(c => { minCardW = Math.min(minCardW, c.getBoundingClientRect().width); });
      stage.querySelectorAll('p').forEach(p => { minP = Math.min(minP, p.getBoundingClientRect().width); });
      return { resultsW: Math.round(document.querySelector('.results').getBoundingClientRect().width),
               minDefW: Number.isFinite(minDefW) ? Math.round(minDefW) : null,
               minCardW: Number.isFinite(minCardW) ? Math.round(minCardW) : null,
               minP: Number.isFinite(minP) ? Math.round(minP) : null,
               docW: document.documentElement.scrollWidth };
    })()`));
  }
  const badNarrow = narrowRows.filter(r => (r.minDefW !== null && r.minDefW < 120) || (r.minCardW !== null && r.minCardW < 220));
  check('L1 1280px（成果栏 480px）下六个阶段页都不出现被压扁的字段/卡片',
    narrowRows.length === tabCount && badNarrow.length === 0,
    JSON.stringify(narrowRows));
  check('L2 逐页签切换都没有横向页面滚动',
    narrowRows.every(r => r.docW <= 1280), JSON.stringify(narrowRows.map(r => r.docW)));
  await shot('rev-project-1280-definition.png');

  /* ================= 汇总 ================= */
  const failed = results.filter(r => !r.ok);
  console.log('\nSUMMARY total=' + results.length + ' pass=' + (results.length - failed.length) + ' fail=' + failed.length);
  if (failed.length) console.log('FAILED: ' + failed.map(f => f.id).join(', '));
  if (pageErrors.length) console.log('PAGE_ERRORS ' + pageErrors.length + ': ' + pageErrors.slice(0, 3).join(' | '));
  console.log(failed.length === 0 && pageErrors.length === 0 ? 'ALL PASS' : 'HAS FAILURES');
  ws.close(); chrome.kill();
  process.exit(failed.length === 0 && pageErrors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FAILED:', e && e.message ? e.message : e);
  try { chrome.kill(); } catch (_) {}
  process.exit(2);
});
