export type EncyclopediaEntry = {
  slug: string;
  title: string;
  summary: string;
  markdownPath: string;
};

export const encyclopediaEntries: EncyclopediaEntry[] = [
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
    summary: 'strict/free 梯子、段位、风控与排行榜展示口径。',
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
    summary: 'PVP 战报与排位系统的关系、哪些情况下会被计分。',
    markdownPath: '/encyclopedia/pvp.md',
  },
];

export const getEncyclopediaEntry = (slug: string | undefined) => {
  if (!slug) return null;
  return encyclopediaEntries.find((entry) => entry.slug === slug) ?? null;
};
