import { describe, expect, it } from 'vitest';

import { readCapability } from '@mahoshojo/ui-web/capability';
import { NAV_GROUPS } from '@mahoshojo/ui-web/navigation';

import { buildCapabilitySnapshot } from '../src/app/capabilities';
import { DELIVERED_ROUTES } from '../src/app/routes';

/**
 * 能力快照是「哪些入口在 Desktop 可点」的唯一判据。
 *
 * 这些断言守的不是快照的内容，而是它的**推导方式**：由 `DELIVERED_ROUTES` 推导意味着路由表与导航
 * 能力不可能分叉。分叉的方向恰好是最坏的那种——快照列出一个已删除的页面，用户就会拿到一个点了没
 * 反应的死链，而 `DESK-PROD-001` 明确禁止「可点击但失效」。
 */
describe('desktop capability snapshot', () => {
  const snapshot = buildCapabilitySnapshot();

  it('covers every navigation entry, including external ones', () => {
    // 遍历全部分组而不是只遍历已交付的：漏掉站外入口会让它们显示成「未声明」，而那是一个错误的
    // 理由——它们的问题不是本仓库没声明，是宿主没有打开外部站点的能力。
    const allHrefs = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

    for (const href of allHrefs) {
      expect(snapshot, `能力快照缺少入口 ${href}`).toHaveProperty(href);
    }
  });

  it('marks exactly the delivered routes as available', () => {
    for (const href of DELIVERED_ROUTES) {
      expect(readCapability(snapshot, href), `${href} 应当可用`).toEqual({ kind: 'available' });
    }
  });

  it('marks undelivered product pages as not implemented rather than unknown', () => {
    const undelivered = NAV_GROUPS.flatMap((group) => group.items)
      .map((item) => item.href)
      .filter((href) => !DELIVERED_ROUTES.includes(href));

    expect(undelivered.length).toBeGreaterThan(0);
    for (const href of undelivered) {
      const availability = readCapability(snapshot, href);
      expect(availability.kind, `${href} 不应是未声明`).toBe('unavailable');
      if (availability.kind === 'unavailable') {
        expect(
          availability.kind === 'unavailable' && availability.reason,
          `${href} 应当给出具体原因`,
        ).toBe('not-implemented');
      }
    }
  });

  it('gives external entries the reason that actually applies to them', () => {
    const externalHrefs = NAV_GROUPS.flatMap((group) => group.items)
      .filter((item) => item.isExternal === true)
      .map((item) => item.href);

    expect(externalHrefs.length).toBeGreaterThan(0);
    for (const href of externalHrefs) {
      const availability = readCapability(snapshot, href);
      expect(availability.kind).toBe('unavailable');
      if (availability.kind === 'unavailable' && availability.reason === 'not-implemented') {
        // 站外入口的理由必须说清是「宿主缺能力」，而不是「页面没做」——两者对用户的下一步完全不同。
        expect(availability.detail).toContain('系统浏览器');
      }
    }
  });

  it('does not advertise any route the router does not actually serve', () => {
    // 反向检查：快照说可点的每一条，都必须真的在 DELIVERED_ROUTES 里，且该清单里的每一条都要有
    // 真实页面。两者任一方向不一致，都说明「可点击」与「真的能打开」已经脱钩。
    const advertised = Object.entries(snapshot)
      .filter(([, availability]) => availability.kind === 'available')
      .map(([href]) => href);

    expect([...advertised].sort()).toEqual([...DELIVERED_ROUTES].sort());
  });
});