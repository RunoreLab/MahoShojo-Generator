import { useParams, useRouter } from '@tanstack/react-router';
import type { EncyclopediaContentSource } from '@mahoshojo/ui-web/encyclopedia';
import { EncyclopediaEntryView, EncyclopediaIndexView } from '@mahoshojo/ui-web/encyclopedia-views';

import { getRouteFragmentFromHashHistory } from './hash-history-fragment';

const DESKTOP_CONTENT_SOURCE: EncyclopediaContentSource = { baseUrl: '/' };

/** 百科目录。离线可用，不等待任何远端请求（`DESK-PROD-004`）。 */
export function DesktopEncyclopediaIndex() {
  const router = useRouter();
  return (
    <EncyclopediaIndexView
      onNavigate={(href) => {
        void router.navigate({ to: href });
      }}
      path="/encyclopedia"
      headerLinks={
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
      }
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
 * 站内链接交给 router，站外链接不提供处理器：Desktop 没有 opener 能力，于是它们渲染成不可执行
 * 并说明原因，而不是留一个点了没反应的链接。
 */
export function DesktopEncyclopediaEntry() {
  const router = useRouter();
  const { slug } = useParams({ strict: false }) as { slug?: string };
  // 使用路由 href，使同页 fragment 变化也触发锚点更新。
  const fragment = getRouteFragmentFromHashHistory(router.state.location.href);

  return (
    <EncyclopediaEntryView
      slug={slug}
      contentSource={DESKTOP_CONTENT_SOURCE}
      hash={fragment}
      onNavigate={(href) => {
        void router.navigate({ to: href });
      }}
      headerLinks={
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
      }
    />
  );
}

