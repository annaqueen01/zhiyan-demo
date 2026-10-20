/* ============================================================
   智研 · 应用入口
   事件绑定、引导流程（命题 → 文献 → 设计门 → 七步 → 论文）、模态实现
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY, U = ZY.util, D = ZY.data, S = ZY.store, E = ZY.engine, R = ZY.render;
  var el = U.create;

  var currentModal = null;
  var running = false;
  var currentStream = null;   // 进行中的流式请求（可中止）
  var corpusReady = false;    // 文献库（样例 + 真实）是否已灌进检索索引

  /**
   * 灌库：真实文献走 addDocument({pages})，逐页真实文本参与检索；
   * 质量诊断随之由真实文本算出，而不是像样例那样「声明」。
   * 幂等，重复调用无副作用。
   */
  function ensureCorpus() {
    if (corpusReady) return;
    if (ZY.resource && ZY.resource.ensureCorpus) {
      ZY.resource.ensureCorpus();
      corpusReady = true;
      return;
    }
    if (ZY.corpus) {
      ZY.corpus.addSampleLibrary(D.LIBRARY);
      corpusReady = true;
    }
  }

  /* ============================================================
     渲染
     ============================================================ */
  function renderAll() {
    R.topbar();
    R.projectRail();
    R.chat();
    R.views();          /* 资源页 / 项目页 / 空态 三选一 */
    R.resultHead();
    R.tabs();
    R.stageContent();
    applyLayout();      /* 列宽约束随视图（空态/项目态）与窗口宽度变化 */
    syncComposeState();
    updateModelPicker();   /* 输入组里的模型选择器 */
    renderAttachments();   /* 已挂附件（换项目时清空） */
  }

  /** 空输入时发送按钮保持禁用（状态清楚，不是靠点击后无反应） */
  function syncComposeState() {
    var ta = U.$('#prompt');
    var btn = U.$('#btn-send');
    if (!ta || !btn) return;
    btn.disabled = !ta.value.trim() && !attachments.length;
    /* 输入框没有自己的边框，高度随内容撑开；超过上限后框内滚动 */
    if (ta.style) {
      ta.style.height = 'auto';
      var h = Number(ta.scrollHeight) || 0;
      ta.style.height = Math.max(56, Math.min(h, 200)) + 'px';
    }
  }

  /* ============================================================
     输入组：附件 / 语音 / 模型选择
     ============================================================ */

  /** 当前挂着的附件。不写进 localStorage：大文件正文不该塞进浏览器存储 */
  var attachments = [];
  var voiceRec = null;
  /** 还没建项目时选的模型，等第一个项目建好再落进去 */
  var pendingModel = null;

  function fmtSize(n) {
    if (n === undefined || n === null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /** 附件条：文件名 + 读取状态，可逐个移除 */
  function renderAttachments() {
    var strip = U.$('#attach-strip');
    if (!strip) return;
    U.clear(strip);
    strip.hidden = attachments.length === 0;
    attachments.forEach(function (a) {
      var meta = a.state === 'reading' ? '读取中…'
        : a.state === 'err' ? '未能读取'
          : (a.chars ? a.chars + ' 字' : fmtSize(a.size));
      strip.appendChild(el('span.attach-chip', { 'data-state': a.state === 'err' ? 'err' : 'ok' }, [
        el('span.ac-name', { text: a.name, title: a.name + ' · ' + fmtSize(a.size) }),
        el('span.ac-meta', { text: meta }),
        el('button.ac-x', {
          type: 'button', text: '×',
          title: '移除附件 ' + a.name, 'aria-label': '移除附件 ' + a.name,
          onclick: function () { removeAttachment(a.id); }
        })
      ]));
    });
  }

  function removeAttachment(id) {
    attachments = attachments.filter(function (a) { return a.id !== id; });
    renderAttachments();
    syncComposeState();
  }

  function addFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    list.forEach(function (f) {
      var a = {
        id: 'att-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
        name: f.name, size: f.size, chars: 0, text: '', state: 'reading'
      };
      attachments.push(a);
      readAttachment(a, f);
    });
    renderAttachments();
    syncComposeState();
  }

  /** 真读：PDF 走 pdftext，纯文本直接读；读不出来标红，不假装读到了 */
  function readAttachment(a, f) {
    var lower = String(f.name || '').toLowerCase();
    function done(text) {
      a.text = String(text || '');
      a.chars = a.text.replace(/\s+/g, '').length;
      a.state = a.chars ? 'ok' : 'err';
      renderAttachments();
    }
    function fail() { a.state = 'err'; renderAttachments(); }

    if (lower.slice(-4) === '.pdf') {
      readArrayBuffer(f).then(function (buf) {
        if (!window.ZY || !ZY.pdftext) { fail(); return null; }
        return ZY.pdftext.extract(buf, { name: f.name }).then(function (res) {
          if (!res || !res.ok) { fail(); return; }
          done((res.pages || []).map(function (pg) { return pg.text; }).join('\n'));
        }, fail);
      }, fail);
      return;
    }
    if (/\.(txt|md|csv|json|log|do)$/.test(lower)) {
      readText(f).then(done, fail);
      return;
    }
    /* docx 等二进制格式这里不做解析，只随消息带文件名 */
    a.state = 'ok';
    renderAttachments();
  }

  /** 附件正文（截断）拼进送给模型的上下文 */
  function attachmentContext() {
    var parts = attachments.filter(function (a) { return a.text; })
      .map(function (a) { return '【附件 ' + a.name + '】\n' + a.text.slice(0, 4000); });
    return parts.length ? '\n\n' + parts.join('\n\n') : '';
  }

  /* ---------------- 语音输入 ---------------- */
  function setVoiceState(on) {
    var b = U.$('#btn-voice');
    if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function toggleVoice() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { R.toast('当前浏览器不支持语音输入（Chrome / Edge 可用）', 'err'); return; }
    if (voiceRec) { try { voiceRec.stop(); } catch (e) { /* 忽略 */ } return; }
    var ta = U.$('#prompt');
    var base = ta.value;
    try {
      voiceRec = new SR();
    } catch (e) { R.toast('语音输入启动失败：' + e.message, 'err'); return; }
    voiceRec.lang = 'zh-CN';
    voiceRec.continuous = false;
    voiceRec.interimResults = true;
    voiceRec.onresult = function (ev) {
      var txt = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      ta.value = (base ? base + ' ' : '') + txt;
      syncComposeState();
    };
    voiceRec.onerror = function (ev) {
      voiceRec = null; setVoiceState(false);
      R.toast('语音输入失败：' + ((ev && ev.error) || '未知原因'), 'err');
    };
    voiceRec.onend = function () { voiceRec = null; setVoiceState(false); };
    try {
      voiceRec.start();
      setVoiceState(true);
      R.toast('开始语音输入，请说话…');
    } catch (e) {
      voiceRec = null; setVoiceState(false);
      R.toast('语音输入启动失败：' + e.message, 'err');
    }
  }

  /* ---------------- 模型选择 ---------------- */
  function currentModelChoice() {
    var p = S.project();
    if (p && p.model) return p.model;
    return pendingModel;
  }

  function updateModelPicker() {
    var chip = U.$('#btn-model');
    var label = U.$('#model-chip-label');
    if (!chip || !label) return;
    var st = S.get();
    var choice = currentModelChoice();
    var prof = choice
      ? st.providers.filter(function (x) { return x.id === choice.provider; })[0]
      : activeProfile();
    var ready = !!(prof && st.credentials[prof.credentialRef]);
    chip.dataset.state = ready ? 'ok' : 'warn';
    if (!prof) { label.textContent = '暂未配置模型'; }
    else {
      var mid = (choice && choice.model) || activeModel(prof);
      label.textContent = ready ? (mid || prof.displayName) : (mid ? (mid + ' · 未配置密钥') : '暂未配置模型');
    }
    chip.setAttribute('aria-label', ready ? ('当前模型：' + label.textContent + '，点击切换') : '暂未配置模型，点击选择或去配置');
    renderModelMenu();
  }

  /** 下拉内容：通道 × 模型。未配置密钥的通道也列出来，但标明状态 */
  function renderModelMenu() {
    var list = U.$('#model-menu-list');
    if (!list) return;
    U.clear(list);
    var st = S.get();
    var choice = currentModelChoice();
    st.providers.forEach(function (prof) {
      var configured = !!st.credentials[prof.credentialRef];
      list.appendChild(el('div.mm-group', {}, [
        el('span', { text: prof.displayName }),
        configured ? null : el('span.mm-warn', { text: '未配置密钥' })
      ]));
      var models = prof.models || [];
      if (!models.length) {
        list.appendChild(el('div.mm-group', {}, [el('span.mm-warn', { text: '该通道还没有模型，去配置里添加' })]));
      }
      models.forEach(function (m) {
        var picked = !!(choice && choice.provider === prof.id && choice.model === m.id);
        list.appendChild(el('button.mm-item', {
          type: 'button', role: 'menuitemradio', 'aria-checked': picked ? 'true' : 'false',
          onclick: function () { pickModel(prof.id, m.id, configured); }
        }, [
          el('span', { text: m.id }),
          picked ? el('span.mm-check', { html: U.ICONS.check }) : null
        ]));
      });
    });
  }

  function pickModel(providerId, modelId, configured) {
    var p = S.project();
    if (p) {
      p.model = { provider: providerId, model: modelId };
      S.updateProject({ model: p.model });
    } else {
      pendingModel = { provider: providerId, model: modelId };
    }
    closeModelMenu();
    updateModelPicker();
    if (!configured) {
      R.toast('已选 ' + modelId + '，但该通道还没配置密钥——点「去配置模型」填一个', 'err');
      return;
    }
    R.toast('已切换模型：' + modelId, 'ok');
  }

  function openModelMenu(on) {
    var menu = U.$('#model-menu');
    var chip = U.$('#btn-model');
    if (!menu || !chip) return;
    menu.hidden = (on === undefined) ? !menu.hidden : !on;
    chip.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    if (!menu.hidden) renderModelMenu();
  }
  function closeModelMenu() { openModelMenu(false); }

  /* ============================================================
     会话引导流程
     ============================================================ */
  /* ============================================================
     真实 API 路径
     ============================================================ */
  /** 是否具备真实调用条件：至少一个通道已配置密钥 */
  function realApiReady() {
    var st = S.get();
    return st.providers.some(function (p) { return !!st.credentials[p.credentialRef]; });
  }

  /* ============================================================
     研究问题结构化抽取（真实流程的第一步）
     ============================================================ */

  /**
   * 用模型把用户原话抽取成结构化研究问题（五槽位）。
   * 流程：提示词 → 调用 → 抽 JSON → 本地校验 → 落库或报错。
   * **失败时不写入任何预设 RQ** —— 宁可停在"没识别出来"，也不套模板。
   */
  function extractRqWithLlm(p, userText) {
    var prof = activeProfile();
    if (!prof) { rqExtractFailed(p, ['没有可用的模型通道']); return; }

    var hints = retrieveContext(userText, 5).map(function (d) {
      return '《' + (d.title || '') + '》' + (d.journal || '') +
             (d.quote ? ('：' + String(d.quote).slice(0, 80)) : '');
    });
    var prompt = ZY.rq.buildPrompt(userText, { libraryHints: hints });

    /* 抽取期间不把原始 JSON 显示给用户：只说明"正在做什么" */
    var msg = { role: 'assistant', at: Date.now(), text: '', streaming: true,
                progress: '小智正在识别你的研究问题' };
    p.messages.push(msg);
    S.updateProject({ messages: p.messages });
    renderAll();

    var holder = ZY.llm.stream(prof, {
      model: activeModel(prof),
      messages: [
        { role: 'system', content: '你只输出 JSON，不输出任何其他内容。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0       /* 结构化抽取要可复现，不要随机性 */
    }, {
      onDelta: function () {
        /* 结构化抽取的中间产物是 JSON，对用户没有意义，不逐字显示。
           只更新一次进度文案，避免"刷屏式"无用输出。 */
        if (!msg._ticked) { msg._ticked = true; renderAll(); }
      }
    });
    currentStream = holder;

    holder.promise.then(function (full) {
      currentStream = null;
      var pp = S.project();
      msg.streaming = false;
      msg.progress = null;
      msg.text = '';                 /* 原始 JSON 不留在对话里 */
      msg.modelMode = 'api:' + prof.id;

      var ex = ZY.rq.extractJson(full);
      if (!ex.ok) {
        rqExtractFailed(pp, ['模型返回的内容不是合法 JSON（' + ex.reason + '）'], ex.raw);
        return;
      }
      var res = ZY.rq.normalize(ex.value, userText);
      E.emit('rq.extract', {
        ok: res.ok, unknown_slots: res.unknownSlots,
        claim_type: res.rq && res.rq.claimType, recovered: !!ex.recovered
      });

      if (!res.ok) { rqExtractFailed(pp, res.errors, null, res); return; }
      applyRq(pp, res, userText);
    }, function (e) {
      currentStream = null;
      var d = ZY.llm.describeError(e);
      rqExtractFailed(p, ['调用失败（' + d.code + '）：' + d.message]);
    });
  }

  /**
   * 抽取成功：写入 RQ，并用**可读卡片**呈现（不出现 JSON、不出现字段名）。
   * 卡片本身在 render.js 里由 ZY.ui.rqCard 渲染。
   */
  function applyRq(p, res, userText) {
    var rq = res.rq;
    var msgs = p.messages;
    var lines = [];

    lines.push('我已经把你的研究问题整理清楚了，请核对下面这几点。');
    if (rq.claimType !== 'causal') {
      lines.push('');
      lines.push('先说结论：**我只会用「' + ZY.rq.CLAIM_LABEL[rq.claimType] +
        '」来表述**，不会写成因果。原因在卡片里说明了。');
    } else {
      lines.push('');
      lines.push('你的变异来源看得出外生冲击，所以**可以用「因果」表述**——但要在设计里把识别策略写扎实。');
    }
    if (res.warnings.length) {
      lines.push('');
      lines.push('另外有 ' + res.warnings.length + ' 处我做了保守处理：');
      res.warnings.forEach(function (w) { lines.push('· ' + w); });
    }
    lines.push('');
    lines.push('接下来我会按**你这个问题**去检索文献，再据此生成实验设计。');

    msgs.push({ role: 'assistant', at: Date.now(), text: lines.join('\n'),
                chips: ['研究问题已识别', '允许措辞：' + ZY.rq.CLAIM_LABEL[rq.claimType]],
                rqCard: true });

    S.updateProject({
      rq: rq,
      title: rq.title || (p.title === '未命名项目' ? userText.slice(0, 20) : p.title),
      messages: msgs,
      stage: 'evidence-mapping',
      tab: 'definition'
    });
    E.emit('rq.locked', { rq_hash: U.hash32(JSON.stringify(rq)), claim_type: rq.claimType });
    renderAll();

    setTimeout(function () { literatureAndDesign(S.project().id); }, 400);
  }

  /**
   * 收尾：把所有还挂着的「进行中」占位消息关掉。
   *
   * 失败路径如果不做这一步，对话区会**永远转圈**（进度条不会自己消失），
   * 用户看到的就是「卡住了」——而其实请求早就失败了。
   * 成功路径一直是显式清 streaming 的，失败路径漏了，于是只有出错时才卡。
   */
  function settleStreaming(msgs) {
    (msgs || []).forEach(function (m) {
      if (m && m.streaming) {
        m.streaming = false;
        m.progress = null;
        m.progressSub = null;
      }
    });
  }

  /** 抽取失败：如实展示原因，不写入任何 RQ */
  function rqExtractFailed(p, errors, raw, res) {
    var pp = p || S.project();
    if (!pp) return;
    pp.messages = pp.messages || [];
    settleStreaming(pp.messages);
    var lines = ['**我没能识别出你的研究问题。**', ''];
    errors.forEach(function (e) { lines.push('· ' + e); });
    if (res && res.warnings && res.warnings.length) {
      lines.push('');
      res.warnings.forEach(function (w) { lines.push('· ' + w); });
    }
    if (raw) lines.push('', '模型原始返回（前 200 字）：' + String(raw).slice(0, 200));
    lines.push('');
    lines.push('我没有拿预置命题替你填上——那样后面的设计、变量、结论类型就都不是你的课题了。');
    lines.push('请按上面的提示补充信息后重新提交一次。');

    pp.messages = pp.messages || [];
    settleStreaming(pp.messages);
    pp.messages.push({ role: 'assistant', at: Date.now(), text: lines.join('\n'),
                       chips: ['研究问题未识别'], error: true });
    S.recordDecision('研究问题抽取失败', '不套用预置命题', ['套用预置命题'], errors.join('；'), 'agent');
    S.updateProject({ messages: pp.messages });
    renderAll();
  }

  /**
   * 针对本项目 RQ 的真实文献分析 + 生成实验设计。
   *
   * 以前这里读的是 D.PROBES 那套固定结果，换任何题目页面上都是同一份数字。
   * 现在：按 RQ 生成多路检索式 → 真实 BM25 检索 → 归纳证据结构 → 落库到
   * project.litAnalysis，文献分析页直接读它。
   * 检索耗时较长时，对话区与右侧面板都会显示"小智快速检索文献中"的动效。
   */
  function literatureAndDesign(projectId) {
    var p = S.get().projects.filter(function (x) { return x.id === projectId; })[0];
    if (!p || !p.rq) return;

    var queries = ZY.litSearch ? ZY.litSearch.buildQueries(p.rq) : [];
    var total = Math.max(1, queries.length);

    /* 检索中的反馈：对话区一条带进度的消息；右侧文献分析页同时切到动效 */
    var prog = { role: 'assistant', at: Date.now(), text: '', streaming: true,
                 progress: '小智快速检索文献中',
                 progressSub: '正在按你的研究问题生成 ' + total + ' 路检索式' };
    p.messages.push(prog);
    S.updateProject({ messages: p.messages, litRunning: { done: 0, total: total } });
    renderAll();

    var analysis = { ok: true, rq: p.rq, queries: queries, perQuery: [], hits: [] };
    var seen = Object.create(null);
    var step = 0;

    function runOne() {
      if (step >= total) { finish(); return; }
      var q = queries[step];
      var hits = [];
      try {
        if (ZY.corpus && !corpusReady) {
          ensureCorpus();
        }
        hits = (ZY.corpus && ZY.corpus.search(q.query, { limit: 8 })) || [];
      } catch (e) {
        E.emit('retrieval.error', { message: String((e && e.message) || e) });
      }

      analysis.perQuery.push({ label: q.label, query: q.query, count: hits.length });
      hits.forEach(function (h) {
        var key = h.docId || h.id;
        var score = (h.score || 0) * (q.weight || 1);
        if (seen[key]) { seen[key].score += score; seen[key].matchedBy.push(q.label); return; }
        var rec = {
          docId: key, title: h.title, journal: h.journal, year: h.year,
          method: h.method || '', conclusion: h.conclusion || '',
          quote: h.quote, page: h.page, charRange: h.charRange,
          score: score, matchedBy: [q.label],
          trust: ZY.litSearch.trustOf(h), lowQuality: !!h.lowQuality, diag: h.diag || null
        };
        seen[key] = rec;
        analysis.hits.push(rec);
      });

      step++;
      prog.progressSub = '已完成 ' + step + '/' + total + ' 路：' + q.label;
      var pp2 = S.project();
      if (pp2 && pp2.id === projectId) {
        S.updateProject({
          litRunning: { done: step, total: total, label: q.label },
          messages: pp2.messages
        });
      }
      renderAll();
      setTimeout(runOne, 90);      /* 让出动效的绘制时间 */
    }

    function finish() {
      analysis.hits.sort(function (a, b) { return b.score - a.score; });
      var sum = ZY.litSearch.summarize(analysis);
      analysis.summary = sum;

      var n = analysis.hits.length;
      var lines = [];
      if (!n) {
        lines.push('**在你的文献库里没有检索到与这个问题相关的文献。**');
        lines.push('');
        lines.push('我跑了 ' + total + ' 路检索式（' +
          queries.map(function (q) { return q.label; }).join('、') + '），都没有命中。');
        lines.push('通常意味着两件事之一：文献库还是空的；或者你的用词与库里的用词差距较大。');
        lines.push('');
        lines.push('**我不会编造引用。** 后面综述里凡是没有依据的地方都会标成「此处待补文献」。');
      } else {
        lines.push('检索完成：在你的文献库里命中 **' + n + ' 篇**相关文献。');
        lines.push('');
        lines.push('质量分布：可引用 ' + (sum.trust.high || 0) + ' 篇 · 需核对 ' +
          (sum.trust.medium || 0) + ' 篇 · 仅可提及 ' + (sum.trust.low || 0) + ' 篇。');
        if (sum.yearRange) {
          lines.push('年份跨度：' + sum.yearRange[0] + '—' + sum.yearRange[1] + '。');
        }
        var methods = Object.keys(sum.methods).sort(function (a, b) {
          return sum.methods[b] - sum.methods[a];
        });
        if (methods.length) {
          lines.push('识别策略分布：' + methods.slice(0, 4).map(function (k) {
            return k + ' ' + sum.methods[k] + ' 篇';
          }).join(' · ') + '。');
        }
        lines.push('');
        lines.push('最相关的 ' + Math.min(5, n) + ' 篇：');
        analysis.hits.slice(0, 5).forEach(function (h, i) {
          lines.push('[' + (i + 1) + '] 《' + (h.title || '') + '》' + (h.journal || '') +
            (h.year ? (' ' + h.year) : '') +
            (h.page ? ('　第 ' + h.page + ' 页') : '') +
            (h.matchedBy && h.matchedBy.length ? ('　（命中：' + h.matchedBy.join('、') + '）') : ''));
        });

        var gaps = sum.gaps.filter(function (g) { return g.status !== 'ok'; });
        if (gaps.length) {
          lines.push('');
          lines.push('⚠️ 有 ' + gaps.length + ' 处在你的库里支撑不足：');
          gaps.forEach(function (g) {
            lines.push('· ' + g.what + '「' + g.term + '」：' +
              (g.status === 'none' ? '没有命中任何文献' : ('只有 ' + g.docs + ' 篇')));
          });
        }
        var dis = sum.disagreements || [];
        if (dis.length) {
          lines.push('');
          lines.push('另有 ' + dis.length + ' 篇结论与主流相反 —— 这些必须写进综述，否则会被认为选择性引用：');
          dis.slice(0, 3).forEach(function (h) {
            lines.push('· 《' + (h.title || '') + '》' + (h.year ? (' ' + h.year) : ''));
          });
        }
        if (sum.causalMethodCount === 0) {
          lines.push('');
          lines.push('提醒：检索到的文献里**没有**使用双重差分/断点/工具变量等因果识别方法的。' +
            '如果你想要因果结论，需要自己补一个外生冲击。');
        }
      }

      prog.streaming = false;
      prog.progress = null;
      prog.progressSub = null;
      prog.text = lines.join('\n');
      prog.chips = ['命中 ' + n + ' 篇'];

      S.updateProject({
        messages: p.messages,
        litAnalysis: analysis,
        litRunning: null,
        literatureDone: true
      });
      renderAll();

      /* 把检索到的证据结构带给设计阶段，避免设计脱离自己的语料 */
      if (realApiReady()) {
        var evidence = n
          ? ('文献库命中 ' + n + ' 篇；质量分布 可引用' + (sum.trust.high || 0) +
             ' 需核对' + (sum.trust.medium || 0) + ' 仅提及' + (sum.trust.low || 0) +
             '；识别策略：' + Object.keys(sum.methods).join('/') +
             '；支撑不足：' + (sum.gaps.filter(function (g) { return g.status !== 'ok'; })
               .map(function (g) { return g.what + '(' + g.term + ')'; }).join('、') || '无'))
          : '文献库没有命中任何相关文献。综述部分必须标注「此处待补文献」，不得编造引用。';
        generateDesignWithLlm(S.project(), evidence);
      } else {
        p.messages.push({ role: 'assistant', at: Date.now(),
          text: '没有模型通道，无法生成实验设计。请先在左下角「账号与设置」里配置 API。',
          chips: ['需要模型通道'] });
        S.updateProject({ messages: p.messages });
        renderAll();
      }
    }

    setTimeout(runOne, 120);
  }

  /**
   * 选定真实数据文件。设计里的「采用的数据」与变量的「数据字段」
   * 都是对着这份文件写的，所以换文件必须让已确认的设计失效——
   * 沿用旧确认等于默认两份不同的数据是一回事。
   */
  function pickDataset(id) {
    var RES = ZY.resource;
    if (!RES || !RES.datasetById || !RES.datasetById(id)) { R.toast('没有这个数据集', 'err'); return; }
    var p = S.project();
    if (!p) return;
    var prev = p.datasetId;
    S.updateProject({ datasetId: id });
    var ds = RES.datasetById(id);
    if (p.design) {
      if (p.designConfirmed && prev && prev !== id) {
        /* 从一份数据换到另一份：设计里的「采用的数据」与字段都不再成立，确认必须失效 */
        E.invalidateDesign('换了数据文件：' + ds.file);
      } else {
        /* 首次选定（设计是在没指定数据的情况下生成的）：不废掉确认，
           但明确说清这份设计不是照它写的，建议重新生成。 */
        p.messages = p.messages || [];
        p.messages.push({
          role: 'assistant', at: Date.now(),
          text: '已把实验设计所依据的数据定为「' + ds.file + '」。' +
            (prev && prev !== id ? '' : '这份设计是在还没指定数据的时候生成的，') +
            '建议点「重新生成实验设计」，让它按这个文件的真实字段重写变量度量与「采用的数据」。',
          chips: ['数据已选定', '建议重新生成设计'],
          fallback: true
        });
        S.updateProject({ messages: p.messages });
      }
    }
    R.toast('已选定数据：' + ds.file);
    renderAll();
  }

  /**
   * 跳到「统计分析」页的某一步正文。
   * 供对话里的进度条目、过程文件表等处调用：
   * 切到统计页 → 渲染 → 滚到那一段并高亮左边索引。
   */
  function gotoStep(stepId) {
    var p = S.project();
    if (!p) { R.toast('还没有项目', 'err'); return; }
    var def = S.PIPELINE_STEPS.filter(function (s) { return s.id === stepId; })[0];
    if (!def) { R.toast('没有这一步：' + stepId, 'err'); return; }
    if (!p.designConfirmed) {
      R.toast('实验设计尚未确认，统计阶段锁定', 'err');
      switchTab('design');
      return;
    }
    S.get().activeStep = stepId;
    S.get().resourcePage = null;
    S.get().scrollToStep = stepId;      /* 渲染完成后由统计页消费掉 */
    S.updateProject({ tab: 'stats' });
    renderAll();
    var sec = document.getElementById('step-' + stepId);
    if (sec && sec.scrollIntoView) {
      try { sec.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      catch (e) { sec.scrollIntoView(); }
    }
  }

  /** 用模型基于本项目 RQ 生成实验设计 */
  function generateDesignWithLlm(p, litSummary) {
    var prof = activeProfile();
    if (!prof) return;
    var ctx = {};
    var imported = S.get().importedPanel;
    if (imported) {
      ctx.datasetHint = imported.label + '（' + U.fmtInt(imported.nRows) + ' 行 × ' +
        imported.names.length + ' 列：' + imported.names.slice(0, 12).join('、') + '）';
    }
    /* 把真实数据目录喂给设计提示词：模型只能引用真实存在的文件名与字段名。
       选定了数据集就给字段级细节，没选定就给按包分组的文件清单。 */
    var RES = ZY.resource;
    if (RES && RES.ready && RES.ready()) {
      var cat = RES.catalogForPrompt(p.datasetId, { maxVars: 80 });
      if (cat) {
        ctx.dataCatalog = cat;
        if (p.datasetId) {
          var _ds = RES.datasetById(p.datasetId);
          if (_ds) ctx.pinnedDataset = _ds.file;
        }
      }
    }
    var prompt = ZY.designGen.buildPrompt(p.rq, ctx);

    var msg = { role: 'assistant', at: Date.now(), text: '', streaming: true,
                progress: '小智正在生成实验设计',
                progressSub: '基于你的研究问题与检索到的文献' };
    p.messages.push(msg);
    S.updateProject({ messages: p.messages, designRunning: true });
    renderAll();

    var holder = ZY.llm.stream(prof, {
      model: activeModel(prof),
      messages: [
        { role: 'system', content: '你只输出 JSON，不输出任何其他内容。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0
    }, {
      onDelta: function () {
        /* 设计也是结构化 JSON，对用户没意义，不逐字显示 */
        if (!msg._ticked) { msg._ticked = true; renderAll(); }
      }
    });
    currentStream = holder;

    holder.promise.then(function (full) {
      currentStream = null;
      var pp = S.project();
      msg.streaming = false;
      msg.progress = null;
      msg.progressSub = null;
      msg.text = '';

      var ex = ZY.rq.extractJson(full);
      if (!ex.ok) { designFailed(pp, ['模型返回的不是合法 JSON（' + ex.reason + '）'], ex.raw); return; }

      var res = ZY.designGen.normalize(ex.value, pp.rq);
      E.emit('design.generate', {
        ok: res.ok, variables: res.design ? res.design.variables.length : 0,
        checks: res.design ? res.design.checks.length : 0
      });
      if (!res.ok) { designFailed(pp, res.errors, null, res); return; }

      var design = res.design;
      design.version = (pp.design && pp.design.version ? pp.design.version + 1 : 1);
      var msgs = pp.messages;
      var lines = ['实验设计已生成（第 ' + design.version + ' 版 · 来源：模型生成）。'];
      lines.push('');
      lines.push('· 假设 ' + design.hypotheses.length + ' 条');
      lines.push('· 变量 ' + design.variables.length + ' 个：' +
        design.variables.slice(0, 8).map(function (v) { return v.name; }).join('、'));
      lines.push('· 模型：' + (design.model.equation || '—'));
      lines.push('· 固定效应：' + (design.model.feTerms.join(' + ') || '—') +
        '　聚类：' + (design.model.cluster || '—'));
      /* 七个组成部分：逐块报出，让人一眼看出哪块没交代清楚 */
      var blocks = design.blocks || [];
      lines.push('· 设计分块 ' + blocks.length + ' 块，每块都写了采用的数据与选择理由：');
      blocks.forEach(function (b) {
        var refs = (b.refs || []).length;
        lines.push('　- ' + b.title + '：' + (b.data || '（缺数据）') +
          '｜理由：' + (b.why ? b.why.slice(0, 40) + (b.why.length > 40 ? '…' : '') : '（缺理由）') +
          '｜文献 ' + refs + ' 篇');
      });
      var fails = design.checks.filter(function (c) { return c.status === 'fail'; });
      var unknowns = design.checks.filter(function (c) { return c.status === 'unknown'; });
      var passes = design.checks.filter(function (c) { return c.status === 'pass'; });
      lines.push('· 检查清单 ' + design.checks.length + ' 项：通过 ' + passes.length +
        '，不通过 ' + fails.length + '，信息不足 ' + unknowns.length);
      if (fails.length) {
        lines.push('');
        lines.push('⚠️ 有 ' + fails.length + ' 项判定为不通过，这直接决定全文能不能用因果表述：');
        fails.slice(0, 4).forEach(function (c) {
          lines.push('· [' + c.id + '] ' + c.label + '：' + (c.evidence || ''));
        });
      }
      if (res.warnings.length) {
        lines.push('');
        res.warnings.forEach(function (w) { lines.push('⚠️ ' + w); });
      }
      lines.push('');
      lines.push('**确认之前我不会读取任何数据。** 请在「实验设计」页核对后点确认。');

      msgs.push({ role: 'assistant', at: Date.now(), text: lines.join('\n'),
                  chips: ['待确认设计', fails.length + ' 项 fail', unknowns.length + ' 项 unknown'] });

      S.updateProject({ design: design, messages: msgs, stage: 'design-authoring', tab: 'design', designRunning: false });
      renderAll();
    }, function (e) {
      currentStream = null;
      var d = ZY.llm.describeError(e);
      designFailed(p, ['调用失败（' + d.code + '）：' + d.message]);
    });
  }

  /** 设计生成失败：停下，不回退预设设计 */
  function designFailed(p, errors, raw, res) {
    var pp = p || S.project();
    if (!pp) return;
    pp.messages = pp.messages || [];
    /* 关键：先把还挂着的「正在生成实验设计」占位关掉，否则界面一直转圈 */
    settleStreaming(pp.messages);
    var lines = ['**实验设计没能生成出来。**', ''];
    errors.forEach(function (e) { lines.push('· ' + e); });
    if (res && res.warnings && res.warnings.length) {
      lines.push('');
      res.warnings.forEach(function (w) { lines.push('· ' + w); });
    }
    if (raw) lines.push('', '模型原始返回（前 200 字）：' + String(raw).slice(0, 200));
    lines.push('');
    lines.push('我没有拿预置设计替你填上——否则你的变量、固定效应、识别策略都会变成另一个课题的。');
    lines.push('请补充上面的信息后重新提交，或在设置里换一个能力更强的模型。');

    pp.messages = pp.messages || [];
    pp.messages.push({ role: 'assistant', at: Date.now(), text: lines.join('\n'),
                       chips: ['设计未生成'], error: true });
    S.recordDecision('实验设计生成失败', '不套用预置设计', ['套用预置设计'], errors.join('；'), 'agent');
    S.updateProject({ messages: pp.messages, stage: 'design-authoring', designRunning: false });
    renderAll();
  }

  /** 当前生效的通道：优先 demo 项目指定的，否则第一个已配置密钥的 */
  function activeProfile() {
    var st = S.get();
    var p = S.get().projects.filter(function (x) { return x.id === st.activeId; })[0];
    var want = p && p.model && p.model.provider;
    var byWant = st.providers.filter(function (x) { return x.id === want && st.credentials[x.credentialRef]; })[0];
    if (byWant) return byWant;
    return st.providers.filter(function (x) { return !!st.credentials[x.credentialRef]; })[0] || null;
  }

  function activeModel(prof) {
    var p = S.project();
    if (p && p.model && p.model.model && (prof.models || []).some(function (m) { return m.id === p.model.model; })) {
      return p.model.model;
    }
    return (prof.models && prof.models[0] && prof.models[0].id) || '';
  }

  /** 把文献库中与提问相关的片段检索出来（真实 BM25 + RRF，异常时回落朴素匹配） */
  function retrieveContext(query, limit) {
    if (!S.get().libraryLoaded) return [];
    var n = limit || 5;

    /* 优先走真实检索器：bigram BM25 + idf 加权覆盖率 + RRF 融合 */
    if (ZY.corpus) {
      try {
        if (!corpusReady) {
          ensureCorpus();
        }
        var hits = ZY.corpus.search(query, { limit: n });
        if (hits) {
          /* 真检索说没有命中，就如实返回空 —— 不要让降级逻辑把"无依据"伪装成有依据 */
          return hits.map(function (h) {
            return {
              id: h.docId, title: h.title, journal: h.journal, year: h.year,
              method: h.method || '', quote: h.quote,
              page: h.page, charRange: h.charRange,
              rrf: h.score, trust: h.trust, lowQuality: h.lowQuality
            };
          });
        }
      } catch (e) {
        /* 检索器异常不该让对话挂掉；降级并把原因记进事件流 */
        E.emit('retrieval.error', { message: String((e && e.message) || e) });
      }
    }

    var q = String(query || '');
    var terms = q.split(/[\s，,。、；;：:？?！!（）()]+/).filter(function (t) { return t.length >= 2; });
    /* 检索器不可用时的朴素兜底：真实文献与内置样例一起参与，
       不再对「数字化」额外加分（那是给示例主题开的后门，语料真实后会歪掉排序） */
    var pool = (ZY.resource && ZY.resource.allDocs) ? ZY.resource.allDocs() : D.LIBRARY;
    var scored = pool.map(function (d) {
      var hay = d.title + ' ' + d.quote + ' ' + (d.method || '') + ' ' + d.journal + ' ' + (d.keywords || '');
      var score = 0;
      terms.forEach(function (t) { if (hay.indexOf(t) >= 0) score += 2; });
      return { d: d, score: score + (d.rrf || 0) * 0.2 };
    }).sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, n).filter(function (x) { return x.score > 0; }).map(function (x) { return x.d; });
  }

  /** 组装发给模型的 messages：只带命中的片段，不整库塞入 */
  function buildMessages(p, userText) {
    var sys = [
      '你是经管论文研究助手，服务对象是第一次写经管论文的本科生与硕士生。',
      '你的任务：把学生的研究想法，推进成一篇结构完整、方法站得住的论文。',
      '',
      '必须遵守的规则：',
      '1. 只使用下面「可引用片段」里的事实。片段的编号必须原样保留在你的引用里，例如 [1]。',
      '2. 如果片段里找不到依据，明确说「此处你的文献库里没有依据」，不要编造文献、作者、期刊或数字。',
      '3. 经管论文的措辞强度必须与证据强度匹配。如果识别策略不支持因果，只能用「相关」「伴随」这类表述，禁止使用「促进、导致、使得、提高了、降低了、抑制了、驱动、带来」。',
      '4. 学生提出的识别策略不成立时，不要硬跑。直接说明「做不了 + 为什么 + 需要补什么」。',
      '5. 用中文回答，语气像一个有耐心的师兄/师姐。不要用空洞的鼓励，直接给可执行的下一步。'
    ].join('\n');

    var ctx = retrieveContext(userText, 5);
    if (ctx.length) {
      sys += '\n\n可引用片段（来自该学生自己的文献库）：\n' + ctx.map(function (d, i) {
        return '[' + (i + 1) + '] 《' + d.title + '》，' + d.journal + ' ' + d.year +
               '（' + d.method + '）：' + d.quote + ' 　【第 ' + d.page + ' 页】';
      }).join('\n');
    } else {
      sys += '\n\n可引用片段：（空）—— 该学生还没有导入相关文献，请明确告知，不要编造。';
    }

    if (p && p.rq) {
      sys += '\n\n当前研究问题：' + p.rq.claimSentence +
             '\n结论类型：' + p.rq.claimType +
             '\n当前阶段：' + (p.designConfirmed ? '实证执行' : (p.design ? '实验设计待确认' : (p.literatureDone ? '文献分析完成' : '命题解析')));
    }

    return {
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userText }
      ],
      citations: ctx
    };
  }

  /** 走真实 API 回复；失败时降级到规则回复并如实告知 */
  function realReply(p, userText, onDone) {
    var prof = activeProfile();
    if (!prof) { onDone(false); return; }
    var built = buildMessages(p, userText);

    var msg = { role: 'assistant', at: Date.now(), text: '', streaming: true, citations: built.citations };
    p.messages.push(msg);
    S.updateProject({ messages: p.messages });
    renderAll();

    var holder = ZY.llm.stream(prof, { model: activeModel(prof), messages: built.messages, temperature: 0.3 }, {
      onDelta: function (d) {
        msg.text += d;
        if (!msg._painted || Date.now() - msg._painted > 120) { msg._painted = Date.now(); renderAll(); }
      }
    });

    currentStream = holder;
    holder.promise.then(function (full) {
      currentStream = null;
      msg.streaming = false;
      msg.text = full;
      msg.modelMode = 'api:' + prof.id;
      S.updateProject({ messages: p.messages });
      E.emit('llm.response', { provider_id: prof.id, model: activeModel(prof), citation_count: built.citations.length });
      renderAll();
      onDone(true);
    }, function (e) {
      currentStream = null;
      var d = ZY.llm.describeError(e);
      msg.streaming = false;
      /* 失败必须如实显示，不能静默降级成"看起来正常"的回复 */
      msg.text = (msg.text ? msg.text + '\n\n' : '') + '⚠️ 调用失败（' + d.code + '）：' + d.message;
      msg.error = d.code;
      S.updateProject({ messages: p.messages });
      ZY.store.recordDecision('模型调用失败', d.code, ['重试', '改配置'], d.message, 'agent');
      renderAll();
      onDone(false, d);
    });
  }

  /** 占位项目：用户第一次提交研究问题时才真正落库 */
  function ensureProject(text) {
    var p = S.project();
    if (p) return p;
    p = S.addProject(text.slice(0, 20) || '未命名项目', text, 'full');
    S.setActive(p.id);
    /* 建项目之前在输入组里选的模型，这时落到项目上 */
    if (pendingModel) {
      p.model = { provider: pendingModel.provider, model: pendingModel.model };
      S.updateProject({ model: p.model });
      pendingModel = null;
    }
    return S.project();
  }

  /* ============================================================
     会话引导流程
     ============================================================ */
  /** 用户提交研究问题 */
  function handleSubmit(text) {
    text = String(text || '').trim();
    if (!text) return;
    var p = ensureProject(text);
    if (!p) return;

    p.messages = p.messages || [];
    /* 附件只留名字进消息（正文可能很大），正文单独送给模型 */
    p.messages.push({
      role: 'user', text: text, at: Date.now(),
      attachments: attachments.map(function (a) { return a.name; })
    });
    var attCtx = attachmentContext();
    /* 附件已经随这条消息交给模型，清空输入组里的挂载 */
    if (attachments.length) { attachments = []; renderAttachments(); syncComposeState(); }

    /* ============================================================
       首次提交：必须把研究问题真正抽出来
       ------------------------------------------------------------
       以前这里做的是「复制预置命题 + 只替换 phenomenon」，结果无论
       用户问什么，对象层级/时间窗/变异来源/结论类型全是"数字化转型"
       那一套 —— 这就是套壳。现在改为调用模型做结构化抽取，
       抽不出来就如实报错让用户补，绝不用预设顶上。
       ============================================================ */
    if (!p.rq) {
      S.updateProject({ messages: p.messages });
      if (realApiReady()) {
        E.emit('stage.enter', { stage_id: 'question-scoping', run_no: 1 });
        extractRqWithLlm(S.project(), attCtx ? (text + attCtx) : text);
      } else {
        /* 没配 API：不能假装识别。给出明确指引，并允许走示例流程。 */
        p.messages.push({
          role: 'assistant', at: Date.now(),
          text: '我还没有模型通道，所以**无法真正识别你的研究问题**。\n\n' +
            '以前的版本会拿一个预置命题套上去（把"数字化转型与企业创新"的对象、变量、时间窗直接填给你），' +
            '那等于假装理解了你的题目——我不打算这么干。\n\n' +
            '请点输入框左下角的模型按钮（现在显示「暂未配置模型」）→「去配置模型」，' +
            '填一个 DeepSeek / GLM / 任意 OpenAI 兼容端点的密钥，然后把你刚才的问题再发一次。\n\n' +
            '只想先看流程的话，点上面的示例卡片走演示数据。',
          chips: ['需要先配置模型', '未做研究问题识别']
        });
        S.updateProject({ messages: p.messages, stage: 'question-scoping' });
        renderAll();
      }
      return;
    }

    /* 已进入流程：配了密钥就交给真实模型，否则按阶段给规则回复 */
    if (realApiReady()) {
      realReply(p, text, function (ok) {
        if (ok) return;
        var rep = E.replyFor(p.designConfirmed ? 'stats' : (p.design ? 'design' : 'literature'), S.project());
        var pp = S.project();
        pp.messages.push({ role: 'assistant', at: Date.now(), text: rep.text, chips: rep.chips, fallback: true });
        S.updateProject({ messages: pp.messages });
        renderAll();
      });
      return;
    }

    /* 已进入流程 → 按当前阶段回应 */
    if (!p.literatureDone) {
      p.literatureDone = true;
      var rep = E.replyFor('literature', p);
      p.messages.push({ role: 'assistant', at: Date.now(), text: rep.text, chips: rep.chips });
      S.updateProject({ messages: p.messages, literatureDone: true, stage: 'evidence-mapping' });
      /* 紧接着生成实验设计 */
      setTimeout(function () { attachDesign(p.id); }, 420);
      renderAll();
      return;
    }

    if (p.design && !p.designConfirmed) {
      var rep3 = E.replyFor('design', p);
      p.messages.push({ role: 'assistant', at: Date.now(), text: rep3.text, chips: rep3.chips });
      S.updateProject({ messages: p.messages });
      renderAll();
      openGateModal();
      return;
    }

    if (p.designConfirmed && !R.isAllDone(p)) {
      var rep4 = E.replyFor(p.pipeline && p.pipeline['baseline'] && p.pipeline['baseline'].status === 'done' ? 'stats' : 'data', p);
      p.messages.push({ role: 'assistant', at: Date.now(), text: rep4.text, chips: rep4.chips });
      S.updateProject({ messages: p.messages });
      renderAll();
      return;
    }

    if (p.paper) {
      p.messages.push({ role: 'assistant', at: Date.now(),
        text: '初稿已经生成。你可以：\n· 点正文里的引用角标回跳原文\n· 点数字回到结果表对应单元格\n· 在「论文生成」页导出完整项目包（含七步三件套、拒答台账与写作说明）',
        chips: ['初稿已就绪'] });
      S.updateProject({ messages: p.messages });
      renderAll();
      return;
    }

    p.messages.push({ role: 'assistant', at: Date.now(), text: '已记录。当前流程可以进行下一步。', chips: [] });
    S.updateProject({ messages: p.messages });
    renderAll();
  }

  /** 附加实验设计（文献分析之后） */
  function attachDesign(projectId) {
    var p = E.byId ? E.byId(projectId) : null;
    if (!p) { p = S.project(); }
    if (!p || p.id !== projectId) p = S.get().projects.filter(function (x) { return x.id === projectId; })[0];
    if (!p || p.design) return;
    var design = JSON.parse(JSON.stringify(D.DESIGN));
    design.checks.forEach(function (c) { c.disposed = false; });
    p.design = design;
    p.pipeline = E.initPipeline(p);
    var rep = E.replyFor('design', p);
    p.messages = p.messages || [];
    p.messages.push({ role: 'assistant', at: Date.now(), text: rep.text, chips: rep.chips });
    E.emit('stage.enter', { stage_id: 'design-authoring', run_no: 1, mode: 'generated' });
    E.emit('artifact.write', { artifact_id: 'design-v' + design.version, type: 'ExperimentDesign', rev: design.version });
    S.updateProject({ design: design, pipeline: p.pipeline, messages: p.messages, stage: 'design-authoring', tab: 'design' });
    renderAll();
  }

  /* ============================================================
     确认门
     ============================================================ */
  function openGateModal() {
    var p = S.project();
    if (!p || !p.design) { R.toast('还没有实验设计', 'err'); return; }
    var g = E.gateCheck(p);
    var body = el('div');

    body.appendChild(el('p', {
      text: '确认后我将开始跑数据。以下是我的理解，请核对：',
      style: { marginBottom: '14px', fontFamily: 'var(--font-kai)' }
    }));

    var list = el('div.card', { style: { padding: '16px 18px' } });
    function row(ok, label, value) {
      list.appendChild(el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '7px 0', borderBottom: '1px dashed var(--line)' } }, [
        el('span', { html: ok === true ? U.ICONS.check : (ok === false ? U.ICONS.warn : U.ICONS.info),
          style: { color: ok === true ? 'var(--success)' : (ok === false ? 'var(--danger)' : 'var(--warning)'), flex: 'none', marginTop: '2px' } }),
        el('span', { style: { fontSize: '12px', fontFamily: 'var(--font-kai)' } }, [
          el('strong', { text: label + '：', style: { fontFamily: 'var(--font-sans)' } }),
          el('span', { text: value })
        ])
      ]));
    }
    row(true, '研究问题', D.RQ.claimSentence);
    row(true, '样本', D.DESIGN.sample.period + ' · ' + U.fmtInt(D.DESIGN.sample.nPlanned) + ' 个企业-年 · ' + U.fmtInt(D.DESIGN.sample.nUnits) + ' 家企业');
    row(true, '模型', D.DESIGN.model.equation.replace(/\s+/g, ' '));
    row(true, '聚类层级', D.DESIGN.model.cluster + '（' + D.DESIGN.model.clusterNote + '）');
    row(null, '说明', 'IV-01 弱工具（第一阶段 F = 6.2 < 10）→ 全文措辞锁定为"相关"，不给因果结论');
    D.DESIGN.checks.forEach(function (c) {
      if (c.status === 'fail') row(false, '⛔ ' + c.id + ' 未处置', c.label + ' —— ' + c.need);
      else if (c.status === 'unknown' && !c.disposed) row(null, '⚠️ ' + c.id + ' 信息不足', c.label + ' —— ' + c.need);
    });
    body.appendChild(list);

    var foot = [
      el('button.btn', { type: 'button', text: '返回修改', onclick: function () { closeModal(); } }),
      el('button.btn', { type: 'button', text: '导出设计方案', onclick: function () { exportDesign(); } }),
      el('button.btn.btn-primary', {
        type: 'button',
        text: g.status === 'ready' ? '确认并开始实证' : ('尚有 ' + g.blockers.length + ' 项待处置'),
        disabled: g.status !== 'ready',
        onclick: function () {
          var res = E.confirmDesign();
          closeModal();
          if (!res.ok) {
            R.toast('仍有待处置项，无法确认', 'err');
            return;
          }
          var pp = S.project();
          pp.messages.push({
            role: 'assistant', at: Date.now(),
            text: '设计已确认（hash ' + res.hash + '）。我现在开始跑数据——执行器已解锁。\n\n七步会依次执行：数据清洗 → 描述统计 → 基准回归 → 稳健性 → 内生性 → 异质性 → 机制。每一步都会产出可执行代码、结果文件和解读文件，你可以随时暂停、单独重跑或跳过。',
            chips: ['设计已确认', '开始执行']
          });
          S.updateProject({ messages: pp.messages });
          switchTab('data');
          renderAll();
          runPipeline();
        }
      })
    ];
    currentModal = R.openModal({
      title: '确认实验设计', sub: '全流程唯一硬门禁 · 未确认不读取任何数据',
      wide: true, body: body, foot: foot,
      onClose: function () { currentModal = null; }
    });
  }

  function openDisposeModal(checkId) {
    var c = ZY.checklist.byId(checkId);
    var design = S.project().design;
    var target = design.checks.filter(function (x) { return x.id === checkId; })[0];
    if (!target) return;

    var body = el('div');
    body.appendChild(el('div.banner.warn', {}, [
      el('span', { html: U.ICONS.warn, style: { marginTop: '2px' } }),
      el('div.banner-body', {}, [
        el('div.banner-title', { text: target.id + ' ' + target.label + '：' + (target.status === 'fail' ? '不通过' : '信息不足') }),
        el('div', { text: target.evidence }),
        target.need ? el('div', { style: { marginTop: '6px' } }, [el('strong', { text: '需要你补：' }), target.need]) : null
      ])
    ]));
    body.appendChild(el('p', { text: '请选择处置方式（四选一）。这一步的处置会被记录，并影响全文允许的措辞强度。', style: { marginBottom: '12px', fontFamily: 'var(--font-kai)' } }));

    var opts = [
      { key: 'add_data', label: '补数据', desc: '补一个更强的工具变量或外生冲击' },
      { key: 'switch_strategy', label: '换策略', desc: '改用其他识别策略（如政策试点 DID）' },
      { key: 'downgrade_wording', label: '降措辞', desc: '接受"相关"表述，不给因果结论' },
      { key: 'skip', label: '先不做', desc: '本项留白，并在初稿中披露' }
    ];
    var chosen = null;
    var card = el('div.card');
    opts.forEach(function (o) {
      card.appendChild(el('label.choice', {}, [
        el('input', { type: 'radio', name: 'dispose', onchange: function () { chosen = o.key; } }),
        el('span', {}, [o.label, el('span.choice-desc', { text: o.desc })])
      ]));
    });
    body.appendChild(card);

    currentModal = R.openModal({
      title: '处置检查项 ' + checkId,
      sub: c ? (c.failMsg || '') : '',
      body: body,
      foot: [
        el('button.btn', { type: 'button', text: '取消', onclick: function () { closeModal(); } }),
        el('button.btn.btn-primary', {
          type: 'button', text: '确认处置',
          onclick: function () {
            if (!chosen) { R.toast('请选择一种处置方式', 'err'); return; }
            target.disposed = true;
            if (chosen === 'downgrade_wording') target.status = 'fail'; /* 保留 fail 但已处置 */
            E.invalidateDesign('处置检查项 ' + checkId + '：' + chosen);
            S.recordDecision('处置检查项 ' + checkId, chosen, ['不处置'], target.need, 'user');
            S.updateProject({ design: S.project().design });
            closeModal();
            R.toast('已处置：' + chosen, 'ok');
            renderAll();
          }
        })
      ],
      onClose: function () { currentModal = null; }
    });
  }

  function openSkipModal(stepId) {
    var def = S.PIPELINE_STEPS.filter(function (s) { return s.id === stepId; })[0];
    var body = el('div');
    body.appendChild(el('p', { text: '跳过「' + def.label + '」会在初稿中自动披露该检验未做。请写明理由。', style: { fontFamily: 'var(--font-kai)' } }));
    var ta = el('textarea', { placeholder: '例如：本期数据缺少工具变量，等补数据后重跑', style: { width: '100%', minHeight: '80px', marginTop: '12px', padding: '10px', border: '1px solid var(--line-strong)', borderRadius: '6px', fontFamily: 'var(--font-kai)', fontSize: '13px' } });
    body.appendChild(ta);
    currentModal = R.openModal({
      title: '跳过 ' + def.label, body: body,
      foot: [
        el('button.btn', { type: 'button', text: '取消', onclick: function () { closeModal(); } }),
        el('button.btn.btn-primary', {
          type: 'button', text: '确认跳过',
          onclick: function () {
            E.skipStep(stepId, ta.value.trim() || '用户跳过（未填理由）');
            closeModal(); renderAll();
            R.toast('已跳过，并会写进初稿披露', 'ok');
          }
        })
      ],
      onClose: function () { currentModal = null; }
    });
  }

  /* ============================================================
     账号与设置（真实 API 配置）
     ============================================================ */
  function openSettings() {
    var st = S.get();
    var body = el('div');

    /* ---- 账号 ---- */
    body.appendChild(el('h3.subhead', {}, ['账号', el('span.sub-note', { text: '仅保存在本机浏览器，不上传' })]));
    var nameInput = el('input', {
      type: 'text', value: st.user.name || '', placeholder: '你的名字（用于本地标识）',
      autocomplete: 'off'
    });
    var emailInput = el('input', {
      type: 'text', value: (st.user && st.user.email) || '', placeholder: '邮箱（可选）', autocomplete: 'off'
    });
    body.appendChild(el('div.card', {}, [
      el('div.field', {}, [el('label', { text: '用户名' }), nameInput,
        el('span.field-hint', { text: '显示在左下角，仅用于本地区分是谁在用这台机器' })]),
      el('div.field', {}, [el('label', { text: '邮箱（可选）' }), emailInput]),
      el('div', { style: { display: 'flex', gap: '8px' } }, [
        el('button.btn.btn-sm.btn-primary', {
          type: 'button', text: '保存账号',
          onclick: function () {
            var n = nameInput.value.trim();
            if (!n) { R.toast('用户名不能为空', 'err'); return; }
            S.setUser({ name: n, email: emailInput.value.trim() });
            R.toast('已保存账号：' + n, 'ok');
            renderAll();
          }
        })
      ])
    ]));

    /* ---- 模型服务 ---- */
    body.appendChild(el('h3.subhead', {}, ['模型服务', el('span.sub-note', { text: 'OpenAI 兼容协议 · 配置后走真实调用' })]));
    body.appendChild(el('div.banner.info', {}, [
      el('span', { html: U.ICONS.info, style: { marginTop: '2px' } }),
      el('div.banner-body', {}, [
        el('div.banner-title', { text: '密钥只写不读' }),
        el('div', { text: '本页永不回显密钥内容。默认只存 sessionStorage（关闭标签页即失效）；勾选「记住密钥」才写入 localStorage。导出与日志都会先脱敏。' })
      ])
    ]));

    /* 单一表单：所有通道收在同一个下拉里，不再并排三张卡 */
    body.appendChild(providerForm(st));

    /* 新增自定义路由 */
    body.appendChild(el('div', { style: { marginTop: '14px' } }, [
      el('button.btn.btn-sm', {
        type: 'button', text: '＋ 添加 OpenAI 兼容路由',
        onclick: function () { closeModal(); openAddProvider(); }
      })
    ]));

    /* 凭据持久化 */
    var remember = el('label.choice', {}, [
      el('input', {
        type: 'checkbox', checked: st.rememberKeys,
        onchange: function () {
          S.setRememberKeys(this.checked);
          R.toast(this.checked ? '已开启：密钥将留在本机磁盘' : '已关闭：密钥仅本页有效', 'ok');
          openSettingsRefresh();
        }
      }),
      el('span', {}, ['记住密钥（写入 localStorage）',
        el('span.choice-desc', { text: '默认关闭。开启后密钥会留在本机磁盘直到你主动清除——现场演示需要刷新页面时有用，但会降低安全性。' })])
    ]);
    body.appendChild(el('div.card', { style: { marginTop: '14px' } }, [
      el('h3', { text: '凭据持久化' }), remember
    ]));

    currentModal = R.openModal({
      title: '账号与设置',
      sub: '用户可以在这里配置真实的模型 API',
      wide: true, body: body,
      foot: [
        el('button.btn.btn-primary', { type: 'button', text: '完成', onclick: function () { closeModal(); renderAll(); } })
      ],
      onClose: function () { currentModal = null; renderAll(); }
    });
  }

  /** 设置页当前选中的通道（仅界面状态，不写进项目数据） */
  var settingsProviderId = null;

  /** 模型服务表单：所有通道收在同一个下拉里，切换通道只换表单内容 */
  function providerForm(st) {
    var prof = st.providers.filter(function (x) { return x.id === settingsProviderId; })[0] || st.providers[0];
    var card = el('div.card');
    if (!prof) return card;
    settingsProviderId = prof.id;
    var ci = S.credentialInfo(prof.credentialRef);
    var conn = st.connTest[prof.id];

    /* 通道：DeepSeek / GLM / 自建中转全部收在这一个下拉里 */
    var channelSel = el('select', {
      onchange: function () { settingsProviderId = this.value; openSettingsRefresh(); }
    });
    st.providers.forEach(function (x) {
      channelSel.appendChild(el('option', {
        value: x.id,
        selected: x.id === prof.id ? true : null,
        text: x.displayName + (x.preset ? '（预置）' : '（自定义）')
      }));
    });
    card.appendChild(el('div.field', {}, [
      el('label', { text: '通道' }), channelSel,
      el('span.field-hint', { text: 'OpenAI 兼容协议：DeepSeek / GLM 预置通道与自建中转都在这一个下拉里选。切换通道不会丢失已保存的密钥。' })
    ]));

    /* Base URL */
    var urlInput = el('input', { type: 'text', value: prof.baseURL, autocomplete: 'off' });
    card.appendChild(el('div.field', {}, [
      el('label', { text: '基址（Base URL）' }), urlInput,
      el('span.field-hint', { text: '例如 https://api.deepseek.com/v1 — 只保留到 /v1，代码会自行拼接 /chat/completions' })
    ]));

    /* 密钥 */
    var keyInput = el('input', {
      type: 'password', autocomplete: 'off',
      placeholder: ci.configured ? '已配置（输入新值可覆盖）' : '粘贴你的 API Key'
    });
    card.appendChild(el('div.field', {}, [
      el('label', { text: 'API Key（引用名 ' + prof.credentialRef + '）' }), keyInput,
      el('span.field-hint', { text: '当前状态：' + (ci.configured ? ('已配置 · ' + ci.source) : '未配置') })
    ]));

    /* 默认模型：选中即把它提到列表首位（调用时取 models[0]） */
    var modelSel = el('select', {
      onchange: function () {
        var id = this.value;
        var pick = (prof.models || []).filter(function (x) { return x.id === id; })[0];
        if (!pick) return;
        prof.models = [pick].concat((prof.models || []).filter(function (x) { return x.id !== id; }));
        S.save(); R.toast('默认模型已设为 ' + id, 'ok'); openSettingsRefresh();
      }
    });
    (prof.models || []).forEach(function (m) { modelSel.appendChild(el('option', { value: m.id, text: m.id })); });
    card.appendChild(el('div.field', {}, [
      el('label', { text: '默认模型' }), modelSel,
      el('span.field-hint', { text: '真实调用使用列表首位的模型；在下面选一个即可把它提到首位。' })
    ]));

    /* 模型列表 */
    var modelWrap = el('div.field', {}, [el('label', { text: '模型' })]);
    (prof.models || []).forEach(function (m) {
      modelWrap.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0' } }, [
        el('span.mono', { text: m.id, style: { fontSize: '12px', flex: '1' } }),
        el('button.text-action', {
          type: 'button', text: '移除',
          onclick: function () {
            prof.models = prof.models.filter(function (x) { return x.id !== m.id; });
            S.save(); R.toast('已移除模型 ' + m.id, 'ok'); openSettingsRefresh();
          }
        })
      ]));
    });
    var newModel = el('input', { type: 'text', placeholder: '手动添加模型 id，例如 deepseek-chat', autocomplete: 'off' });
    modelWrap.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
      newModel,
      el('button.btn.btn-sm', {
        type: 'button', text: '添加',
        onclick: function () {
          var v = newModel.value.trim();
          if (!v) return;
          prof.models = prof.models || [];
          if (!prof.models.some(function (x) { return x.id === v; })) prof.models.push({ id: v, name: v });
          S.save(); R.toast('已添加模型 ' + v, 'ok'); openSettingsRefresh();
        }
      })
    ]));
    card.appendChild(modelWrap);

    /* 发现的候选模型 */
    var disc = S.get().discovered[prof.id];
    if (disc && disc.length) {
      var dw = el('div.field', {}, [
        el('label', { text: '端点发现的模型（' + disc.length + ' 个）' }),
        el('span.field-hint', { text: '发现结果只做候选，点「添加」才写入配置' })
      ]);
      var list = el('div', { style: { maxHeight: '160px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '6px', padding: '6px', marginTop: '6px' } });
      disc.slice(0, 80).forEach(function (m) {
        var exists = (prof.models || []).some(function (x) { return x.id === m.id; });
        list.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px' } }, [
          el('span.mono', { text: m.id, style: { fontSize: '11px', flex: '1', overflow: 'hidden', textOverflow: 'ellipsis' } }),
          el('span.hint', { text: m.contextWindow ? (m.contextWindow + ' ctx') : '' }),
          exists
            ? el('span.badge.ok', { text: '已添加' })
            : el('button.text-action', {
                type: 'button', text: '添加',
                onclick: function () {
                  prof.models = prof.models || [];
                  prof.models.push({ id: m.id, name: m.name || m.id, contextWindow: m.contextWindow });
                  S.save(); R.toast('已添加 ' + m.id, 'ok'); openSettingsRefresh();
                }
              })
        ]));
      });
      dw.appendChild(list);
      card.appendChild(dw);
    }

    /* 操作与结果 */
    var out = el('div', { style: { marginTop: '10px', minHeight: '20px' } });
    if (conn) out.appendChild(connBadge(conn));

    card.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } }, [
      el('button.btn.btn-sm.btn-primary', {
        type: 'button', text: '保存',
        onclick: function () {
          var u = urlInput.value.trim();
          if (!u || !/^https?:\/\//.test(u)) { R.toast('基址必须是 http(s) 开头的完整地址', 'err'); return; }
          prof.baseURL = u.replace(/\/+$/, '');
          var k = keyInput.value.trim();
          if (k) {
            var bad = ZY.llm.validateKey(k);
            if (bad) { R.toast(ZY.llm.MESSAGES[bad], 'err'); return; }
            S.setCredential(prof.credentialRef, k);
          }
          S.save();
          R.toast('已保存（密钥存于 ' + (S.get().rememberKeys ? 'localStorage' : 'sessionStorage') + '）', 'ok');
          openSettingsRefresh();
        }
      }),
      el('button.btn.btn-sm', {
        type: 'button', text: '清除密钥',
        onclick: function () {
          S.clearCredential(prof.credentialRef);
          R.toast('已清除该通道的密钥', 'ok');
          openSettingsRefresh();
        }
      }),
      el('button.btn.btn-sm', {
        type: 'button', text: '测试连接',
        onclick: function () {
          U.clear(out);
          out.appendChild(el('span.hint', { text: '正在发起真实请求…' }));
          ZY.llm.testConnection(prof).then(function (res) {
            S.get().connTest[prof.id] = { status: 'ok', latencyMs: res.latencyMs, text: '已连通 · ' + res.model + ' 可用', at: Date.now() };
            S.save();
            U.clear(out); out.appendChild(connBadge(S.get().connTest[prof.id]));
          }, function (e) {
            var d = ZY.llm.describeError(e);
            S.get().connTest[prof.id] = { status: 'err', code: d.code, text: d.message, detail: d.detail, at: Date.now() };
            S.save();
            U.clear(out); out.appendChild(connBadge(S.get().connTest[prof.id]));
          });
        }
      }),
      el('button.btn.btn-sm', {
        type: 'button', text: '获取可用模型',
        onclick: function () {
          U.clear(out);
          out.appendChild(el('span.hint', { text: '正在请求 /models…' }));
          ZY.llm.listModels(prof).then(function (list) {
            S.get().discovered[prof.id] = list;
            S.save();
            U.clear(out);
            out.appendChild(el('span.badge.ok', { text: '发现 ' + list.length + ' 个候选模型' }));
            R.toast('发现 ' + list.length + ' 个模型，请点「添加」写入配置', 'ok');
            openSettingsRefresh();
          }, function (e) {
            var d = ZY.llm.describeError(e);
            U.clear(out);
            out.appendChild(el('span.badge.err', { text: d.code + '：' + d.message }));
          });
        }
      })
    ]));
    card.appendChild(out);

    /* 删除自定义路由 */
    if (!prof.preset) {
      card.appendChild(el('div', { style: { marginTop: '10px', textAlign: 'right' } }, [
        el('button.text-action', {
          type: 'button', text: '删除该路由',
          onclick: function () {
            var st = S.get();
            st.providers = st.providers.filter(function (x) { return x.id !== prof.id; });
            S.save(); R.toast('已删除路由 ' + prof.displayName, 'ok'); openSettingsRefresh();
          }
        })
      ]));
    }
    return card;
  }

  function connBadge(conn) {
    if (conn.status === 'ok') {
      return el('span.badge.ok', { text: '已连通 · ' + conn.latencyMs + 'ms · ' + conn.text });
    }
    var cls = conn.code === 'TRANSPORT' ? '.warn' : '.err';
    return el('span.badge' + cls, { text: conn.code + '：' + conn.text, title: conn.detail || '' });
  }

  /** 新增自定义 OpenAI 兼容路由 */
  function openAddProvider() {
    var idInput = el('input', { type: 'text', placeholder: '路由名，小写字母与短横线，如 my-gateway', autocomplete: 'off' });
    var urlInput = el('input', { type: 'text', placeholder: 'https://gateway.example.com/v1', autocomplete: 'off' });
    var modelInput = el('input', { type: 'text', placeholder: '默认模型 id，如 qwen3-max', autocomplete: 'off' });
    var body = el('div');
    body.appendChild(el('div.banner.info', {}, [
      el('span', { html: U.ICONS.info, style: { marginTop: '2px' } }),
      el('div.banner-body', {}, [el('div', { text: '路由名会被用来派生凭据引用名（大写＋下划线）。所有字段之后都可以在设置里修改。' })])
    ]));
    body.appendChild(el('div.field', {}, [el('label', { text: '路由名' }), idInput]));
    body.appendChild(el('div.field', {}, [el('label', { text: '基址（Base URL）' }), urlInput]));
    body.appendChild(el('div.field', {}, [el('label', { text: '默认模型 id' }), modelInput]));

    currentModal = R.openModal({
      title: '添加 OpenAI 兼容路由',
      sub: '适用于任何实现了 /chat/completions 的端点（含中转网关、自建服务）',
      body: body,
      foot: [
        el('button.btn', { type: 'button', text: '取消', onclick: function () { closeModal(); openSettings(); } }),
        el('button.btn.btn-primary', {
          type: 'button', text: '创建',
          onclick: function () {
            var id = idInput.value.trim().toLowerCase();
            var url = urlInput.value.trim();
            var model = modelInput.value.trim();
            if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) { R.toast('路由名格式不对：小写字母开头，可含数字与短横线', 'err'); return; }
            if (!/^https?:\/\//.test(url)) { R.toast('基址必须是 http(s) 完整地址', 'err'); return; }
            if (!model) { R.toast('请填写至少一个模型 id', 'err'); return; }
            var st = S.get();
            if (st.providers.some(function (x) { return x.id === id; })) { R.toast('路由名已存在', 'err'); return; }
            st.providers.push({
              id: id, displayName: id, protocol: 'openai-chat',
              baseURL: url.replace(/\/+$/, ''),
              credentialRef: id.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY',
              preset: false, models: [{ id: model, name: model }]
            });
            S.save();
            R.toast('已创建路由 ' + id + '，请填入 API Key 并测试连接', 'ok');
            closeModal(); openSettings();
          }
        })
      ],
      onClose: function () { currentModal = null; }
    });
  }

  function openSettingsRefresh() {
    if (currentModal) currentModal.close();
    openSettings();
  }

  /* ============================================================
     真实导入：PDF 文献 / CSV 数据
     ============================================================ */
  /** 打开文件选择框 */
  function pickFiles(isLib) {
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = isLib ? '.pdf,.txt,.md' : '.csv,.txt';
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (files.length) ingestFiles(files, isLib, null);
    });
    input.click();
  }

  /** 选择本地文件夹（需要 File System Access API） */
  function pickFolder(isLib) {
    if (!window.showDirectoryPicker) {
      R.toast('这个浏览器不支持「选择本地文件夹」，请改用上传；两者能力等价', 'err');
      return;
    }
    window.showDirectoryPicker().then(function (dir) {
      return collectFromDirectory(dir, isLib);
    }).then(function (files) {
      if (!files.length) { R.toast('该文件夹里没有可用的' + (isLib ? 'PDF/TXT' : 'CSV') + '文件', 'err'); return; }
      ingestFiles(files, isLib, null);
    }, function (e) {
      /* 用户取消不算错误 */
      if (e && e.name === 'AbortError') return;
      R.toast('读取文件夹失败：' + ((e && e.message) || e), 'err');
    });
  }

  function collectFromDirectory(dir, isLib) {
    var out = [];
    var exts = isLib ? ['.pdf', '.txt', '.md'] : ['.csv', '.txt'];
    function walk(handle, depth) {
      if (depth > 3) return Promise.resolve();
      var it = handle.values();
      var chain = Promise.resolve();
      var next = function () {
        return it.next().then(function (r) {
          if (r.done) return;
          var h = r.value;
          if (h.kind === 'file') {
            var lower = h.name.toLowerCase();
            if (exts.some(function (x) { return lower.endsWith(x); })) {
              return h.getFile().then(function (f) { out.push(f); });
            }
            return;
          }
          if (h.kind === 'directory') return walk(h, depth + 1);
        }).then(next);
      };
      return chain.then(next);
    }
    return walk(dir, 0).then(function () { return out; });
  }

  /** 统一入口：判类型、解析、入库 */
  function ingestFiles(files, isLib, statusEl) {
    var setStatus = function (t) { if (statusEl) statusEl.textContent = t; };
    if (isLib) {
      setStatus('正在解析 ' + files.length + ' 个文件…');
      ingestDocuments(files, setStatus);
    } else {
      setStatus('正在读取 CSV…');
      ingestPanel(files, setStatus);
    }
  }

  /** 文献入库：PDF → 文本 → 真实检索索引 */
  function ingestDocuments(files, setStatus) {
    if (!ZY.corpus) { R.toast('检索模块未加载', 'err'); return; }
    var texts = [];
    var collect = Promise.resolve();

    files.forEach(function (f) {
      collect = collect.then(function () {
        var lower = f.name.toLowerCase();
        if (lower.endsWith('.pdf')) {
          return readArrayBuffer(f).then(function (buf) {
            return ZY.pdftext.extract(buf, { name: f.name }).then(function (res) {
              if (!res || !res.ok) {
                /* 解析失败必须如实报告，不静默跳过 */
                texts.push({ file: f.name, ok: false, message: (res && res.message) || '解析失败' });
                return;
              }
              texts.push({
                file: f.name, ok: true, pages: res.pages, diag: res.diag,
                via: res.parse && res.parse.via
              });
            });
          });
        }
        return readText(f).then(function (t) {
          texts.push({
            file: f.name, ok: true,
            pages: [{ pageNo: 1, text: t, chars: t.length }],
            diag: ZY.pdftext.diagnose ? ZY.pdftext.diagnose([{ pageNo: 1, text: t }]) : null,
            via: 'plain-text'
          });
        });
      });
    });

    collect.then(function () {
      var okCount = 0, failCount = 0, chunkCount = 0;
      var newly = [];
      texts.forEach(function (t) {
        if (!t.ok) { failCount++; return; }
        var full = (t.pages || []).map(function (p) { return p.text; }).join('\n');
        if (!full.trim()) { failCount++; return; }
        var doc = {
          id: 'imp-' + U.hash32(t.file + ':' + full.length),
          title: t.file.replace(/\.(pdf|txt|md)$/i, ''),
          journal: '（本地导入）', year: new Date().getFullYear(),
          method: '—', importSource: 'local-upload',
          pages: t.pages, diag: t.diag, via: t.via
        };
        var added = ZY.corpus.addDocument(doc, { imported: true });
        okCount++;
        chunkCount += (added && added.chunks ? added.chunks.length : 1);
        newly.push(doc.id);
      });

      /* 记住导入的文献，刷新后可恢复索引 */
      if (newly.length) {
        var st = S.get();
        st.importedDocs = (st.importedDocs || []).concat(newly.map(function (id) {
          var d = texts.filter(function (x) { return x.ok; });
          return id;
        }));
        st.importedDocs = st.importedDocs.filter(function (v, i, a) { return a.indexOf(v) === i; });
        st.libraryLoaded = true;
        S.save();
      }

      var msg = '成功 ' + okCount + ' 篇（' + chunkCount + ' 个块）' +
        (failCount ? ('，失败 ' + failCount + ' 篇') : '');
      if (setStatus) setStatus(msg);
      R.toast('文献入库：' + msg, okCount ? 'ok' : 'err');

      var failed = texts.filter(function (t) { return !t.ok; });
      if (failed.length) {
        /* 失败原因逐条列出，用户才知道该补什么 */
        var body = el('div');
        body.appendChild(el('p', { text: '以下文件没能入库，原因如下：' }));
        var card = el('div.card');
        failed.forEach(function (t) {
          card.appendChild(el('div', { style: { padding: '8px 0', borderBottom: '1px dashed var(--line)' } }, [
            el('strong', { text: t.file, style: { fontSize: '12px' } }),
            el('div', { text: t.message, style: { fontSize: '12px', color: 'var(--danger)', fontFamily: 'var(--font-kai)' } })
          ]));
        });
        body.appendChild(card);
        currentModal = R.openModal({
          title: '部分文件未能解析', sub: '共 ' + failed.length + ' 个', body: body,
          foot: [el('button.btn.btn-primary', { type: 'button', text: '知道了', onclick: function () { closeModal(); } })],
          onClose: function () { currentModal = null; }
        });
      }
      renderAll();
    });
  }

  /** 数据入库：真实 CSV 解析 + 面板识别，供计量引擎使用 */
  function ingestPanel(files, setStatus) {
    var f = files[0];
    readText(f).then(function (text) {
      var tbl = ZY.econ.csvToTable(text, { maxRows: 200000 });
      if (!tbl.ok) {
        R.toast('CSV 解析失败：' + tbl.message, 'err');
        if (setStatus) setStatus('解析失败');
        return;
      }
      /* 转成行对象数组：计量引擎按变量名取列 */
      var rows = [];
      for (var i = 0; i < tbl.cols[0].values.length; i++) {
        var row = {};
        tbl.cols.forEach(function (c) { row[c.name] = c.values[i]; });
        rows.push(row);
      }
      var panel = ZY.econ.detectPanel(tbl.cols);

      var st = S.get();
      st.importedPanel = {
        label: f.name, names: tbl.names, rows: rows,
        nRows: tbl.nRows, truncated: tbl.truncated,
        panel: panel, missing: tbl.cols.map(function (c) { return { name: c.name, missing: c.missing, type: c.type }; })
      };
      st.datasetLoaded = true;
      S.save();

      var msg = f.name + '：' + U.fmtInt(tbl.nRows) + ' 行 × ' + tbl.names.length + ' 列';
      if (setStatus) setStatus(msg);
      R.toast('数据入库：' + msg + (panel.ok ? ('；' + panel.message) : ''), 'ok');

      /* 面板识别不上时必须告知，否则用户会以为后面能跑 */
      if (!panel.ok) {
        R.toast('未能识别面板结构：' + panel.message + '。可先做描述统计与截面回归。', 'err');
      }
      renderAll();
    }, function (e) {
      R.toast('读取失败：' + ((e && e.message) || e), 'err');
    });
  }

  function readText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(fr.error || new Error('读取失败')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  function readArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('读取失败')); };
      fr.readAsArrayBuffer(file);
    });
  }

  /** 重新生成实验设计（基于当前 RQ；失败则停下，不套预设） */
  function regenerateDesign() {
    var p = S.project();
    if (!p || !p.rq) { R.toast('还没有研究问题，无法生成设计', 'err'); return; }
    if (!realApiReady()) { R.toast('需要先配置模型通道', 'err'); openSettings(); return; }
    if (p.designConfirmed) {
      R.toast('设计已确认，重新生成会使其失效', 'err');
    }
    /* 重新生成前先让旧确认失效，避免"设计已换但确认还在" */
    if (p.designConfirmed) E.invalidateDesign('重新生成实验设计');
    generateDesignWithLlm(p, '');
  }

  /** 按当前研究问题重新做一次文献检索（文献分析页的"开始检索/重新检索"按钮） */
  function runLiterature() {
    var p = S.project();
    if (!p) { R.toast('还没有项目', 'err'); return; }
    if (!p.rq) { R.toast('还没有研究问题，请先在对话区提交', 'err'); return; }
    switchTab('literature');
    literatureAndDesign(p.id);
  }

  /* ============================================================
     资源库页面 / 引用抽屉
     ============================================================ */
  /** 资源库：在成果区显示对应页面（不再使用抽屉）；收起状态会自动展开 */
  function openResourcePage(kind) {
    S.openResourcePage(kind);
    /* 资源库页面属于成果区内容：若成果区处于收起状态，先自动展开 */
    if (S.uiPrefs().resultsCollapsed) S.setUiPrefs({ resultsCollapsed: false });
    renderAll();
    var label = kind === 'library' ? '文献库' : '数据库';
    R.toast('已在右侧打开' + label);
  }

  function closeResourcePage() {
    S.closeResourcePage();
    renderAll();
  }


  function openSource(docId) {
    var doc = ZY.stages.literature.docOf(docId);
    if (!doc || !doc.title) { R.toast('找不到该文献', 'err'); return; }
    var isReal = doc.source === 'real';
    var body = el('div');
    body.appendChild(el('div.card', {}, [
      el('h3', { text: doc.title }),
      isReal ? el('div.meta-row', {}, [el('span', { text: '来源' }), el('strong', {}, [
        el('span.badge.ok', { text: '真实文献' }),
        doc.tag ? el('span.hint', { text: '　' + doc.tag }) : null
      ])]) : null,
      el('div.meta-row', {}, [el('span', { text: '作者' }), el('strong', { text: doc.authors || '未标注' })]),
      el('div.meta-row', {}, [el('span', { text: '期刊 / 年份' }), el('strong', {
        text: (doc.journal || '期刊未标注') + ' · ' + (doc.year == null ? '年份未标注' : doc.year)
      })]),
      isReal ? null : el('div.meta-row', {}, [el('span', { text: '识别策略' }), el('strong', { text: doc.method || '—' })]),
      el('div.meta-row', {}, [el('span', { text: '文件' }), el('strong', { html: '<span class="mono" style="font-size:11px">' + U.escapeHtml(doc.file || '—') + '</span>' })]),
      el('div.meta-row', {}, [el('span', { text: '定位' }), el('strong', {
        text: (doc.page == null ? '页号未标注' : '第 ' + doc.page + ' 页') +
          (doc.charRange ? ' · 字符 ' + doc.charRange[0] + '–' + doc.charRange[1] : '')
      })]),
      isReal ? null : el('div.meta-row', {}, [el('span', { text: '融合分（RRF）' }), el('strong', {
        text: doc.rrf == null ? '—' : doc.rrf.toFixed(2)
      })])
    ]));

    body.appendChild(el('h3.subhead', {}, ['可引用片段']));
    body.appendChild(el('div.card', {}, [
      el('p', { text: '「' + doc.quote + '」', style: { color: 'var(--ink)', fontSize: '14px' } }),
      el('div.divider'),
      el('p.hint', {
        text: '来源：' + (doc.file || '—') +
          (doc.page == null ? '' : ' · 第 ' + doc.page + ' 页') +
          (doc.charRange ? ' · 字符区间 ' + doc.charRange[0] + '–' + doc.charRange[1] : '') +
          (isReal && doc.charRange ? ' · 可用「原文切片 = 摘录」逐字核验' : '')
      })
    ]));

    if (isReal && doc.readable === false) {
      body.appendChild(el('div.banner.warn', {}, [
        el('span', { html: U.ICONS.warn, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div.banner-title', { text: '该篇文本层不可用' }),
          el('div', { text: 'PDF 字体没有嵌入 ToUnicode 映射，抽出来的是字形码而不是文字。它可以被"提及"，但任何原句引用都不可信 —— 所以这里不给摘录。' })
        ])
      ]));
    }

    body.appendChild(el('h3.subhead', {}, ['解析质量诊断']));
    body.appendChild(el('div.card', {}, [
      el('p.hint', {
        text: isReal
          ? '以下数值由该 PDF 的**真实逐页文本**算出（不是声明值）。'
          : '以下数值为内置样例的声明值，仅用于演示。'
      }),
      el('div.deflist', {}, [
        el('dt', { text: '文本覆盖率' }), el('dd', { text: doc.coverage == null ? '未计算' : (doc.coverage * 100).toFixed(1) + '%' }),
        el('dt', { text: '乱码率' }), el('dd', { text: doc.mojibake == null ? '未计算' : (doc.mojibake * 100).toFixed(2) + '%' }),
        el('dt', { text: '是否扫描件' }), el('dd', { text: doc.scanned == null ? '未计算' : (doc.scanned ? '是（未做 OCR）' : '否') }),
        el('dt', { text: '双栏风险' }), el('dd', { text: doc.twoCol ? (doc.twoCol === 'high' ? '高（阅读顺序可能错乱）' : (doc.twoCol === 'none' ? '无' : doc.twoCol)) : '未计算' }),
        isReal ? el('dt', { text: '总页数' }) : null,
        isReal ? el('dd', { text: String(doc.nPages || 0) + ' 页 · ' + String(doc.chars || 0) + ' 字' }) : null,
        el('dt', { text: '质量等级' }), el('dd', {}, [
          el('span.badge' + (doc.trust === 'high' ? '.ok' : doc.trust === 'medium' ? '.warn' : '.err'), {
            text: doc.trustLabel || (doc.trust === 'high' ? '可引用' : doc.trust === 'medium' ? '需人工核对' : '仅可提及，不可引用原句')
          })
        ])
      ])
    ]));

    if (doc.trust !== 'high' && !(isReal && doc.readable === false)) {
      body.appendChild(el('div.banner.warn', {}, [
        el('span', { html: U.ICONS.warn, style: { marginTop: '2px' } }),
        el('div.banner-body', {}, [
          el('div', { text: doc.trust === 'low'
            ? '该篇为扫描件/乱码，文本层不可靠。它可以被"提及"，但原句引用必须带「解析质量低·请人工核对」徽标。'
            : '该篇解析质量中等，引用页码与原文措辞建议人工核对后再写入正文。' })
        ])
      ]));
    }

    R.openDrawer({ title: '文献出处', sub: (doc.journal || '期刊未标注') + ' ' + (doc.year == null ? '' : doc.year), body: body });
  }

  /** 打开一份真实的方法证据（do 代码 / 回归日志 / 结果文件） */
  function openArtifact(rel) {
    var RES = ZY.resource;
    var a = RES && RES.artifacts ? RES.artifacts().filter(function (x) { return x.rel === rel; })[0] : null;
    if (!a) { R.toast('找不到该文件', 'err'); return; }
    var body = el('div');
    body.appendChild(el('div.card', {}, [
      el('h3', { text: a.file }),
      el('div.meta-row', {}, [el('span', { text: '类型' }), el('strong', { text: a.ext })]),
      el('div.meta-row', {}, [el('span', { text: '所属' }), el('strong', { text: RES.pkgOf(a.rel) })]),
      el('div.meta-row', {}, [el('span', { text: '路径' }), el('strong', { html: '<span class="mono" style="font-size:11px">' + U.escapeHtml(a.rel) + '</span>' })]),
      el('div.meta-row', {}, [el('span', { text: '字符数' }), el('strong', { text: U.fmtInt(a.chars) })])
    ]));
    body.appendChild(el('h3.subhead', {}, ['内容']));
    body.appendChild(el('div.card', {}, [
      el('pre.artifact-pre', { text: String(a.text || '').slice(0, 20000) })
    ]));
    if (String(a.text || '').length > 20000) {
      body.appendChild(el('p.hint', { text: '内容较长，以上只显示前 20000 字符。' }));
    }
    R.openDrawer({ title: '方法证据', sub: a.file, body: body, wide: true });
  }

  function switchTab(tabId) {
    var p = S.project();
    if (!p) return;
    S.get().resourcePage = null;   /* 切换阶段页签即退出资源库页面 */
    /* 门禁未过时，禁止进入数据之后的页签（给出解释而非静默） */
    var order = ['definition', 'literature', 'design', 'data', 'stats', 'paper'];
    if (order.indexOf(tabId) > 2 && p.design && !p.designConfirmed) {
      R.toast('实验设计尚未确认，数据与统计阶段锁定', 'err');
      tabId = 'design';
    }
    if (order.indexOf(tabId) > 3 && (!p.pipeline || !p.pipeline['baseline'] || p.pipeline['baseline'].status !== 'done')) {
      if (tabId === 'paper' && !p.paper) { R.toast('实证尚未完成，可先生成初稿但会披露未做项', 'err'); }
    }
    S.updateProject({ tab: tabId });
    renderAll();
  }

  function selectProject(id) {
    S.setActive(id);   /* setActive 内部会退出资源库页面 */
    renderAll();
  }

  function startDemo(demoId) {
    var dp = D.DEMO_PROJECTS.filter(function (x) { return x.id === demoId; })[0];
    if (!dp) return;

    /* 真实课题示例：没有模型通道就**什么都不建**。
       这里刻意不提供「演示数据兜底」——它的全部价值就是真跑一遍，
       用假数据把它演出来等于骗人。只提示去接入，并保留用户原来的位置。 */
    if (dp.requiresApi && !realApiReady()) {
      S.setActive(null);
      renderAll();
      var host = U.$('#demo-cards');
      if (host) {
        var old = U.$('#demo-api-hint');
        if (old) old.parentNode.removeChild(old);
        var hint = el('div.demo-api-hint', { id: 'demo-api-hint' }, [
          el('div.dah-title', { text: '「' + dp.title + '」需要先接入模型 API' }),
          el('div.dah-body', {
            text: '这个示例要用真实文献库与真实数据目录，从命题解析、实验设计到七步实证都由模型完成，' +
              '没有本地兜底数据可用 —— 所以必须先接入模型 API。' +
              '填一个 DeepSeek / GLM / 任意 OpenAI 兼容端点的密钥即可运行。'
          }),
          el('div.dah-actions', {}, [
            el('button.btn.btn-sm.btn-primary', {
              type: 'button', text: '去配置模型',
              onclick: function () { openSettings(); }
            }),
            el('button.btn.btn-sm', {
              type: 'button', text: '先看别的示例',
              onclick: function () { ZY.app.startDemo('demo-main'); }
            })
          ])
        ]);
        host.parentNode.insertBefore(hint, host.nextSibling);
      }
      R.toast('这个示例需要先接入模型 API', 'err');
      return;
    }

    var exist = S.get().projects.filter(function (p) { return p.id === demoId; })[0];
    if (exist) {
      /* 已存在则直接进入；若从未开始过（无消息），补回引导卡，避免出现空对话 */
      if (!exist.messages || !exist.messages.length) {
        exist.messages = [buildIntro(dp)];
        S.updateProject({ messages: exist.messages });
      }
      S.setActive(demoId);
      renderAll();
      return;
    }

    var p = S.blankProject(dp.id, dp.title, dp.topic, dp.scenario);
    if (pendingModel) {
      p.model = { provider: pendingModel.provider, model: pendingModel.model };
      pendingModel = null;
    }
    p.messages = [buildIntro(dp)];
    if (dp.scenario === 'reader') {
      p.tab = 'literature';
      p.literatureDone = true;
    } else if (dp.scenario === 'live') {
      p.tab = 'chat';
    }

    S.get().projects.unshift(p);
    S.setActive(p.id);
    S.updateProject({ messages: p.messages, tab: p.tab, design: p.design, pipeline: p.pipeline, literatureDone: p.literatureDone });
    renderAll();

    /* 真实课题示例：把命题真的交给模型去解析。
       不预填 RQ、不预置设计 —— 走的就是用户自己打字按回车的那条路。 */
    if (dp.scenario === 'live') {
      setTimeout(function () { handleSubmit(dp.topic); }, 260);
    }
  }

  /** 示例项目的首条引导消息 */
  function buildIntro(dp) {
    if (dp.scenario === 'full') {
      return {
        role: 'assistant', at: Date.now(),
        text: '这是一个完整流程示例。你可以直接点「运行示例流程」，或自己输入研究问题重跑一遍。\n\n示例研究：' + dp.topic + '\n\n我会依次完成：命题解析 → 文献检索 → 实验设计（等你确认）→ 七步实证 → 论文初稿。',
        chips: ['示例数据已就绪'],
        ask: {
          title: '如何开始？',
          options: [
            { key: 'run', label: '运行示例流程', icon: 'play', desc: '用预置命题从命题解析一路跑到论文初稿（推荐）' },
            { key: 'own', label: '我想用自己的研究问题', icon: 'edit', desc: '在下方输入框直接输入，我会重新解析并检索' }
          ]
        }
      };
    }
    if (dp.scenario === 'reader') {
      return {
        role: 'assistant', at: Date.now(),
        text: '文献解读模式。点任意一篇文献可以查看结构化解读卡：研究问题 / 数据与样本 / 识别策略 / 核心结论 / 局限 / 可借鉴点，每个字段都带出处。',
        chips: ['文献解读']
      };
    }
    if (dp.scenario === 'live') {
      var rs = (ZY.resource && ZY.resource.stats) ? ZY.resource.stats() : null;
      var libLine = rs
        ? ('文献库里现在有 ' + rs.total + ' 篇可检索（真实文献 ' + rs.real + ' 篇 / 内置样例 ' + rs.samples + ' 篇，共 ' +
           rs.pages + ' 页），数据目录里有 ' + rs.datasets + ' 个真实数据文件。')
        : '文献库与数据目录已载入。';
      return {
        role: 'assistant', at: Date.now(),
        text: '这个示例用**真实**文献库与**真实**数据目录跑，不套预置结果。\n\n' + libLine +
          '\n\n研究问题：' + dp.topic + '\n\n' +
          '接下来我会：命题解析 → 在你自己的文献库里检索证据（命中片段带页号与字符区间，可逐条核验）→ ' +
          '给出实验设计并等你确认 → 七步实证 → 论文初稿。\n\n' +
          '每一步的结论都只能引用检索到的原文；库里没有依据的地方我会直接说「没有依据」，不编文献。',
        chips: ['真实文献库', '真实数据目录', '引用可核验']
      };
    }
    return {
      role: 'assistant', at: Date.now(),
      text: '这是一个完整流程示例。你可以直接点「运行示例流程」，或自己输入研究问题重跑一遍。\n\n示例研究：' + dp.topic + '\n\n我会依次完成：命题解析 → 文献检索 → 实验设计（等你确认）→ 七步实证 → 论文初稿。',
      chips: ['示例数据已就绪']
    };
  }

  function answerAsk(msg, opt) {
    var p = S.project();
    if (!p) return;
    /* 记录已选，卡片进入已选态：选项变灰、选中项高亮，避免重复点击 */
    if (msg && msg.ask) msg.ask.answered = opt.key;
    if (opt.key === 'run') {
      p.messages.push({ role: 'user', text: '运行示例流程', at: Date.now() });
      S.updateProject({ messages: p.messages });
      runDemoFlow();
    } else {
      p.messages.push({ role: 'user', text: '我要用自己的研究问题', at: Date.now() });
      S.updateProject({ messages: p.messages });
      U.$('#prompt').focus();
      renderAll();
    }
  }

  /* ============================================================
     示例流程：从预置命题一路跑到论文初稿
     仅「运行示例流程」走这里。真实用户问题走 handleSubmit 的真实链路。
     ============================================================ */

  /**
   * 示例流程专用：把设计里未处置的 fail 项按「降措辞」处置掉，让门禁放行。
   * 只写 disposed，不改 status —— deriveWording 读的是 status，
   * 所以放行之后全文允许的措辞强度仍然是"相关"，不会凭空升级成因果。
   */
  function demoDisposeBlockers(p) {
    var hit = [];
    (((p || {}).design || {}).checks || []).forEach(function (c) {
      if (c.status === 'fail' && !c.disposed) {
        c.disposed = true;
        hit.push(c.id + ' ' + c.label);
        S.recordDecision('处置检查项 ' + c.id, '示例流程：降措辞（接受“相关”表述）',
          ['补数据', '换策略', '先不做'], c.need, 'system');
      }
    });
    if (hit.length) S.updateProject({ design: p.design });
    return hit;
  }

  function runDemoFlow() {
    if (running) { R.toast('流程正在执行中', 'err'); return; }
    var p = S.project();
    if (!p) return;

    /* 1. 命题解析 —— 示例流程使用预置命题（已在项目里的真实 RQ 不会被覆盖） */
    if (!p.rq) {
      p.rq = JSON.parse(JSON.stringify(D.RQ));
      var r0 = E.replyFor('definition', p);
      p.messages.push({ role: 'assistant', at: Date.now(), text: r0.text, chips: r0.chips });
      S.updateProject({ rq: p.rq, messages: p.messages, stage: 'question-scoping' });
      renderAll();
    }

    /* 2. 文献分析 → 3. 实验设计 → 4. 自动过设计门 → 5. 七步实证 → 6. 论文初稿
       每步之间留一帧渲染时间，让阶段推进看得见。 */
    setTimeout(function () {
      var q = S.project();
      if (!q) return;
      q.literatureDone = true;
      var r1 = E.replyFor('literature', q);
      q.messages.push({ role: 'assistant', at: Date.now(), text: r1.text, chips: r1.chips });
      S.updateProject({ messages: q.messages, literatureDone: true, stage: 'evidence-mapping' });
      renderAll();

      setTimeout(function () {
        var q1 = S.project();
        if (!q1) return;
        attachDesign(q1.id);

        setTimeout(function () {
          /* 设计门是全流程唯一硬门禁：示例设计里 IV-01（弱工具，F=6.2）不通过，
             门禁会拦住不放行。真实流程停下来等在门禁弹窗里逐项处置；
             示例流程按推荐方式代处置（降措辞），但**不修改 status**，
             所以全文措辞强度仍被锁在"相关"，不会因为放行就冒出因果结论。 */
          var q1b = S.project();
          if (!q1b) return;
          var disposed = demoDisposeBlockers(q1b);
          var g = E.confirmDesign();
          if (!g || !g.ok) {
            R.toast('示例设计未通过确认门，请在弹窗中查看原因', 'err');
            openGateModal();
            return;
          }
          var q2 = S.project();
          q2.messages.push({
            role: 'assistant', at: Date.now(),
            text: (disposed.length
                ? '设计门拦下了 ' + disposed.length + ' 项不通过：' + disposed.join('；')
                  + '。示例流程代你按推荐方式处置——降措辞，全文只写"相关"，不给因果结论。'
                  + '（真实流程会停在这里，等你在门禁弹窗里逐项选择处置方式。）'
                : '设计门直接通过。')
              + '接下来依次跑完七步实证，最后生成论文初稿。',
            chips: ['设计已确认']
          });
          S.updateProject({ messages: q2.messages });
          renderAll();
          setTimeout(runDemoSteps, 500);
        }, 800);
      }, 700);
    }, 700);
  }

  /** 示例流程：跑完剩余七步，然后生成论文初稿 */
  function runDemoSteps() {
    var p = S.project();
    if (!p) { running = false; return; }
    running = true;
    switchTab('stats');
    E.runRest(firstPending(p), function (st) {
      renderAll();
      if (st !== null) return;
      running = false;
      var pp = S.project();
      if (!pp) return;
      var r = E.replyFor('stats', pp);
      pp.messages.push({ role: 'assistant', at: Date.now(), text: r.text, chips: r.chips });
      S.updateProject({ messages: pp.messages });
      renderAll();
      setTimeout(function () {
        generatePaper();
        R.toast('示例流程已跑完全部阶段，论文初稿已生成', 'ok');
      }, 600);
    });
  }

  /* ============================================================
     流水线执行
     ============================================================ */
  function runPipeline() {
    var p = S.project();
    if (!p) return;
    if (!p.designConfirmed) { openGateModal(); return; }
    if (running) { R.toast('流水线正在执行中', 'err'); return; }
    running = true;
    switchTab('stats');
    E.runRest(firstPending(p), function (st, ratio) {
      renderAll();
      if (st === null) {
        running = false;
        var pp = S.project();
        pp.messages.push({ role: 'assistant', at: Date.now(), text: E.replyFor('stats', pp).text, chips: E.replyFor('stats', pp).chips });
        S.updateProject({ messages: pp.messages });
        R.toast('七步实证全部完成，可以生成论文初稿了', 'ok');
        renderAll();
      }
    });
  }

  function firstPending(p) {
    for (var i = 0; i < S.PIPELINE_STEPS.length; i++) {
      var st = p.pipeline[S.PIPELINE_STEPS[i].id];
      if (st && st.status !== 'done') return S.PIPELINE_STEPS[i].id;
    }
    return 'data-prep';
  }

  function runStep(stepId) {
    if (running) { R.toast('流水线正在执行中', 'err'); return; }
    running = true;
    S.get().activeStep = stepId;
    E.runStep(stepId, function () { renderAll(); }).then(function (st) {
      running = false;
      renderAll();
      var q = st.quality;
      if (q && !q.pass) { R.toast('质量门未通过：' + q.reason, 'err'); }
      else { R.toast('「' + st.label + '」完成，三件套已生成', 'ok'); }
    }, function (err) {
      running = false;
      renderAll();
      R.toast(err.message || '执行被拒绝', 'err');
    });
  }

  function rerunStep(stepId) {
    E.resetStep(stepId);
    setTimeout(function () { runStep(stepId); }, 120);
  }

  function downloadStep(stepId) {
    var files = ['code', 'result', 'interpret'];
    var nameOf = {
      code: E.codeFileName(stepId),
      result: E.resultFileName(stepId),
      interpret: E.interpretFileName(stepId)
    };
    var out = ['# ' + stepId + ' · 三件套导出', ''];
    files.forEach(function (k) {
      out.push('---', '', '## ' + nameOf[k], '');
      out.push('```', E.fileContent(stepId, k), '```', '');
    });
    U.downloadText('step-' + stepId + '-三件套.md', out.join('\n'), 'text/markdown');
    R.toast('已下载三件套（Demo 以合并 Markdown 代替 zip）', 'ok');
  }

  function previewFile(stepId, kind) {
    var body = el('div');
    body.appendChild(el('div.code-block', { text: E.fileContent(stepId, kind) }));
    R.openModal({
      title: (kind === 'code' ? E.codeFileName(stepId) : (kind === 'result' ? E.resultFileName(stepId) : E.interpretFileName(stepId))),
      sub: '可执行代码 / 结果文件 / 结果解读文件',
      wide: true, body: body,
      foot: [
        el('button.btn', { type: 'button', html: U.ICONS.download + ' 下载此文件', onclick: function () {
          U.downloadText(kind === 'code' ? E.codeFileName(stepId) : (kind === 'result' ? E.resultFileName(stepId) : E.interpretFileName(stepId)), E.fileContent(stepId, kind));
        } }),
        el('button.btn.btn-primary', { type: 'button', text: '关闭', onclick: function () { closeModal(); } })
      ]
    });
  }

  function focusCell(cellId) {
    var cell = ZY.engine.findCell(cellId);
    if (!cell) return;
    S.get().focusCell = cellId;
    S.save();
    switchTab('stats');
    S.get().activeStep = 'baseline';
    S.get().segView = 'result';
    S.save();
    renderAll();
    R.toast('已定位到结果表：' + cell.label + ' = ' + U.fmtNum(cell.value, 3), 'ok');
  }

  /* ============================================================
     论文与导出
     ============================================================ */
  function generatePaper() {
    var p = S.project();
    if (!p.designConfirmed) { openGateModal(); return; }
    var paper = E.generatePaper();
    var pp = S.project();
    pp.messages.push({ role: 'assistant', at: Date.now(), text: E.replyFor('paper', pp).text, chips: E.replyFor('paper', pp).chips });
    S.updateProject({ messages: pp.messages, paper: paper, tab: 'paper' });
    renderAll();
    R.toast('论文初稿已生成（九章）', 'ok');
  }

  function openStyleModal() {
    var body = el('div');
    body.appendChild(el('p', { text: '拖入 1–5 篇参考文献，我会提取它的行文风格与章节组织——只模仿形式，不搬运句子。', style: { fontFamily: 'var(--font-kai)', marginBottom: '12px' } }));
    body.appendChild(el('div.card', {}, [
      el('div', { style: { border: '1px dashed var(--line-strong)', borderRadius: '8px', padding: '24px', textAlign: 'center', color: 'var(--ink-tertiary)', fontSize: '12px', fontFamily: 'var(--font-kai)' } },
        ['把 PDF 拖到这里，或 ', el('span', { style: { color: 'var(--blue)', textDecoration: 'underline', cursor: 'pointer' }, text: '选择文件' })])
    ]));
    body.appendChild(el('div.banner.info', { style: { marginTop: '14px' } }, [
      el('span', { html: U.ICONS.info, style: { marginTop: '2px' } }),
      el('div.banner-body', {}, [el('div', { text: 'Demo 中此操作由《中国工业经济》默认风格包替代；真实上传与风格提取后续迭代。' })])
    ]));
    R.openModal({
      title: '指定参考风格文献', body: body,
      foot: [
        el('button.btn', { type: 'button', text: '取消', onclick: function () { closeModal(); } }),
        el('button.btn.btn-primary', { type: 'button', text: '使用默认风格包', onclick: function () { closeModal(); R.toast('已使用《中国工业经济》默认风格包', 'ok'); } })
      ]
    });
  }

  function exportPaper(fmt) {
    var p = S.project();
    if (!p.paper) { R.toast('还没有生成初稿', 'err'); return; }
    var md = E.paperToMarkdown(p.paper);
    U.downloadText(p.title + '-初稿.md', md, 'text/markdown');
    R.toast('已导出初稿 Markdown', 'ok');
  }

  function exportPackage() {
    var md = E.exportPackageMd();
    var p = S.project();
    U.downloadText(p.title + '-项目包.md', md, 'text/markdown');
    R.toast('已导出完整项目包（含过程文件、拒答台账与写作说明）', 'ok');
  }

  function exportDesign() {
    var d = (S.project() && S.project().design) || D.DESIGN;
    var libById = {};
    (D.LIBRARY || []).forEach(function (x) { libById[x.id] = x; });
    function refName(id) {
      var doc = libById[id];
      if (!doc) return id;
      var first = String(doc.authors || '').split(/[,，]/)[0];
      return first + (/[,，]/.test(String(doc.authors)) ? ' 等' : '') + '（' + doc.year + '）';
    }
    function refList(ids) {
      return (ids || []).length ? (ids || []).map(refName).join('、') : '（未给参考文献）';
    }
    var BLOCK_TITLE = {
      'data-prep': '数据处理', 'window': '基础回归数据区间选择', 'scope': '研究样本范围',
      'variables': '变量度量（因变量 / 自变量 / 控制变量）',
      'robustness': '稳健性设计方案', 'heterogeneity': '异质性设计方案', 'mechanism': '机制设计'
    };
    var ORDER = ['data-prep', 'window', 'scope', 'variables', 'robustness', 'heterogeneity', 'mechanism'];
    var byId = {};
    (d.blocks || []).forEach(function (b) { if (b && b.id) byId[b.id] = b; });
    /* 旧项目没有 blocks：从 sample / pipeline 回退，理由留空并标明 */
    var pipe = {};
    ((d.pipeline || []).length ? d.pipeline : D.DESIGN.pipeline).forEach(function (x) { pipe[x.stepId] = x.items || []; });
    var s = d.sample || {};
    var fallbackData = {
      'data-prep': s.source, 'window': s.period, 'scope': s.filter,
      'robustness': '', 'heterogeneity': '', 'mechanism': ''
    };
    var fallbackItems = {
      'data-prep': pipe['data-prep'], 'robustness': pipe['robustness'],
      'heterogeneity': pipe['heterogeneity'], 'mechanism': pipe['mechanism']
    };

    var md = ['# 实验设计方案 · ' + S.project().title, '',
      '导出时间：' + U.fmtDate() + ' ' + U.hhmm(), '',
      '## 研究假设', ''].concat(d.hypotheses.map(function (h) { return '- ' + h.id + ' ' + h.statement; }));

    ORDER.forEach(function (id, i) {
      var b = byId[id] || {};
      md.push('', '## ' + (i + 1) + '. ' + (b.title || BLOCK_TITLE[id]), '');
      md.push('- **采用的数据**：' + (b.data || fallbackData[id] || '（未填写）'));
      md.push('- **为什么这样选**：' + (b.why || '（这份设计没有给出选择理由）'));
      var items = (b.items && b.items.length) ? b.items : (fallbackItems[id] || []);
      if (items.length) {
        md.push('- **具体做法**：');
        items.forEach(function (t) { md.push('    - ' + t); });
      }
      md.push('- **参考文献**：' + refList(b.refs));
      if (id === 'variables' && (d.variables || []).length) {
        md.push('', '| 变量 | 角色 | 变量度量 | 选择理由 | 数据字段 | 缺失处理 | 预期符号 | 参考文献 |',
          '| --- | --- | --- | --- | --- | --- | --- | --- |');
        d.variables.forEach(function (v) {
          md.push('| ' + v.name + ' | ' + v.role + ' | ' + v.construction + ' | ' + (v.why || '—') +
            ' | ' + v.source + ' | ' + v.missing + ' | ' + v.sign + ' | ' + (v.lit || '—') + ' |');
        });
      }
    });

    md.push('', '## 模型设定', '', d.model.equation, '',
      '- 固定效应：' + d.model.feTerms.join(' + '),
      '- 聚类：' + d.model.cluster,
      '- 估计方法：' + d.model.estimator, '',
      '## 检查清单', '');
    d.checks.forEach(function (c) { md.push('- [' + c.status + '] ' + c.id + ' ' + c.label + '：' + c.evidence); });

    U.downloadText('实验设计方案.md', md.join('\n'), 'text/markdown');
    R.toast('已导出设计方案（含七个组成部分的数据与理由）', 'ok');
  }

  /* ============================================================
     导出为 .docx（经本机导出桥）
     ============================================================ */
  var DOCX_BRIDGE = 'http://127.0.0.1:8766/docx';

  /** 组装导出用的项目包。字段名与 export_docx.py 的读取路径一一对应。 */
  function buildDocxBundle() {
    var p = S.project();
    if (!p) return null;
    var paper = p.paper ? JSON.parse(JSON.stringify(p.paper)) : null;
    if (!paper) return null;

    /* 摘要：数据里没有独立小节，与 UI 上渲染的保持一致 */
    if (!paper.abstract) {
      paper.abstract = '本文基于 2011—2022 年中国 A 股制造业上市公司面板数据，' +
        '考察数字化转型与企业创新产出之间的关系。结果表明二者存在稳健的正相关关系，' +
        '且该关系在大型企业中更为明显。受识别策略限制，本文结论应理解为条件相关关系，' +
        '而非因果效应。';
    }
    if (!paper.keywords) paper.keywords = ['数字化转型', '企业创新', '固定效应', '异质性'];
    paper.wording = paper.wording || ZY.engine.projectWording();

    /* 引用文献：从各段 cites 反查文献库 */
    var seen = {}, refs = [];
    (paper.sections || []).forEach(function (s) {
      (s.paragraphs || []).forEach(function (para) {
        (para.cites || []).forEach(function (c) {
          if (seen[c.docId]) return;
          seen[c.docId] = 1;
          var doc = ZY.stages.literature.docOf(c.docId);
          if (doc && doc.title) {
            refs.push({
              authors: doc.authors || '', title: doc.title,
              journal: doc.journal, year: doc.year,
              text: (doc.authors || '') + '. ' + doc.title + '[J]. ' + doc.journal + ', ' + doc.year + '.'
            });
          }
        });
      });
    });

    /* 七步结果表：优先用 pipeline 的真实计算结果，没有则退回样例 STEPS */
    var steps = {};
    var pipeData = p.pipeline || {};
    S.PIPELINE_STEPS.forEach(function (def) {
      var st = pipeData[def.id] || {};
      var bundleStep = { label: def.label, tables: [] };

      /* 真实计算结果优先。字段名要按 pipeline.js 的实际形状取：
         它给的是 {title, head, rows, formattedRows, numCols, note}，
         不是 {caption, header, rows} —— 映射错了会静默掉成样例表。 */
      if (st.real && Array.isArray(st.real.tables) && st.real.tables.length) {
        bundleStep.tables = st.real.tables.map(function (t, i) {
          return {
            caption: t.title || t.caption || ('表　' + def.label + (i ? ('　' + (i + 1)) : '')),
            header: t.head || t.header || [],
            rows: t.formattedRows || t.rows || [],
            note: t.note || '',
            source: '本表由内置计量引擎实际计算（OLS + 固定效应 + 聚类标准误）'
          };
        });
        bundleStep.real = true;
        bundleStep.provenance = st.real.provenance || null;
        bundleStep.summary = st.real.summary || '';
      } else if (D.STEPS[def.id] && D.STEPS[def.id].table) {
        var tb = D.STEPS[def.id].table;
        bundleStep.tables = [{
          caption: '表　' + def.label + ' 结果',
          header: tb.head, rows: tb.rows,
          note: D.STEPS[def.id].warning || '',
          source: '预置样例数据（该步未产生真实计算结果）'
        }];
        bundleStep.real = false;
        bundleStep.summary = (D.STEPS[def.id] && D.STEPS[def.id].summary) || '';
      }
      bundleStep.status = st.status || 'pending';
      bundleStep.elapsedMs = st.elapsedMs || null;
      bundleStep.simulated = !!st.simulated;
      steps[def.id] = bundleStep;
    });

    /* 披露项：未做的检验 / 无法完成的检验 */
    var skipped = [];
    S.PIPELINE_STEPS.forEach(function (def) {
      var st = pipeData[def.id] || {};
      if (st.status === 'skipped') skipped.push(def.label + '（' + (st.note || '用户跳过') + '）');
    });

    var unverified = 0;
    (paper.sections || []).forEach(function (s) {
      (s.paragraphs || []).forEach(function (para) { if (para.unverified) unverified++; });
    });

    /* provenance：任一真实结果里带的最完整那份 */
    var prov = { engine: '内置 OLS + 固定效应 + 聚类标准误（纯前端实现）' };
    Object.keys(steps).forEach(function (k) {
      var st = pipeData[k] || {};
      if (st.real && st.real.provenance) prov = Object.assign(prov, st.real.provenance);
    });
    prov.nObs = prov.nObs || D.DATASETS[0].rows;
    prov.cluster = prov.cluster || (D.DESIGN.model.cluster || '—');

    return {
      meta: { title: p.title },
      generatedAt: U.fmtDate() + ' ' + U.hhmm(),
      paper: paper, steps: steps, references: refs,
      skippedSteps: skipped.length ? skipped : ['无'],
      cannotDo: ['事件研究（连续处理强度，无明确处理时点）'],
      unverifiedCount: unverified,
      provenance: prov,
      demo: true
    };
  }

  /** 走本机导出桥生成并下载 .docx */
  function exportDocx() {
    var bundle = buildDocxBundle();
    if (!bundle) { R.toast('还没有生成论文初稿', 'err'); return; }

    R.toast('正在生成 Word…若本机导出桥未启动会给出提示');
    var t0 = Date.now();
    fetch(DOCX_BRIDGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var msg = '导出失败（HTTP ' + res.status + '）';
          try { msg = JSON.parse(t).message || msg; } catch (e) { /* 保持原样 */ }
          throw new Error(msg);
        });
      }
      return res.blob().then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = (bundle.meta.title || '论文初稿') + '.docx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        R.toast('已导出 Word（' + U.fmtDur(Date.now() - t0) + '）', 'ok');
      });
    }, function (e) {
      /* 拿不到响应 = 桥没起。给出可执行的修复指引，而不是一句"失败"。 */
      openDocxHelp(String(e && e.message || e));
    });
  }

  /** 导出桥不可用时的说明与自救指引 */
  function openDocxHelp(reason) {
    var p = S.project();
    var body = el('div');
    body.appendChild(el('div.banner.warn', {}, [
      el('span', { html: U.ICONS.warn, style: { marginTop: '2px' } }),
      el('div.banner-body', {}, [
        el('div.banner-title', { text: '无法连接本机导出桥' }),
        el('div', { text: '浏览器不能直接写 Word 文件，需要一个本机进程来生成真正的 .docx。' +
          (reason ? '（' + reason + '）' : '') })
      ])
    ]));
    body.appendChild(el('p', {
      text: '在 frontend-demo 目录下执行下面任一条命令，然后回到本页重新点「导出 Word」：',
      style: { marginBottom: '10px', fontFamily: 'var(--font-kai)' }
    }));
    body.appendChild(el('div.code-block', {
      text: 'python serve_docx.py\n\n# 或者不起服务，直接用命令行导出：\npython export_docx.py --in bundle.json --out 论文初稿.docx'
    }));
    body.appendChild(el('p', {
      text: '导出脚本只监听 127.0.0.1，不保存你的数据。',
      style: { marginTop: '10px', fontSize: '11px', color: 'var(--ink-tertiary)', fontFamily: 'var(--font-kai)' }
    }));

    var json = JSON.stringify(buildDocxBundle(), null, 2);
    currentModal = R.openModal({
      title: '导出 Word',
      sub: '需要本机导出桥（一次性启动）',
      wide: true, body: body,
      foot: [
        el('button.btn', {
          type: 'button', text: '下载项目包 JSON',
          onclick: function () {
            U.downloadText((p ? p.title : 'project') + '-bundle.json', json, 'application/json');
            R.toast('已下载 JSON，可用 export_docx.py 离线导出', 'ok');
          }
        }),
        el('button.btn.btn-primary', { type: 'button', text: '知道了', onclick: function () { closeModal(); } })
      ],
      onClose: function () { currentModal = null; }
    });
  }

  function openDesignGateHint() { openGateModal(); }

  /** 「换个说法」：把越界段落按选定的降级说法重写（强度只能调低） */
  function applyRewrite(sectionId, paraIndex, label) {
    var p = S.project();
    if (!p || !p.paper) { R.toast('还没有初稿', 'err'); return; }
    var sec = p.paper.sections.filter(function (s) { return s.id === sectionId; })[0];
    if (!sec) return;
    var para = sec.paragraphs[paraIndex];
    if (!para) return;
    var original = para.text;
    var t = original;
    t = t.replace(/显著提高|显著提升|显著促进|促进|提升了|提高了|导致|使得|驱动|带来|抑制了|降低了/g, '与…正相关');
    t = t.replace(/说明了|表明|证明/g, '与…的方向一致');
    para.text = t;
    p.paper.rewrites = p.paper.rewrites || [];
    p.paper.rewrites.push({ sectionId: sectionId, index: paraIndex, label: label, from: original, to: t, at: Date.now() });
    S.recordDecision('降级措辞（' + sec.title + ' 第 ' + (paraIndex + 1) + ' 段）', label, ['保留原措辞'], '措辞强度须与证据强度匹配', 'agent');
    E.emit('section.generated', { section_id: sectionId, paragraph_ids: [paraIndex], wording_strength: p.paper.wording, unverified_count: E.countUnverified(p.paper) });
    S.updateProject({ paper: p.paper });
    renderAll();
    R.toast('已降级为：' + label + '（写入决策留痕）', 'ok');
  }

  /* ============================================================
     布局控制器：列宽拖拽 / 成果区收起 / 宽度约束与持久化
     ------------------------------------------------------------
     · 用户意图值（保存值）写在 localStorage 的 UI 偏好键里，与项目数据分离；
     · 当前生效宽度按窗口空间约束后写进 CSS 变量 --rail-w / --chat-w；
     · 窗口变窄只约束生效值，窗口回宽后自动恢复保存的偏好值；
     · 收起成果区只改变可见性，不取消任务、不清空成果与对话。
     ============================================================ */
  var RAIL_COL = { key: 'railW', min: 220, max: 340, def: 248 };
  var CHAT_COL = { key: 'chatW', min: 320, max: 560, def: 390 };
  var RESULTS_MIN = 480;      /* 成果栏最小宽度 */
  var RESULTS_STRIP = 44;     /* 收起后的竖向入口宽度 */
  var GUTTER = 6;             /* 拖拽命中带 */
  var STACK_BP = 1040;        /* 低于此宽度改纵向排列（最小值合计约 1032px） */

  var effWidths = { railW: RAIL_COL.def, chatW: CHAT_COL.def };
  var resizeRaf = null;

  function appEl() { return U.$('.app'); }
  function currentView() { var a = appEl(); return a ? a.dataset.view : 'empty'; }
  function isStacked() { return window.innerWidth < STACK_BP; }
  /** 只有项目态/资源态需要为成果栏留出最小宽度 */
  function hasResultsColumn() {
    var v = currentView();
    return v === 'project' || v === 'resource';
  }
  function resultsCollapsed() { return !!S.uiPrefs().resultsCollapsed; }
  function columnConf(which) { return which === 'rail' ? RAIL_COL : CHAT_COL; }

  /** 可供 项目栏 + 对话栏 使用的宽度（收起成果区后对话栏自适应，无需预留） */
  function availableForColumns() {
    if (!hasResultsColumn()) return Infinity;
    if (resultsCollapsed()) return Infinity;
    var reserved = GUTTER * 2 + RESULTS_MIN;
    return window.innerWidth - reserved;
  }

  /** 当前生效列宽：先压缩对话栏、再压缩项目栏，保证成果栏不低于最小值 */
  function computeWidths() {
    var prefs = S.uiPrefs();
    var rail = U.clamp(prefs.railW, RAIL_COL.min, RAIL_COL.max);
    var chat = U.clamp(prefs.chatW, CHAT_COL.min, CHAT_COL.max);
    var avail = availableForColumns();
    if (avail !== Infinity && rail + chat > avail) chat = Math.max(CHAT_COL.min, avail - rail);
    if (avail !== Infinity && rail + chat > avail) rail = Math.max(RAIL_COL.min, avail - chat);
    return { railW: Math.round(rail), chatW: Math.round(chat) };
  }

  /** 把当前生效宽度与收起状态刷到 DOM（含 ARIA 值） */
  function paintLayout() {
    var a = appEl();
    if (!a) return;
    a.style.setProperty('--rail-w', effWidths.railW + 'px');
    a.style.setProperty('--chat-w', effWidths.chatW + 'px');
    a.dataset.results = resultsCollapsed() ? 'collapsed' : 'expanded';
    var rail = U.$('#split-rail');
    if (rail) rail.setAttribute('aria-valuenow', String(effWidths.railW));
    var chat = U.$('#split-chat');
    if (chat) chat.setAttribute('aria-valuenow', String(effWidths.chatW));
    var collapseBtn = U.$('#btn-collapse-results');
    if (collapseBtn) collapseBtn.setAttribute('aria-expanded', String(!resultsCollapsed()));
    var expandBtn = U.$('#btn-expand-results');
    if (expandBtn) expandBtn.setAttribute('aria-expanded', String(resultsCollapsed()));
  }

  /** 重新按窗口空间约束列宽（每次渲染与窗口尺寸变化时调用） */
  function applyLayout() {
    effWidths = computeWidths();
    paintLayout();
  }

  /**
   * 设置某一列宽度。
   * persist=true 时写回 UI 偏好（仅用户主动操作会这样调用）。
   */
  function setColumnWidth(which, w, persist) {
    var conf = columnConf(which);
    var other = which === 'rail' ? effWidths.chatW : effWidths.railW;
    var avail = availableForColumns();
    var next = U.clamp(Math.round(Number(w) || 0), conf.min, conf.max);
    if (avail !== Infinity && next + other > avail) next = Math.max(conf.min, avail - other);
    if (which === 'rail') effWidths = { railW: next, chatW: effWidths.chatW };
    else effWidths = { railW: effWidths.railW, chatW: next };
    paintLayout();
    if (persist) {
      var patch = {};
      patch[conf.key] = next;
      S.setUiPrefs(patch);
    }
    return next;
  }

  /** 成果区里的滚动容器（收起/展开后要恢复阅读位置） */
  function resultsScrollers() {
    return [U.$('#project-view .content'), U.$('#resource-view')].filter(Boolean);
  }
  /* 收起前记录的滚动位置：收起后元素不可见，scrollTop 会归零，必须先记下来 */
  var resultsScrollMemo = null;

  /** 收起/展开成果区；silent=true 时不弹提示（用于资源库自动展开） */
  function toggleResults(force, silent) {
    var next = (force === undefined) ? !resultsCollapsed() : !!force;
    if (next === resultsCollapsed()) { applyLayout(); return; }
    if (next) resultsScrollMemo = resultsScrollers().map(function (el) { return el.scrollTop; });
    S.setUiPrefs({ resultsCollapsed: next });   /* 偏好与项目数据分开存储 */
    applyLayout();
    if (!next) {
      var memo = resultsScrollMemo;
      var els = resultsScrollers();
      resultsScrollMemo = null;
      requestAnimationFrame(function () {
        els.forEach(function (el, i) { if (memo && memo[i] != null) el.scrollTop = memo[i]; });
      });
      if (!silent) R.toast('成果区已展开');
    } else if (!silent) {
      R.toast('成果区已收起，研究任务继续运行');
    }
  }

  /** 列宽拖拽（指针）/ 键盘 / 双击恢复默认 */
  function bindSeparator(which) {
    var conf = columnConf(which);
    var handle = U.$('#split-' + which);
    if (!handle) return;

    handle.addEventListener('pointerdown', function (ev) {
      if (isStacked() || ev.button !== 0) return;
      ev.preventDefault();
      var startX = ev.clientX;
      var startW = effWidths[conf.key];
      var app = appEl();
      app.classList.add('is-resizing');
      document.body.style.cursor = 'col-resize';
      try { handle.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }

      function onMove(e) { setColumnWidth(which, startW + (e.clientX - startX), false); }
      function onUp() {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        app.classList.remove('is-resizing');
        document.body.style.cursor = '';
        /* 鼠标释放后保存宽度 */
        var patch = {};
        patch[conf.key] = effWidths[conf.key];
        S.setUiPrefs(patch);
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });

    /* 双击恢复该分隔线的默认值 */
    handle.addEventListener('dblclick', function () {
      if (isStacked()) return;
      var v = setColumnWidth(which, conf.def, true);
      R.toast((which === 'rail' ? '项目栏' : '对话栏') + '宽度已恢复默认 ' + v + 'px');
    });

    /* 键盘：方向键 16px，Shift + 方向键 32px */
    handle.addEventListener('keydown', function (ev) {
      if (isStacked()) return;
      var step = ev.shiftKey ? 32 : 16;
      var now = effWidths[conf.key];
      if (ev.key === 'ArrowLeft') { setColumnWidth(which, now - step, true); ev.preventDefault(); }
      else if (ev.key === 'ArrowRight') { setColumnWidth(which, now + step, true); ev.preventDefault(); }
      else if (ev.key === 'Home') { setColumnWidth(which, conf.min, true); ev.preventDefault(); }
      else if (ev.key === 'End') { setColumnWidth(which, conf.max, true); ev.preventDefault(); }
    });
  }

  function onWindowResize() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = null;
      applyLayout();
    });
  }

  /* ============================================================
     模态关闭
     ============================================================ */
  function closeModal() { if (currentModal) { currentModal.close(); currentModal = null; } }

  /* ============================================================
     事件绑定
     ============================================================ */
  function bind() {
    var form = U.$('#compose');
    var ta = U.$('#prompt');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = ta.value.trim();
      if (!v) return;
      ta.value = '';
      syncComposeState();
      handleSubmit(v);
    });
    ta.addEventListener('input', syncComposeState);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });

    U.$('#btn-new-project').addEventListener('click', function () {
      /* 「新建」= 回到空状态：不预建项目，让用户先输入研究问题或选示例卡片。
         项目在用户真正提交研究问题时才落库，避免留下"研究准备中"的空壳。 */
      S.setActive(null);
      renderAll();
      R.toast('输入你的研究问题，或选择一张示例卡片');
      var box = U.$('#prompt');
      if (box) box.focus();
    });

    U.$('#btn-library').addEventListener('click', function () { openResourcePage('library'); });
    U.$('#btn-dataset').addEventListener('click', function () { openResourcePage('dataset'); });
    /* 设置入口：左下角用户行 + 输入组里的「去配置模型」 */
    U.$('#btn-user').addEventListener('click', openSettings);

    /* 输入组工具：附件 / 语音 / 模型选择 */
    var fileInput = U.$('#file-input');
    U.$('#btn-attach').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      addFiles(this.files);
      this.value = '';       /* 允许连续选同一个文件 */
    });
    U.$('#btn-voice').addEventListener('click', toggleVoice);

    U.$('#btn-model').addEventListener('click', function (ev) {
      ev.stopPropagation();
      openModelMenu();
    });
    U.$('#btn-model-config').addEventListener('click', function () {
      closeModelMenu();
      openSettings();
    });
    /* 点空白处收起模型下拉 */
    document.addEventListener('click', function (ev) {
      var picker = U.$('#model-picker');
      if (picker && !picker.contains(ev.target)) closeModelMenu();
    });

    /* 成果区收起 / 展开（两个独立按钮，不与拖拽线共用命中区） */
    U.$('#btn-collapse-results').addEventListener('click', function () { toggleResults(true); });
    U.$('#btn-expand-results').addEventListener('click', function () { toggleResults(false); });

    /* 列宽拖拽：项目栏↔主区、对话栏↔成果栏 */
    bindSeparator('rail');
    bindSeparator('chat');
    window.addEventListener('resize', onWindowResize);

    /* 键盘快捷键 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });
  }

  /* ============================================================
     启动
     ============================================================ */
  function boot() {
    S.load();
    /* 首次进入不激活任何项目：对话区显示输入框 + 三张示例卡片，
       成果区为空态，六个阶段在开始项目后才出现。 */
    bind();
    renderAll();
    E.emit('session/created', { session_id: 'demo-session', at: Date.now() });
    console.log('%c智研 · 纯前端 Demo', 'color:#7A6AD4;font-weight:700', '\n数据均为虚构样例；算法后续迭代。\n设计规范：docs/ui-concept/DESIGN-SPEC.md');
  }

  ZY.app = {
    boot: boot, renderAll: renderAll,
    applyLayout: applyLayout, toggleResults: toggleResults, setColumnWidth: setColumnWidth,
    syncComposeState: syncComposeState,
    handleSubmit: handleSubmit, answerAsk: answerAsk, startDemo: startDemo, runDemoFlow: runDemoFlow,
    selectProject: selectProject, switchTab: switchTab,
    openGateModal: openGateModal, openDisposeModal: openDisposeModal, openSkipModal: openSkipModal,
    openSettings: openSettings, openSource: openSource, openArtifact: openArtifact,
    pickDataset: pickDataset, gotoStep: gotoStep,
    openResourcePage: openResourcePage, closeResourcePage: closeResourcePage,
    openStyleModal: openStyleModal, openDesignGateHint: openDesignGateHint,
    pickFiles: pickFiles, pickFolder: pickFolder, ingestFiles: ingestFiles,
    regenerateDesign: regenerateDesign, runLiterature: runLiterature,
    applyRewrite: applyRewrite,
    runPipeline: runPipeline, runStep: runStep, rerunStep: rerunStep,
    downloadStep: downloadStep, previewFile: previewFile, focusCell: focusCell,
    generatePaper: generatePaper, exportPaper: exportPaper, exportPackage: exportPackage, exportDesign: exportDesign,
    exportDocx: exportDocx, buildDocxBundle: buildDocxBundle,
    /* 输入组：附件 / 语音 / 模型选择（供脚本化验证与外部调用） */
    addFiles: addFiles, removeAttachment: removeAttachment, attachmentContext: attachmentContext,
    toggleVoice: toggleVoice, updateModelPicker: updateModelPicker,
    pickModel: pickModel, openModelMenu: openModelMenu, closeModelMenu: closeModelMenu
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
