import { describe, expect, it } from 'vitest';

import { readCapability } from '@mahoshojo/ui-web/capability';
import { HOME_FEATURE_CATEGORIES } from '@mahoshojo/ui-web/home';

import { DECLARED_PRODUCT_PATHS, buildCapabilitySnapshot } from '../src/app/capabilities';
import { DELIVERED_ROUTES } from '../src/app/delivered-routes';

/**
 * D3.0 的导航能力快照。
 *
 * ## 为什么这里同时断言 `NAV_GROUPS ∪ HOME_FEATURES`
 *
 * 首页功能卡指向的路径里，`/details`、`/canshou`、`/character-party`、`/magic-tea-party`、
 * `/card-forge` 都不在 `NAV_GROUPS` 里——它们只在首页出现。如果快照只遍历导航入口，这五条会落在
 * `unknown`，于是首页把它们显示成「未声明」。那是一个错误的理由：用户点的是首页上的按钮，它的问题
 * 不是本仓库没声明，是该页面尚未在本地运行时交付。
 */
describe('desktop capability snapshot', () => {
  const snapshot = buildCapabilitySnapshot();

  it('covers every navigation entry, including external ones', () => {
    for (const href of DECLARED_PRODUCT_PATHS) {
      expect(snapshot, `能力快照缺少入口 ${href}`).toHaveProperty(href);
    }
  });

  it('covers every home feature, not just the navigation groups', () => {
    for (const category of HOME_FEATURE_CATEGORIES) {
      for (const feature of category.features) {
        expect(snapshot, `能力快照缺少首页入口 ${feature.href}`).toHaveProperty(feature.href);
        expect(readCapability(snapshot, feature.href).kind, `${feature.href} 不应是未声明`).not.toBe('unknown');
      }
    }
  });

  it('marks exactly the delivered routes as available', () => {
    for (const href of DELIVERED_ROUTES) {
      expect(readCapability(snapshot, href), `${href} 应当可用`).toEqual({ kind: 'available' });
    }
  });

  it('marks undelivered product pages as not implemented rather than unknown', () => {
    const undelivered = DECLARED_PRODUCT_PATHS.filter((href) => !DELIVERED_ROUTES.includes(href));
    expect(undelivered.length).toBeGreaterThan(0);

    for (const href of undelivered) {
      const availability = readCapability(snapshot, href);
      expect(availability.kind, `${href} 不应是未声明`).toBe('unavailable');
      if (availability.kind === 'unavailable') {
        expect(availability.reason, `${href} 应当给出具体原因`).toBe('not-implemented');
      }
    }
  });

  it('marks external entries as blocked by the missing opener capability', () => {
    // 站外入口的问题不是「本仓库没声明」，是宿主没有打开外部站点的能力。理由不同，文案也不同。
    const external = ['https://wantu-waystation.pages.dev/'];
    for (const href of external) {
      const availability = readCapability(snapshot, href);
      expect(availability.kind, `${href} 不应是未声明`).toBe('unavailable');
      if (availability.kind === 'unavailable') {
        expect(availability.detail).toContain('系统浏览器');
      }
    }
  });

  it('delivers the encyclopedia so the offline documentation is reachable', () => {
    // D3.0 的核心交付：未登录、无模型配置、项目服务器不可达时也能读到全部产品文档。
    expect(DELIVERED_ROUTES).toContain('/encyclopedia');
    expect(DELIVERED_ROUTES).toContain('/encyclopedia/[slug]');
  });
});