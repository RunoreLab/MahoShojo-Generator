export type EncyclopediaEntry = {
  slug: string;
  title: string;
  summary: string;
  markdownPath: string;
  categoryId: EncyclopediaCategoryId;
  keywords?: string[];
};

export type EncyclopediaCategoryId =
  | 'guide'
  | 'magic-tea-party'
  | 'troubleshooting'
  | 'ai'
  | 'gameplay'
  | 'mechanics'
  | 'content'
  | 'management'
  | 'community';

export type EncyclopediaCategory = {
  id: EncyclopediaCategoryId;
  title: string;
  description: string;
};

export const encyclopediaCategories: EncyclopediaCategory[] = [
  {
    id: 'guide',
    title: '快速开始',
    description: '站内入口、生成流程与新手速查。',
  },
  {
    id: 'magic-tea-party',
    title: '魔法茶会',
    description: '长期剧情会话：角色/情景/世界书 + 选项/摘要/更新草案。',
  },
  {
    id: 'troubleshooting',
    title: '故障排查',
    description: '网络、Cloudflare、限流、导入解析等问题自救。',
  },
  {
    id: 'ai',
    title: 'AI 生成与格式',
    description: '拒答、空输出、格式异常、生成失败与常见自救。',
  },
  {
    id: 'gameplay',
    title: '对战与计分',
    description: '竞技场、PVP、排位规则、裁判事件与计分口径。',
  },
  {
    id: 'mechanics',
    title: '系统机制',
    description: '原生性、技术值、定位标签等站内机制解释。',
  },
  {
    id: 'content',
    title: '情景与成长',
    description: '情景卡、长线继承、成长升华等玩法内容。',
  },
  {
    id: 'management',
    title: '内容管理与风控',
    description: '档案馆、公开审核、敏感词/屏蔽词与安全提示。',
  },
  {
    id: 'community',
    title: '社区约定与术语',
    description: '术语表、礼仪约定与社区提案整理。',
  },
];

