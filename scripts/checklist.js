/* ============================================================
   智研 · 识别策略检查清单
   判定只有三种：pass（有证据支持）/ fail（明确不满足）/ unknown（信息不足）
   unknown 一律不得默认为 pass —— 经管实证的误用大多发生在"默认成立"上。
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};

  var CHECKS = [
    /* ---- 固定效应面板 ---- */
    { id: 'FE-01', group: '固定效应面板', label: '组内变异充分性',
      pass: '核心解释变量在去均值后仍有充分变异（组内/总标准差 > 0.4）',
      failCode: 'R-ID-05', failMsg: '双向固定效应吸收了核心变量的变异，β 不可识别',
      alt: '在"更多固定效应"与"保留识别变异"之间做选择' },
    { id: 'FE-02', group: '固定效应面板', label: '面板结构明确',
      pass: '明确 N 与 T 的量级（大 N 短 T / 小 N 长 T）',
      failCode: 'R-DATA-06', failMsg: '面板结构未填清，无法判断该用哪种标准误',
      alt: '先补 N 与 T，再选估计量' },
    { id: 'FE-03', group: '固定效应面板', label: '序列相关处理',
      pass: '标准误处理序列相关，并声明聚类层级与聚类数',
      failCode: 'R-ID-13', failMsg: '面板数据几乎必然存在序列相关，默认标准误会导致过度显著',
      alt: '声明聚类层级；聚类数 < 40 时改用 wild cluster bootstrap' },
    { id: 'FE-04', group: '固定效应面板', label: '不平衡面板与流失',
      pass: '报告缺失程度与流失模式；非随机流失已做检验',
      failCode: 'R-DATA-03', failMsg: '非随机流失使估计样本被选择性筛过',
      alt: '平衡子样本 + 流失分析（比较留存与流失个体的基线特征）' },
    { id: 'FE-05', group: '固定效应面板', label: '动态面板偏误',
      pass: '含滞后被解释变量且 T 短时使用 GMM/IV',
      failCode: 'R-ID-06', failMsg: '静态 FE 估计量存在 Nickell 偏误（系数被低估）',
      alt: '改用 Arellano–Bond 类方法；本环境无成熟实现时只给设计与伪代码' },

    /* ---- 双重差分 / 事件研究 ---- */
    { id: 'DID-01', group: 'DID / 事件研究', label: '双侧变异',
      pass: '同时存在处理组与未处理组（或仅时点不同的处理组）',
      failCode: 'R-DATA-01', failMsg: '所有个体同一时点被覆盖，"政策前后差异"与时间趋势重合，无法归因于政策',
      alt: '(a) 找未受政策覆盖的邻近地区作对照；(b) 改为前后均值对比并标注"无法分离共同冲击"' },
    { id: 'DID-02', group: 'DID / 事件研究', label: '处理时点变异',
      pass: '处理时点在个体/地区间存在差异',
      failCode: 'R-DATA-04', failMsg: '所有人同时被处理 = 没有 DID，只有"政策前后对比"',
      alt: '改称"政策实施前后对比"，并在局限里写明无法排除同期冲击' },
    { id: 'DID-03', group: 'DID / 事件研究', label: '处理前时期数',
      pass: '处理前 ≥ 3 期（事件研究建议 ≥ 4 期）',
      failCode: 'R-DATA-02', failMsg: '处理前期数不足，平行趋势不可检验',
      alt: '补早期数据；否则只给"政策后变化"的描述，不给 DID 估计' },
    { id: 'DID-04', group: 'DID / 事件研究', label: '平行趋势',
      pass: '事件研究 pre 期系数单独不显著且联合检验不显著且无单调趋势',
      failCode: 'R-ID-01', failMsg: '平行趋势不成立或不检验 → 不给 DID 系数',
      alt: '(a) 换对照组构造；(b) 换识别策略；(c) 降级为相关表述并公开 pre-trend 图' },
    { id: 'DID-09', group: 'DID / 事件研究', label: '交错处理的估计量',
      pass: '交错处理时使用对异质性稳健的估计量',
      failCode: 'R-ID-07', failMsg: '交错处理下 TWFE 会产生负权重，系数可能连符号都错；本环境无成熟实现',
      alt: '只给设计、公式与伪代码，不给系数；或改用"先处理后"干净子样本做两期 DID' },

    /* ---- 工具变量 ---- */
    { id: 'IV-01', group: '工具变量', label: '第一阶段强度',
      pass: '第一阶段显著；F > 10 或报告弱识别稳健推断（AR 区间）',
      failCode: 'R-ID-02', failMsg: '弱工具：2SLS 有偏、标准误失真、置信区间覆盖不足',
      alt: '(a) 换/加工具；(b) 报告 AR 置信区间；(c) 退回 OLS 并把结论改称相关' },
    { id: 'IV-02', group: '工具变量', label: '排他性约束',
      pass: '给出机制性论证（工具只通过内生变量影响结果）',
      failCode: 'R-ID-15', failMsg: '排他性约束在数据上永远检验不了，无论证不能称因果',
      alt: '补 3–5 句机制论证（标为"论证"而非"证据"）' },

    /* ---- 断点回归 ---- */
    { id: 'RDD-01', group: '断点回归', label: '断点处样本量',
      pass: '断点两侧带宽内样本量足够',
      failCode: 'R-ID-16', failMsg: '局部线性估计方差过大，系数不稳定',
      alt: '放宽带宽并做敏感性曲线，或放弃 RDD' },
    { id: 'RDD-02', group: '断点回归', label: '驱动变量连续性',
      pass: '密度检验未发现断点处聚集',
      failCode: 'R-ID-03', failMsg: '驱动变量在断点处堆积，存在操纵迹象 → RDD 识别假设不成立',
      alt: 'donut hole 排除近断点样本重估；若结论消失必须放弃因果表述' },

    /* ---- 倾向得分匹配 ---- */
    { id: 'PSM-02', group: '倾向得分匹配', label: '共同支撑',
      pass: '匹配后处理组 PS 落在对照组范围内，并报告丢弃样本量',
      failCode: 'R-ID-04', failMsg: '落在共同支撑区外的个体没有可比对象，估计依赖模型外推',
      alt: '修剪样本并明确报告丢了多少，或改用其他策略' },

    /* ---- 跨方法通用 ---- */
    { id: 'GEN-04', group: '通用红线', label: '措辞强度匹配',
      pass: '因果证据用因果措辞；相关证据不得使用因果动词',
      failCode: 'R-ID-12', failMsg: '相关证据写成因果结论，是同类产品最常见的学术事故',
      alt: '按证据强度降级措辞（相关证据段落中因果动词数必须为 0）' },
    { id: 'GEN-01', group: '通用红线', label: '不显著 ≠ 无效应',
      pass: '报告最小可检测效应或置信区间',
      failCode: 'R-ID-22', failMsg: '"不显著"只能说明没有足够证据，不能说明没有影响',
      alt: '改为"未发现统计上显著的影响"，并报告置信区间' }
  ];

  /* 措辞强度阶梯：claim_type × 检查结果 → 允许的措辞 */
  var WORDING = {
    causal:       { label: '因果', verbs: ['促进', '抑制', '提高', '降低', '导致', '使…增加'], allow: ['因果'] },
    associative:  { label: '相关', verbs: ['与…正相关', '与…负相关', '伴随', '同步变化'], allow: ['相关'] },
    descriptive:  { label: '描述', verbs: ['呈现', '分布', '占比', '趋势'], allow: ['描述'] }
  };

  /* 因果动词黑名单（用于机器校验：相关证据段落中出现即违规）
     设计说明：只看动词会误伤方法学表述（如"导致估计偏误""由共同趋势驱动"）。
     因此采用「因果动词 + 本研究结果对象」同句共现判定，既保精度又不漏判。 */
  var CAUSAL_VERBS = ['促进', '导致', '使得', '提高了', '降低了', '抑制了', '驱动', '带来', '提升了', '改善了'];

  /* 结果对象：仅当同一句里出现这些词，才说明该句在讲"对创新产出的作用" */
  var OUTCOME_NOUNS = ['创新', '专利', '产出', '绩效', '效率', '研发', '生产率'];

  /* 判定为方法学/动机说明的语境，命中即豁免 */
  var METHOD_CONTEXT = ['估计', '偏误', '内生', '工具变量', '共同趋势', '测量', '测度', '变量',
                        '样本', '模型', '设定', '检验', '稳健', '原因', '分歧', '渠道', '机制'];

  /* 转述他人结论的语境，命中即豁免：
     学术写作允许在明确归属的前提下转述文献的因果结论（"已有研究发现…"），
     但作者自己的结论句不得使用因果动词。 */
  var ATTRIBUTION = ['已有研究', '现有研究', '文献发现', '多数文献', '研究指出', '研究认为',
                     '学者', '张三', '李四', '相关研究', '既有研究', '前人研究', '研究表明',
                     '文献指出', '研究显示', '被认为', '有研究'];

  function isExempt(sentence) {
    if (METHOD_CONTEXT.some(function (m) { return sentence.indexOf(m) >= 0; })) return true;
    if (ATTRIBUTION.some(function (a) { return sentence.indexOf(a) >= 0; })) return true;
    return false;
  }

  /**
   * 分句：中英文句号/分号/问叹号/换行，以及全角逗号与顿号。
   * 为什么连逗号一起切分——见 findCausalViolations 的说明。
   */
  function splitClaims(text) {
    return String(text || '').split(/[。；;!?！？，,、\u000A]/);
  }

  /**
   * 统计一段文本中的"因果断言"数量。
   * 规则：按分句切分；同一分句内同时出现 因果动词 与 结果对象，且不含方法学/转述语境，才计为 1 次越界。
   */
  function countCausalVerbs(text) {
    if (!text) return 0;
    var n = 0;
    splitClaims(text).forEach(function (s) {
      if (!s) return;
      var hasVerb = CAUSAL_VERBS.some(function (v) { return s.indexOf(v) >= 0; });
      if (!hasVerb) return;
      var hasOutcome = OUTCOME_NOUNS.some(function (o) { return s.indexOf(o) >= 0; });
      if (!hasOutcome) return;
      if (isExempt(s)) return;
      n++;
    });
    return n;
  }

  /** 找出具体越界的句子与命中的动词，供 UI 给出改写建议 */
  function findCausalViolations(text) {
    if (!text) return [];
    var out = [];
    splitClaims(text).forEach(function (s) {
      if (!s) return;
      var hit = CAUSAL_VERBS.filter(function (v) { return s.indexOf(v) >= 0; });
      if (!hit.length) return;
      if (!OUTCOME_NOUNS.some(function (o) { return s.indexOf(o) >= 0; })) return;
      if (isExempt(s)) return;
      out.push({ sentence: s.trim(), verbs: hit });
    });
    return out;
  }

  /** 给出 3 个可被支持的降级说法（对应"换个说法"交互） */
  function suggestRewrites(sentence) {
    var s = String(sentence || '').replace(/^[，,、\s]+/, '');
    return [
      { label: '改成相关表述', text: '…与…呈显著正相关（不主张因果）' },
      { label: '改成伴随表述', text: '…伴随…的同步变化，方向与预期一致' },
      { label: '改成描述表述', text: '…水平较高的企业，其…也相对更高' }
    ];
  }

  /** 依据设计页 checks 推导全文允许的措辞强度 */
  function deriveWording(claimType, checks) {
    var hasFail = false, hasUnknown = false, hasCausalEvidence = false;
    (checks || []).forEach(function (c) {
      if (c.status === 'fail') hasFail = true;
      if (c.status === 'unknown') hasUnknown = true;
      if (c.id === 'IV-01' && c.status === 'pass') hasCausalEvidence = true;
      if ((c.id === 'DID-04' || c.id === 'DID-09') && c.status === 'pass') hasCausalEvidence = true;
    });
    if (claimType === 'causal' && !hasFail && !hasUnknown && hasCausalEvidence) return 'causal';
    if (claimType === 'descriptive') return 'descriptive';
    return 'associative';
  }

  /** 按 id 取检查项定义 */
  function byId(id) {
    for (var i = 0; i < CHECKS.length; i++) if (CHECKS[i].id === id) return CHECKS[i];
    return null;
  }

  ZY.checklist = {
    CHECKS: CHECKS, WORDING: WORDING, CAUSAL_VERBS: CAUSAL_VERBS,
    OUTCOME_NOUNS: OUTCOME_NOUNS, METHOD_CONTEXT: METHOD_CONTEXT,
    byId: byId, deriveWording: deriveWording,
    countCausalVerbs: countCausalVerbs,
    findCausalViolations: findCausalViolations,
    suggestRewrites: suggestRewrites
  };
})(window);
