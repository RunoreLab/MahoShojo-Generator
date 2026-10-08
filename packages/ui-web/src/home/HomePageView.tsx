import type { ReactNode } from 'react';

import { HOME_FEATURE_CATEGORIES, HOME_RECOMMENDED_ENTRIES } from './feature-catalog';
import {
  HomeEncyclopediaCard,
  HomeFeatureGrid,
  HomeHero,
  type HomeFeatureGridProps,
} from './HomeView';

export interface HomePageViewProps extends Omit<HomeFeatureGridProps, 'categories'> {
  /** 身份读取、徽章和登录动作由宿主投影，不在共享首页发起请求。 */
  readonly account?: ReactNode;
  readonly platformNotice?: ReactNode;
  readonly platformTools?: ReactNode;
  readonly footer?: ReactNode;
}

/** 成熟 Web 首页的完整布局闭包；宿主只注入身份、能力与原生专属区段。 */
export function HomePageView({
  assetSource,
  capabilities,
  onNavigate,
  resolveInternalHref,
  unavailable,
  account,
  platformNotice,
  platformTools,
  footer,
}: HomePageViewProps) {
  return (
    <div data-testid="page-home" className="magic-background-white">
      <div className="container">
        <div className="card">
          <HomeHero assetSource={assetSource} subtitle="欢迎来到魔法国度！选择一个项目开始玩耍吧！" />
          {account}
          <HomeEncyclopediaCard
            assetSource={assetSource}
            onNavigate={onNavigate}
            resolveInternalHref={resolveInternalHref}
            recommended={HOME_RECOMMENDED_ENTRIES}
          />
          <div className="mt-4">
            <HomeFeatureGrid
              assetSource={assetSource}
              categories={HOME_FEATURE_CATEGORIES}
              capabilities={capabilities}
              onNavigate={onNavigate}
              resolveInternalHref={resolveInternalHref}
              unavailable={unavailable}
            />
          </div>
          <div className="mt-8 text-center">
            <p className="text-sm italic text-gray-500">设定来源于小说《下班，然后变成魔法少女》</p>
          </div>
          {platformNotice ? <div className="mt-4 text-center text-sm text-(--app-text-muted)">{platformNotice}</div> : null}
          {platformTools ? <div className="mt-6">{platformTools}</div> : null}
        </div>
        {footer}
      </div>
    </div>
  );
}
