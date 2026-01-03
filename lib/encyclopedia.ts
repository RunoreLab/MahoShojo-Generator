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

