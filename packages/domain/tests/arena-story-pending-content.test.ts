import { describe, expect, it } from 'vitest';
import {
  buildCompletedBattleStoryRecords, chunkBattleStoryCommitJson, freezeBattleStoryCommit,
  projectHostedStoryPendingContent, type HostedStoryPendingContentInput,
} from '../src/arena-story-commit';
const serialize = (value: unknown) => Buffer.concat([...chunkBattleStoryCommitJson(value, 7)]).toString('utf8');
const base = (): HostedStoryPendingContentInput => ({
  reasoning: '', roleState: 'not-requested', workingCombatants: [
    { type: 'magical-girl', data: { name: '同名', state: '原件甲' }, isNative: false, source: { slot: 0 } },
    { type: 'magical-girl', data: { name: '同名', state: '原件乙' }, isNative: true, source: { slot: 1 } },
    { type: 'canshou', data: { state: '无可读名称' }, source: { slot: 2 } },
  ],
});

const records = (input: HostedStoryPendingContentInput) => {
  const projection = projectHostedStoryPendingContent(input);
  return buildCompletedBattleStoryRecords({
    action: 'start', session: { id: 'session', title: '初始标题', createdAt: 1, updatedAt: 1,
      source: { mode: 'daily' }, seed: { combatants: [...input.workingCombatants] },
      workingCombatants: [...input.workingCombatants], chapterCount: 0 },
    operationId: 'chapter', checkpointId: 'after', initialCheckpointId: 'before', now: 2,
    source: { mode: 'daily' }, inputCombatants: [...input.workingCombatants],
    generated: { chapterIndex: 1, markdown: '# 正文\n故事', digest: { chapterTitle: '正文' }, ...projection },
  });
};

