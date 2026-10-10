import { describe, expect, it } from 'vitest';
import {
  projectUnsignedArenaPostBattleCandidates,
  type ArenaPostBattleCandidateContext,
  type ArenaPostBattleCandidateInput,
} from '../src/arena-post-battle-candidates';
import { materializeArenaNarrativeHistoryForRequest } from '../src/narrative-history-operations';

const context: ArenaPostBattleCandidateContext = {
  scopeKey: 'original-scope', requestId: 'request-1', generationId: 'request-1',
  occurredAt: '2026-10-09T10:00:00.000Z', worldLineIds: { 0: 'local-fixed-world-line' },
};
const input: ArenaPostBattleCandidateInput = {
  combatants: [{ data: {
    name: '角色甲', signature: 'server-source-signature', isNative: true, isPreset: true, isValid: true,
    isVerified: true, verificationStatus: 'verified', permissions: ['admin'], createdAt: 'old-time',
    sourceDataCardId: 'original-cloud-id', sourceDataCardUpdatedAt: 'old-cloud-time',
    arenaRoomKey: 'original-room', adjudicationSourceKey: 'original-adjudication',
    _author: '作者', _custom: { _native: '保留' },
    metadata: { signature: 'source-signature', isVerified: true, permissions: ['admin'],
      generationId: 'old', extra: '保留', nested: { signature: '合法字段', permissions: '合法设定' } },
    custom: { signature: '普通扩展', isNative: true, sourceDataCardId: '叙事设定' },
    arena_history: { attributes: { world_line_id: 'existing-world', custom: true }, extra: '保留',
      entries: [{ id: 'legacy-id', metadata: { signature: '不是卡级签名' }, unknown: true }] },
    current_state: { summary: '原状态', generation_id: 'old-generation', fields: [], unknown: true },
  } }],
  report: { headline: '决战', mode: 'classic', officialReport: { winner: '角色甲' } },
  impacts: [{ characterName: '角色甲', impact: '成长', currentStateSummary: '平静' }],
  userGuidance: null, scenario: null,
  writeArenaHistory: true, writeCurrentState: true, writeNarrativeHistory: true,
  narrativeHistory: {
    entries: [{ id: 'legacy-history', title: '旧战报', content: '旧正文', createdAt: 'old', updatedAt: 'old' }],
    title: '决战', content: '# 决战\n\n完整战报正文，不能用角色成长摘要代替。',
  },
};

