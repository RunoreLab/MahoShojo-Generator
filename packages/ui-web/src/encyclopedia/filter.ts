import { useMemo, useState } from 'react';

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

/** 目录页与条目页共用的筛选状态。 */
export interface EncyclopediaFilter {
  readonly query: string;
  readonly categoryId: EncyclopediaCategoryFilter;
}

export const ALL_CATEGORY: EncyclopediaCategoryFilter = 'all';

/**
 * 从 URL query 解析筛选状态。
 *
 * `c` 必须是已声明的分类，否则退回 `all`。这条容错是必需的而不是防御性编程：分类集合会随内容增长，
 * 而旧链接与外部链接里的 `?c=` 不会跟着更新，一个未知分类渲染出"分类：undefined"比忽略它糟糕。
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
 * 目录页与条目页侧栏共用的筛选计算。
 *
 * 抽出来是因为两处必须给出**完全一致**的数字：目录页的分类计数与条目页侧栏的条目列表如果各算一次，
 * 它们会在某次内容改动后开始互相矛盾，而用户看到的是"侧栏说有 8 篇、目录只列出 7 篇"。
 *
 * 检索的是标题、摘要与关键词，不含正文——这是元数据检索而不是全文检索（D3.0 明确不做全文搜索）。
 */
export const useFilteredEncyclopediaEntries = ({
  query,
  categoryId,
}: EncyclopediaFilter): EncyclopediaFilteredEntries => {
  const entries = useMemo(
    () =>
      encyclopediaEntries.filter((entry) => {
        if (categoryId !== ALL_CATEGORY && entry.categoryId !== categoryId) return false;
        return matchEncyclopediaEntry(entry, query);
      }),
    [categoryId, query],
  );

  const counts = useMemo(() => {
    const result: Record<string, { total: number; matched: number }> = {
      [ALL_CATEGORY]: { total: encyclopediaEntries.length, matched: entries.length },
    };
    for (const category of encyclopediaCategories) result[category.id] = { total: 0, matched: 0 };

    for (const entry of encyclopediaEntries) {
      result[entry.categoryId] ??= { total: 0, matched: 0 };
      result[entry.categoryId].total += 1;
    }
    for (const entry of entries) {
      result[entry.categoryId] ??= { total: 0, matched: 0 };
      result[entry.categoryId].matched += 1;
    }

    return result;
  }, [entries]);

  return {
    entries,
    counts,
    grouped: groupEncyclopediaEntries([...entries]),
    selectedCategory: categoryId === ALL_CATEGORY ? null : getEncyclopediaCategory(categoryId),
    showClear: categoryId !== ALL_CATEGORY || query.trim() !== '',
  };
};

/**
 * 受控筛选状态。
 *
 * `ready` 让宿主决定何时开始把状态同步回 URL。目录页在首帧就同步，条目页侧栏只改本地状态——
 * 把「要不要写回 URL」交给调用点，而不是在这里猜。
 */
export const useEncyclopediaFilter = ({
  initial,
  ready = true,
  onChange,
}: {
  readonly initial: EncyclopediaFilter;
  readonly ready?: boolean;
  readonly onChange?: (next: EncyclopediaFilter) => void;
}): EncyclopediaFilter & {
  readonly setQuery: (query: string) => void;
  readonly setCategoryId: (categoryId: EncyclopediaCategoryFilter) => void;
  readonly reset: () => void;
} => {
  const [filter, setFilter] = useState<EncyclopediaFilter>(initial);

  const commit = (next: EncyclopediaFilter) => {
    setFilter(next);
    if (ready) onChange?.(next);
  };

  return {
    ...filter,
    setQuery: (query) => commit({ ...filter, query }),
    setCategoryId: (categoryId) => commit({ ...filter, categoryId }),
    reset: () => commit({ query: '', categoryId: ALL_CATEGORY }),
  };
};