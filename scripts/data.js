/* ============================================================
   智研 · 演示数据（全部为虚构样例，仅用于演示）
   ⚠️ 本 Demo 不联网、不解析真实文件；算法后续迭代。
   ============================================================ */
(function (global) {
  'use strict';
  var ZY = global.ZY = global.ZY || {};

  /* ---------- 文献库（22 篇样例，含解析质量诊断）---------- */
  var LIBRARY = [
    { id: 'd01', file: '数字化与企业创新_张三_2021.pdf', year: 2021, journal: '中国工业经济', authors: '张三, 李四',
      title: '数字化转型与企业创新绩效：基于A股上市公司的经验证据', method: 'DiD', trust: 'high',
      coverage: 0.982, mojibake: 0.001, scanned: false, twoCol: 'none', design: 'causal', conclusion: 'positive',
      quote: '数字化转型显著提升了企业创新绩效，且该效应在制造业与高技术行业中更为明显。',
      page: 12, charRange: [1840, 1932], rrf: 0.91 },
    { id: 'd02', file: '数字经济与企业创新效率_王五_2020.pdf', year: 2020, journal: '管理世界', authors: '王五',
      title: '数字经济发展与企业创新效率——来自地级市层面的证据', method: '面板FE', trust: 'high',
      coverage: 0.964, mojibake: 0.002, scanned: false, twoCol: 'none', design: 'associative', conclusion: 'positive',
      quote: '数字经济发展水平与企业创新效率呈显著正相关，但这一关系在控制城市固定效应后有所减弱。',
      page: 34, charRange: [2210, 2301], rrf: 0.87 },
    { id: 'd03', file: '数字化转型的测度与争议_赵六_2022.pdf', year: 2022, journal: '数量经济技术经济研究', authors: '赵六, 孙七',
      title: '数字化转型测度方法的比较与再检验', method: '方法学', trust: 'high',
      coverage: 0.951, mojibake: 0.003, scanned: false, twoCol: 'none', design: 'descriptive', conclusion: 'mixed',
      quote: '不同测度方式下数字化转型与企业创新的估计结果存在明显差异，年报词频法可能高估效应。',
      page: 8, charRange: [640, 726], rrf: 0.83 },
    { id: 'd04', file: '数字化_融资约束与创新_陈八_2019.pdf', year: 2019, journal: '金融研究', authors: '陈八',
      title: '数字化转型、融资约束与企业创新', method: '中介效应', trust: 'medium',
      coverage: 0.812, mojibake: 0.041, scanned: false, twoCol: 'none', design: 'mechanistic', conclusion: 'positive',
      quote: '融资约束在数字化转型影响企业创新的过程中起到部分中介作用。',
      page: 21, charRange: [1102, 1176], rrf: 0.79 },
    { id: 'd05', file: '数字化与创新_负向证据_周九_2023.pdf', year: 2023, journal: '经济研究', authors: '周九, 吴十',
      title: '数字化转型抑制了实质性创新吗？——基于专利结构的再考察', method: 'DiD', trust: 'high',
      coverage: 0.973, mojibake: 0.001, scanned: false, twoCol: 'none', design: 'causal', conclusion: 'negative',
      quote: '数字化转型显著增加了外观设计专利，但对发明专利的影响并不显著，甚至在中介检验中呈弱负向。',
      page: 45, charRange: [3010, 3104], rrf: 0.81 },
    { id: 'd06', file: '产业政策与企业创新_2020.pdf', year: 2020, journal: '中国工业经济', authors: '郑一',
      title: '产业政策、政府补贴与企业创新投入', method: 'PSM-DID', trust: 'high',
      coverage: 0.958, mojibake: 0.002, scanned: false, twoCol: 'none', design: 'causal', conclusion: 'positive',
      quote: '产业政策通过政府补贴渠道显著提高了企业的研发投入强度。',
      page: 17, charRange: [1508, 1580], rrf: 0.62 },
    { id: 'd07', file: '公司治理与创新_2021.pdf', year: 2021, journal: '南开管理评论', authors: '冯二',
      title: '股权结构与技术创新：监督还是掏空', method: '面板FE', trust: 'high',
      coverage: 0.944, mojibake: 0.002, scanned: false, twoCol: 'none', design: 'associative', conclusion: 'mixed',
      quote: '股权集中度与创新产出呈倒U型关系，过高集中度下监督效应被掏空效应抵消。',
      page: 26, charRange: [2040, 2120], rrf: 0.58 },
    { id: 'd08', file: '高铁开通与创新溢出_2022.pdf', year: 2022, journal: '经济学(季刊)', authors: '许三',
      title: '高铁开通与区域创新溢出', method: 'RDD', trust: 'high',
      coverage: 0.967, mojibake: 0.001, scanned: false, twoCol: 'none', design: 'causal', conclusion: 'positive',
      quote: '高铁开通对沿线城市的专利授权量产生了显著的正向影响，且效应随距离衰减。',
      page: 9, charRange: [720, 800], rrf: 0.49 },
    { id: 'd09', file: '营商环境与企业创新_2019.pdf', year: 2019, journal: '管理科学学报', authors: '何四',
      title: '营商环境优化能否促进企业创新', method: '面板FE', trust: 'medium',
      coverage: 0.847, mojibake: 0.028, scanned: false, twoCol: 'none', design: 'associative', conclusion: 'positive',
      quote: '营商环境指数每提高一个标准差，企业专利申请量平均提高约 4.3%。',
      page: 15, charRange: [1330, 1402], rrf: 0.55 },
    { id: 'd10', file: '扫描件_数字化案例研究_2018.pdf', year: 2018, journal: '案例研究', authors: '吕五',
      title: '传统制造企业数字化转型的路径研究', method: '案例研究', trust: 'low',
      coverage: 0.412, mojibake: 0.156, scanned: true, twoCol: 'none', design: 'descriptive', conclusion: 'n/a',
      quote: '（该篇为扫描件，文本层缺失，仅可作提及，不可引用原句）', page: 1, charRange: [0, 40], rrf: 0.33 },
    { id: 'd11', file: '双栏排版_数字化与全要素生产率_2021.pdf', year: 2021, journal: '世界经济', authors: '施六',
      title: '数字化转型与全要素生产率：来自中国工业企业的证据', method: 'DiD', trust: 'medium',
      coverage: 0.878, mojibake: 0.012, scanned: false, twoCol: 'high', design: 'causal', conclusion: 'positive',
      quote: '数字化转型通过降低信息摩擦提升了企业全要素生产率。',
      page: 40, charRange: [2600, 2668], rrf: 0.74 },
    { id: 'd12', file: '创新质量与专利结构_2023.pdf', year: 2023, journal: '科研管理', authors: '钱七',
      title: '专利质量视角下的企业创新评价', method: '指标体系', trust: 'high',
      coverage: 0.939, mojibake: 0.002, scanned: false, twoCol: 'none', design: 'descriptive', conclusion: 'n/a',
      quote: '发明专利占比是衡量创新质量的关键指标，仅使用专利总量会掩盖结构性差异。',
      page: 6, charRange: [498, 570], rrf: 0.71 },
    { id: 'd13', file: '组织变革与数字化_2020.pdf', year: 2020, journal: '管理评论', authors: '孙八',
      title: '组织变革在数字化转型中的作用', method: '问卷', trust: 'high',
      coverage: 0.921, mojibake: 0.003, scanned: false, twoCol: 'none', design: 'mechanistic', conclusion: 'positive',
      quote: '组织变革能力是数字化转型转化为创新产出的重要条件。',
      page: 19, charRange: [1620, 1690], rrf: 0.66 },
    { id: 'd14', file: '知识产权保护与创新_2019.pdf', year: 2019, journal: '中国软科学', authors: '李九',
      title: '知识产权保护强度与企业创新激励', method: 'IV', trust: 'medium',
      coverage: 0.851, mojibake: 0.022, scanned: false, twoCol: 'none', design: 'causal', conclusion: 'positive',
      quote: '以历史专利存量作为工具变量，知识产权保护显著提升了企业创新激励。',
      page: 23, charRange: [1890, 1972], rrf: 0.6 },
    { id: 'd15', file: '数字化转型的行业异质性_2022.pdf', year: 2022, journal: '产业经济研究', authors: '张十',
      title: '数字化转型效应的行业与规模异质性', method: '分组回归', trust: 'high',
      coverage: 0.955, mojibake: 0.002, scanned: false, twoCol: 'none', design: 'associative', conclusion: 'mixed',
      quote: '数字化转型的创新效应在大型企业中显著，在中小企业中并不稳健。',
      page: 11, charRange: [1020, 1096], rrf: 0.77 },
    { id: 'd16', file: '数字金融与企业创新_2021.pdf', year: 2021, journal: '金融研究', authors: '王一',
      title: '数字金融发展与企业创新产出', method: '面板FE', trust: 'high',
      coverage: 0.948, mojibake: 0.002, scanned: false, twoCol: 'none', design: 'associative', conclusion: 'positive',
      quote: '数字金融覆盖广度每提升 10%，企业专利申请量提高约 1.8%。',
      page: 28, charRange: [2240, 2312], rrf: 0.52 },
    { id: 'd17', file: '数据要素与创新_2023.pdf', year: 2023, journal: '经济研究', authors: '柳二',
      title: '数据要素市场化配置与企业创新', method: 'DiD', trust: 'high',
      coverage: 0.971, mojibake: 0.001, scanned: false, twoCol: 'none', design: 'causal', conclusion: 'positive',
      quote: '数据交易平台设立显著提升了本地企业的创新产出，且存在明显的空间溢出。',
      page: 37, charRange: [2500, 2580], rrf: 0.69 },
    { id: 'd18', file: '管理层认知与数字化_2022.pdf', year: 2022, journal: '南开管理评论', authors: '周三',
      title: '管理层数字化认知与战略转型', method: '文本分析', trust: 'high',
      coverage: 0.933, mojibake: 0.003, scanned: false, twoCol: 'none', design: 'descriptive', conclusion: 'n/a',
      quote: '管理层认知是数字化转型决策的前置条件，但在中小板企业中差异较大。',
      page: 14, charRange: [1230, 1300], rrf: 0.45 },
    { id: 'd19', file: '创新补贴的挤出效应_2020.pdf', year: 2020, journal: '中国工业经济', authors: '吴四',
      title: '政府创新补贴的激励与挤出', method: 'PSM', trust: 'medium',
      coverage: 0.862, mojibake: 0.018, scanned: false, twoCol: 'none', design: 'causal', conclusion: 'mixed',
      quote: '创新补贴对研发投入存在激励效应，但对专利产出出现部分挤出。',
      page: 31, charRange: [2060, 2130], rrf: 0.43 },
    { id: 'd20', file: '数字化转型的长期效应_2023.pdf', year: 2023, journal: '管理世界', authors: '郑五',
      title: '数字化转型的长期创新效应：五年追踪', method: '事件研究', trust: 'high',
      coverage: 0.962, mojibake: 0.002, scanned: false, twoCol: 'none', design: 'causal', conclusion: 'positive',
      quote: '转型后第 2–4 年创新产出显著上升，短期效应并不明显。',
      page: 42, charRange: [2860, 2932], rrf: 0.76 },
    { id: 'd21', file: '区域数字基础设施_2021.pdf', year: 2021, journal: '数量经济技术经济研究', authors: '孙六',
      title: '区域数字基础设施与企业创新', method: '面板FE', trust: 'medium',
      coverage: 0.836, mojibake: 0.031, scanned: false, twoCol: 'none', design: 'associative', conclusion: 'positive',
      quote: '宽带中国试点地区的企业创新产出提升约 6.1%。',
      page: 18, charRange: [1560, 1628], rrf: 0.5 },
    { id: 'd22', file: '综述_中国数字化转型研究进展_2022.pdf', year: 2022, journal: '经济学动态', authors: '钱七, 李九',
      title: '中国情境下数字化转型研究：一个文献综述', method: '综述', trust: 'high',
      coverage: 0.945, mojibake: 0.002, scanned: false, twoCol: 'none', design: 'descriptive', conclusion: 'mixed',
      quote: '现有研究在测度、样本期与识别策略上高度异质，结论分歧主要源于此。',
      page: 5, charRange: [360, 434], rrf: 0.85 }
  ];

  /* ---------- 语料体检统计 ---------- */
  var LIBRARY_STATS = {
    total: LIBRARY.length,
    byTrust: { high: 16, medium: 5, low: 1 },
    avgCoverage: 0.912,
    medianMojibake: 0.002,
    scanned: 1,
    twoColRisk: 1,
    years: { min: 2018, max: 2023 },
    methods: { 'DiD': 5, '面板FE': 5, 'RDD': 1, 'IV': 1, 'PSM': 2, '事件研究': 1, '分组回归': 1, '案例研究': 1, '方法学': 1, '综述': 1, '问卷': 1, '指标体系': 1, '文本分析': 1 }
  };

  /* ---------- 数据库（合成面板：企业-年）---------- */
  var DATASETS = [
    {
      id: 'ds1', file: 'A股制造业面板_2011-2022.csv', rows: 18042, cols: 14,
      size: 4823040, shape: 'panel', unitId: 'firm_id', timeId: 'year',
      nUnits: 2847, nPeriods: 12, missingRate: 0.023,
      columns: [
        { name: 'firm_id', label: '企业代码', type: 'id', missing: 0 },
        { name: 'year', label: '年份', type: 'int', missing: 0 },
        { name: 'province_id', label: '省份代码', type: 'id', missing: 0 },
        { name: 'industry_id', label: '行业代码', type: 'id', missing: 0 },
        { name: 'ln_innov', label: '创新产出（ln 专利申请数）', type: 'float', missing: 0.004 },
        { name: 'ln_innov_inv', label: '发明专利（ln）', type: 'float', missing: 0.006 },
        { name: 'ln_innov_util', label: '实用新型（ln）', type: 'float', missing: 0.006 },
        { name: 'digi', label: '数字化转型（年报词频占比）', type: 'float', missing: 0.031 },
        { name: 'digi_alt', label: '数字化转型（无形资产占比，替代度量）', type: 'float', missing: 0.048 },
        { name: 'size', label: '企业规模（ln 总资产）', type: 'float', missing: 0.002 },
        { name: 'lev', label: '资产负债率', type: 'float', missing: 0.011 },
        { name: 'roa', label: '总资产收益率', type: 'float', missing: 0.009 },
        { name: 'age', label: '企业年龄（ln）', type: 'float', missing: 0.003 },
        { name: 'subsidy', label: '政府补贴（ln）', type: 'float', missing: 0.057 }
      ]
    },
    {
      id: 'ds2', file: '城市营商环境指数_2011-2022.xlsx', rows: 3360, cols: 6,
      size: 512000, shape: 'panel', unitId: 'city_id', timeId: 'year',
      nUnits: 280, nPeriods: 12, missingRate: 0.008,
      columns: [
        { name: 'city_id', label: '城市代码', type: 'id', missing: 0 },
        { name: 'year', label: '年份', type: 'int', missing: 0 },
        { name: 'biz_env', label: '营商环境指数', type: 'float', missing: 0.008 },
        { name: 'digital_infra', label: '数字基础设施指数', type: 'float', missing: 0.012 },
        { name: 'gdp_pc', label: '人均GDP（ln）', type: 'float', missing: 0.002 },
        { name: 'fdi', label: '实际利用外资占比', type: 'float', missing: 0.021 }
      ]
    }
  ];

  /* ---------- 命题解析（五槽位）---------- */
  var RQ = {
    phenomenon: '数字化转型对企业创新产出的影响',
    objectLevel: 'firm-year',
    objectLevelLabel: '中国 A 股制造业上市公司（企业-年）',
    timeWindow: [2011, 2022],
    variationSource: 'digital-transformation-intensity',
    variationSourceLabel: '企业层面数字化转型强度差异（连续强度）',
    claimType: 'causal',
    claimSentence: '数字化转型显著提升了企业创新产出（因果）',
    outOfScope: [
      '不讨论服务业与非上市企业',
      '不识别数字化转型的具体技术路径',
      '不做跨国比较'
    ],
    unknownSlots: ['variationSource'],
    candidateQuestions: [
      { text: '数字化转型是否提升了企业创新产出？', corpusSupport: 12, feasibility: '中', note: '语料中 DiD / 面板 FE 证据较多，但存在负向证据（1 篇）' },
      { text: '数字化转型通过融资约束渠道影响创新吗？', corpusSupport: 3, feasibility: '低', note: '机制类文献仅 3 篇，且中介变量内生性难以处理' },
      { text: '数字化转型的创新效应在大型与中小企业间是否存在差异？', corpusSupport: 5, feasibility: '中高', note: '有直接可对照的异质性文献 2 篇' }
    ]
  };

  /* ---------- 检索结果（三类探针）---------- */
  var PROBES = {
    topic: { docs: 22, hits: 186, years: [2018, 2023] },
    method: { DiD: 5, '面板FE': 5, '事件研究': 1, IV: 1, RDD: 1, PSM: 2, '分组回归': 1 },
    disagreements: [
      { docId: 'd05', claim: '数字化转型只增加外观设计专利，对发明专利影响不显著', support: 'strong' },
      { docId: 'd03', claim: '年报词频法可能高估数字化转型的创新效应', support: 'strong' },
      { docId: 'd19', claim: '创新补贴对专利产出出现部分挤出', support: 'weak' }
    ],
    gaps: [
      { stage: '文献综述', status: 'ok', docs: 22, note: '覆盖充分，但需按识别策略分组组织' },
      { stage: '理论分析与研究假设', status: 'ok', docs: 6, note: '机制类文献偏少，仅 3 篇' },
      { stage: '实证结果', status: 'ok', docs: 5, note: '可直接对照的 DiD 研究 5 篇' },
      { stage: '稳健性检验', status: 'thin', docs: 2, note: '仅 2 篇报告了完整稳健性矩阵' },
      { stage: '机制分析', status: 'none', docs: 0, note: '语料中无外生机制变量的直接证据' }
    ]
  };

  /* ---------- 实验设计（七分区）---------- */
  var DESIGN = {
    version: 3,
    hypotheses: [
      { id: 'H1', statement: '数字化转型显著提升企业创新产出', direction: '+', mechanism: '降低信息摩擦与协调成本', outcomeVar: 'ln_innov', priorLit: ['d01', 'd11', 'd20'] },
      { id: 'H2', statement: '该效应在大型企业中更强', direction: '+（大企业）', mechanism: '规模互补性', outcomeVar: 'ln_innov', priorLit: ['d15', 'd02'] }
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
    variables: [
      { name: 'ln_innov', role: '被解释变量', construction: 'ln(1 + 专利申请总数)', source: 'ln_innov', missing: '不插补', sign: '—', lit: 'd01, d12',
        why: '专利申请量右偏严重，取对数后接近对称，回归系数可直接读作半弹性；用申请量而非授权量是为了避开审查周期造成的年度错配。' },
      { name: 'ln_innov_inv', role: '被解释变量（替代）', construction: 'ln(1 + 发明专利数)', source: 'ln_innov_inv', missing: '不插补', sign: '—', lit: 'd05, d12',
        why: '发明专利比实用新型与外观设计更能代表实质性创新；用作替代度量，检验结论是否只由低质量专利堆出来。' },
      { name: 'digi', role: '核心解释变量', construction: '年报数字化词频 ÷ 年报总词数', source: 'digi', missing: '行业-年份中位数', sign: '+', lit: 'd01, d03',
        why: '年报文本覆盖面最广、逐年可比，且企业无法预知会被这样度量；但它可能含"策略性披露"，所以必须配一个基于真金白银的替代度量。' },
      { name: 'digi_alt', role: '核心解释变量（替代）', construction: '数字化相关无形资产 ÷ 总资产', source: 'digi_alt', missing: '行业-年份中位数', sign: '+', lit: 'd03',
        why: '无形资产占比反映的是实际投入而非文字表述，用来交叉验证"说"与"做"是否一致，规避纯文本度量的噪声。' },
      { name: 'size', role: '控制变量', construction: 'ln(总资产)', source: 'size', missing: '中位数', sign: '+', lit: 'd07',
        why: '规模同时决定创新投入能力与数字化水平，不控制它，规模效应会被误记到数字化系数上——这是最主要的遗漏变量来源。' },
      { name: 'lev', role: '控制变量', construction: '总负债 ÷ 总资产', source: 'lev', missing: '中位数', sign: '−', lit: 'd07',
        why: '高杠杆挤占研发支出，且与数字化投入负相关；不控制会把杠杆的抑制效应混进核心系数。' },
      { name: 'roa', role: '控制变量', construction: '净利润 ÷ 总资产', source: 'roa', missing: '中位数', sign: '+', lit: 'd07',
        why: '盈利决定研发投入的可持续性，是"有没有钱做创新"的直接约束。' },
      { name: 'age', role: '控制变量', construction: 'ln(1 + 企业年龄)', source: 'age', missing: '中位数', sign: '−', lit: 'd06',
        why: '成熟企业创新边际递减，且数字化起步更早；不控制年龄会把"资历"当成"数字化"的效果。' },
      { name: 'firm FE', role: '固定效应', construction: '企业个体固定效应', source: 'firm_id', missing: '—', sign: '—', lit: '—',
        why: '吸收不随时间变化的企业特征（治理结构、区位、企业家能力），这些既影响数字化又影响创新。' },
      { name: 'year FE', role: '固定效应', construction: '年份固定效应', source: 'year', missing: '—', sign: '—', lit: '—',
        why: '吸收全行业共同的年度冲击（宏观周期、政策变化），避免把共同趋势读成企业间差异。' }
    ],
    model: {
      equation: 'ln_innov(i,t) = β0 + β1·digi(i,t) + γ·Controls(i,t) + μ(i) + λ(t) + ε(i,t)',
      feTerms: ['firm FE', 'year FE'],
      cluster: 'firm',
      clusterNote: '处理在**企业层**变异（连续强度），故聚类到企业层；若改用地区试点识别需聚类到城市层',
      weights: '无',
      estimator: 'OLS + 双向固定效应（within 变换）'
    },
    checks: [
      { id: 'FE-01', label: '组内变异充分性', status: 'pass', evidence: 'digi 组内标准差 / 总标准差 = 0.61（去均值后仍有充分变异）', need: '' },
      { id: 'FE-02', label: '面板结构明确', status: 'pass', evidence: 'N = 2,847，T = 12（长 N 短 T）', need: '' },
      { id: 'FE-03', label: '序列相关处理', status: 'pass', evidence: '聚类到企业层，聚类数 2,847', need: '' },
      { id: 'FE-04', label: '不平衡面板与流失', status: 'pass', evidence: '缺失率 2.3%，随机缺失检验 p = 0.31', need: '' },
      { id: 'DID-04', label: '平行趋势（若声称因果）', status: 'unknown', evidence: '连续处理强度设计，无明确处理时点，事件研究不适用', need: '若要写"因果"，需改为政策试点识别或补一个外生冲击作为工具变量' },
      { id: 'IV-01', label: '工具变量强度', status: 'fail', evidence: '备选工具（同行业同年度其他企业数字化均值）第一阶段 F = 6.2 < 10', need: '更换工具变量，或接受"相关"表述。**不接受弱工具下的因果结论**' },
      { id: 'GEN-04', label: '措辞强度匹配', status: 'pass', evidence: '因 IV-01 未通过，措辞强度锁定为 associative（相关）', need: '' }
    ],
    pipeline: [
      { stepId: 'data-prep', items: ['类型转换与面板唯一性校验', '缺失处理（行业-年份中位数）', '异常值缩尾 1%/99%', '变量构造（ln_innov / digi / 控制变量）', '样本筛选'] },
      { stepId: 'descriptive', items: ['描述性统计表', '相关系数矩阵', '分组均值对比'] },
      { stepId: 'baseline', items: ['主回归（firm + year FE，企业层聚类）', '报告 N / 组内R² / 聚类数 / FE 清单'] },
      { stepId: 'robustness', items: ['替换被解释变量（发明专利）', '替换核心解释变量（无形资产占比）', '更换样本窗', '增删控制变量', '安慰剂检验', '更换聚类层级', '更换 FE 组合'] },
      { stepId: 'endogeneity', items: ['工具变量 2SLS（含第一阶段 F）', '滞后一期解释变量', '说明：弱工具故本步结论仅作参考'] },
      { stepId: 'heterogeneity', items: ['按企业规模分组', '按所有制分组', '组间系数差异检验'] },
      { stepId: 'mechanism', items: ['融资约束渠道（KZ 指数）', '对照组直接效应'] }
    ],
    /* 实验设计的七个组成部分。每一块都必须写清两件事：
       ① 采用的数据（data）② 为什么这样选（why），并附参考文献（refs）。 */
    blocks: [
      {
        id: 'data-prep', no: '①', title: '数据处理',
        data: 'A股制造业面板_2011-2022.csv（18,528 行 × 14 列，企业-年）',
        why: '面板数据必须先做唯一性与类型校验，否则双向固定效应会因重复键错配观测；缺失与异常值都按"行业-年份"分组处理，而不是用全样本均值——后者会让样本稀少的行业被整体均值拉偏。',
        items: [
          '类型转换与面板唯一性校验（firm_id × year 无重复）',
          '关键变量缺失按行业-年份中位数插补（插补比例 2.3%，另做不插补的敏感性检验）',
          '连续变量缩尾 1%/99%（处理 372 个观测）',
          '变量构造：ln_innov / digi / 控制变量',
          '筛选后重算面板平衡性与组内变异'
        ],
        refs: ['d07', 'd12']
      },
      {
        id: 'window', no: '②', title: '基础回归数据区间选择',
        data: '2011—2022 共 12 个年度，2011 年为基准起始年',
        why: '2011 年起年报数字化披露的口径才趋于稳定，更早年份大量公司未规范披露，词频会被"没写"与"没做"混淆；2022 年是数据可得的最新年份，再往后会因年报滞后与疫情期异常值混入而失真。12 年对短面板足够，又能把 2015 年供给侧改革这个结构性断点放在窗口内检验而不是跨越它。',
        items: [
          '基准窗：2011—2022',
          '缩窗检验：2013—2022（去掉最早两年，排除口径不稳）',
          '断点检验：以 2015 年为界分前后两段分别估计'
        ],
        refs: ['d01', 'd03']
      },
      {
        id: 'scope', no: '③', title: '研究样本范围',
        data: '沪深 A 股制造业上市公司，企业-年观测；计划 18,042 个企业-年、2,847 家企业',
        why: '制造业是数字化投入最集中、也最可能写在年报里的行业；只取上市公司是因为财务与专利数据可逐项核验。剔除金融业（报表结构不可比）、ST/*ST（持续经营存疑）、资产负债率 > 1（资不抵债使比率失真）以及关键变量缺失的样本，并要求至少连续 3 年观测，保证组内变异可识别。',
        items: [
          '行业：制造业（证监会 2012 分类 C 门类）',
          '剔除金融业、ST/*ST、资产负债率 > 1',
          '剔除关键变量缺失样本 486 行',
          '要求连续观测 ≥ 3 年'
        ],
        refs: ['d01', 'd07', 'd15']
      },
      {
        id: 'variables', no: '④', title: '变量度量（因变量 / 自变量 / 控制变量）',
        data: '年报文本（数字化词频）、专利申请表、资产负债表与利润表',
        why: '因变量用专利数取对数：分布右偏、可比、系数可读作半弹性。自变量用年报词频占比：覆盖广、逐年可比，但已知有"策略性披露"问题，因此另设无形资产占比做替代度量，用"说"与"做"互相校验。控制变量按公司金融文献的常规组合取规模、杠杆、盈利与年龄——每一项都对应一条会同时影响数字化与创新的替代路径，而不是为凑数。',
        items: [],
        refs: ['d01', 'd03', 'd05', 'd07']
      },
      {
        id: 'robustness', no: '⑤', title: '稳健性设计方案',
        data: '同一份面板 + 两套替代度量（发明专利数、数字化无形资产占比）',
        why: '主结果要能扛住四类质疑：换度量、换窗口、换控制变量、换聚类层级；再补一个安慰剂检验，把"随机分组也会显著"这条退路堵死。所有检验在跑之前就声明，不在看到结果之后再挑，避免变成"选择性报告"。',
        items: [
          '替换被解释变量：ln(1 + 发明专利数)',
          '替换核心解释变量：数字化无形资产 ÷ 总资产',
          '更换样本窗：2013—2022',
          '增删控制变量：加入 / 移除 Tobin Q 与股权集中度',
          '安慰剂检验：随机打乱 digi 后重复 500 次，看真实系数落在分布的位置',
          '更换聚类层级：行业 × 年份双向聚类'
        ],
        refs: ['d05', 'd12', 'd19']
      },
      {
        id: 'heterogeneity', no: '⑥', title: '异质性设计方案',
        data: '同一份面板 + 分组变量（企业规模、所有制、行业数字化密度）',
        why: '如果机制成立，效应应在资源互补性更强的大企业、决策链条更短的非国有企业中更明显；按行业数字化密度分组则是为了排除"全行业共同趋势"这一竞争性解释。分组一律做组间系数差异检验，而不是只比较两组的显著性——后者是常见的误读。',
        items: [
          '按企业规模（总资产中位数）分大 / 小两组',
          '按所有制分国有 / 非国有',
          '按行业数字化密度分高 / 低两组',
          '组间系数差异检验（Chow / SUR）'
        ],
        refs: ['d15', 'd16', 'd20']
      },
      {
        id: 'mechanism', no: '⑦', title: '机制设计',
        data: '同一份面板 + 融资约束代理变量（KZ 指数、SA 指数）',
        why: '理论预期数字化缓解的是信息摩擦与融资约束，所以机制检验看的是"约束越紧的企业效应是否越强"（分组 / 交互项），而不是做中介效应回归——中介法要求"无遗漏混淆"这个假设在面板里几乎不可能成立。同时报告控制渠道变量后的直接效应，避免把全部效应都归给单一路径。',
        items: [
          '融资约束渠道：按 KZ 指数分组 + 交互项',
          '替代渠道：SA 指数复核结论是否稳健',
          '报告控制渠道变量后的直接效应',
          '排除竞争性机制：管理层认知（年报语调）'
        ],
        refs: ['d04', 'd13', 'd18']
      }
    ],
    expected: {
      sign: '+',
      magnitude: 'β1 约 0.06 – 0.11（对数-对数半弹性）',
      significance: '5% 水平显著',
      fallback: '若符号反转或失显著：报告设定敏感性，不修改主结论；若替换度量后失显著，措辞降为"在部分设定下成立"'
    }
  };

  /* ---------- 七步实证结果（样例计算，非真实回归）---------- */
  var STEPS = {
    'data-prep': {
      summary: '读取 18,042 行 × 14 列；剔除关键变量缺失与资产负债率 > 1 的样本 486 行；缩尾 1%/99% 处理 372 个观测。',
      metrics: [ { k: '原始观测', v: '18,528' }, { k: '有效样本', v: '18,042' }, { k: '剔除', v: '486' }, { k: '缩尾观测', v: '372' }, { k: '缺失率', v: '2.3%' } ],
      table: {
        head: ['变量', '观测数', '均值', '标准差', '最小值', '中位数', '最大值'],
        rows: [
          ['ln_innov', '18,042', '1.842', '1.106', '0.000', '1.792', '6.214'],
          ['ln_innov_inv', '17,935', '1.104', '0.982', '0.000', '0.693', '5.106'],
          ['digi', '18,042', '0.284', '0.176', '0.000', '0.261', '1.084'],
          ['digi_alt', '17,180', '0.061', '0.048', '0.000', '0.052', '0.312'],
          ['size', '18,042', '22.184', '1.246', '18.702', '22.041', '27.108'],
          ['lev', '18,042', '0.428', '0.196', '0.041', '0.421', '0.892'],
          ['roa', '18,042', '0.041', '0.062', '−0.284', '0.038', '0.226'],
          ['age', '18,042', '2.612', '0.518', '0.693', '2.708', '3.611']
        ]
      }
    },
    'descriptive': {
      summary: '核心变量分布合理；digi 与 ln_innov 的相关系数为 0.213，未见严重多重共线性（最大 VIF = 1.84）。',
      metrics: [ { k: '相关系数 corr(digi, ln_innov)', v: '0.213' }, { k: '最大 VIF', v: '1.84' }, { k: '处理组均值', v: '2.104' }, { k: '对照组均值', v: '1.638' } ],
      table: {
        head: ['', 'ln_innov', 'digi', 'size', 'lev', 'roa', 'age'],
        rows: [
          ['ln_innov', '1.000', '', '', '', '', ''],
          ['digi', '0.213', '1.000', '', '', '', ''],
          ['size', '0.318', '0.142', '1.000', '', '', ''],
          ['lev', '0.062', '−0.031', '0.284', '1.000', '', ''],
          ['roa', '0.148', '0.024', '−0.062', '−0.318', '1.000', ''],
          ['age', '−0.048', '0.018', '0.146', '0.112', '−0.084', '1.000']
        ]
      }
    },
    'baseline': {
      summary: '核心解释变量 digi 的系数为 0.083，在 5% 水平显著为正；组内 R² 0.412，聚类数 2,847。',
      metrics: [ { k: 'N', v: '18,042' }, { k: '组内 R²', v: '0.412' }, { k: '聚类数', v: '2,847（企业层）' }, { k: '固定效应', v: 'firm + year' } ],
      table: {
        head: ['变量', '系数', '标准误', 't 值', 'p 值', '显著性'],
        numCols: [1, 2, 3, 4],
        rows: [
          ['digi', '0.083', '0.034', '2.441', '0.015', '**'],
          ['size', '0.142', '0.021', '6.762', '0.000', '***'],
          ['lev', '−0.068', '0.041', '−1.659', '0.097', '*'],
          ['roa', '0.216', '0.092', '2.348', '0.019', '**'],
          ['age', '−0.032', '0.028', '−1.143', '0.253', ''],
          ['常数项', '−2.418', '0.486', '−4.975', '0.000', '***']
        ]
      },
      cells: [
        { id: 'c-0001', label: 'digi 系数', value: 0.083, term: 'digi', coef: 0.083, se: 0.034, t: 2.441, p: 0.015 },
        { id: 'c-0002', label: 'digi 标准误', value: 0.034, term: 'digi' },
        { id: 'c-0003', label: '组内 R²', value: 0.412 },
        { id: 'c-0004', label: '样本量 N', value: 18042 },
        { id: 'c-0005', label: '聚类数', value: 2847 }
      ],
      code: [
        '# 03-baseline：主回归（双向固定效应 + 企业层聚类）',
        '# seed=20240113  data_hash=8f3a91c2  env_lock=env_lock.txt',
        'import pandas as pd, numpy as np',
        'import statsmodels.formula.api as smf',
        '',
        'df = pd.read_csv("data/A股制造业面板_2011-2022.csv")',
        'df = df.dropna(subset=["ln_innov", "digi", "size", "lev", "roa", "age"])',
        'df = df[df["lev"] <= 1]',
        '',
        '# 组内去均值（吸收 firm FE 与 year FE）',
        'def demean(frame, cols, by):',
        '    g = frame.groupby(by)[cols]',
        '    return frame[cols] - g.transform("mean")',
        '',
        'cols = ["ln_innov", "digi", "size", "lev", "roa", "age"]',
        'd = demean(df, cols, "firm_id")',
        'd = demean(d.join(df[["year"]]), cols, "year")',
        '',
        'model = smf.ols("ln_innov ~ digi + size + lev + roa + age", data=d).fit(',
        '    cov_type="cluster", cov_kwds={"groups": df["firm_id"]})',
        'print(model.summary())',
        '',
        '# 组内 R²',
        'within_r2 = 1 - model.ssr / ((d["ln_innov"] - d["ln_innov"].mean()) ** 2).sum()',
        'print(f"within R2 = {within_r2:.3f}")'
      ].join('\n')
    },
    'robustness': {
      summary: '7 项稳健性检验中 6 项完成、1 项无法完成（期数不足以做事件研究）；替换核心度量后系数降至 0.061 但仍显著。',
      metrics: [ { k: '完成', v: '6 / 7' }, { k: '无法完成', v: '1（事件研究）' }, { k: '符号稳定', v: '是' }, { k: '最小系数', v: '0.061' } ],
      table: {
        head: ['稳健性检验', 'digi 系数', '标准误', 'N', '聚类数', '结论'],
        numCols: [1, 2, 3],
        rows: [
          ['基准设定', '0.083', '0.034', '18,042', '2,847', '通过'],
          ['替换被解释变量（发明专利）', '0.061', '0.029', '17,935', '2,842', '通过（系数下降）'],
          ['替换核心解释变量（无形资产占比）', '0.094', '0.041', '17,180', '2,731', '通过'],
          ['更换样本窗（2013–2022）', '0.079', '0.036', '15,204', '2,588', '通过'],
          ['增删控制变量', '0.081', '0.033', '18,042', '2,847', '通过'],
          ['安慰剂检验（提前 2 期处理）', '0.012', '0.031', '16,880', '2,690', '通过（不显著）'],
          ['更换聚类层级（行业层）', '0.083', '0.048', '18,042', '31', '**注意**：聚类数仅 31，推断偏乐观'],
          ['事件研究', '—', '—', '—', '—', '无法完成（连续处理无明确时点）']
        ]
      }
    },
    'endogeneity': {
      summary: '工具变量第一阶段 F = 6.2，低于经验门槛 10 → 弱工具。按规范不改报因果，主结论措辞保持"相关"。',
      metrics: [ { k: '第一阶段 F', v: '6.2' }, { k: '经验门槛', v: '10' }, { k: '判定', v: '弱工具' }, { k: '处置', v: '退回 OLS + 降措辞' } ],
      table: {
        head: ['设定', 'digi 系数', '标准误', '第一阶段 F', '结论'],
        numCols: [1, 2, 3],
        rows: [
          ['OLS（基准）', '0.083', '0.034', '—', '报告'],
          ['2SLS（同行业同年度均值作工具）', '0.142', '0.078', '6.2', '**弱工具，不作因果解读**'],
          ['滞后一期解释变量', '0.071', '0.038', '—', '通过']
        ]
      },
      warning: '工具变量强度不足是本步最重要的结论：它直接决定了全文只能用"相关/伴随"表述，不能用"促进/导致"。'
    },
    'heterogeneity': {
      summary: '按企业规模分组的组间系数差异显著（p = 0.038）；按所有制分组的差异不显著（p = 0.412）。',
      metrics: [ { k: '规模分组差异 p', v: '0.038' }, { k: '所有制分组差异 p', v: '0.412' }, { k: '有效分组', v: '1 / 2' } ],
      table: {
        head: ['分组', 'digi 系数', '标准误', 'N', '组间差异 p 值'],
        numCols: [1, 2, 3, 4],
        rows: [
          ['大型企业（size 高于中位数）', '0.121', '0.042', '9,021', '0.038'],
          ['中小企业', '0.038', '0.045', '9,021', '（参照组）'],
          ['国有企业', '0.076', '0.048', '6,318', '0.412'],
          ['非国有企业', '0.088', '0.039', '11,724', '（参照组）']
        ]
      },
      warning: '所有制分组的 p = 0.412 表示两组系数**没有统计差异**，不能写成"对非国有企业作用更强"。'
    },
    'mechanism': {
      summary: '语料中无外生机制变量的直接证据；融资约束渠道为事后探索（post-hoc），措辞降级为"与…一致"。',
      metrics: [ { k: '机制证据', v: '事后（post-hoc）' }, { k: '渠道变量内生性', v: '存在' }, { k: '允许措辞', v: '与…一致' } ],
      table: {
        head: ['机制变量', '系数', '标准误', 'p 值', '是否可称机制'],
        numCols: [1, 2, 3],
        rows: [
          ['融资约束（KZ 指数）', '−0.046', '0.021', '0.029', '否（内生，仅可称"一致"）'],
          ['直接效应', '0.068', '0.033', '0.041', '—']
        ]
      },
      warning: '中介变量本身受数字化转型影响，因此本步结论不能写成"通过融资约束渠道"。'
    }
  };

  /* ---------- 论文初稿（九章）---------- */
  var PAPER = {
    id: 'paper-v1',
    styleMode: 'journal-default',
    styleJournal: '中国工业经济',
    styleProfile: { avgSentenceLen: 38.4, connectors: ['因此', '然而', '进一步地', '值得注意的是'], sectionParagraphs: [4, 7], figureLead: '表 X 报告了…', conclusionTone: '审慎、限定样本与时期' },
    sections: [
      {
        id: 'intro', no: '一', title: '引言', status: 'done', wording: 'associative', unverified: 0,
        paragraphs: [
          { text: '数字经济已成为中国经济增长的重要动能。企业作为创新活动的主要承担者，其数字化转型进程如何影响创新产出，是近年来产业组织与创新经济学关注的核心问题之一。',
            cites: [{ docId: 'd01', support: 'strong' }, { docId: 'd22', support: 'strong' }] },
          { text: '已有研究在结论上并不一致。多数文献发现数字化转型显著提升了企业创新绩效，但也有研究指出，数字化转型主要增加了外观设计专利，对发明专利的影响并不显著。',
            cites: [{ docId: 'd01', support: 'strong' }, { docId: 'd05', support: 'strong' }] },
          { text: '导致结论分歧的一个重要原因是测度方式的差异。年报词频法可能高估数字化转型的创新效应，而无形资产占比法则相对保守。',
            cites: [{ docId: 'd03', support: 'strong' }] },
          { text: '本文基于 2011—2022 年中国 A 股制造业上市公司面板数据，考察数字化转型与企业创新产出之间的关系，并进一步检验企业规模带来的异质性。本文的边际贡献在于：同时使用两种数字化转型测度进行交叉验证，并明确报告了识别策略的限制。',
            cites: [] }
        ]
      },
      {
        id: 'literature', no: '二', title: '文献综述', status: 'done', wording: 'associative', unverified: 0,
        paragraphs: [
          { text: '围绕数字化转型与创新，现有文献大致可分为三类。第一类关注数字化转型对创新总量的影响，多采用双重差分或面板固定效应方法，结论以正向为主。',
            cites: [{ docId: 'd01', support: 'strong' }, { docId: 'd11', support: 'strong' }, { docId: 'd20', support: 'strong' }] },
          { text: '第二类文献转向创新结构，强调仅使用专利总量会掩盖结构性差异，发明专利占比才是衡量创新质量的关键指标。这类研究对第一类结论提出了重要修正。',
            cites: [{ docId: 'd05', support: 'strong' }, { docId: 'd12', support: 'strong' }] },
          { text: '第三类文献关注测度本身。不同测度方式下估计结果存在明显差异，这提示现有结论的稳健性仍需检验。',
            cites: [{ docId: 'd03', support: 'strong' }, { docId: 'd22', support: 'strong' }] },
          { text: '在机制层面，融资约束被认为是潜在渠道之一，但相关研究多依赖中介效应模型，机制变量的内生性难以处理。',
            cites: [{ docId: 'd04', support: 'weak' }] }
        ]
      },
      {
        id: 'theory', no: '三', title: '理论分析与研究假设', status: 'done', wording: 'associative', unverified: 0,
        paragraphs: [
          { text: '数字化转型通过降低信息摩擦与协调成本，可能提升企业的创新投入与产出效率。基于此，本文提出：假设 H1，数字化转型与企业创新产出正相关。',
            cites: [{ docId: 'd01', support: 'strong' }, { docId: 'd13', support: 'weak' }] },
          { text: '规模互补性理论预测，大型企业具备更充足的资源以承接数字化带来的组织变革，因而效应可能更强。据此提出：假设 H2，上述关系在大型企业中更强。',
            cites: [{ docId: 'd15', support: 'strong' }, { docId: 'd02', support: 'weak' }] }
        ]
      },
      {
        id: 'design', no: '四', title: '研究设计', status: 'done', wording: 'neutral', unverified: 0,
        paragraphs: [
          { text: '本文使用 2011—2022 年中国 A 股制造业上市公司面板数据，共 2,847 家企业、18,042 个企业-年观测。数据来自用户导入的本地数据文件，变量定义见表 1。',
            cites: [] },
          { text: '基准模型采用双向固定效应设定，并聚类到企业层：ln_innov(i,t) = β0 + β1·digi(i,t) + γ·Controls(i,t) + μ(i) + λ(t) + ε(i,t)。',
            cites: [] },
          { text: '需要说明的是，数字化转型强度在企业层连续变异，不存在明确的政策处理时点，因此本文的识别策略更接近条件相关分析，而非严格的因果识别。',
            cites: [] }
        ]
      },
      {
        id: 'result', no: '五', title: '实证结果', status: 'done', wording: 'associative', unverified: 0,
        paragraphs: [
          { text: '表 2 报告了基准回归结果。核心解释变量 digi 的系数为 0.083，在 5% 水平上显著。由于解释变量与被解释变量均取对数形式，该系数可解释为数字化转型强度每提高 1%，企业创新产出约提高 0.083%。',
            cites: [], cells: ['c-0001', 'c-0002'] },
          { text: '控制变量方面，企业规模与总资产收益率均显著为正，与既有研究一致。组内 R² 为 0.412，聚类数为 2,847。',
            cites: [{ docId: 'd07', support: 'weak' }], cells: ['c-0003', 'c-0005'] },
          { text: '表 3 报告了稳健性检验结果。替换被解释变量为发明专利后，系数下降至 0.061，但仍在 10% 水平上显著；替换核心解释变量为无形资产占比后，系数为 0.094。安慰剂检验中提前两期的虚拟处理变量不显著，说明结果并非由共同趋势驱动。',
            cites: [], cells: [] },
          { text: '值得注意的是，将标准误聚类到行业层时，聚类数仅为 31，此时的推断偏乐观，因此本文以企业层聚类结果为准。',
            cites: [] }
        ]
      },
      {
        id: 'robust', no: '六', title: '稳健性检验', status: 'done', wording: 'associative', unverified: 1,
        paragraphs: [
          { text: '本文共设计 7 项稳健性检验，实际完成 6 项。结果显示核心结论在多种设定下保持一致，但系数大小存在波动，其中替换被解释变量后的系数下降幅度最大。',
            cites: [] },
          { text: '有一项检验未能完成：由于数字化转型为连续强度变量、不存在明确的处理时点，事件研究法不适用。这一限制意味着本文无法提供平行趋势的直接证据。',
            cites: [] },
          { text: '此外，本文未报告遗漏变量敏感度界，该分析留待后续补充。',
            cites: [], unverified: true }
        ]
      },
      {
        id: 'endo', no: '七', title: '内生性讨论', status: 'done', wording: 'associative', unverified: 0,
        paragraphs: [
          { text: '数字化转型与企业创新可能同时受到企业能力等不可观测因素影响，导致估计偏误。本文尝试使用同行业同年度其他企业数字化均值作为工具变量，但第一阶段 F 统计量仅为 6.2，低于弱工具变量的经验门槛，因此 2SLS 结果仅作参考，不作为因果证据。',
            cites: [] },
          { text: '使用滞后一期解释变量后，系数为 0.071 且仍显著。综合来看，本文更倾向于将基准结果解释为条件相关关系。',
            cites: [] }
        ]
      },
      {
        id: 'hetero', no: '八', title: '异质性与机制分析', status: 'done', wording: 'associative', unverified: 0,
        paragraphs: [
          { text: '按企业规模分组的结果显示，大型企业组的系数为 0.121，中小企业组为 0.038，组间系数差异检验的 p 值为 0.038，表明规模差异具有统计意义。',
            cites: [{ docId: 'd15', support: 'strong' }] },
          { text: '按所有制分组的结果则未发现显著差异（p = 0.412）。因此本文不主张数字化对非国有企业作用更强。',
            cites: [] },
          { text: '在机制方面，融资约束变量的系数为负且显著，但由于该变量本身可能受数字化转型影响，本文仅将其表述为与融资约束渠道一致，而不主张中介机制成立。',
            cites: [{ docId: 'd04', support: 'weak' }] }
        ]
      },
      {
        id: 'conclusion', no: '九', title: '结论与政策含义', status: 'done', wording: 'associative', unverified: 0,
        paragraphs: [
          { text: '本文基于 2011—2022 年中国 A 股制造业上市公司数据，发现数字化转型与企业创新产出之间存在稳健的正相关关系，且这一关系在大型企业中更为明显。',
            cites: [] },
          { text: '需要强调的是，受限于识别策略，本文结论应被理解为条件相关关系，而非因果效应。在数字化转型强度连续变异、缺乏外生冲击的情形下，任何因果表述都超出了数据所能支持的范围。',
            cites: [] },
          { text: '就政策含义而言，本文的证据支持在制造业企业中继续推进数字化改造，但样本仅覆盖上市公司，结论不宜直接外推至中小企业与服务业。',
            cites: [] }
        ]
      }
    ]
  };

  /* ---------- 模型服务 ---------- */
  var PROVIDERS = [
    { id: 'deepseek-official', displayName: 'DeepSeek 官方', protocol: 'openai-chat', baseURL: 'https://api.deepseek.com/v1',
      credentialRef: 'DEEPSEEK_API_KEY', preset: true, models: [{ id: 'deepseek-chat', name: 'deepseek-chat' }, { id: 'deepseek-reasoner', name: 'deepseek-reasoner' }] },
    { id: 'glm-official', displayName: 'GLM / 智谱', protocol: 'openai-chat', baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      credentialRef: 'GLM_API_KEY', preset: true, models: [{ id: 'glm-4-plus', name: 'glm-4-plus' }, { id: 'glm-4-flash', name: 'glm-4-flash' }] },
    { id: 'my-gateway', displayName: '自有中转网关', protocol: 'openai-chat', baseURL: 'https://gateway.example.com/v1',
      credentialRef: 'MY_GATEWAY_API_KEY', preset: false, models: [{ id: 'qwen3-max', name: 'qwen3-max' }] }
  ];

  /* ---------- 早期 demo 项目（"演示入口"三卡）---------- */
  var DEMO_PROJECTS = [
    { id: 'demo-main', title: '数字化转型与企业创新', topic: '数字化转型 对 企业创新 的影响',
      desc: '完整的 13 阶段流程：从命题到论文初稿，含七步实证与质量门', tag: '完整流程', scenario: 'full' },
    { id: 'demo-literature', title: '读懂一篇 DID 论文', topic: '论文解读 · 研究问题/数据/识别/结论/局限',
      desc: '针对单篇文献的结构化解读卡，每个字段带引用出处', tag: '文献解读', scenario: 'reader' },
    /* 真实课题入口：语料与数据都来自真实目录，全程走真实模型调用。
       刻意不配「跑通」的兜底 —— 没接 API 就明确提示去接，不假装能跑。 */
    { id: 'demo-live-epu', title: '经济政策不确定性与企业杠杆操纵',
      topic: '经济政策不确定性 对 企业杠杆操纵 的影响',
      desc: '真实文献库与真实数据目录，全程真实模型调用，从命题解析跑到论文初稿',
      tag: '需接入 API', scenario: 'live', requiresApi: true }
  ];

  ZY.data = {
    LIBRARY: LIBRARY, LIBRARY_STATS: LIBRARY_STATS, DATASETS: DATASETS,
    RQ: RQ, PROBES: PROBES, DESIGN: DESIGN, STEPS: STEPS, PAPER: PAPER,
    PROVIDERS: PROVIDERS, DEMO_PROJECTS: DEMO_PROJECTS
  };
})(window);