export const encyclopediaEntries: EncyclopediaEntry[] = [
  {
    slug: 'site-guide',
    title: '站内功能速览（从生成到对战）',
    summary: '新手从生成到对战的一页速查：入口、流程、常见问题。',
    markdownPath: '/encyclopedia/site-guide.md',
    categoryId: 'guide',
    keywords: ['新手', '入口', '流程', '速查'],
  },
  {
    slug: 'magic-tea-party',
    title: '魔法茶会（功能与快速开始）',
    summary: '长期剧情对话页：角色/情景自由组合，支持选项、摘要、角色更新与导入导出。',
    markdownPath: '/encyclopedia/magic-tea-party.md',
    categoryId: 'magic-tea-party',
    keywords: ['/magic-tea-party', '茶会', '长期对话', '互动剧情', '自备 Key'],
  },
  {
    slug: 'magic-tea-party-settings',
    title: '魔法茶会：设置与参数说明',
    summary: '输出模式（JSONL/Markdown）、合并输出计划、资料读写与写入策略等设置怎么选。',
    markdownPath: '/encyclopedia/magic-tea-party-settings.md',
    categoryId: 'magic-tea-party',
    keywords: ['JSONL', 'Markdown', 'outputPlan', '选项', '摘要', '写入', '历战记录', '当前状态'],
  },
  {
    slug: 'magic-tea-party-session-management',
    title: '魔法茶会：会话管理（分支/合并/备份与导出）',
    summary: '置顶会话、编辑并分支、合并到原会话、ZIP 归档（含图片）与对话导出图片等常用操作。',
    markdownPath: '/encyclopedia/magic-tea-party-session-management.md',
    categoryId: 'magic-tea-party',
    keywords: ['会话', '分支', '合并', 'fork', 'merge', '置顶', '导入', '导出', 'ZIP', '图片导出'],
  },
  {
    slug: 'magic-tea-party-card-authoring',
    title: '魔法茶会：角色卡/情景卡进阶（协议与 mtp_notice）',
    summary: '如何写更适合茶会的角色卡和情景卡：情景锚点、协议重映射、mtp_notice 自定义提示/报错。',
    markdownPath: '/encyclopedia/magic-tea-party-card-authoring.md',
    categoryId: 'magic-tea-party',
    keywords: ['协议', '协议附录', 'mtp_notice', 'notice', '情景卡', '世界书', 'SillyTavern'],
  },
  {
    slug: 'magic-tea-party-troubleshooting',
    title: '魔法茶会：错误排查与 FAQ',
    summary: '登录提示、缺少 API Key、输出解析失败、敏感词拦截、上下文超载与写入异常的自救清单。',
    markdownPath: '/encyclopedia/magic-tea-party-troubleshooting.md',
    categoryId: 'magic-tea-party',
    keywords: ['登录', '未登录', 'API Key', '403', 'notice', '解析失败', '敏感词', 'blocked'],
  },
  {
    slug: 'network-errors',
    title: '网络问题（Failed to fetch / 连接中断）',
    summary: '浏览器请求发不出去/被中断时的自救步骤与排查清单。',
    markdownPath: '/encyclopedia/network-errors.md',
    categoryId: 'troubleshooting',
    keywords: ['Failed to fetch', '连接中断', '网络', '浏览器'],
  },
  {
    slug: 'cloudflare-524-timeout',
    title: '524 Timeout（Cloudflare 超时）',
    summary: 'Cloudflare 已连上源站但等待太久：为何发生、如何自救、何时该重试。',
    markdownPath: '/encyclopedia/cloudflare-524-timeout.md',
    categoryId: 'troubleshooting',
    keywords: ['524', 'Cloudflare', '超时'],
  },
  {
    slug: 'cloudflare-errors',
    title: 'Cloudflare/服务器错误（5xx / 520/522/523…）',
    summary: '5xx/52x 常见状态码速查：短暂波动 vs 服务端异常，以及排查建议。',
    markdownPath: '/encyclopedia/cloudflare-errors.md',
    categoryId: 'troubleshooting',
    keywords: ['5xx', '520', '522', '523', 'Cloudflare'],
  },
  {
    slug: 'rate-limit-429',
    title: '429 Too Many Requests（请求过于频繁）',
    summary: '触发限流/冷却时该怎么做，以及官方/自备 Key 的常见差异。',
    markdownPath: '/encyclopedia/rate-limit-429.md',
    categoryId: 'troubleshooting',
    keywords: ['429', '限流', '冷却', 'API Key'],
  },
  {
    slug: 'modelscope-auth-401',
    title: 'ModelScope 立绘 401（鉴权失败）排查',
    summary: '立绘生成提示 ModelScope 401 时，如何核查 Token、权限、模型访问与 request id。',
    markdownPath: '/encyclopedia/modelscope-auth-401.md',
    categoryId: 'troubleshooting',
    keywords: ['ModelScope', '401', '鉴权失败', 'Token', '立绘', 'request id'],
  },
  {
    slug: 'liblib-auth-401',
    title: 'LibLib 立绘 401（签名/鉴权失败）排查',
    summary: '立绘生成提示 LibLib 401 或“签名验证失败”时，如何核查 Access Key / Secret Key 与签名时效。',
    markdownPath: '/encyclopedia/liblib-auth-401.md',
    categoryId: 'troubleshooting',
    keywords: ['LibLib', '401', '签名验证失败', 'Access Key', 'Secret Key', '立绘'],
  },
  {
    slug: 'ai-errors',
    title: 'AI 生成失败：常见原因与自救',
    summary: '高峰期/配置/额度/输入过长等导致的生成失败排查与恢复建议。',
    markdownPath: '/encyclopedia/ai-errors.md',
    categoryId: 'ai',
    keywords: ['生成失败', '额度', '配置', '高峰期'],
  },
  {
    slug: 'ai-api-call-error',
    title: 'AI_APICallError（上游 AI 接口调用失败）',
    summary: '当你看到 AI_APICallError：通常是 Key/权限/额度/模型/封禁/繁忙等上游问题导致。',
    markdownPath: '/encyclopedia/ai-api-call-error.md',
    categoryId: 'ai',
    keywords: ['AI_APICallError', 'APICallError', 'request id', 'key', 'quota', '封禁', '模型'],
  },
  {
    slug: 'ai-refusal',
    title: 'AI 拒答与安全策略提示（不是站内设置）',
    summary: '“身为语言模型…”“安全策略”等拒答模板语：如何判断归因与合规自救。',
    markdownPath: '/encyclopedia/ai-refusal.md',
    categoryId: 'ai',
    keywords: ['拒答', '安全策略', '合规'],
  },
  {
    slug: 'ai-empty-output',
    title: 'AI 返回空对象/空内容（{} / [] / 空白）',
    summary: '生成结果变成 {} / [] / 空白：常见原因、如何区分拒答/超时、以及自救步骤。',
    markdownPath: '/encyclopedia/ai-empty-output.md',
    categoryId: 'ai',
    keywords: ['{}', '[]', '空白', '超时'],
  },
  {
    slug: 'ai-output-format',
    title: 'AI 输出格式异常（缺字段/夹带解释/校验失败）',
    summary: '生成完成但结构不合格：校验失败、JSON 解析失败、输出被截断等问题的自救。',
    markdownPath: '/encyclopedia/ai-output-format.md',
    categoryId: 'ai',
    keywords: ['JSON', '校验失败', '缺字段', '截断'],
  },
  {
    slug: 'ai-reasoning-visibility',
    title: 'AI 思考过程查看说明（在哪里看）',
    summary: '各页面查看 AI 思考摘要与详情的位置、状态含义及常见疑问。',
    markdownPath: '/encyclopedia/ai-reasoning-visibility.md',
    categoryId: 'ai',
    keywords: ['AI 思考', 'reasoning', '思考过程', '推理内容', '在哪看', '摘要'],
  },
  {
    slug: 'data-card-errors',
    title: '数据卡问题：导入/解析/格式校验/签名',
    summary: '导入/解析失败、字段校验、templateId/version 不匹配等问题的排查清单。',
    markdownPath: '/encyclopedia/data-card-errors.md',
    categoryId: 'troubleshooting',
    keywords: ['导入', '解析', '校验', '签名', 'templateId', 'version'],
  },
  {
    slug: 'character-generator',
    title: '角色生成（/name、/details、/canshou）',
    summary: '三种角色生成入口的差异、适用场景，以及 /name 结果的兼容性提醒。',
    markdownPath: '/encyclopedia/character-generator.md',
    categoryId: 'guide',
    keywords: ['/name', '/details', '/canshou', '角色生成'],
  },
  {
    slug: 'questionnaire',
    title: '问卷系统与自定义问卷（编辑器 / 云端问卷库）',
    summary: '自定义问卷、条件显示/跳题、云端问卷库与字数上限等新功能说明。',
    markdownPath: '/encyclopedia/questionnaire.md',
    categoryId: 'guide',
    keywords: ['问卷', '自定义问卷', 'questionnaire', '/questionnaire-editor', '条件显示', '跳题', '云端问卷'],
  },
  {
    slug: 'general-cards',
    title: '通用数据卡（Markdown）：通用角色/通用情景',
    summary: '用 Markdown 维护角色/情景：最自由、最容错的两种模板与使用技巧。',
    markdownPath: '/encyclopedia/general-cards.md',
    categoryId: 'guide',
    keywords: ['通用角色', '通用情景', 'Markdown', '长线', '流式'],
  },
  {
    slug: 'free-generator',
    title: '自由生成（/free）',
    summary: '任意提示词 + 选择 Schema 生成数据卡（角色/情景），支持参考附件与流式输出。',
    markdownPath: '/encyclopedia/free-generator.md',
    categoryId: 'guide',
    keywords: ['自由生成', '/free', 'Schema', '附件', '提示词', '流式'],
  },
  {
    slug: 'character-party',
    title: '角色组队（/character-party）',
    summary: '把多张角色卡拼成一张“队伍卡”，用于组队出场/打包角色。',
    markdownPath: '/encyclopedia/character-party.md',
    categoryId: 'guide',
    keywords: ['组队', '队伍卡', '/character-party', '合并', '通用角色'],
  },
  {
    slug: 'arena',
    title: '竞技场',
    summary: '竞技场与战报生成的基本概念、模式差异与计分触发点。',
    markdownPath: '/encyclopedia/arena.md',
    categoryId: 'gameplay',
    keywords: ['战报', '模式', '计分'],
  },
  {
    slug: 'guidance',
    title: '引导 / 裁判事件 / 读写状态',
    summary: 'userGuidance、裁判事件、读写历战/状态栏对战报与计分的影响。',
    markdownPath: '/encyclopedia/guidance.md',
    categoryId: 'gameplay',
    keywords: ['userGuidance', '裁判', '历战记录', '状态栏'],
  },
  {
    slug: 'ranking',
    title: '排位与排行榜',
    summary: '严格/自由 天梯、段位、风控与排行榜展示口径。',
    markdownPath: '/encyclopedia/ranking.md',
    categoryId: 'gameplay',
    keywords: ['天梯', '段位', '风控', '排行榜'],
  },
  {
    slug: 'native',
    title: '原生性（签名）',
    summary: '什么是原生卡、原生性如何计算，以及为什么可能显示“未知”。',
    markdownPath: '/encyclopedia/native.md',
    categoryId: 'mechanics',
    keywords: ['原生', '签名', '未知'],
  },
  {
    slug: 'tech-index',
    title: '技术值（Tech Index）',
    summary: '技术值的意义、计算口径与“为何不是强度值”。',
    markdownPath: '/encyclopedia/tech-index.md',
    categoryId: 'mechanics',
    keywords: ['Tech Index', '计算口径'],
  },
  {
    slug: 'tags',
    title: '定位标签',
    summary: '标签体系、绑定规则，以及如何在页面里使用标签筛选。',
    markdownPath: '/encyclopedia/tags.md',
    categoryId: 'mechanics',
    keywords: ['标签', '筛选', '定位'],
  },
  {
    slug: 'community-rules',
    title: '社区守则与竞技场规范（必读）',
    summary: '交流礼仪、竞技场红线、引用规范与玩法标签等管理组意见汇总。',
    markdownPath: '/encyclopedia/community-rules.md',
    categoryId: 'community',
    keywords: ['社区守则', '竞技场守则', '礼仪', '底线', '引用', '玩法标签', '规范'],
  },
  {
    slug: 'code-kill',
    title: '代码杀（概念与礼仪）',
    summary: '“代码杀”是什么、为何是风险提示，以及社群礼仪建议。',
    markdownPath: '/encyclopedia/code-kill.md',
    categoryId: 'community',
    keywords: ['礼仪', '风险提示'],
  },
  {
    slug: 'glossary',
    title: '术语表（社区提案）',
    summary: '历战记录、状态栏、优先级、八角笼等术语解释与来源标注。',
    markdownPath: '/encyclopedia/glossary.md',
    categoryId: 'community',
    keywords: ['术语', '来源标注'],
  },
  {
    slug: 'newbie-guide',
    title: '新手攻略（强度直觉）',
    summary: '如何粗略判断对手强度，以及新手学习路线（社区攻略改写）。',
    markdownPath: '/encyclopedia/newbie-guide.md',
    categoryId: 'guide',
    keywords: ['学习路线', '强度', '直觉'],
  },
  {
    slug: 'scenario-generator',
    title: '箱庭物语（情景生成器）',
    summary: '用问卷生成情景 JSON，并在竞技场「情景模式」中使用。',
    markdownPath: '/encyclopedia/scenario-generator.md',
    categoryId: 'content',
    keywords: ['情景', 'JSON', '问卷', '箱庭物语'],
  },
  {
    slug: 'scenario-advanced',
    title: '情景卡进阶（继承与长线）',
    summary: '用历战记录/状态栏做“多回合延续”的情景卡（社区攻略改写）。',
    markdownPath: '/encyclopedia/scenario-advanced.md',
    categoryId: 'content',
    keywords: ['继承', '长线', '多回合', '历战记录', '状态栏'],
  },
  {
    slug: 'sublimation',
    title: '成长升华',
    summary: '让角色根据经历蜕变成新形态：模板、保留字段、读写历史/状态。',
    markdownPath: '/encyclopedia/sublimation.md',
    categoryId: 'content',
    keywords: ['升华', '蜕变', '新形态', '模板'],
  },
  {
    slug: 'archive',
    title: '档案馆（角色管理）',
    summary: '数据卡导入/编辑/替换、隐私提示，以及敏感词修正建议。',
    markdownPath: '/encyclopedia/archive.md',
    categoryId: 'management',
    keywords: ['角色管理', '隐私', '编辑', '替换'],
  },
  {
    slug: 'tavern-ecosystem',
    title: '酒馆生态联动（SillyTavern 导入/导出）',
    summary: '将 SillyTavern 角色卡 PNG 导入为本站数据卡，或把本站数据卡导出为酒馆 PNG。',
    markdownPath: '/encyclopedia/tavern-ecosystem.md',
    categoryId: 'management',
    keywords: ['SillyTavern', '酒馆', '/tavern', '导入', '导出', 'PNG', 'ccv3', 'chara'],
  },
  {
    slug: 'review',
    title: '公开与审核机制',
    summary: 'review_status、公开展示口径，以及“提交审核/待审核”的含义。',
    markdownPath: '/encyclopedia/review.md',
    categoryId: 'management',
    keywords: ['review_status', '审核', '公开'],
  },
  {
    slug: 'sensitive-words',
    title: '敏感词与逮捕',
    summary: '什么会触发逮捕页、为什么会拦截，以及如何自救恢复内容。',
    markdownPath: '/encyclopedia/sensitive-words.md',
    categoryId: 'management',
    keywords: ['逮捕', '拦截', '敏感词'],
  },
  {
    slug: 'shield-words',
    title: '屏蔽词（和谐替换）',
    summary: '屏蔽词不会逮捕：只会对输出做遮罩或替换，减少误伤。',
    markdownPath: '/encyclopedia/shield-words.md',
    categoryId: 'management',
    keywords: ['屏蔽词', '和谐', '遮罩', '替换'],
  },
  {
    slug: 'pvp',
    title: 'PVP 与计分',
    summary: '房间制卡牌对决：玩法流程、隐私提示，以及计分口径摘要。',
    markdownPath: '/encyclopedia/pvp.md',
    categoryId: 'gameplay',
    keywords: ['房间', '对决', '隐私', '计分'],
  },
];

