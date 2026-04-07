import { describe, expect, test } from 'bun:test';

import {
  getNavGroupForPath,
  getTopbarCoverage,
  isTopbarCoveredPath,
  NAV_GROUPS,
  TOPBAR_COVERED_ROUTES,
} from '@/lib/navigation';

describe('navigation config', () => {
  test('v1 topbar coverage is limited to approved core pages', () => {
    expect(TOPBAR_COVERED_ROUTES).toEqual([
      '/',
      '/battle',
      '/arena',
      '/creator',
      '/character-manager',
      '/me',
      '/pvp',
    ]);

    for (const path of TOPBAR_COVERED_ROUTES) {
      expect(isTopbarCoveredPath(path)).toBe(true);
    }

    for (const path of [
      '/ranking',
      '/encyclopedia',
      '/encyclopedia/site-guide',
      '/details',
      '/canshou',
      '/name',
      '/free',
      '/scenario',
      '/sublimation',
    ]) {
      expect(isTopbarCoveredPath(path)).toBe(false);
    }
  });

  test('navigation targets include non-covered pages explicitly', () => {
    const targets = NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.href, item.isTopbarCovered]));

    expect(targets).toContainEqual(['/ranking', false]);
    expect(targets).toContainEqual(['/encyclopedia', false]);
    expect(targets).toContainEqual(['/name', false]);
    expect(targets).toContainEqual(['/free', false]);
    expect(targets).toContainEqual(['/scenario', false]);
    expect(targets).toContainEqual(['/sublimation', false]);
    expect(targets).toContainEqual(['/battle', true]);
  });

  test('route group metadata covers navigation targets but coverage controls active topbar display', () => {
    expect(getNavGroupForPath('/battle')?.id).toBe('battle');
    expect(getNavGroupForPath('/arena')?.id).toBe('battle');
    expect(getNavGroupForPath('/pvp')?.id).toBe('battle');
    expect(getNavGroupForPath('/ranking')?.id).toBe('battle');

    expect(getNavGroupForPath('/creator')?.id).toBe('creative');
    expect(getNavGroupForPath('/name')?.id).toBe('creative');
    expect(getNavGroupForPath('/scenario')?.id).toBe('creative');

    expect(getNavGroupForPath('/character-manager')?.id).toBe('character');
    expect(getNavGroupForPath('/me')?.id).toBe('character');
    expect(getNavGroupForPath('/sublimation')?.id).toBe('character');

    expect(getNavGroupForPath('/encyclopedia/site-guide')?.id).toBe('knowledge');
    expect(getTopbarCoverage('/ranking')).toEqual({ isCovered: false, activeGroupId: null });
    expect(getTopbarCoverage('/battle')).toEqual({ isCovered: true, activeGroupId: 'battle' });
  });
});
