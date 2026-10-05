/**
 * 共源百科：目录数据、正文寻址与筛选语义。
 *
 * ## 这个入口是 RSC 安全的
 *
 * 它只导出**纯**数据与纯函数，不 import 任何 React hook。Server Component（Web 的
 * `generateStaticParams` / `generateMetadata`，以及 `error-help`、`report-appeals` 这类服务端模块）
 * 从这里读目录，因此这条导入链上不能出现 `useState` / `useEffect`——否则 Next 的 App Router 会在
 * 构建期拒绝，而 jsdom 测试抓不到。
 *
 * React 视图与 hook 在 `./encyclopedia-views`。`tests/server-safe-subpaths.test.ts` 对这条边界加门禁。
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

export {
  ALL_CATEGORY,
  filterEncyclopediaEntries,
  parseEncyclopediaFilter,
  serializeEncyclopediaFilter,
  type EncyclopediaCategoryFilter,
  type EncyclopediaFilter,
  type EncyclopediaFilteredEntries,
} from './filter';