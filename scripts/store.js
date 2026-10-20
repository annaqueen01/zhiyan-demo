/* ============================================================
   智研 · 状态与持久化
   纯前端：状态存 localStorage；事件日志（受 DSH 同构启发）存内存 + 快照。
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};
  var U = ZY.util;

  var KEY = 'zhiyan.demo.v1';

  /* ---------- 阶段定义（13 个）---------- */
  var STAGES = [
    { id: 'definition',  label: '项目定义', short: '定义' },
    { id: 'literature',  label: '文献分析', short: '文献' },
    { id: 'design',      label: '实验设计', short: '设计' },
    { id: 'data',        label: '数据处理', short: '数据' },
    { id: 'stats',       label: '统计分析', short: '统计' },
    { id: 'paper',       label: '论文生成', short: '论文' }
  ];

  /* 用户可见的 6 个页签 → 13 个内部阶段的映射 */
  var STAGE_TAB = {
    'corpus-intake': 'definition', 'question-scoping': 'definition',
    'evidence-mapping': 'literature',
    'design-authoring': 'design', 'design-gate': 'design',
    'data-prep': 'data', 'descriptive': 'data',
    'baseline': 'stats', 'robustness': 'stats', 'endogeneity': 'stats',
    'heterogeneity': 'stats', 'mechanism': 'stats',
    'paper-drafting': 'paper'
  };

  var PIPELINE_STEPS = [
    { id: 'data-prep',     no: '①', label: '数据清洗' },
    { id: 'descriptive',   no: '②', label: '描述性统计' },
    { id: 'baseline',      no: '③', label: '基准回归' },
    { id: 'robustness',    no: '④', label: '稳健性检验' },
    { id: 'endogeneity',   no: '⑤', label: '内生性分析' },
    { id: 'heterogeneity', no: '⑥', label: '异质性分析' },
    { id: 'mechanism',     no: '⑦', label: '机制分析' }
  ];

  var listeners = [];
  var state = null;

  /* ---------- 初始状态 ---------- */
  function blankProject(id, title, topic, scenario) {
    return {
      id: id,
      title: title,
      topic: topic || '',
      scenario: scenario || 'full',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stage: 'definition',            // 当前 13 阶段 ID
      tab: 'definition',              // 当前页签
      designConfirmed: false,
      designHash: null,
      pipeline: null,                 // 运行时由 engine 填充
      messages: [],
      paper: null,
      datasetId: null,                // 选定的真实数据文件（决定「采用的数据」能引用什么）
      model: { provider: 'deepseek-official', model: 'deepseek-chat' },
      thread: []
    };
  }

  function initialState() {
    var p = blankProject('demo-main', '数字化转型与企业创新',
      '数字化转型 对 企业创新 的影响', 'full');
    return {
      version: 1,
      /* 首次进入不激活任何项目：右侧成果区为空，对话区显示输入框 + 示例卡片。
         点击示例卡片或输入研究问题后，才进入项目流程。 */
      projects: [p],
      activeId: null,
      resourcePage: null,           // null | 'dataset' | 'library'
      // 资源库
      libraryLoaded: true,
      datasetLoaded: true,
      // 模型服务
      providers: JSON.parse(JSON.stringify(ZY.data.PROVIDERS)),
      credentials: {},              // 仅内存 + sessionStorage（刷新即失效）
      rememberKeys: false,          // 用户显式 opt-in 才落 localStorage
      connTest: {},                 // providerId → {status, latencyMs, at}
      user: { name: '研究者', email: '' },   // 本地账号（仅存在本机）
      discovered: {},               // providerId → 已发现的模型候选
      importedPanel: null,          // 用户导入的 CSV 面板 {label, rows, names}
      importedDocs: [],             // 用户导入的文献 id 列表
      sampleSize: 2400,             // 真实计量计算用的样本量（可调）
      // 全局 UI
      activeStep: 'data-prep',
      segView: 'result',            // 三件套视图：code | result | interpret
      focusCell: null,              // 关联同步：当前聚焦的 cell_id
      focusCite: null,              // 当前聚焦的引用
      refusals: [],
      decisions: [],
      syncState: 'local'
    };
  }

  /* ---------- 持久化 ---------- */
  function persistable() {
    return {
      version: state.version,
      projects: state.projects,
      activeId: state.activeId,
      resourcePage: state.resourcePage,
      libraryLoaded: state.libraryLoaded,
      datasetLoaded: state.datasetLoaded,
      providers: state.providers,
      rememberKeys: state.rememberKeys,
      user: state.user,
      discovered: state.discovered,
      importedPanel: state.importedPanel,
      sampleSize: state.sampleSize,
      // 仅当用户显式同意"记住密钥"时才持久化凭据
      credentials: state.rememberKeys ? state.credentials : {},
      refusals: state.refusals,
      decisions: state.decisions,
      activeStep: state.activeStep
    };
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(persistable()));
      state.syncState = 'local';
    } catch (e) {
      state.syncState = 'error';
      console.warn('[智研] 本地保存失败', e);
    }
    notify();
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    state = initialState();
    if (raw) {
      try {
        var s = JSON.parse(raw);
        if (s && s.version === 1 && Array.isArray(s.projects) && s.projects.length) {
          state.projects = s.projects;
          /* 自愈：上一次浏览器被关掉时，可能正好有消息停在「进行中」。
             那条消息是带着 streaming:true 存下来的，刷新也不会自己消失 ——
             不清掉的话，用户一打开就看到永远转圈的进度条。 */
          state.projects.forEach(function (proj) {
            (proj && proj.messages || []).forEach(function (m) {
              if (m && m.streaming) {
                m.streaming = false;
                m.progress = null;
                m.progressSub = null;
              }
            });
            if (proj) proj.designRunning = false;
          });
          /* 允许 null：表示尚未开始任何项目 */
          state.activeId = s.activeId || null;
          state.resourcePage = s.resourcePage || null;
          state.libraryLoaded = s.libraryLoaded !== false;
          state.datasetLoaded = s.datasetLoaded !== false;
          if (Array.isArray(s.providers) && s.providers.length) state.providers = s.providers;
          state.rememberKeys = !!s.rememberKeys;
          state.credentials = s.credentials || {};
          state.refusals = s.refusals || [];
          state.decisions = s.decisions || [];
          state.discovered = s.discovered || {};
          if (s.user && s.user.name) state.user = { name: s.user.name, email: s.user.email || '' };
          state.importedPanel = s.importedPanel || null;
          state.importedDocs = s.importedDocs || [];
          state.sampleSize = s.sampleSize || 2400;
          state.activeStep = s.activeStep || 'data-prep';
        }
      } catch (e) {
        console.warn('[智研] 读取本地状态失败，已重置', e);
        state = initialState();
      }
    }
    // 凭据：默认从 sessionStorage 读取（刷新即失效）
    try {
      var sess = sessionStorage.getItem(KEY + '.keys');
      if (sess) Object.assign(state.credentials, JSON.parse(sess));
    } catch (e) { /* 忽略 */ }
    return state;
  }

  function reset() {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY + '.keys'); } catch (e) {}
    state = initialState();
    notify();
  }

  /* ---------- UI 偏好（与项目数据分开存储） ----------
     列宽与成果区展开状态属于"本机界面偏好"，不是研究项目数据：
     因此使用独立键，不进 persistable()，也不会被 reset()（清空项目）连带清掉。 */
  var UI_KEY = 'zhiyan.demo.ui.v1';
  var UI_DEFAULTS = { railW: 248, chatW: 390, resultsCollapsed: false };
  var ui = null;

  function readUi() {
    var out = Object.assign({}, UI_DEFAULTS);
    try {
      var raw = localStorage.getItem(UI_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && typeof s === 'object') {
          if (isFinite(s.railW)) out.railW = Number(s.railW);
          if (isFinite(s.chatW)) out.chatW = Number(s.chatW);
          out.resultsCollapsed = !!s.resultsCollapsed;
        }
      }
    } catch (e) { /* 隐私模式：退回默认值 */ }
    return out;
  }

  /** 读取 UI 偏好（懒加载并缓存） */
  function uiPrefs() {
    if (!ui) ui = readUi();
    return ui;
  }

  /** 合并写入 UI 偏好：只保存"用户意图值"，不含窗口约束后的临时值 */
  function setUiPrefs(patch) {
    ui = Object.assign({}, uiPrefs(), patch || {});
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* 忽略 */ }
    return ui;
  }

  function resetUiPrefs() {
    ui = Object.assign({}, UI_DEFAULTS);
    try { localStorage.removeItem(UI_KEY); } catch (e) { /* 忽略 */ }
    return ui;
  }

  /* ---------- 订阅 ---------- */
  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }
  function notify() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { console.error('[智研] 订阅回调异常', e); }
    });
  }

  /* ---------- 便捷访问 ---------- */
  function get() { return state; }

  function project() {
    if (!state.activeId) return null;
    for (var i = 0; i < state.projects.length; i++) {
      if (state.projects[i].id === state.activeId) return state.projects[i];
    }
    return null;
  }

  /** 打开某个项目（同时退出"浏览资源"模式） */
  function setActive(id) {
    state.activeId = id;
    state.resourcePage = null;
    var p = project();
    if (p) { state.activeStep = (p.pipeline && p.pipeline.activeStep) || 'data-prep'; }
    save();
  }

  /** 进入资源库页面（不清空 activeId，便于返回研究） */
  function openResourcePage(kind) {
    state.resourcePage = (state.resourcePage === kind) ? null : kind;
    save();
  }

  function closeResourcePage() {
    state.resourcePage = null;
    save();
  }

  function updateProject(patch) {
    var p = project();
    if (!p) return null;
    Object.assign(p, patch, { updatedAt: Date.now() });
    save();
    return p;
  }

  function addProject(title, topic, scenario) {
    var p = blankProject(U.uid('proj'), title, topic, scenario);
    state.projects.unshift(p);
    state.activeId = p.id;
    save();
    return p;
  }

  function removeProject(id) {
    state.projects = state.projects.filter(function (p) { return p.id !== id; });
    if (!state.projects.length) state.projects = [blankProject('demo-main', '数字化转型与企业创新', '数字化转型 对 企业创新 的影响', 'full')];
    if (state.activeId === id) state.activeId = state.projects[0].id;
    save();
  }

  /* ---------- 凭据（只写不读）---------- */
  function setCredential(ref, value) {
    state.credentials[ref] = value;
    try {
      sessionStorage.setItem(KEY + '.keys', JSON.stringify(state.credentials));
      if (state.rememberKeys) localStorage.setItem(KEY + '.keys.persist', JSON.stringify(state.credentials));
    } catch (e) { /* 隐私模式忽略 */ }
    save();
  }

  function clearCredential(ref) {
    delete state.credentials[ref];
    try { sessionStorage.setItem(KEY + '.keys', JSON.stringify(state.credentials)); } catch (e) {}
    save();
  }

  /** UI 只允许知道"是否已配置"，永不回显值 */
  function credentialInfo(ref) {
    var has = !!(state.credentials[ref] && String(state.credentials[ref]).length);
    return {
      configured: has,
      source: has ? (state.rememberKeys ? 'localStorage（已记住）' : 'sessionStorage（本页有效）') : 'none',
      ref: ref
    };
  }

  function setRememberKeys(on) {
    state.rememberKeys = !!on;
    try {
      if (on) localStorage.setItem(KEY + '.keys.persist', JSON.stringify(state.credentials));
      else localStorage.removeItem(KEY + '.keys.persist');
    } catch (e) {}
    save();
  }

  /* ---------- 本地账号（仅存本机，不上传）---------- */
  function setUser(patch) {
    state.user = Object.assign({ name: '研究者', email: '' }, state.user, patch || {});
    save();
    return state.user;
  }

  /** 头像字：取用户名首字（中文取第一个字，英文取首字母） */
  function avatarChar() {
    var n = (state.user && state.user.name) || '';
    if (!n) return '研';
    return n.slice(0, 1).toUpperCase();
  }

  /* ---------- 决策留痕 ---------- */
  function recordDecision(question, chosen, rejected, reason, actor) {
    state.decisions.unshift({
      id: U.uid('dec'), at: Date.now(), actor: actor || 'user',
      question: question, chosen: chosen, rejected: rejected || [], reason: reason || ''
    });
    if (state.decisions.length > 200) state.decisions.length = 200;
    save();
  }

  function raiseRefusal(code, conclusion, missing, canAdd, notDoing, weaker) {
    var r = {
      id: U.uid('ref'), at: Date.now(), code: code, conclusion: conclusion,
      missing: missing || [], canAdd: canAdd || [], notDoing: notDoing || [],
      weaker: weaker || null, resolved: false, userDecision: null
    };
    state.refusals.unshift(r);
    save();
    return r;
  }

  function resolveRefusal(id, decision) {
    state.refusals.forEach(function (r) {
      if (r.id === id) { r.resolved = true; r.userDecision = { chosen: decision, at: Date.now() }; }
    });
    save();
  }

  ZY.store = {
    STAGES: STAGES, STAGE_TAB: STAGE_TAB, PIPELINE_STEPS: PIPELINE_STEPS,
    load: load, save: save, reset: reset, subscribe: subscribe, notify: notify,
    UI_DEFAULTS: UI_DEFAULTS, uiPrefs: uiPrefs, setUiPrefs: setUiPrefs, resetUiPrefs: resetUiPrefs,
    get: get, project: project, setActive: setActive, updateProject: updateProject,
    addProject: addProject, removeProject: removeProject, blankProject: blankProject,
    setCredential: setCredential, clearCredential: clearCredential,
    credentialInfo: credentialInfo, setRememberKeys: setRememberKeys,
    openResourcePage: openResourcePage, closeResourcePage: closeResourcePage,
    setUser: setUser, avatarChar: avatarChar,
    recordDecision: recordDecision, raiseRefusal: raiseRefusal, resolveRefusal: resolveRefusal,
    refusals: function () { return state.refusals; },
    decisions: function () { return state.decisions; }
  };
})(window);
