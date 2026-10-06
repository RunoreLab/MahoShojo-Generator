import type { MouseEvent, ReactNode } from 'react';

import { readCapability, type CapabilitySnapshot } from '../capability/index';
// 直接指向模块而不是 views 的 barrel：barrel 会把该 feature 下所有 hook 一起拖进来，而首页
// 是 Server Component 会经过的路径（`app/page.tsx` 只需要目录数据与 preload 列表）。
import { EncyclopediaLinks } from '../encyclopedia/views/EncyclopediaLinks';
import {
  homeAssetUrl,
  type HomeAssetSource,
  type HomeFeature,
  type HomeFeatureCategory,
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
 * bootstrap 的一部分，`DESK-PROD-004` 要求共享页面不因复用隐式挂载这些启动行为。
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

export interface HomeAccountWelcomeLink {
  readonly href: string;
  readonly label: string;
}

export interface HomeAccountWelcomeProps {
  /**
   * 账号区状态机：宿主**已验证**才给 `'signed-in'`；`'anonymous'` 渲染为空而不是
   * 显示「未登录」文案——未验证的凭据不冒称已注销（DESK-ONLINE-008 同一句话）。
   */
  readonly state: 'loading' | 'signed-in' | 'anonymous';
  /** signed-in 时注入的展示名节点（Web 可挂徽章，Desktop 为纯文本）。 */
  readonly name?: ReactNode;
  /** signed-in 的主入口（档案馆）。 */
  readonly primaryHref: string;
  /** 次级入口；宿主按真实交付投影，不给就不渲染。 */
  readonly secondaryLinks?: readonly HomeAccountWelcomeLink[];
  readonly onNavigate: (href: string) => void;
  /** 渲染 `<a href>` 时把产品路径解析成运行时 href（Desktop hash history 传 `#` 前缀）。 */
  readonly resolveInternalHref?: ((href: string) => string) | undefined;
}

/**
 * 首页账号欢迎区。
 *
 * 结构共源、身份宿主投影：共享层只摆放「欢迎回来，<谁> 点击进入档案馆」这一产品形态，
 * 至于这个「谁」是带徽章的用户组件还是纯文本用户名，由宿主在已验证身份后注入。
 */
export function HomeAccountWelcome({
  state,
  name,
  primaryHref,
  secondaryLinks,
  onNavigate,
  resolveInternalHref,
}: HomeAccountWelcomeProps) {
  if (state === 'anonymous') return null;

  const navigate = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onNavigate(href);
  };

  return (
    <div className="mb-4 flex justify-center" data-testid="home-account-welcome">
      {state === 'loading' ? (
        <span className="text-sm text-gray-600">加载中...</span>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <a
            href={resolveInternalHref?.(primaryHref) ?? primaryHref}
            onClick={navigate(primaryHref)}
            className="inline-flex items-center rounded-lg bg-pink-100 px-4 py-2 text-sm text-pink-700 transition-colors hover:bg-pink-200"
          >
            <span>欢迎回来，</span>
            {name}
            <span className="ml-2">点击进入档案馆</span>
          </a>
          {secondaryLinks?.map((link) => (
            <a
              key={link.href}
              href={resolveInternalHref?.(link.href) ?? link.href}
              onClick={navigate(link.href)}
              className="text-sm text-blue-600 hover:underline"
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export interface HomeEncyclopediaCardProps {
  readonly assetSource: HomeAssetSource;
  readonly onNavigate: (href: string) => void;
  /** 渲染 `<a href>` 时把产品路径解析成运行时 href（Desktop hash history 传 `#` 前缀）。 */
  readonly resolveInternalHref?: ((href: string) => string) | undefined;
  /** 首页推荐位。要素 slug 变化时由宿主给出新的文案。 */
  readonly recommended?: readonly { readonly slug: string; readonly text?: string }[];
}

/**
 * 首页的百科入口。
 *
 * 它值得单独成为一个组件而不是目录页的附属品：Desktop 首屏能打开的页面只有百科与本地库，
 * 百科因此是本地运行时**唯一**能读完全部产品文档的入口（`DESK-PROD-004`）。
 */
export function HomeEncyclopediaCard({ assetSource, onNavigate, resolveInternalHref, recommended }: HomeEncyclopediaCardProps) {
  return (
    <div className="flex flex-col gap-3">
      {recommended ? (
        <EncyclopediaLinks
          items={recommended}
          onNavigate={onNavigate}
          {...(resolveInternalHref ? { resolveInternalHref } : {})}
          label="新手推荐："
          className="flex flex-wrap justify-center gap-3 text-xs"
        />
      ) : null}
      <div className="flex justify-center">
        <a
          href={resolveInternalHref?.('/encyclopedia') ?? '/encyclopedia'}
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
  /** 渲染 `<a href>` 时把产品路径解析成运行时 href（Desktop hash history 传 `#` 前缀）。 */
  readonly resolveInternalHref?: ((href: string) => string) | undefined;
  /** 不可用入口的处置方式，与共源顶栏同一套语义。 */
  readonly unavailable?: 'hide' | 'explain';
  /** 宿主提供实际功能清单，共享层不预设 Web 或 Desktop inventory。 */
  readonly categories: readonly HomeFeatureCategory[];
}

/** 共源功能分组网格，按宿主提供的清单与能力过滤不可执行入口。 */
export function HomeFeatureGrid({
  assetSource,
  capabilities,
  onNavigate,
  resolveInternalHref,
  unavailable = 'hide',
  categories,
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
        href={resolveInternalHref?.(feature.href) ?? feature.href}
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
