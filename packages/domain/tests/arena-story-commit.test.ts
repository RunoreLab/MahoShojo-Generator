import { describe, expect, it, vi } from 'vitest';
import { advanceBattleStorySaveEvidence, buildCompletedBattleStoryCommit, buildCompletedBattleStoryRecords, captureBattleStoryCommitExpected, digestBattleStoryCommitValue, freezeBattleStoryCommit } from '../src/arena-story-commit';

const session = {
  id: 'session', title: '原标题', createdAt: 1, updatedAt: 1, source: { mode: 'daily' },
  seed: { combatants: [{ name: '角色', unknownExtension: { array: ['保留', 5] } }] },
  workingCombatants: [{ name: '角色' }], chapterCount: 0, lastChapterId: null,
  unknownSessionField: { preserved: true },
};
const generated = {
  chapterIndex: 1, markdown: '# 完成章\n\n正文\u0000😀', reportJson: { unknown: '扩展' },
  digest: { chapterTitle: '完成章', bodyExcerpt: '正文' },
  cardSnapshot: { aiReasoning: { text: '已有思考' }, extra: { retained: 1 } },
  nextWorkingCombatants: [{ name: '角色', history: ['变化'] }], generationId: 'generation',
};
const start = () => buildCompletedBattleStoryCommit({
  action: 'start', session, expected: null, operationId: 'chapter1', checkpointId: 'cp1', initialCheckpointId: 'cp0',
  now: 2, source: session.source, inputCombatants: session.workingCombatants, generated,
});

describe('completed battle story commit rules', () => {
  it.each([
    [undefined, 'not-written', 'not-written'], [undefined, 'unknown', 'unknown'],
    ['not-written', 'not-written', 'not-written'], ['not-written', 'unknown', 'unknown'],
    ['unknown', 'not-written', 'unknown'], ['unknown', 'unknown', 'unknown'],
  ] as const)('save evidence %s + %s remains %s', (previous, failedAttempt, expected) => {
    expect(advanceBattleStorySaveEvidence(previous, failedAttempt)).toBe(expected);
  });
  it('never serializes a whole object or large string to calculate its digest', () => {
    const original = JSON.stringify;
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown) => {
      if (typeof value === 'object' || (typeof value === 'string' && value.length > 8_192)) throw new Error('unbounded serialization');
      return original(value);
    }) as typeof JSON.stringify);
    try { expect(digestBattleStoryCommitValue({ text: 'x'.repeat(128 * 1024), extension: [1, 'ok'] })).toMatch(/^sha256:[a-f0-9]{64}$/u); }
    finally { spy.mockRestore(); }
  });
  it('refuses non-JSON values and cycles instead of silently changing records', () => {
    for (const value of [NaN, Infinity, 1n, new Date(), { callback: () => {} }]) expect(() => digestBattleStoryCommitValue(value)).toThrow();
    const cycle: unknown[] = []; cycle.push(cycle);
    expect(() => digestBattleStoryCommitValue(cycle)).toThrow('循环');
  });
  it('assembles start and continuation without changing source data or unknown extensions', () => {
    const first = start();
    expect(first.chapter).toEqual({ id: 'chapter1', sessionId: 'session', index: 1, action: 'start', status: 'active', generationId: 'generation', title: '完成章', markdown: generated.markdown, reportJson: generated.reportJson, cardSnapshot: generated.cardSnapshot, deterministicDigest: generated.digest, createdAt: 2 });
    expect(first.session.unknownSessionField).toBe(session.unknownSessionField);
    expect(first.session.seed).toBe(session.seed);
    expect(first.checkpoints.map((item) => [item.id, item.boundaryIndex, item.chapterId])).toEqual([['cp0', 0, undefined], ['cp1', 1, 'chapter1']]);
    const expected = captureBattleStoryCommitExpected({ session: first.session, chapters: [first.chapter], checkpoint: first.checkpoints[1]! });
    const second = buildCompletedBattleStoryCommit({ action: 'continue', session: first.session, expected, operationId: 'chapter2', checkpointId: 'cp2', now: 3, source: { mode: 'daily' }, inputCombatants: first.session.workingCombatants, generated: { ...generated, chapterIndex: 2 } });
    expect(second.session.chapterCount).toBe(2);
    expect(second.chapter.sourceChapterId).toBe('chapter1');
    expect(second.checkpoints).toHaveLength(1);
    expect((second.session as { lastChapterInputCombatants?: unknown[] }).lastChapterInputCombatants).toBe(first.session.workingCombatants);
    expect(session.chapterCount).toBe(0);
    expect(freezeBattleStoryCommit(second)).toBe(second);
    expect(Object.isFrozen(second.checkpoints[0]!.combatants)).toBe(true);
  });
  it('detects legacy head/checkpoint inconsistency before generating', () => {
    const first = start();
    expect(() => captureBattleStoryCommitExpected({ session: { ...first.session, chapterCount: 2 }, chapters: [first.chapter], checkpoint: null })).toThrow();
    expect(() => captureBattleStoryCommitExpected({ session: first.session, chapters: [first.chapter], checkpoint: { ...first.checkpoints[1]!, chapterId: 'other' } })).toThrow();
    expect(captureBattleStoryCommitExpected({ session: first.session, chapters: [first.chapter], checkpoint: null }).checkpointDigest).toBe(digestBattleStoryCommitValue(null));
  });
  it('shares exact record assembly with Native without inventing a Web content-CAS expectation', () => {
    const input = {
      action: 'start' as const, session, operationId: 'chapter1', checkpointId: 'cp1', initialCheckpointId: 'cp0',
      now: 2, source: session.source, inputCombatants: session.workingCombatants, generated,
    };
    const records = buildCompletedBattleStoryRecords(input);
    const commit = buildCompletedBattleStoryCommit({ ...input, expected: null });
    expect(records).toEqual({ session: commit.session, chapter: commit.chapter, checkpoints: commit.checkpoints });
    expect(commit).toEqual(start());
    expect(records).not.toHaveProperty('expected');
    const next = {
      ...input, action: 'continue' as const, session: records.session,
      operationId: 'chapter2', checkpointId: 'cp2', inputCombatants: records.session.workingCombatants,
      now: 3, generated: { ...generated, chapterIndex: 2 },
    };
    const expected = captureBattleStoryCommitExpected({ session: records.session, chapters: [records.chapter], checkpoint: records.checkpoints[1]! });
    const nextCommit = buildCompletedBattleStoryCommit({ ...next, expected });
    expect(buildCompletedBattleStoryRecords(next)).toEqual({
      session: nextCommit.session, chapter: nextCommit.chapter, checkpoints: nextCommit.checkpoints,
    });
    // The old Web API still requires its original CAS state; sharing records does not relax it.
    expect(() => buildCompletedBattleStoryCommit({ ...next, expected: null })).toThrow('预期会话位置');
    expect(() => buildCompletedBattleStoryRecords({ ...input, initialCheckpointId: undefined })).toThrow('预期会话位置');
    expect(() => buildCompletedBattleStoryRecords({ ...next, session: { ...next.session, chapterCount: -1 } })).toThrow('预期会话位置');
  });

});
