/**
 * 共源百科的筛选 hook。
 *
 * 它建立在 `./filter` 的纯函数之上，因此真正的规则只有一份实现；hook 只负责"把状态记在 React 里"。
 *
 * 为什么与纯筛选分处两个 subpath：Server Component 也要读目录数据，而 Next 的 App Router 会在构建期
 * 拒绝任何经由 hook 的导入链。
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ALL_CATEGORY,
  filterEncyclopediaEntries,
  type EncyclopediaCategoryFilter,
  type EncyclopediaFilter,
  type EncyclopediaFilteredEntries,
} from '../filter';

/**
 * 宿主侧「跳到某个产品 href」的导航回调。
 *
 * `replace` 供筛选写回 URL 这类高频、不应产生历史条目的变更使用——逐按键 `push`
 * 会让一次输入占十几条历史记录，后退键要按很久才能离开目录页。
 */
export type EncyclopediaNavigate = (
  href: string,
  options?: { readonly replace?: boolean },
) => void;

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
  /**
   * 最近一次「由本组件 commit 产生」的值，用来区分两种 initial 变化：
   *
   * - **回声**：commit → onChange 写回 URL → 宿主把新 search 喂回 `initial`。
   *   等于 lastCommitted，跳过——否则用户正在输入的内容会被自己的回声打回。
   * - **外部导航**：后退/前进或程序化跳转把 URL 改到别的值。不等于
   *   lastCommitted → 同步进本地状态（D5.1-P2-r1：同页 `?q=a↔?q=b` 的
   *   back/forward 此前不生效，筛选框停在旧值）。
   */
  const lastCommitted = useRef<EncyclopediaFilter>(initial);

  useEffect(() => {
    const committed = lastCommitted.current;
    if (initial.query === committed.query && initial.categoryId === committed.categoryId) return;
    const next = { query: initial.query, categoryId: initial.categoryId };
    lastCommitted.current = next;
    setFilter(next);
  }, [initial.categoryId, initial.query]);

  const commit = (next: EncyclopediaFilter) => {
    lastCommitted.current = next;
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