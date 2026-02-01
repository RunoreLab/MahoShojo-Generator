import { describe, expect, it } from 'bun:test';

import { applyMagicTeaPartyUpdateDrafts } from '@/lib/magic-tea-party/apply-updates';
import type { MagicTeaPartyRole, MagicTeaPartyUpdateDraft } from '@/lib/magic-tea-party/types';

const baseRole = (): MagicTeaPartyRole => ({
  id: 'role-1',
  name: '星野铃',
  source: 'cloud',
  signature: 'sig-1',
  card: {
    signature: 'card-sig',
  },
});

describe('applyMagicTeaPartyUpdateDrafts', () => {
  it('写入历战与当前状态，并移除签名', () => {
    const drafts: MagicTeaPartyUpdateDraft[] = [
      {
        roleId: 'role-1',
        characterName: '星野铃',
        impact: '铃在茶会中觉醒了新的魔力。',
        currentStateSummary: '状态稳定，力量有所提升。',
        hasWinner: true,
        winner: '星野铃',
      },
    ];
    const result = applyMagicTeaPartyUpdateDrafts({
      sessionId: 'session-1',
      sessionTitle: '魔法茶会·序章',
      drafts,
      roles: [baseRole()],
      summaryMeta: {
        summaryId: 'summary-1',
        messageRange: {
          fromMessageId: 'm1',
          toMessageId: 'm4',
          count: 4,
        },
      },
      writeArenaHistory: true,
      writeCurrentState: true,
      nowISO: '2026-01-17T12:00:00.000Z',
      createWorldLineId: () => 'world-1',
    });

    const updated = result.updatedRoles[0];
    expect(updated.isNative).toBe(false);
    expect(updated.signature).toBeUndefined();
    expect((updated.card as any).signature).toBeUndefined();

    const history = (updated.card as any).arena_history;
    expect(history).toBeTruthy();
    expect(history.attributes.world_line_id).toBe('world-1');
    expect(history.attributes.updated_at).toBe('2026-01-17T12:00:00.000Z');
    expect(history.entries.length).toBe(1);
    expect(history.entries[0].type).toBe('tea-party');
    expect(history.entries[0].title).toBe('魔法茶会·序章');
    expect(history.entries[0].participants).toEqual(['星野铃']);
    expect(history.entries[0].winner).toBe('星野铃');
    expect(history.entries[0].metadata.source).toBe('magic-tea-party');
    expect(history.entries[0].metadata.summary_id).toBe('summary-1');
    expect(history.entries[0].metadata.message_range).toEqual({
      fromMessageId: 'm1',
      toMessageId: 'm4',
      count: 4,
    });

    const currentState = (updated.card as any).current_state;
    expect(currentState.summary).toBe('状态稳定，力量有所提升。');
    expect(currentState.updated_at).toBe('2026-01-17T12:00:00.000Z');
  });

  it('写入开关关闭时保持角色不变', () => {
    const role = baseRole();
    const drafts: MagicTeaPartyUpdateDraft[] = [
      {
        roleId: 'role-1',
        characterName: '星野铃',
        impact: '不会被写入。',
        currentStateSummary: '不会被写入。',
      },
    ];
    const result = applyMagicTeaPartyUpdateDrafts({
      sessionId: 'session-2',
      drafts,
      roles: [role],
      writeArenaHistory: false,
      writeCurrentState: false,
    });
    expect(result.updatedRoles[0]).toEqual(role);
  });
});
