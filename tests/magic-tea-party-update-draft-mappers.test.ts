import { describe, expect, test } from 'bun:test';

import { mapMagicTeaPartyUpdateDraftCompat } from '@/lib/magic-tea-party/update-draft-mappers';

describe('magic-tea-party update draft mappers', () => {
  test('兼容历史字段并输出 canonical 字段', () => {
    const mapped = mapMagicTeaPartyUpdateDraftCompat({
      roleId: 'role-1',
      character: '星野铃',
      impact: '力量增强',
      current_state_summary: '状态稳定',
      hasWinner: true,
      winner: '星野铃',
      meta: { sessionId: 'session-1' },
    });

    expect(mapped).toEqual({
      roleId: 'role-1',
      characterName: '星野铃',
      impact: '力量增强',
      currentStateSummary: '状态稳定',
      hasWinner: true,
      winner: '星野铃',
      meta: { sessionId: 'session-1' },
    });
    expect(mapped && 'current_state_summary' in mapped).toBe(false);
  });

  test('characterName 优先于 character/name，并保留空值语义', () => {
    const mapped = mapMagicTeaPartyUpdateDraftCompat({
      characterName: '  Canonical ',
      character: 'Legacy',
      name: 'Fallback',
      currentStateSummary: '  保持警戒  ',
      impact: '  ',
    });

    expect(mapped).toEqual({
      characterName: 'Canonical',
      currentStateSummary: '保持警戒',
    });
  });

  test('缺少角色名时返回 null', () => {
    expect(mapMagicTeaPartyUpdateDraftCompat({ impact: 'x' })).toBeNull();
    expect(mapMagicTeaPartyUpdateDraftCompat(null)).toBeNull();
  });
});
