export type EncyclopediaEntry = {
  slug: string;
  title: string;
  summary: string;
  markdownPath: string;
};

export const encyclopediaEntries: EncyclopediaEntry[] = [
  {
    slug: 'site-guide',
    title: '站内功能速览（从生成到对战）',
    summary: '新手从生成到对战的一页速查：入口、流程、常见问题。',
    markdownPath: '/encyclopedia/site-guide.md',
  },
  {
    slug: 'network-errors',
    title: '网络问题（Failed to fetch / 连接中断）',
    summary: '浏览器请求发不出去/被中断时的自救步骤与排查清单。',
    markdownPath: '/encyclopedia/network-errors.md',
  },
  {
    slug: 'cloudflare-524-timeout',
    title: '524 Timeout（Cloudflare 超时）',
    summary: 'Cloudflare 已连上源站但等待太久：为何发生、如何自救、何时该重试。',
    markdownPath: '/encyclopedia/cloudflare-524-timeout.md',
  },
  {
    slug: 'cloudflare-errors',
    title: 'Cloudflare/服务器错误（5xx / 520/522/523…）',
    summary: '5xx/52x 常见状态码速查：短暂波动 vs 服务端异常，以及排查建议。',
    markdownPath: '/encyclopedia/cloudflare-errors.md',
  },
  {
    slug: 'rate-limit-429',
    title: '429 Too Many Requests（请求过于频繁）',
    summary: '触发限流/冷却时该怎么做，以及官方/自备 Key 的常见差异。',
    markdownPath: '/encyclopedia/rate-limit-429.md',
  },
  {
    slug: 'ai-errors',
    title: 'AI 生成失败：常见原因与自救',
    summary: '高峰期/配置/额度/输入过长等导致的生成失败排查与恢复建议。',
    markdownPath: '/encyclopedia/ai-errors.md',
  },
  {
    slug: 'ai-refusal',
    title: 'AI 拒答与安全策略提示（不是站内设置）',
    summary: '“身为语言模型…”“安全策略”等拒答模板语：如何判断归因与合规自救。',
    markdownPath: '/encyclopedia/ai-refusal.md',
  },
  {
    slug: 'ai-output-format',
    title: 'AI 输出格式异常（缺字段/夹带解释/校验失败）',
    summary: '生成完成但结构不合格：校验失败、JSON 解析失败、输出被截断等问题的自救。',
    markdownPath: '/encyclopedia/ai-output-format.md',
  },
  {
    slug: 'data-card-errors',
    title: '数据卡问题：导入/解析/格式校验/签名',
    summary: '导入/解析失败、字段校验、templateId/version 不匹配等问题的排查清单。',
    markdownPath: '/encyclopedia/data-card-errors.md',
  },
  {
    slug: 'character-generator',
    title: '角色生成（/name、/details、/canshou）',
    summary: '三种角色生成入口的差异、适用场景，以及 /name 结果的兼容性提醒。',
    markdownPath: '/encyclopedia/character-generator.md',
  },
  {
    slug: 'arena',
    title: '竞技场',
    summary: '竞技场与战报生成的基本概念、模式差异与计分触发点。',
    markdownPath: '/encyclopedia/arena.md',
  },
  {
    slug: 'guidance',
    title: '引导 / 裁判事件 / 读写状态',
    summary: 'userGuidance、裁判事件、读写历战/状态栏对战报与计分的影响。',
    markdownPath: '/encyclopedia/guidance.md',
  },
  {
    slug: 'ranking',
    title: '排位与排行榜',
    summary: '严格/自由 天梯、段位、风控与排行榜展示口径。',
    markdownPath: '/encyclopedia/ranking.md',
  },
  {
    slug: 'native',
    title: '原生性（签名）',
    summary: '什么是原生卡、原生性如何计算，以及为什么可能显示“未知”。',
    markdownPath: '/encyclopedia/native.md',
  },
  {
    slug: 'tech-index',
    title: '技术值（Tech Index）',
    summary: '技术值的意义、计算口径与“为何不是强度值”。',
    markdownPath: '/encyclopedia/tech-index.md',
  },
  {
    slug: 'tags',
    title: '定位标签',
    summary: '标签体系、绑定规则，以及如何在页面里使用标签筛选。',
    markdownPath: '/encyclopedia/tags.md',
  },
  {
    slug: 'code-kill',
    title: '代码杀（概念与礼仪）',
    summary: '“代码杀”是什么、为何是风险提示，以及社群礼仪建议。',
    markdownPath: '/encyclopedia/code-kill.md',
  },
  {
    slug: 'glossary',
    title: '术语表（社区提案）',
    summary: '历战记录、状态栏、优先级、八角笼等术语解释与来源标注。',
    markdownPath: '/encyclopedia/glossary.md',
  },
  {
    slug: 'newbie-guide',
    title: '新手攻略（强度直觉）',
    summary: '如何粗略判断对手强度，以及新手学习路线（社区攻略改写）。',
    markdownPath: '/encyclopedia/newbie-guide.md',
  },
  {
    slug: 'scenario-generator',
    title: '箱庭物语（情景生成器）',
    summary: '用问卷生成情景 JSON，并在竞技场「情景模式」中使用。',
    markdownPath: '/encyclopedia/scenario-generator.md',
  },
  {
    slug: 'scenario-advanced',
    title: '情景卡进阶（继承与长线）',
    summary: '用历战记录/状态栏做“多回合延续”的情景卡（社区攻略改写）。',
    markdownPath: '/encyclopedia/scenario-advanced.md',
  },
  {
    slug: 'sublimation',
    title: '成长升华',
    summary: '让角色根据经历蜕变成新形态：模板、保留字段、读写历史/状态。',
    markdownPath: '/encyclopedia/sublimation.md',
  },
  {
    slug: 'archive',
    title: '档案馆（角色管理）',
    summary: '数据卡导入/编辑/替换、隐私提示，以及敏感词修正建议。',
    markdownPath: '/encyclopedia/archive.md',
  },
  {
    slug: 'review',
    title: '公开与审核机制',
    summary: 'review_status、公开展示口径，以及“提交审核/待审核”的含义。',
    markdownPath: '/encyclopedia/review.md',
  },
  {
    slug: 'sensitive-words',
    title: '敏感词与逮捕',
    summary: '什么会触发逮捕页、为什么会拦截，以及如何自救恢复内容。',
    markdownPath: '/encyclopedia/sensitive-words.md',
  },
  {
    slug: 'shield-words',
    title: '屏蔽词（和谐替换）',
    summary: '屏蔽词不会逮捕：只会对输出做遮罩或替换，减少误伤。',
    markdownPath: '/encyclopedia/shield-words.md',
  },
  {
    slug: 'pvp',
    title: 'PVP 与计分',
    summary: '房间制卡牌对决：玩法流程、隐私提示，以及计分口径摘要。',
    markdownPath: '/encyclopedia/pvp.md',
  },
];

export const getEncyclopediaEntry = (slug: string | undefined) => {
  if (!slug) return null;
  return encyclopediaEntries.find((entry) => entry.slug === slug) ?? null;
};
