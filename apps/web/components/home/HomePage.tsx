'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  HOME_FEATURE_CATEGORIES,
  HOME_ACCOUNT_SECONDARY_LINKS,
  HomeAccountWelcome,
  HomePageView,
  type HomeAssetSource,
} from '@mahoshojo/ui-web/home';

import Footer from '@/components/Footer';
import { useAuth } from '@/lib/useAuth';
import { UserWithTitle } from '@/components/UserTitle';
import type { CapabilitySnapshot } from '@mahoshojo/ui-web/capability';
import { AVAILABLE } from '@mahoshojo/ui-web/capability';

/**
 * Web 的首页。
 *
 * 共享部分是首页布局、品牌 Hero、功能分组网格与百科入口卡（`@mahoshojo/ui-web/home`）；本文件负责 Web 特有的
 * 东西：账号欢迎语与 Footer。把它们一起搬进共享包会把 Web 在线 bootstrap 带进 Desktop
 * （`DESK-PROD-004`），因此这里刻意保持组装者的角色。
 *
 * ## 能力快照为什么是「全部可用」
 *
 * Web 上首页的 13 个入口都真实存在。快照仍然由宿主显式给出而不是让共享层默认全开，是为了让
 * 「可用性由宿主声明」这件事在两端是同一种形状——Desktop 只组装已交付的百科、本地库与设置入口。
 */
const WEB_CAPABILITIES: CapabilitySnapshot = Object.fromEntries(
  HOME_FEATURE_CATEGORIES.flatMap((category) => category.features.map((feature) => [feature.href, AVAILABLE])),
);

const WEB_ASSET_SOURCE: HomeAssetSource = { baseUrl: '/' };

export function HomePage() {
  const router = useRouter();
  const { user, userBadges, isAuthenticated, loading } = useAuth();

  return (
    <HomePageView
      assetSource={WEB_ASSET_SOURCE}
      capabilities={WEB_CAPABILITIES}
      onNavigate={(href) => { void router.push(href); }}
      account={(
            <HomeAccountWelcome
              state={loading ? 'loading' : isAuthenticated ? 'signed-in' : 'anonymous'}
              name={
                <UserWithTitle
                  username={user?.username || ''}
                  usernameClassName="text-pink-700"
                  titleClassName="text-xs"
                  badges={userBadges}
                  showBadges={true}
                />
              }
              primaryHref="/character-manager"
              secondaryLinks={HOME_ACCOUNT_SECONDARY_LINKS}
              onNavigate={(href) => {
                void router.push(href);
              }}
            />
      )}
      platformPromotion={(
        <aside
          data-testid="desktop-download-promotion"
          aria-label="桌面客户端下载"
          className="mx-auto mb-5 flex max-w-2xl flex-col gap-2 rounded-xl border border-(--app-border-strong) bg-(--app-surface-80) p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-semibold text-(--app-text)">
              🖥️ Windows 桌面客户端
            </p>
            <p className="mt-1 text-(--app-text-muted)">Windows 版独立应用，创作与本地作品管理更加方便。</p>
          </div>
          <Link
            prefetch={false}
            href="/download"
            className="shrink-0 font-semibold text-(--app-text) underline underline-offset-4"
          >
            查看版本与下载
          </Link>
        </aside>
      )}
      footer={<Footer className="footer" />}
    />
  );
}
