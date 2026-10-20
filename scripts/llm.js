/* ============================================================
   智研 · 模型调用（真实 API）
   OpenAI 兼容协议：POST {baseURL}/chat/completions（stream=true）
   · 密钥只在调用瞬间从 credential store 取出，不写任何日志
   · 错误用稳定 code 路由，不靠解析 message 文本做判断
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};

  /* ---------- 稳定错误码（与 PRD 附录A 对齐）---------- */
  var ERR = {
    NO_ADAPTER: 'NO_ADAPTER',
    MISSING_CREDENTIAL: 'MISSING_CREDENTIAL',
    INVALID_CREDENTIAL: 'INVALID_CREDENTIAL',
    AUTH: 'AUTH',
    RATE_LIMIT: 'RATE_LIMIT',
    QUOTA: 'QUOTA',
    SERVER: 'SERVER',
    TRANSPORT: 'TRANSPORT',
    TIMEOUT: 'TIMEOUT',
    CONTEXT_WINDOW_EXCEEDED: 'CONTEXT_WINDOW_EXCEEDED',
    UNKNOWN_MODEL: 'UNKNOWN_MODEL',
    EMPTY_RESPONSE: 'EMPTY_RESPONSE',
    ABORTED: 'ABORTED',
    BAD_REQUEST: 'BAD_REQUEST'
  };

  var MESSAGES = {
    NO_ADAPTER: '没有可用的模型通道：请先在设置里配置 provider',
    MISSING_CREDENTIAL: '该路由没有凭据：请在设置里保存 API Key',
    INVALID_CREDENTIAL: 'API 密钥为空白，或含 HTTP 头无法携带的字符；请只粘贴原始密钥',
    AUTH: '鉴权失败（401/403）：请检查 API Key 是否正确、是否过期',
    RATE_LIMIT: '触发速率限制（429）：稍后重试，或换一个模型',
    QUOTA: '额度或余额不足（402）：请检查账户余额',
    SERVER: '提供方服务器错误（5xx）：稍后重试',
    TRANSPORT: '无法从浏览器访问该端点：可能是跨域限制（CORS）、网络中断或基址填写错误。注意：不能用「密钥错误」来推断 CORS 是否可用。',
    TIMEOUT: '请求超时：模型响应过慢或网络不稳定',
    CONTEXT_WINDOW_EXCEEDED: '请求超出模型上下文窗口：请减少携带的检索片段',
    UNKNOWN_MODEL: '该路由未配置这个模型',
    EMPTY_RESPONSE: '模型返回了空内容',
    ABORTED: '已取消',
    BAD_REQUEST: '请求参数被拒绝（400）：请检查模型 id 与参数'
  };

  function err(code, extra) {
    var e = new Error(MESSAGES[code] || code);
    e.code = code;
    if (extra) e.detail = extra;
    return e;
  }

  /* ---------- 密钥本地校验（不发请求）---------- */
  function validateKey(key) {
    if (!key || !String(key).trim()) return ERR.MISSING_CREDENTIAL;
    if (!/^[\x21-\x7E]+$/.test(String(key))) return ERR.INVALID_CREDENTIAL;
    return null;
  }

  /* ---------- 错误分类：先状态码，文本只作兜底 ---------- */
  var CONTEXT_PATTERNS = [
    /context length/i, /context_length_exceeded/i, /maximum context/i,
    /too large for this model context/i, /reduce the length/i, /超出[^。]{0,8}上下文/i
  ];
  var QUOTA_PATTERNS = [/insufficient_quota/i, /exceeded your current quota/i, /余额/i, /quota/i];

  function classifyError(status, bodyText, networkErr) {
    if (networkErr) return ERR.TRANSPORT;
    if (status === 401 || status === 403) return ERR.AUTH;
    if (status === 402) return ERR.QUOTA;
    if (status === 429) return ERR.RATE_LIMIT;
    if (status >= 500) return ERR.SERVER;
    var t = String(bodyText || '');
    if (status === 400) {
      if (CONTEXT_PATTERNS.some(function (r) { return r.test(t); })) return ERR.CONTEXT_WINDOW_EXCEEDED;
      if (QUOTA_PATTERNS.some(function (r) { return r.test(t); })) return ERR.QUOTA;
      return ERR.BAD_REQUEST;
    }
    return ERR.SERVER;
  }

  function keyFor(profile) {
    var st = ZY.store.get();
    return st.credentials[profile.credentialRef] || '';
  }

  function endpoint(profile, path) {
    return String(profile.baseURL || '').replace(/\/+$/, '') + path;
  }

  function headersFor(profile) {
    var key = keyFor(profile);
    var h = { 'Content-Type': 'application/json' };
    if (key) h['Authorization'] = 'Bearer ' + key;
    return h;
  }

  function withTimeout(ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
    return { ctl: ctl, done: function () { if (timer) clearTimeout(timer); } };
  }

  /* ---------- 模型发现：GET {baseURL}/models ---------- */
  function normalizeModel(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = raw.id || raw.model || raw.name;
    if (!id) return null;   /* 一行坏数据不该毁掉整个端点 */
    return {
      id: String(id),
      name: String(raw.name || raw.display_name || raw.displayName || id),
      contextWindow: raw.contextWindow || raw.context_window || raw.context_length ||
                     raw.max_input_tokens || (raw.limit && raw.limit.context) || null,
      maxTokens: raw.maxOutputTokens || raw.max_output_tokens || raw.maxTokens ||
                 raw.max_tokens || (raw.limit && raw.limit.output) ||
                 (raw.top_provider && raw.top_provider.max_completion_tokens) || null
    };
  }

  function listModels(profile, opts) {
    opts = opts || {};
    var missing = validateKey(keyFor(profile));
    if (missing && !opts.allowAnonymous) return Promise.reject(err(missing));
    var w = withTimeout(opts.timeoutMs || 15000);
    return fetch(endpoint(profile, '/models'), {
      method: 'GET', headers: headersFor(profile), signal: w.ctl ? w.ctl.signal : undefined
    }).then(function (res) {
      w.done();
      if (!res.ok) return res.text().then(function (t) { throw err(classifyError(res.status, t), t.slice(0, 300)); });
      return res.text();
    }).then(function (text) {
      if (text.length > 4 * 1024 * 1024) throw err(ERR.SERVER, '模型列表响应过大');
      var json;
      try { json = JSON.parse(text); } catch (e) { throw err(ERR.SERVER, '模型列表不是合法 JSON'); }
      var arr;
      if (Array.isArray(json.data)) arr = json.data;
      else if (json.models && !Array.isArray(json.models)) {
        arr = Object.keys(json.models).map(function (k) {
          var v = json.models[k] || {}; v.id = v.id || k; return v;
        });
      } else if (Array.isArray(json.models)) arr = json.models;
      else arr = [];
      return arr.map(normalizeModel).filter(Boolean);
    }, function (e) {
      w.done();
      if (e && e.code) throw e;
      if (e && e.name === 'AbortError') throw err(ERR.TIMEOUT);
      throw err(ERR.TRANSPORT, e && e.message);
    });
  }

  /* ---------- 连通性测试（必须走成功路径）---------- */
  function testConnection(profile, modelId) {
    var missing = validateKey(keyFor(profile));
    if (missing) return Promise.reject(err(missing));
    var model = modelId || (profile.models && profile.models[0] && profile.models[0].id);
    if (!model) return Promise.reject(err(ERR.UNKNOWN_MODEL));

    var t0 = Date.now();
    var w = withTimeout(15000);
    return fetch(endpoint(profile, '/chat/completions'), {
      method: 'POST',
      headers: headersFor(profile),
      body: JSON.stringify({ model: model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5, stream: false }),
      signal: w.ctl ? w.ctl.signal : undefined
    }).then(function (res) {
      w.done();
      var latencyMs = Date.now() - t0;
      if (!res.ok) {
        return res.text().then(function (t) { throw err(classifyError(res.status, t), t.slice(0, 300)); });
      }
      /* 不断言返回文本：推理模型可能把预算花在 thinking 上（content 为 null），
         但连接是好的 —— 没抛错即说明链路通。 */
      return res.text().then(function () { return { ok: true, latencyMs: latencyMs, model: model }; });
    }, function (e) {
      w.done();
      if (e && e.code) throw e;
      if (e && e.name === 'AbortError') throw err(ERR.TIMEOUT);
      throw err(ERR.TRANSPORT, e && e.message);
    });
  }

  /* ---------- SSE 流式对话 ---------- */
  function stream(profile, req) {
    req = req || {};
    var missing = validateKey(keyFor(profile));
    if (missing) return { promise: Promise.reject(err(missing)), abort: function () {}, text: function () { return ''; } };

    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var aborted = false;
    var full = '';

    var body = { model: req.model, messages: req.messages || [], stream: true };
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.maxTokens != null) body.max_tokens = req.maxTokens;

    var promise = fetch(endpoint(profile, '/chat/completions'), {
      method: 'POST', headers: headersFor(profile),
      body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw err(classifyError(res.status, t), t.slice(0, 300)); });
      }
      if (!res.body || typeof res.body.getReader !== 'function') {
        return res.text().then(function (t) {
          var text = parseNonStream(t);
          full = text;
          if (req.onDelta && text) req.onDelta(text);
          if (!text) throw err(ERR.EMPTY_RESPONSE);
          return text;
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buffer += decoder.decode(r.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop() || '';
          lines.forEach(function (line) {
            var s = line.trim();
            if (!s || s.indexOf('data:') !== 0) return;
            var payload = s.slice(5).trim();
            if (payload === '[DONE]') return;
            var delta = parseDelta(payload);
            if (delta) { full += delta; if (req.onDelta) req.onDelta(delta); }
          });
          return pump();
        });
      }
      return pump().then(function () {
        if (!full) throw err(ERR.EMPTY_RESPONSE);
        return full;
      });
    }, function (e) {
      if (aborted || (e && e.name === 'AbortError')) throw err(ERR.ABORTED);
      if (e && e.code) throw e;
      throw err(ERR.TRANSPORT, e && e.message);
    });

    return {
      promise: promise,
      abort: function () { aborted = true; if (ctl) ctl.abort(); },
      text: function () { return full; }
    };
  }

  function parseDelta(payload) {
    try {
      var j = JSON.parse(payload);
      var ch = j.choices && j.choices[0];
      if (!ch) return '';
      var d = ch.delta || ch.message || {};
      if (typeof d.content === 'string') return d.content;
      return '';   /* reasoning_content 不计入正文 */
    } catch (e) { return ''; }
  }

  function parseNonStream(text) {
    try {
      var j = JSON.parse(text);
      var ch = j.choices && j.choices[0];
      var m = ch && (ch.message || ch.delta);
      return (m && m.content) || '';
    } catch (e) { return ''; }
  }

  function describeError(e) {
    var code = (e && e.code) || ERR.SERVER;
    return { code: code, message: MESSAGES[code] || (e && e.message) || code, detail: e && e.detail };
  }

  ZY.llm = {
    ERR: ERR, MESSAGES: MESSAGES,
    validateKey: validateKey, classifyError: classifyError,
    listModels: listModels, testConnection: testConnection, stream: stream,
    describeError: describeError, normalizeModel: normalizeModel,
    keyFor: keyFor, endpoint: endpoint, headersFor: headersFor
  };
})(window);
