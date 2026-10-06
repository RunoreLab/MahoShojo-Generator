/**
 * 共源百科的 React 视图与 hook。
 *
 * ## 为什么与 `./encyclopedia` 分开
 *
 * `apps/web/app/encyclopedia/[slug]/page.tsx` 是 Server Component：`generateStaticParams` 与
 * `generateMetadata` 读目录数据。若它经过的模块里出现 `useState` / `useEffect`，Next 的 App Router
 * 会在**构建期**直接拒绝——`You're importing a component that needs useState`。jsdom 测试覆盖不到
 * 这条边界，只有 `next build` 能抓到。
 *
 * 因此本 subpath 只装 React 侧的东西（视图、hook、正文取回），而 `./encyclopedia` 保持纯数据与纯
 * URL 语义，任何地方都能 import。`packages/README.md` 要求显式 feature subpath 而不是根 barrel，
 * 这条要求在这里有了具体含义：**面向 RSC 的数据入口与面向客户端的视图入口必须是两条路径**。
 */
export {
  useEncyclopediaFilter,
  useFilteredEncyclopediaEntries,
  type EncyclopediaNavigate,
} from './use-encyclopedia-filter';

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

export {
  EncyclopediaPageFrame,
  type EncyclopediaPageFrameProps,
} from './EncyclopediaPageFrame';