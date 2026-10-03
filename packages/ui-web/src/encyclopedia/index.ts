/**
 * 共源百科：目录数据、正文寻址与检索。
 *
 * 本 subpath 目前只交付**数据层**（目录、分类、检索、正文 URL）。目录页与条目页视图属于 D3.0c，
 * 它们与本文件一起构成百科在两个运行时的完整承载。
 *
 * 它不开根 barrel，也不导出 React 组件以外的副作用：`apps/web` 与 `apps/desktop` 从这里读到的
 * 必须是同一份目录数据，`DESK-PROD-002` 明确不允许共享包里的 Desktop 副本与 Web 原实现并存。
 */
export {
  encyclopediaCategories,
  encyclopediaEntries,
  getEncyclopediaCategory,
  getEncyclopediaEntry,
  groupEncyclopediaEntries,
  matchEncyclopediaEntry,
  normalizeEncyclopediaSearchText,
  type EncyclopediaCategory,
  type EncyclopediaCategoryId,
  type EncyclopediaEntry,
} from './catalog';

export {
  ENCYCLOPEDIA_CONTENT_PREFIX,
  encyclopediaContentUrl,
  type EncyclopediaContentSource,
} from './content-source';