describe('Hosted story pending content projection', () => {
  it.each([{ header: { narrativeHistoryReadCount: 0 }, telemetry: { narrativeHistoryReadCount: 1 } },
    { header: { narrativeHistoryReadCount: 3 }, telemetry: { narrativeHistoryReadCount: 0 } }])('rejects conflicting read counts and preserves both originals %#', ({ header, telemetry }) => {
    const input = { ...base(), header, telemetry }; const before = structuredClone(input);
    expect(() => projectHostedStoryPendingContent(input)).toThrow('读取数不一致');
    expect(input).toEqual(before);
  });
  it('takes readCount from either carrier and preserves raw model text and usage references', () => {
    const usage = { promptTokens: null, completionTokensIncludesReasoning: false };
    const telemetry = { aiModel: '  model\ud800\n', usage, narrativeHistoryReadCount: 0 };
    const result = projectHostedStoryPendingContent({ ...base(), telemetry });
    expect(result.cardSnapshot.aiModel).toBe(telemetry.aiModel);
    expect(result.cardSnapshot.aiUsage).toBe(usage);
    expect(result.cardSnapshot.narrativeHistoryReadCount).toBe(0);
    expect(projectHostedStoryPendingContent({ ...base(), header: { narrativeHistoryReadCount: 7 } }).cardSnapshot.narrativeHistoryReadCount).toBe(7);
    expect(projectHostedStoryPendingContent({ ...base(), header: { narrativeHistoryReadCount: 0 }, telemetry }).cardSnapshot.narrativeHistoryReadCount).toBe(0);
  });

  it('retains exact reasoning, report extensions, guidance and debug text including lone surrogates', () => {
    const text = '  推理\r\n\n\t𐐀🪄\u0000\ud800|\udfff  ';
    const input: HostedStoryPendingContentInput = { ...base(), reasoning: text, inputUserGuidance: `输入${text}`,
      meta: { event: 'meta', data: { parseOk: true, meta: { report: { title: text }, impacts: [{ unknown: text }],
        unknownExtension: { '\ud800': [text, 0, false, null] } }, raw: text, rawTruncated: false } },
      header: { reporterInfo: { name: text }, characterGuidances: [{ guidance: text }],
        adjudicationResults: [{ extension: text, result: false }], narrativeHistoryReadCount: 0, scenarioDisplayName: text } };
    const before = structuredClone(input);
    const completed = records(input);
    expect(input).toEqual(before);
    const saved = JSON.parse(serialize(freezeBattleStoryCommit(completed)));
    expect(saved.chapter.cardSnapshot).toEqual({
      aiReasoning: { status: 'done', source: 'provider', text }, ...input.header, userGuidance: input.inputUserGuidance,
      streamUpdateMetaDebug: { source: 'sse', parseOk: true, raw: text, rawTruncated: false },
      storyRoleSync: { version: 1, state: 'not-requested', warnings: [] },
    });
    expect(saved.chapter.reportJson).toEqual(input.meta!.data.meta);
    expect(saved.checkpoints[1].combatants).toEqual(input.workingCombatants);
  });

  it('retains header guidance even when empty and only falls back when it is absent', () => {
    for (const guidance of ['', '  响应指导\n']) {
      expect(projectHostedStoryPendingContent({ ...base(), inputUserGuidance: '输入指导', header: { userGuidance: guidance } })
        .cardSnapshot.userGuidance).toBe(guidance);
    }
    expect(projectHostedStoryPendingContent({ ...base(), inputUserGuidance: '' }).cardSnapshot.userGuidance).toBe('');
    expect(projectHostedStoryPendingContent(base()).cardSnapshot).not.toHaveProperty('userGuidance');
  });

  it('maps sparse, reordered role results by the original index, retaining every other envelope and card', () => {
    const input: HostedStoryPendingContentInput = { ...base(), roleState: 'accepted', roleResponse: {
      updatedCombatants: [{ combatantIndex: 2, data: { state: '新无名角色' }, isNative: false },
        { combatantIndex: 0, data: { name: '同名', signature: 'fresh' }, isNative: true }],
      warnings: [{ code: 'ARENA_RECONCILIATION_COMBATANT_UNMATCHED', combatantIndex: 1, message: '原件乙未更新' }],
    } };
    const before = structuredClone(input);
    const output = projectHostedStoryPendingContent(freezeBattleStoryCommit(input));
    expect(output.nextWorkingCombatants).toHaveLength(3);
    expect(output.nextWorkingCombatants[1]).toBe(input.workingCombatants[1]);
    for (const update of input.roleResponse!.updatedCombatants) {
      expect(output.nextWorkingCombatants[update.combatantIndex]).toEqual({
        ...input.workingCombatants[update.combatantIndex], data: update.data, isNative: update.isNative,
      });
    }
    expect(output.cardSnapshot.storyRoleSync.warnings).toBe(input.roleResponse!.warnings);
    expect(input).toEqual(before);
    expect(JSON.parse(serialize(freezeBattleStoryCommit(records(input)))).checkpoints[1].combatants).toEqual(output.nextWorkingCombatants);
  });

  it.each(['http-failure', 'user-kept-original'] as const)('persists explicit old-role reason %s', (fallbackReason) => {
    const input: HostedStoryPendingContentInput = { ...base(), roleState: 'old-roles', fallbackReason,
      meta: { event: 'meta_error', data: { parseOk: false, error: '坏 meta\n\ud800', raw: '', rawTruncated: false } } };
    const saved = JSON.parse(serialize(freezeBattleStoryCommit(records(input))));
    expect(saved.chapter.reportJson).toEqual({});
    expect(saved.chapter.cardSnapshot.storyRoleSync).toEqual({ version: 1, state: 'old-roles', warnings: [], reason: fallbackReason });
    expect(saved.chapter.cardSnapshot.streamUpdateMetaDebug).toEqual({ source: 'sse', ...input.meta!.data });
    expect(saved.checkpoints[1].combatants).toEqual(input.workingCombatants);
  });

  it.each([-1, 3, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid role index %s without mutating originals', (combatantIndex) => {
    const input: HostedStoryPendingContentInput = { ...base(), roleState: 'accepted', roleResponse: {
      updatedCombatants: [{ combatantIndex: 0, data: { state: 'valid earlier entry' }, isNative: false },
        { combatantIndex, data: { state: 'invalid later entry' }, isNative: false }], warnings: [],
    } };
    const before = structuredClone(input);
    expect(() => projectHostedStoryPendingContent(input)).toThrow('索引');
    expect(input).toEqual(before);
  });

  it('rejects duplicate role indexes and incoherent or unresolved synchronization states', () => {
    const response = { updatedCombatants: [{ combatantIndex: 1, data: {}, isNative: false }], warnings: [] };
    expect(() => projectHostedStoryPendingContent({ ...base(), roleState: 'accepted',
      roleResponse: { ...response, updatedCombatants: [...response.updatedCombatants, ...response.updatedCombatants] } })).toThrow('索引');
    for (const change of [
      { roleState: 'unresolved' }, { roleState: 'accepted' }, { roleState: 'old-roles' },
      { roleState: 'old-roles', fallbackReason: 'unknown' }, { roleState: 'not-requested', fallbackReason: 'http-failure' },
      { roleState: 'not-requested', roleResponse: response },
      { roleState: 'old-roles', fallbackReason: 'user-kept-original', roleResponse: response },
      { roleState: 'accepted', roleResponse: response, fallbackReason: 'http-failure' },
    ]) expect(() => projectHostedStoryPendingContent({ ...base(), ...change } as HostedStoryPendingContentInput)).toThrow('角色同步');
  });
});