export const getEncyclopediaEntry = (slug: string | undefined) => {
  if (!slug) return null;
  return encyclopediaEntryBySlug.get(slug) ?? null;
};

export const getEncyclopediaCategory = (id: EncyclopediaCategoryId | undefined) => {
  if (!id) return null;
  return encyclopediaCategories.find((item) => item.id === id) ?? null;
};

export const normalizeEncyclopediaSearchText = (value: string) =>
  value.trim().toLowerCase();

export const matchEncyclopediaEntry = (entry: EncyclopediaEntry, query: string) => {
  const q = normalizeEncyclopediaSearchText(query);
  if (!q) return true;

  const keywords = entry.keywords?.join(' ') ?? '';
  const haystack = `${entry.title} ${entry.summary} ${keywords}`.toLowerCase();
  return haystack.includes(q);
};

export const groupEncyclopediaEntries = (entries: EncyclopediaEntry[]) => {
  const categoriesWithEntries = encyclopediaCategories
    .map((category) => ({
      category,
      entries: entries.filter((entry) => entry.categoryId === category.id),
    }))
    .filter((item) => item.entries.length > 0);

  const uncategorized = entries.filter(
    (entry) => !encyclopediaCategories.some((category) => category.id === entry.categoryId),
  );

  return { categoriesWithEntries, uncategorized };
};

const encyclopediaEntryBySlug = new Map<string, EncyclopediaEntry>(
  encyclopediaEntries.map((entry) => [entry.slug, entry]),
);
