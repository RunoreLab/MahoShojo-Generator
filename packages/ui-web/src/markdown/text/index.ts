/**
 * 共源 Markdown 的**纯**部分：文本变换、heading slug、媒体识别机制与降级文案。
 *
 * ## 为什么单独一个入口
 *
 * Next 的 App Router 有一条构建期边界：**Server Component 的导入链上不能出现 React hook**。Web 的
 * Route Handler（`app/api/media-proxy/route.ts`）只需要这里的降级文案函数，而它经由
 * `apps/web/lib/markdown/externalMedia.ts` 拿——那条链上不能有 hook，否则 `next build` 直接失败，
 * 而 jsdom 测试全绿。
 *
 * 因此凡是「服务端也可能需要的纯逻辑」都放这里，React 渲染与滚动 hook 留在 `./markdown`。
 * `tests/server-safe-shared-subpaths.test.ts` 对这条边界加静态门禁。
 */
export {
  createHeadingSlugger,
  decodeFragmentId,
  slugifyHeading,
} from './heading-slug';

export { fixNestedListIndentation } from './fix-nested-list-indentation';

export { stripLeadingMatchingTitle } from './strip-leading-matching-title';

export {
  DENY_EXTERNAL_MEDIA,
  detectMediaKindByExtension,
  formatMarkdownImage,
  formatMarkdownLink,
  isExternalMarkdownHref,
  normalizeMarkdownHref,
  type ExternalMediaKind,
  type ExternalMediaPolicy,
} from './external-media';
