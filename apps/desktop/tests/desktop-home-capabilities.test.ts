import { describe, expect, it } from 'vitest';

import { readCapability } from '@mahoshojo/ui-web/capability';

import { DECLARED_PRODUCT_PATHS, buildCapabilitySnapshot } from '../src/app/capabilities';
import { DELIVERED_ROUTES } from '../src/app/delivered-routes';

/** Desktop 能力声明不把 Web 首页功能清单当成交付承诺。 */
describe('desktop capability snapshot', () => {
  const snapshot = buildCapabilitySnapshot();

  it('covers every navigation entry, including external ones', () => {
    for (const href of DECLARED_PRODUCT_PATHS) {
      expect(snapshot, `能力快照缺少入口 ${href}`).toHaveProperty(href);
    }
  });

  it('does not declare Web-only homepage entries', () => {
    for (const href of ['/canshou', '/character-party', '/magic-tea-party', '/card-forge']) {
      expect(readCapability(snapshot, href).kind).toBe('unknown');
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
