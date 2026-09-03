/**
 * 在数组内移动元素；越界或原地移动时原样返回副本。
 * roster/分队/情景/素材的共享 adapter 共用同一重排语义。
 */
export const moveItemInList = <Item,>(
  items: readonly Item[],
  fromIndex: number,
  toIndex: number,
): Item[] => {
  const next = [...items];
  if (
    fromIndex < 0
    || fromIndex >= next.length
    || toIndex < 0
    || toIndex >= next.length
    || fromIndex === toIndex
  ) return next;
  const [item] = next.splice(fromIndex, 1);
  if (item !== undefined) next.splice(toIndex, 0, item);
  return next;
};
