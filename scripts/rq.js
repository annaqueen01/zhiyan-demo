/* ============================================================
   智研 · 研究问题（RQ）结构化抽取

   为什么单独一个模块
   ------------------
   之前用户提交研究问题时，代码做的是：
       rq = JSON.parse(JSON.stringify(D.RQ));  // 复制预置命题
       rq.phenomenon = 用户输入;                // 只替换一个字段
   结果是无论用户问什么，对象层级、时间窗、变异来源、结论类型、
   候选题目全都是"数字化转型与企业创新"那一套 —— 这就是"套壳"。

   现在改为：研究问题**必须**由模型基于用户原话抽取成结构化槽位，
   再经本地校验。抽不出来就如实说"没抽出来"，不拿预设糊过去。
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};

  var CLAIM_TYPES = ['causal', 'associative', 'descriptive'];

  var CLAIM_LABEL = { causal: '因果', associative: '相关', descriptive: '描述' };

  var SLOT_LABEL = {
    phenomenon: '现象',
    researchQuestion: '研究问题',
    objectLevel: '对象与层级',
    timeWindow: '时间窗',
    variationSource: '变异来源',
    claimType: '结论类型',
    outcomeVar: '被解释变量',
    treatmentVar: '核心解释变量',
    outOfScope: '本文不做'
  };

  /** 必填槽位：缺任何一个都不能进实验设计 */
  var REQUIRED_SLOTS = [
    'phenomenon', 'researchQuestion', 'objectLevel', 'timeWindow',
    'variationSource', 'claimType', 'outcomeVar', 'treatmentVar'
  ];

  /* ---------------- JSON 抽取（模型输出常带代码围栏或前后废话）---------------- */
  function extractJson(text) {
    if (!text) return { ok: false, reason: '模型返回为空' };
    var s = String(text).trim();

    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();

    var parsed = tryParse(s);
    if (parsed) return { ok: true, value: parsed };

    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      parsed = tryParse(s.slice(a, b + 1));
      if (parsed) return { ok: true, value: parsed, recovered: true };
    }
    return { ok: false, reason: '模型返回的不是合法 JSON', raw: s.slice(0, 400) };
  }

  function tryParse(t) {
    if (!t) return null;
    try {
      var v = JSON.parse(t);
      return (v && typeof v === 'object') ? v : null;
    } catch (e) { return null; }
  }

  /* ---------------- 提示词 ---------------- */
  function buildPrompt(userText, ctx) {
    ctx = ctx || {};
    var lines = [
      '你是经管实证研究的方法学助手。请把学生的一段研究想法，抽取成结构化槽位。',
      '',
      '只输出一个 JSON 对象，不要任何解释文字，不要 markdown 围栏。字段如下：',
      '{',
      '  "phenomenon": "现象或研究话题，一句话，20-40 字",',
      '  "researchQuestion": "可检验的研究问题，必须是问句，以问号结尾",',
      '  "objectLevel": "研究对象与观测层级，例如 中国A股制造业上市公司（企业-年）",',
      '  "timeWindow": [起始年, 结束年],',
      '  "variationSource": "核心解释变量的变异来自哪里，必须具体",',
      '  "claimType": "causal 或 associative 或 descriptive 之一",',
      '  "outcomeVar": "被解释变量，一个具体的可观测量",',
      '  "treatmentVar": "核心解释变量，一个具体的可观测量",',
      '  "outOfScope": ["本文明确不做的 1-3 件事"],',
      '  "candidateQuestions": ["3 个备选研究问题，问句形式"]',
      '}',
      '',
      '判定 claimType 的规则（务必遵守）：',
      '· 只有当变异来源是**外生冲击**（政策试点、断点、随机分配等）时，才可写 causal；',
      '· 如果变异来源只是"企业间或年际的连续差异"，那只能写 associative；',
      '· 如果学生只想要描述事实分布，写 descriptive；',
      '· 拿不准就写 associative —— 宁可保守。',
      '',
      '必须遵守：',
      '1. 不许编造学生没提到的变量。学生没说被解释变量或核心解释变量时，',
      '   把该字段设为 null，**不要猜一个填上**。',
      '2. timeWindow 学生没给就设为 null。',
      '3. 内容用中文，claimType 用英文枚举值。'
    ];

    if (ctx.libraryHints && ctx.libraryHints.length) {
      lines.push('');
      lines.push('该学生文献库中的相关片段（可据此判断变量在中国情境下是否常见）：');
      ctx.libraryHints.slice(0, 5).forEach(function (h, i) {
        lines.push('  [' + (i + 1) + '] ' + h);
      });
    }

    lines.push('');
    lines.push('学生原话：' + userText);
    return lines.join('\n');
  }

  /* ---------------- 归一化 ---------------- */
  function str(v) {
    if (v == null) return null;
    var s = String(v).trim();
    return s ? s : null;
  }

  function normTimeWindow(tw) {
    if (!tw) return null;
    if (Array.isArray(tw) && tw.length >= 2) {
      var a = parseInt(tw[0], 10), b = parseInt(tw[1], 10);
      if (isFinite(a) && isFinite(b) && a <= b) return [a, b];
      return null;
    }
    if (typeof tw === 'string') {
      var m = tw.match(/(\d{4})\s*[-—~至到]\s*(\d{4})/);
      if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
      var one = tw.match(/(\d{4})/);
      if (one) return [parseInt(one[1], 10), parseInt(one[1], 10)];
    }
    return null;
  }

  function normClaimType(v) {
    var s = String(v || '').toLowerCase().trim();
    if (CLAIM_TYPES.indexOf(s) >= 0) return s;
    if (/因果|causal/.test(s)) return 'causal';
    if (/相关|关联|associat|correlat/.test(s)) return 'associative';
    if (/描述|分布|descript/.test(s)) return 'descriptive';
    return null;
  }

  function arr(v, max) {
    if (!v) return [];
    var a = Array.isArray(v) ? v : [v];
    return a.map(str).filter(Boolean).slice(0, max || 5);
  }

  /**
   * 校验并归一化模型抽出的槽位。
   * 返回 { ok, rq, unknownSlots, warnings, errors }
   * ok=false 表示结构不完整，**不允许**继续往下走。
   */
  function normalize(raw, userText) {
    var errors = [], warnings = [], unknown = [];

    if (!raw || typeof raw !== 'object') {
      return { ok: false, rq: null, unknownSlots: [], warnings: [],
               errors: ['模型没有返回结构化对象，无法据此确定研究问题'] };
    }

    var rq = {
      phenomenon: str(raw.phenomenon) || null,
      researchQuestion: str(raw.researchQuestion) || null,
      objectLevel: str(raw.objectLevel) || null,
      timeWindow: normTimeWindow(raw.timeWindow),
      variationSource: str(raw.variationSource) || null,
      claimType: normClaimType(raw.claimType),
      outcomeVar: str(raw.outcomeVar) || null,
      treatmentVar: str(raw.treatmentVar) || null,
      outOfScope: arr(raw.outOfScope, 4),
      candidateQuestions: arr(raw.candidateQuestions, 5),
      source: 'llm',
      extractedFrom: str(userText),
      extractedAt: Date.now(),
      raw: raw
    };

    REQUIRED_SLOTS.forEach(function (k) {
      var v = rq[k];
      var empty = (v == null) || (Array.isArray(v) && !v.length) ||
                  (typeof v === 'string' && !v.trim());
      if (empty) unknown.push(k);
    });

    if (!rq.claimType) {
      rq.claimType = 'associative';
      warnings.push('模型没有给出可识别的结论类型，已暂按「相关」处理；' +
                    '若你的识别策略是外生冲击，请手动改为「因果」。');
    }

    /* 保守规则：没有明确外生变异来源时不允许 causal */
    if (rq.claimType === 'causal' && !looksExogenous(rq.variationSource)) {
      rq.claimType = 'associative';
      warnings.push('模型给出「因果」，但变异来源看不出外生冲击（' +
                    (rq.variationSource || '未说明') +
                    '），已按保守原则降为「相关」。要用因果表述，需要一个外生冲击或工具变量。');
    }

    if (rq.researchQuestion && !/[?？]$/.test(rq.researchQuestion)) {
      rq.researchQuestion = rq.researchQuestion.replace(/[。.]+$/, '') + '？';
      warnings.push('模型给出的研究问题不是问句，已补成问句形式。');
    }

    /* 只有现象、没有研究问题：这是用户这次遇到的那个症状，必须显式说明 */
    if (!rq.researchQuestion) {
      errors.push('没有抽出「研究问题」槽位。' +
        (rq.phenomenon ? '模型只识别出了现象（' + rq.phenomenon + '），' : '') +
        '研究问题必须是一个可检验的问句，否则无法据此设计实证策略。' +
        '请把你关心的关系写成问句再提交一次，例如「X 是否影响了 Y？」。');
    }

    if (!rq.outcomeVar) {
      errors.push('没有抽出「被解释变量」。请说明你想解释的结果变量，例如专利数量、全要素生产率。');
    }
    if (!rq.treatmentVar) {
      errors.push('没有抽出「核心解释变量」。请说明你的核心解释变量，例如数字化转型强度、政策是否实施。');
    }

    rq.unknownSlots = unknown;
    rq.claimSentence = buildClaimSentence(rq);
    rq.title = buildTitle(rq);
    if (!rq.candidateQuestions.length && rq.researchQuestion) {
      rq.candidateQuestions = [rq.researchQuestion];
    }

    return { ok: errors.length === 0, rq: rq, unknownSlots: unknown,
             warnings: warnings, errors: errors };
  }

  /** 变异来源是否看得出外生冲击 */
  function looksExogenous(v) {
    if (!v) return false;
    return /政策|试点|改革|冲击|断点|双重差分|DID|随机|准自然|外生|工具变量|批复|名单|扩容|开放|自贸|宽带中国|低碳城市|智慧城市|营改增/.test(v);
  }

  function buildClaimSentence(rq) {
    var a = rq.treatmentVar || '核心解释变量';
    var b = rq.outcomeVar || '被解释变量';
    var obj = rq.objectLevel ? ('（' + rq.objectLevel + '）') : '';
    if (rq.claimType === 'causal') return a + '对' + b + '的因果影响' + obj;
    if (rq.claimType === 'descriptive') return b + '的分布特征与变化' + obj;
    return a + '与' + b + '的关系' + obj;
  }

  function buildTitle(rq) {
    var a = rq.treatmentVar || rq.phenomenon || '研究主题';
    return rq.outcomeVar ? (a + '与' + rq.outcomeVar) : a;
  }

  /** 校验一个已有 rq（存储回读或用户手改后用） */
  function validate(rq) {
    if (!rq) return { ok: false, errors: ['没有研究问题'], unknownSlots: [] };
    var unknown = [];
    REQUIRED_SLOTS.forEach(function (k) {
      var v = rq[k];
      var empty = (v == null) || (Array.isArray(v) && !v.length) ||
                  (typeof v === 'string' && !v.trim());
      if (empty) unknown.push(k);
    });
    var errors = [];
    if (!rq.researchQuestion) errors.push('缺少研究问题（问句）');
    if (!rq.outcomeVar) errors.push('缺少被解释变量');
    if (!rq.treatmentVar) errors.push('缺少核心解释变量');
    return { ok: errors.length === 0, errors: errors, unknownSlots: unknown };
  }

  ZY.rq = {
    CLAIM_TYPES: CLAIM_TYPES, CLAIM_LABEL: CLAIM_LABEL,
    SLOT_LABEL: SLOT_LABEL, REQUIRED_SLOTS: REQUIRED_SLOTS,
    extractJson: extractJson, buildPrompt: buildPrompt,
    normalize: normalize, validate: validate,
    looksExogenous: looksExogenous,
    buildClaimSentence: buildClaimSentence, buildTitle: buildTitle
  };
})(window);
