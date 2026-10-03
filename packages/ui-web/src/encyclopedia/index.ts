/**
 * 共源百科：目录数据、正文寻址、检索与页面视图。
 *
 * 本 subpath 是百科在两个运行时的完整承载：`apps/web` 与 `apps/desktop` 从这里读同一份目录、用同一
 * 对视图，因此不会出现"共享包里的 Desktop 副本"与 Web 原实现并存（`DESK-PROD-002`）。
 *
 * 宿主需要提供的只有三样：路由（`onNavigate`）、正文服务根（`contentSource`）、以及 fragment
 * （`hash`）。三者都是宿主事实，共享层一律不推断。
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
  parseEncyclopediaFilter,
  serializeEncyclopediaFilter,
  useEncyclopediaFilter,
  useFilteredEncyclopediaEntries,
  type EncyclopediaCategoryFilter,
  type EncyclopediaFilter,
  type EncyclopediaFilteredEntries,
} from './filter';

export {
  useEncyclopediaContent,
  useEncyclopediaEntryHref,
  type EncyclopediaContentState,
} from './use-encyclopedia-content';

export {
  EncyclopediaEntryView,
  type EncyclopediaEntryViewProps,
} from './EncyclopediaEntryView';

export {
  EncyclopediaIndexView,
  type EncyclopediaIndexViewProps,
} from './EncyclopediaIndexView';

export {
  EncyclopediaLinks,
  type EncyclopediaLinkItem,
  type EncyclopediaLinksProps,
} from './EncyclopediaLinks';