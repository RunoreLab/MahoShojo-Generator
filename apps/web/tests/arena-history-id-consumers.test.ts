import { describe, expect, it, vi } from 'vitest';
import { projectArenaPostBattleCharacters } from '@mahoshojo/domain/arena-post-battle';
import { patchGenerationCharacterEffect } from '@mahoshojo/domain/arena-character-repair';
import { applyPostBattleUpdates } from '@/lib/arena/service';
import { applyMagicTeaPartyUpdateDrafts } from '@/lib/magic-tea-party/apply-updates';

vi.mock('@/lib/signature', () => ({ generateSignature: vi.fn(), verifySignature: vi.fn() }));

const generationId = 'history-id-generation';
const nowISO = '2026-10-10T00:00:00.000Z';
const report = { headline: '新战报', mode: 'classic', officialReport: { winner: 'A' } };
const impacts = [{ characterName: 'A', impact: '成长' }];
const consumers: Record<string, (data: Record<string, unknown>) => Promise<any> | any> = {
  next: async (data) => (await applyPostBattleUpdates([{ data, isNative: false }], report as never, impacts, null, null, {
    writeArenaHistory: true, writeCurrentState: false, generationId,
  }))[0]!.data,
  domain: (data) => projectArenaPostBattleCharacters({
    combatants: [{ data }], report, impacts, userGuidance: null, scenario: null,
    writeArenaHistory: true, writeCurrentState: false, generationId, occurredAt: nowISO,
  }, { worldLineIds: { 0: 'new-world' }, nonNativeDataInvolved: true })[0]!.data,
  'tea-party': (data) => applyMagicTeaPartyUpdateDrafts({
    sessionId: 'session', roles: [{ id: 'role', name: 'A', source: 'cloud', card: data }],
    drafts: [{ roleId: 'role', characterName: 'A', impact: '成长' }],
    writeArenaHistory: true, writeCurrentState: false, nowISO,
  }).updatedRoles[0]!.card,
  'explicit-repair-create': (data) => {
    const result = patchGenerationCharacterEffect({
      characterData: data, generationId, patch: { combatantIndex: 0, characterName: 'A', impact: '成长' },
      nowISO, allowCreateMissingEffects: true,
      createHistoryEntry: { type: 'classic', title: '新战报', participants: ['A'], winner: 'A' },
    });
    if (!result.ok) throw new Error(result.reason);
    return result.characterData;
  },
};

it.each([{ attributes: 'legacy' }, { entries: { legacy: true } }])(
  'Next keeps its existing incomplete-history fallback for unsupported fields: %j', async (history) => {
    const result = await consumers.next!({ name: 'A', templateId: '通用角色', arena_history: history });
    expect(result.arena_history.entries).toHaveLength(1);
    expect(result.arena_history.entries[0].id).toBe(1);
    expect(result.arena_history.attributes.world_line_id).toEqual(expect.any(String));
  },
);

describe.each(Object.entries(consumers))('%s uses the shared new-history allocator', (_name, consume) => {
  it('retains entries and history extensions when optional attributes are missing', async () => {
    const history = { extra: 'preserved', entries: [{ id: '1', title: '旧条目', extension: { untouched: true } }] };
    const result = await consume({ name: 'A', templateId: '通用角色', arena_history: history });
    expect(result.arena_history.extra).toBe('preserved');
    expect(result.arena_history.entries.slice(0, -1)).toEqual(history.entries);
    expect(result.arena_history.entries.at(-1).id).toBe(2);
    expect(history).not.toHaveProperty('attributes');
  });
  it.each([
    { entries: [], next: 1 },
    { entries: [{ id: 'legacy', title: '' }, { title: '无编号' }], next: 1 },
    { entries: [{ id: 3 }, { id: 1 }, { id: 3 }, { id: '4' }], next: 5 },
    { entries: [{ id: 4.8 }, { id: '8' }], next: 5 },
    { entries: [{ id: Number.MAX_SAFE_INTEGER }, { id: '1' }, { id: 2 }], next: 3 },
    { entries: [{ id: Number.MAX_VALUE }, { id: 1 }, { id: '2' }], next: 3 },
    { entries: [null, false, '不可预览旧条目', { id: '1' }], next: 2 },
  ])('only appends ID $next and preserves prior records/extensions', async ({ entries, next }) => {
    const data = {
      name: 'A', templateId: '通用角色', custom: { preserved: true },
      arena_history: {
        extra: 'history extension', attributes: { world_line_id: 'original', custom: 'attribute extension' },
        entries,
      },
    };
    const snapshot = structuredClone(data);
    for (const ordered of [entries, [...entries].reverse()]) {
      const result = await consume({ ...data, arena_history: { ...data.arena_history, entries: ordered } });
      expect(result.arena_history.entries.slice(0, -1)).toEqual(ordered);
      expect(result.arena_history.entries.at(-1).id).toBe(next);
      expect(result.arena_history).toMatchObject({ extra: 'history extension', attributes: { custom: 'attribute extension' } });
      expect(result.custom).toEqual({ preserved: true });
    }
    expect(data).toEqual(snapshot);
  });
});
