'use client';

import { useRouter } from 'next/navigation';

import {
  HomeEncyclopediaCard,
  HomeFeatureGrid,
  HomeHero,
  type HomeAssetSource,
} from '@mahoshojo/ui-web/home';

import { HOME_FEATURE_CATEGORIES } from '@/config/features';
import Footer from '@/components/Footer';
import { useAuth } from '@/lib/useAuth';
import { UserWithTitle } from '@/components/UserTitle';
import type { CapabilitySnapshot } from '@mahoshojo/ui-web/capability';
import { AVAILABLE } from '@mahoshojo/ui-web/capability';

/**
 * Web 的首页。
 *
 * 共享部分是品牌 Hero、功能分组网格与百科入口卡（`@mahoshojo/ui-web/home`）；本文件负责 Web 特有的
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
    <>
      <div className="magic-background-white">
        <div className="container">
          <div className="card">
            <HomeHero
              assetSource={WEB_ASSET_SOURCE}
              subtitle="欢迎来到魔法国度！选择一个项目开始玩耍吧！"
            />

            {(loading || isAuthenticated) && (
              <div className="mb-4 flex justify-center">
                {loading ? (
                  <span className="text-sm text-gray-600">加载中...</span>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <a
                      href="/character-manager"
                      onClick={(event) => {
                        event.preventDefault();
                        void router.push('/character-manager');
                      }}
                      className="inline-flex items-center rounded-lg bg-pink-100 px-4 py-2 text-sm text-pink-700 transition-colors hover:bg-pink-200"
                    >
                      <span>欢迎回来，</span>
                      <UserWithTitle
                        username={user?.username || ''}
                        usernameClassName="text-pink-700 font-semibold"
                        titleClassName="text-xs"
                        badges={userBadges}
                        showBadges={true}
                      />
                      <span className="ml-2">点击进入档案馆</span>
                    </a>
                    <a
                      href="/me"
                      onClick={(event) => {
                        event.preventDefault();
                        void router.push('/me');
                      }}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      个人页：战报记录（测试版）
                    </a>
                  </div>
                )}
              </div>
            )}

            <HomeEncyclopediaCard
              assetSource={WEB_ASSET_SOURCE}
              onNavigate={(href) => {
                void router.push(href);
              }}
              recommended={[
                { slug: 'site-guide', text: '站内功能速览（从生成到对战）' },
                { slug: 'newbie-guide', text: '新手攻略（强度直觉）' },
                { slug: 'community-rules', text: '社区守则与竞技场规范（必读）' },
              ]}
            />

            <div className="mt-4">
              <HomeFeatureGrid
                categories={HOME_FEATURE_CATEGORIES}
                assetSource={WEB_ASSET_SOURCE}
                capabilities={WEB_CAPABILITIES}
                onNavigate={(href) => {
                  void router.push(href);
                }}
              />
            </div>

            <div className="mt-8 text-center">
              <p className="text-sm italic text-gray-500">设定来源于小说《下班，然后变成魔法少女》</p>
            </div>
          </div>

          <Footer className="footer" />
        </div>
      </div>
    </>
  );
}
