import { describe, expect, it } from 'vitest';
import {
  getArenaPostBattleWorldLineIndices,
  projectArenaPostBattleCharacters,
  type ArenaPostBattleProjectionInput,
} from '../src/arena-post-battle';

const input: ArenaPostBattleProjectionInput = {
  combatants: [{ data: {
    codename: '角色甲', signature: 'source-signature', _author: '作者',
    metadata: { signature: 'source-metadata-signature', extra: true },
    custom: { signature: 'legitimate-extension', _user: '保留' },
  } }],
  report: { headline: '决战', officialReport: { winner: '角色甲' } },
  impacts: [{ characterName: '角色甲', currentStateSummary: '平静', impact: '成长' }],
  scenario: null, userGuidance: null,
  writeArenaHistory: true, writeCurrentState: true,
  generationId: 'generation-1', occurredAt: '2026-10-09T10:00:00.000Z',
};
const context = { worldLineIds: { 0: 'fixed-world-line' }, nonNativeDataInvolved: true };

describe('pure Arena character effects', () => {
  it('requires fixed host values, preserves source/unknown fields and never signs', () => {
    const before = structuredClone(input);
    expect(getArenaPostBattleWorldLineIndices(input)).toEqual([0]);
    const first = projectArenaPostBattleCharacters(input, context);
    expect(first).toEqual(projectArenaPostBattleCharacters(input, context));
    expect(first[0]?.data).toMatchObject({
      _author: '作者', metadata: { signature: 'source-metadata-signature', extra: true },
      custom: { signature: 'legitimate-extension', _user: '保留' },
      arena_history: { attributes: { world_line_id: 'fixed-world-line', created_at: input.occurredAt } },
      current_state: { summary: '平静', updated_at: input.occurredAt, generation_id: input.generationId },
    });
    expect(first[0]?.data).not.toHaveProperty('signature');
    expect(input).toEqual(before);
    const repeated = { ...input, combatants: first.map(({ data }) => ({ data })) };
    expect(getArenaPostBattleWorldLineIndices(repeated)).toEqual([]);
    expect(projectArenaPostBattleCharacters(repeated, { ...context, worldLineIds: {} })).toEqual([]);
  });

  it('does not invent an ID, time, winner or reward when host inputs are missing', () => {
    expect(() => projectArenaPostBattleCharacters(input, { ...context, worldLineIds: {} })).toThrow('fixed Arena world-line');
    expect(projectArenaPostBattleCharacters({ ...input, report: {} }, context)[0]?.data).toMatchObject({
      arena_history: { entries: [{ winner: '', title: '未命名战报', type: 'classic' }] },
    });
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])(
    'applies write flags independently (history=%s, state=%s)', (writeArenaHistory, writeCurrentState) => {
      const next = { ...input, writeArenaHistory, writeCurrentState };
      expect(getArenaPostBattleWorldLineIndices(next)).toEqual(writeArenaHistory ? [0] : []);
      const result = projectArenaPostBattleCharacters(next, context);
      if (!writeArenaHistory && !writeCurrentState) expect(result).toEqual([]);
      else {
        expect('arena_history' in result[0]!.data).toBe(writeArenaHistory);
        expect('current_state' in result[0]!.data).toBe(writeCurrentState);
      }
    },
  );
});
