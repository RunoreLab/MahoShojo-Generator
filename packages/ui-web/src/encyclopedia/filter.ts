/**
 * 百科筛选的**纯**部分。
 *
 * ## 为什么它与 hook 分开
 *
 * `apps/web/app/encyclopedia/[slug]/page.tsx` 是 Server Component：`generateStaticParams` 与
 * `generateMetadata` 都要读目录数据。让它经过一个会 import `useMemo` / `useState` 的模块，
 * Next 的 App Router 会直接拒绝构建——"You're importing a component that needs `useState`"。
 *
 * 因此数据与 URL 语义留在 `./encyclopedia`（任何地方都能 import），React 视图与 hook 搬进
 * `./encyclopedia-views`（只在 Client Component 里用）。这不是洁癖：RSC 与客户端组件的边界由 Next
 * 在构建期强制，而那正是 jsdom 测试覆盖不到的地方。
 */

import {
  encyclopediaCategories,
  encyclopediaEntries,
  getEncyclopediaCategory,
  groupEncyclopediaEntries,
  matchEncyclopediaEntry,
  type EncyclopediaCategoryId,
  type EncyclopediaEntry,
} from './catalog';

export type EncyclopediaCategoryFilter = EncyclopediaCategoryId | 'all';

export interface EncyclopediaFilter {
  readonly query: string;
  readonly categoryId: EncyclopediaCategoryFilter;
}

export const ALL_CATEGORY: EncyclopediaCategoryFilter = 'all';

/**
 * 从 URL query 解析筛选状态。
 *
 * `c` 必须是已声明的分类，否则退回 `all`。这条容错是必需的而不是防御性编程：分类集合会随内容增长，
 * 而旧链接与外部链接里的 `?c=` 不会跟着更新，一个未知分类渲染出「分类：undefined」比忽略它糟糕。
 */
export const parseEncyclopediaFilter = (search: string | null | undefined): EncyclopediaFilter => {
  const params = new URLSearchParams(search ?? '');
  const rawCategory = params.get('c');
  const categoryId = encyclopediaCategories.some((category) => category.id === rawCategory)
    ? (rawCategory as EncyclopediaCategoryId)
    : ALL_CATEGORY;

  return { query: params.get('q') ?? '', categoryId };
};

/** 把筛选状态序列化回 query；两个维度都为空时返回空串，让宿主能渲染干净的路径。 */
export const serializeEncyclopediaFilter = ({ query, categoryId }: EncyclopediaFilter): string => {
  const params = new URLSearchParams();
  if (categoryId !== ALL_CATEGORY) params.set('c', categoryId);
  if (query.trim()) params.set('q', query.trim());
  return params.toString();
};

export interface EncyclopediaFilteredEntries {
  readonly entries: readonly EncyclopediaEntry[];
  /** 每个分类的 `{total, matched}`，缺项补 0，供分类筛选器显示计数。 */
  readonly counts: Readonly<Record<string, { total: number; matched: number }>>;
  readonly grouped: ReturnType<typeof groupEncyclopediaEntries>;
  readonly selectedCategory: ReturnType<typeof getEncyclopediaCategory>;
  readonly showClear: boolean;
}

/**
 * 目录页与条目页共用的筛选计算（纯函数版）。
 *
 * 抽出来是因为两处必须给出**完全一致**的数字：目录页的分类计数与条目页侧栏的条目列表如果各算一次，
 * 它们会在某次内容改动后开始互相矛盾，而用户看到的是「侧栏说有 8 篇、目录只列出 7 篇」。
 *
 * 检索的是标题、摘要与关键词，不含正文——这是元数据检索而不是全文检索（D3.0 明确不做全文搜索）。
 */
export const filterEncyclopediaEntries = ({
  query,
  categoryId,
}: EncyclopediaFilter): EncyclopediaFilteredEntries => {
  const entries = encyclopediaEntries.filter((entry) => {
    if (categoryId !== ALL_CATEGORY && entry.categoryId !== categoryId) return false;
    return matchEncyclopediaEntry(entry, query);
  });

  const counts: Record<string, { total: number; matched: number }> = {
    [ALL_CATEGORY]: { total: encyclopediaEntries.length, matched: entries.length },
  };
  for (const category of encyclopediaCategories) counts[category.id] = { total: 0, matched: 0 };

  for (const entry of encyclopediaEntries) {
    counts[entry.categoryId] ??= { total: 0, matched: 0 };
    counts[entry.categoryId].total += 1;
  }
  for (const entry of entries) {
    counts[entry.categoryId] ??= { total: 0, matched: 0 };
    counts[entry.categoryId].matched += 1;
  }

  return {
    entries,
    counts,
    grouped: groupEncyclopediaEntries([...entries]),
    selectedCategory: categoryId === ALL_CATEGORY ? null : getEncyclopediaCategory(categoryId),
    showClear: categoryId !== ALL_CATEGORY || query.trim() !== '',
  };
};