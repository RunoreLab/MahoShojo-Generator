import type { ReactNode } from 'react';

import { readCapability, type CapabilitySnapshot } from '../capability/index';
// 直接指向模块而不是 views 的 barrel：barrel 会把该 feature 下所有 hook 一起拖进来，而首页
// 是 Server Component 会经过的路径（`app/page.tsx` 只需要目录数据与 preload 列表）。
import { EncyclopediaLinks } from '../encyclopedia/views/EncyclopediaLinks';
import {
  HOME_FEATURE_CATEGORIES,
  homeAssetUrl,
  type HomeAssetSource,
  type HomeFeature,
} from './feature-catalog';

export interface HomeHeroProps {
  readonly assetSource: HomeAssetSource;
  /** 亮暗两套 logo。缺省时只用 `lightSrc`。 */
  readonly lightSrc?: string;
  readonly darkSrc?: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly subtitle?: ReactNode;
}

/**
 * 共源品牌区。
 *
 * 它只渲染 logo 与一句产品语。账号欢迎语、Footer、远端图片与统计**不在这里**——那些是 Web 在线
 * bootstrap 的一部分，`DESK-PROD-004` 明确禁止本地壳自动发起项目请求。
 */
export function HomeHero({
  assetSource,
  lightSrc = 'logo.svg',
  darkSrc = 'logo-white.svg',
  alt = '魔法少女生成器',
  width = 280,
  height = 180,
  subtitle,
}: HomeHeroProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      {/* 两套 logo 各引一次并由 CSS 显隐：与既有 Web 形态一致，也不依赖宿主提供主题状态。 */}
      <img
        src={homeAssetUrl(assetSource, lightSrc)}
        data-testid="home-logo-light"
        width={width}
        height={height}
        alt={alt}
        className="dark:hidden"
      />
      <img
        src={homeAssetUrl(assetSource, darkSrc)}
        data-testid="home-logo-dark"
        width={width}
        height={height}
        alt={alt}
        className="hidden dark:block"
      />
      {subtitle ? <p className="subtitle text-center">{subtitle}</p> : null}
    </div>
  );
}

export interface HomeEncyclopediaCardProps {
  readonly assetSource: HomeAssetSource;
  readonly onNavigate: (href: string) => void;
  /** 首页推荐位。要素 slug 变化时由宿主给出新的文案。 */
  readonly recommended?: readonly { readonly slug: string; readonly text?: string }[];
}

/**
 * 首页的百科入口。
 *
 * 它值得单独成为一个组件而不是目录页的附属品：Desktop 首屏能打开的页面只有百科与本地库，
 * 百科因此是本地运行时**唯一**能读完全部产品文档的入口（`DESK-PROD-004`）。
 */
export function HomeEncyclopediaCard({ assetSource, onNavigate, recommended }: HomeEncyclopediaCardProps) {
  return (
    <div className="flex flex-col gap-3">
      {recommended ? (
        <EncyclopediaLinks
          items={recommended}
          onNavigate={onNavigate}
          label="新手推荐："
          className="flex flex-wrap justify-center gap-3 text-xs"
        />
      ) : null}
      <div className="flex justify-center">
        <a
          href="/encyclopedia"
          onClick={(event) => {
            event.preventDefault();
            onNavigate('/encyclopedia');
          }}
          className="group w-full max-w-md rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-left transition-colors hover:bg-blue-50"
        >
          <div className="flex items-center gap-3">
            <img
              src={homeAssetUrl(assetSource, 'encyclopedia.svg')}
              width={160}
              height={64}
              alt="百科"
              className="shrink-0"
            />
            <div className="min-w-0">
              <div className="text-base font-semibold leading-tight text-blue-800">百科目录</div>
              <div className="text-xs text-blue-700/80">使用说明 / 规则 / 进阶</div>
            </div>
            <span className="ml-auto text-xs text-blue-700 group-hover:underline">打开</span>
          </div>
        </a>
      </div>
    </div>
  );
}

export interface HomeFeatureGridProps {
  readonly assetSource: HomeAssetSource;
  readonly capabilities: CapabilitySnapshot;
  readonly onNavigate: (href: string) => void;
  /** 不可用入口的处置方式，与 `ProductNav` 同一套语义。 */
  readonly unavailable?: 'hide' | 'explain';
  readonly categories?: typeof HOME_FEATURE_CATEGORIES;
}

/**
 * 共源功能分组网格。
 *
 * ## 为什么默认 `hide` 而不是把 13 个入口都标灰
 *
 * 13 个入口在 Desktop 首期只有一个可用。把另外 12 个全部渲染成禁用项，得到的是一张 roadmap 展板，
 * 而不是产品首页——`ProductNav` 的注释已经写过同一句话：把 18 个入口里 15 个标灰的导航不是导航。
 * 因此缺省丢弃不可用项，`'explain'` 留给已经交付大部分范围的宿主。
 *
 * ## 可用性由宿主给，不在这里判断
 *
 * 共享层只按 `capabilities` 过滤，绝不硬编码「哪些可用」。D3.1/D3.2/D3.3 交付后宿主往快照里加一条，
 * 这里的入口自动点亮，视图代码一行不改。
 */
export function HomeFeatureGrid({
  assetSource,
  capabilities,
  onNavigate,
  unavailable = 'hide',
  categories = HOME_FEATURE_CATEGORIES,
}: HomeFeatureGridProps) {
  const reason = (feature: HomeFeature): string => {
    const availability = readCapability(capabilities, feature.href);
    switch (availability.kind) {
      case 'available':
        return '';
      case 'unknown':
        return '当前运行时未声明此入口的可用状态';
      case 'unavailable':
        return availability.detail ?? '尚未在当前运行时交付';
    }
  };

  const featureTile = (feature: HomeFeature) => {
    const availability = readCapability(capabilities, feature.href);
    const isAvailable = availability.kind === 'available';
    const className = ['feature-button', feature.className, isAvailable ? '' : 'opacity-50']
      .filter((value): value is string => Boolean(value))
      .join(' ');

    if (!isAvailable) {
      return unavailable === 'hide' ? null : (
        <span key={feature.id} className={className} aria-disabled="true" title={reason(feature)}>
          <div className="feature-button-content">
            <div className="feature-title-container">
              <img
                src={homeAssetUrl(assetSource, feature.assetFile)}
                width={feature.width}
                height={feature.height}
                alt={feature.alt}
                className="feature-title-svg"
              />
            </div>
          </div>
        </span>
      );
    }

    return (
      <a
        key={feature.id}
        href={feature.href}
        onClick={(event) => {
          event.preventDefault();
          onNavigate(feature.href);
        }}
        className={className}
      >
        <div className="gradient-overlay" />
        <div className="feature-button-content">
          <div className="feature-title-container">
            <img
              src={homeAssetUrl(assetSource, feature.assetFile)}
              width={feature.width}
              height={feature.height}
              alt={feature.alt}
              className="feature-title-svg"
            />
          </div>
        </div>
      </a>
    );
  };

  return (
    <div className="space-y-8" data-testid="home-feature-grid">
      {categories.map((category) => {
        const tiles = category.features.map(featureTile).filter(Boolean);
        if (tiles.length === 0) return null;

        return (
          <div key={category.id} className="feature-category">
            <h2 className="mb-4 text-center text-lg font-semibold text-pink-700">{category.title}</h2>
            <div className={`feature-grid ${category.columns === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {tiles}
            </div>
          </div>
        );
      })}
    </div>
  );
}