describe('unsigned Arena candidates without persistence', () => {
  it('keeps original scope/time, separates full narrative and character effects and never mutates the source', () => {
    const before = structuredClone(input);
    const result = projectUnsignedArenaPostBattleCandidates(input, context);
    expect(result).toMatchObject({
      scopeKey: context.scopeKey, requestId: context.requestId,
      generationId: context.generationId, occurredAt: context.occurredAt,
      narrativeHistory: { appended: true, entry: {
        id: `arena-generation:${context.generationId}`,
        content: input.narrativeHistory.content, createdAt: context.occurredAt, updatedAt: context.occurredAt,
      } },
    });
    const data = result.characterEffects[0]!.data;
    expect(data).toMatchObject({
      _author: '作者', _custom: { _native: '保留' },
      metadata: { extra: '保留', nested: { signature: '合法字段', permissions: '合法设定' } },
      custom: { signature: '普通扩展', isNative: true, sourceDataCardId: '叙事设定' },
      arena_history: { attributes: { world_line_id: 'existing-world', custom: true }, extra: '保留', entries: [
        { id: 'legacy-id', metadata: { signature: '不是卡级签名' }, unknown: true },
        { impact: '成长', metadata: { non_native_data_involved: true, generation_id: context.generationId } },
      ] },
      current_state: { summary: '平静', generation_id: context.generationId, unknown: true },
    });
    for (const key of ['signature', 'isNative', 'isPreset', 'isValid', 'sourceDataCardId',
      'sourceDataCardUpdatedAt', 'arenaRoomKey', 'adjudicationSourceKey',
      'isVerified', 'verificationStatus', 'permissions', 'createdAt']) expect(data).not.toHaveProperty(key);
    for (const key of ['signature', 'isVerified', 'permissions', 'generationId']) expect(data.metadata).not.toHaveProperty(key);
    expect(result).not.toHaveProperty('updatedCombatants');
    expect(input).toEqual(before);
    expect(projectUnsignedArenaPostBattleCandidates(input, context)).toEqual(result);
    // Candidate edits also cannot reach backwards into the original history/card objects.
    data.custom = {};
    result.narrativeHistory!.entries[0]!.content = '候选副本被编辑';
    expect(input).toEqual(before);
  });

  it('deduplicates replayed character and full-history effects using the original generation', () => {
    const first = projectUnsignedArenaPostBattleCandidates(input, context);
    const repeated = projectUnsignedArenaPostBattleCandidates({
      ...input,
      combatants: first.characterEffects.map(({ data }) => ({ data })),
      narrativeHistory: { ...input.narrativeHistory, entries: first.narrativeHistory!.entries },
    }, context);
    expect(repeated.characterEffects).toEqual([]);
    expect(repeated.narrativeHistory?.appended).toBe(false);
    expect(repeated.narrativeHistory?.entries).toEqual(first.narrativeHistory?.entries);
    expect(repeated.narrativeHistory?.entry?.createdAt).toBe(context.occurredAt);
  });

  for (const writeArenaHistory of [false, true]) for (const writeCurrentState of [false, true]) {
    it.each([false, true])(
      `independent write switches history=${writeArenaHistory}, state=${writeCurrentState}, narrative=%s`,
      (writeNarrativeHistory) => {
        const result = projectUnsignedArenaPostBattleCandidates({
          ...input, writeArenaHistory, writeCurrentState, writeNarrativeHistory,
        }, context);
        expect(result.narrativeHistory !== null).toBe(writeNarrativeHistory);
        expect(result.characterEffects).toHaveLength(writeArenaHistory || writeCurrentState ? 1 : 0);
        if (result.characterEffects.length) {
          const data = result.characterEffects[0]!.data;
          expect((data.arena_history as { entries: unknown[] }).entries.length).toBe(writeArenaHistory ? 2 : 1);
          expect((data.current_state as { summary: string }).summary).toBe(writeCurrentState ? '平静' : '原状态');
        }
      },
    );
  }

  it.each([false, true])('history reading (%s) does not control later candidate writing', (readNarrativeHistory) => {
    const read = materializeArenaNarrativeHistoryForRequest({
      readNarrativeHistory, readNarrativeHistoryLimit: 10, isNarrativeHistoryUnlimited: false,
    }, input.narrativeHistory.entries);
    expect(read.entries !== undefined).toBe(readNarrativeHistory);
    const result = projectUnsignedArenaPostBattleCandidates(input, context);
    expect(result.narrativeHistory?.appended).toBe(true);
    expect(result.narrativeHistory?.entry?.content).toBe(input.narrativeHistory.content);
  });

  it('keeps the complete oversized Unicode report for an eventual explicit save failure/export', () => {
    const content = '# 完整战报\n\n' + '战'.repeat(1_500_000);
    const result = projectUnsignedArenaPostBattleCandidates({
      ...input, writeArenaHistory: false, writeCurrentState: false,
      narrativeHistory: { ...input.narrativeHistory, content },
    }, context);
    expect(new TextEncoder().encode(content).byteLength).toBeGreaterThan(4 * 1024 * 1024);
    expect(result.narrativeHistory?.entry?.content).toBe(content);
  });

  it.each(['scopeKey', 'requestId', 'generationId', 'occurredAt'] as const)(
    'never invents missing fixed %s', (key) => {
      expect(() => projectUnsignedArenaPostBattleCandidates(input, { ...context, [key]: '' }))
        .toThrow('original scope, request, generation and fixed time');
    },
  );

  it('rejects a noncanonical generation instead of splitting narrative and character replay identity', () => {
    expect(() => projectUnsignedArenaPostBattleCandidates(input, { ...context, generationId: ' request-1 ' }))
      .toThrow('original scope, request, generation and fixed time');
  });
});
