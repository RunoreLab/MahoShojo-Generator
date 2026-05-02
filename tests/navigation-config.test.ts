import { describe, expect, test } from 'bun:test';

import {
  getNavGroupForPath,
  getTopbarCoverage,
  isTopbarCoveredPath,
  NAV_GROUPS,
  TOPBAR_COVERED_ROUTES,
} from '@/lib/navigation';

describe('navigation config', () => {
  test('topbar coverage includes primary user-facing pages', () => {
    expect(TOPBAR_COVERED_ROUTES).toEqual([
      '/',
      '/battle',
      '/arena',
      '/arena-stream',
      '/creator',
      '/name',
      '/details',
      '/canshou',
      '/free',
      '/scenario',
      '/character-manager',
      '/character-party',
      '/questionnaire-editor',
      '/sublimation',
      '/tachie',
      '/tavern',
      '/magic-tavern',
      '/magic-tea-party',
      '/me',
      '/badge-manager',
      '/redeem',
      '/password-recovery',
      '/pvp',
      '/pvp/[roomId]',
      '/ranking',
      '/messages',
      '/report-appeals',
      '/investigation',
      '/challenge',
      '/beta-access',
      '/encyclopedia',
      '/encyclopedia/[slug]',
    ]);

    for (const path of TOPBAR_COVERED_ROUTES) {
      expect(isTopbarCoveredPath(path)).toBe(true);
    }

    for (const path of [
      '/404',
      '/arrested',
    ]) {
      expect(isTopbarCoveredPath(path)).toBe(false);
    }
  });

  test('navigation targets mark covered primary pages explicitly', () => {
    const targets = NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.href, item.isTopbarCovered]));

    expect(targets).toContainEqual(['/ranking', true]);
    expect(targets).toContainEqual(['/encyclopedia', true]);
    expect(targets).toContainEqual(['/name', true]);
    expect(targets).toContainEqual(['/free', true]);
    expect(targets).toContainEqual(['/scenario', true]);
    expect(targets).toContainEqual(['/sublimation', true]);
    expect(targets).toContainEqual(['/battle', true]);
    expect(targets.map(([href]) => href)).not.toContain('/messages');
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
    expect(getTopbarCoverage('/ranking')).toEqual({ isCovered: true, activeGroupId: 'battle' });
    expect(getTopbarCoverage('/battle')).toEqual({ isCovered: true, activeGroupId: 'battle' });
    expect(getTopbarCoverage('/scenario')).toEqual({ isCovered: true, activeGroupId: 'creative' });
    expect(getTopbarCoverage('/encyclopedia/[slug]')).toEqual({ isCovered: true, activeGroupId: 'knowledge' });
    expect(getTopbarCoverage('/pvp/[roomId]')).toEqual({ isCovered: true, activeGroupId: 'battle' });
    expect(getTopbarCoverage('/messages')).toEqual({ isCovered: true, activeGroupId: null });
    expect(getTopbarCoverage('/investigation')).toEqual({ isCovered: true, activeGroupId: 'knowledge' });
  });
});
