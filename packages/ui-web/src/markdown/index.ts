/**
 * 共源 Markdown 渲染层。
 *
 * ## 抽出来的是什么，不是什么
 *
 * **是**：渲染骨架（GFM + 数学 + 表格/列表排版）、heading slug、fragment 滚动、站外媒体机制、
 * 站内外导航策略注入点，以及一个纯文本工具函数。
 *
 * **不是**：任何宿主行为。`next/link`、`unified` 的领域插件（竞技场战报表格）、外部媒体白名单、
 * 具体 router，全部由宿主注入。`apps/web` 的 `MarkdownBlock.tsx` 因此变成一个很薄的包装：它把
 * Web 自己的插件与白名单传进来，其余走共享实现——`DESK-PROD-002` 要求 Web 与 Desktop 回用同一
 * 实现，而不是共享包留一份、Web 另留一份。
 *
 * heading id 是**显式 opt-in**（`headingIds?: false | 'github'`），理由见 `heading-slug.ts`。
 */
export {
  MarkdownBlock,
  type MarkdownBlockMode,
  type MarkdownBlockProps,
  type MarkdownBlockVariant,
  type InternalLinkRenderProps,
  type MarkdownNavigationPolicy,
  type MarkdownPlugin,
} from './MarkdownBlock';

export { useHashScrollTarget, type HashScrollTargetOptions } from './use-hash-scroll-target';

/**
 * 纯文本部分从 `./markdown-text` 导出，这里同时再导出一次。
 *
 * 客户端组件从 `./markdown` 一处拿全；服务端代码必须走 `./markdown-text`，否则会把 React hook 拖进
 * Route Handler 的导入链。两条路径的分工在各自的模块注释里写明。
 */
export {
  DENY_EXTERNAL_MEDIA,
  createHeadingSlugger,
  decodeFragmentId,
  detectMediaKindByExtension,
  fixNestedListIndentation,
  formatMarkdownImage,
  formatMarkdownLink,
  isExternalMarkdownHref,
  normalizeMarkdownHref,
  slugifyHeading,
  stripLeadingMatchingTitle,
  type ExternalMediaKind,
  type ExternalMediaPolicy,
} from './text/index';