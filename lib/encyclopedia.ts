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
    slug: 'ranking',
    title: '排位与排行榜',
    summary: 'strict/free 梯子、段位、风控与排行榜展示口径。',
    markdownPath: '/encyclopedia/ranking.md',
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
