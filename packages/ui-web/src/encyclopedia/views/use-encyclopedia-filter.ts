/**
 * 共源百科的筛选 hook。
 *
 * 它建立在 `./filter` 的纯函数之上，因此真正的规则只有一份实现；hook 只负责"把状态记在 React 里"。
 *
 * 为什么与纯筛选分处两个 subpath：Server Component 也要读目录数据，而 Next 的 App Router 会在构建期
 * 拒绝任何经由 hook 的导入链。
 */
import { useMemo, useState } from 'react';

import {
  ALL_CATEGORY,
  filterEncyclopediaEntries,
  type EncyclopediaCategoryFilter,
  type EncyclopediaFilter,
  type EncyclopediaFilteredEntries,
} from '../filter';

export const useFilteredEncyclopediaEntries = ({
  query,
  categoryId,
}: EncyclopediaFilter): EncyclopediaFilteredEntries =>
  // 依赖写字段而不是对象本身：调用点每次渲染都会传一个新对象字面量，依赖对象会让 memo 永远失效。
  useMemo(() => filterEncyclopediaEntries({ query, categoryId }), [categoryId, query]);

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