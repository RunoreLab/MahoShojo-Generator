'use client';

import { useRouter } from 'next/navigation';

import {
  HOME_FEATURE_CATEGORIES,
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
                  usernameClassName="text-pink-700 font-semibold"
                  titleClassName="text-xs"
                  badges={userBadges}
                  showBadges={true}
                />
              }
              primaryHref="/character-manager"
              secondaryLinks={[{ href: '/me', label: '个人页：战报记录（测试版）' }]}
              onNavigate={(href) => {
                void router.push(href);
              }}
            />
      )}
      footer={<Footer className="footer" />}
    />
  );
}
