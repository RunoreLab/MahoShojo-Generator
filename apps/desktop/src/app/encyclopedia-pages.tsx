import { useParams, useRouter, useSearch } from '@tanstack/react-router';
import { parseEncyclopediaFilter, type EncyclopediaContentSource } from '@mahoshojo/ui-web/encyclopedia';
import { EncyclopediaEntryView, EncyclopediaIndexView } from '@mahoshojo/ui-web/encyclopedia-views';

import { useExternalLinks } from '../features/external-links/external-links-provider';
import {
  getRouteFragmentFromHashHistory,
  navigateByProductHref,
  resolveInternalHrefForHashHistory,
  type ProductHrefNavigateOptions,
} from './hash-history-fragment';

const DESKTOP_CONTENT_SOURCE: EncyclopediaContentSource = { baseUrl: '/' };

/**
 * 共源视图回传的是产品路径（`/encyclopedia?q=x`、`/encyclopedia/foo#锚`、同页 `#锚` 这类
 * 字符串）。`navigateByProductHref` 统一拆 `?`/`#` 并支持筛选写回的 `replace` 语义，
 * 不再在本文件重复拆分逻辑（D5.1-P2-r1）。
 */
const createDesktopNavigate = (router: ReturnType<typeof useRouter>) =>
  (href: string, options?: ProductHrefNavigateOptions) => navigateByProductHref(router, href, options);

const homeLink = (router: ReturnType<typeof useRouter>) => (
  <a
    href="#/"
    onClick={(event) => {
      event.preventDefault();
      void router.navigate({ to: '/' });
    }}
    className="text-blue-600 hover:underline"
  >
    返回首页
  </a>
);

/**
 * 百科目录。离线可用，不等待任何远端请求（`DESK-PROD-004`）。
 *
 * `?q` / `?c` 是可分享的筛选状态，语义与 Web 一致：写入由共享视图经 `onNavigate` 完成，
 * 恢复由这里把路由 search 喂回 `initialQuery` / `initialCategoryId`。
 */
export function DesktopEncyclopediaIndex() {
  const router = useRouter();
  const search = useSearch({ strict: false }) as { q?: string; c?: string };

  const params = new URLSearchParams();
  if (typeof search.q === 'string') params.set('q', search.q);
  if (typeof search.c === 'string') params.set('c', search.c);
  const initial = parseEncyclopediaFilter(params.toString());

  return (
    <EncyclopediaIndexView
      onNavigate={createDesktopNavigate(router)}
      resolveInternalHref={resolveInternalHrefForHashHistory}
      path="/encyclopedia"
      initialQuery={initial.query}
      initialCategoryId={initial.categoryId}
      headerLinks={homeLink(router)}
    />
  );
}

/**
 * 百科条目。
 *
 * fragment 必须由宿主注入，而 Desktop 的 hash history 让这件事不像看上去那么简单：
 * `window.location.hash` 在这里是整个 `#/encyclopedia/foo#heading`，直接喂给 `getElementById` 只会
 * 落空；而 `@tanstack/react-router` 解析后的 `location` 根本没有 `hash` 字段。因此由
 * `getRouteFragmentFromHashHistory` 从路由 href 里提取 fragment。
 *
 * 站内链接交给 router；站外链接经 `openContent` 默认先确认域名，再由
 * `open_external_url` 交给系统浏览器（DESK-PARITY-003）。
 */
export function DesktopEncyclopediaEntry() {
  const router = useRouter();
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const { openContent } = useExternalLinks();
  // 使用路由 href，使同页 fragment 变化也触发锚点更新。
  const fragment = getRouteFragmentFromHashHistory(router.state.location.href);

  return (
    <EncyclopediaEntryView
      slug={slug}
      contentSource={DESKTOP_CONTENT_SOURCE}
      resolveInternalHref={resolveInternalHrefForHashHistory}
      hash={fragment}
      onNavigate={createDesktopNavigate(router)}
      onNavigateExternal={openContent}
      headerLinks={homeLink(router)}
    />
  );
}
