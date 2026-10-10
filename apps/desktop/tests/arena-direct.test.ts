import { describe, expect, it, vi } from 'vitest';
import * as arenaCore from '@mahoshojo/ai-core/arena-generation';
import { appendNarrativeHistoryEntry } from '@mahoshojo/domain/narrative-history-operations';
import type { AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { assembleArenaGenerationPrompt, buildArenaGenerationInputSnapshot, type ArenaGenerationInputSnapshot } from '@mahoshojo/ai-core/arena-generation';
import { executeArenaDirect, type ArenaDirectHostContext, type ArenaDirectIntent } from '../src/features/arena/direct';

const input = (mode: ArenaGenerationInputSnapshot['battleMode'] = 'classic'): ArenaGenerationInputSnapshot => ({
  battleMode: mode, reportFormat: 'markdown', arenaFreeRankingEnabled: false,
  combatants: ['甲', '乙'].map(name => ({ type: 'general-character', data: { name, content: '完整角色设定', signature: 'source-only' }, isValid: true, isPreset: false, filename: '' })),
  teams: [], scenario: { content: mode === 'scenario' ? { title: '车站', content: '等待重逢' } : null, fileName: null },
  scenarioDisplayName: '车站', auxScenarios: [], materials: [], selectedLanguage: 'zh-CN',
  settings: { userGuidance: '守护彼此', readArenaHistory: true, readArenaHistoryLimit: 3, isArenaHistoryUnlimited: false, writeArenaHistory: true,
    readCurrentState: true, writeCurrentState: true, readNarrativeHistory: true, readNarrativeHistoryLimit: 3, isNarrativeHistoryUnlimited: false, writeNarrativeHistory: true },
  narrativeHistoryEntries: [], adjudicationEvents: [], storyLength: 'medium',
});
const host = (): ArenaDirectHostContext => ({ scopeKey: 'account-A:epoch-1', reporterInfo: { name: '本地记者', publication: '本地报刊' }, adjudicationResults: [] });
const task = (generationMode: ArenaDirectIntent['generationMode'] = 'stream'): ArenaDirectIntent => ({ requestId: 'arena-1', mode: 'direct-local', generationMode, modelId: 'fixture-model', temperature: 0.5, maxOutputTokens: 2048 });
const report = { headline: '相遇', article: { body: '重逢后的故事', analysis: '观察' }, officialReport: { winner: '甲', conclusion: '和解' }, impacts: [{ characterName: '甲', impact: '信任', currentStateSummary: '平静' }] };
const streamText = '# 相遇\n\n重逢后的故事\n\n<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"相遇","winner":"甲"},"impacts":[{"characterName":"甲","impact":"信任","currentStateSummary":"平静"}]} -->\n<!-- MAHOSHOJO_TELEMETRY_META {"aiModel":"untrusted-model","usage":{"totalTokens":999999}} -->';
const harness = (text = streamText, configure?: (events: AiStreamEvent[], request: AiExecutionRequest) => AiStreamEvent[]) => {
  let sent: AiExecutionRequest | undefined;
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'cancel_direct_ai') return true;
    if (!['stream_direct_ai', 'stream_target_ai'].includes(command)) throw new Error('unexpected project/Hosted request');
    sent = args!.request as AiExecutionRequest;
    const onmessage = (args!.onEvent as { onmessage: (event: AiStreamEvent) => void }).onmessage;
    const identity = { requestId: sent.requestId, contractVersion: 1 as const, mode: sent.mode };
    const events: AiStreamEvent[] = [ { ...identity, type: 'started', sequence: 0 }, { ...identity, type: 'reasoning-delta', sequence: 1, delta: '独立推理' } ];
    for (const delta of text.match(/[\s\S]{1,60000}/g) ?? []) events.push({ ...identity, type: 'text-delta', sequence: events.length, delta });
    events.push({ ...identity, type: 'usage', sequence: events.length, usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 3, totalTokens: 30 } });
    events.push({ ...identity, type: 'result', sequence: events.length, result: { ...identity, status: 'completed', output: { text, reasoning: '独立推理' }, finishReason: 'stop', resolvedModelId: 'actual-model', usage: { totalTokens: 30 } } });
    for (const event of configure?.(events, sent) ?? events) onmessage(event);
  });
  return { options: { invoke, profileId: 'custom-1', createChannel: () => ({}) }, invoke, get request() { return sent; } };
};

describe('typed Arena Direct adapter', () => {
  it.each(['classic', 'kizuna', 'daily', 'scenario'] as const)('%s reuses the real shared consumer for both output forms', async mode => {
    for (const generationMode of ['stream', 'non-stream'] as const) {
      const value = input(mode); const context = host(); const intent = task(generationMode);
      const native = harness(generationMode === 'stream' ? streamText : JSON.stringify(report));
      const outcome = await executeArenaDirect(native.options, value, intent, context, new AbortController().signal);
      expect(outcome.status).toBe('completed');
      const payload = { ...buildArenaGenerationInputSnapshot(value), adjudicationResults: context.adjudicationResults };
      const expected = assembleArenaGenerationPrompt({ payload, outputContract: generationMode === 'stream' ? 'stream-markdown' : 'structured-report', reporterInfo: context.reporterInfo, adjudicationResults: context.adjudicationResults });
      expect(native.request!.messages.at(-1)!.content).toBe(expected.prompt);
      expect(native.request).toMatchObject({ requestKind: 'arena', modelId: intent.modelId, temperature: 0.5, maxOutputTokens: 2048 });
      expect(native.request!.arenaInputJson).toBe(JSON.stringify(payload));
      expect(native.request!.messages.at(-1)!.content).not.toContain('source-only');
      expect(native.invoke).toHaveBeenCalledTimes(1);
      expect(outcome).toMatchObject({ scopeKey: context.scopeKey, reasoning: '独立推理', usage: { totalTokens: 30 }, report: { headline: '相遇', reporterInfo: context.reporterInfo, aiModel: 'actual-model' }, impacts: report.impacts });
      expect(outcome).not.toHaveProperty('card'); expect(outcome).not.toHaveProperty('updatedCombatants'); expect(outcome).not.toHaveProperty('signature');
      expect(outcome.markdown).not.toContain('MAHOSHOJO'); expect(outcome.markdown).not.toContain('独立推理');
      if (outcome.status === 'completed') expect(outcome.historyCandidate).toMatchObject({ scopeKey: context.scopeKey, requestId: intent.requestId, title: '相遇', content: outcome.markdown });
    }
  });
  it('freezes input, provider target, model, parameters and original scope before dispatch', async () => {
    const value = input(); const context = host(); const intent = task();
    const native = harness(streamText, events => {
      context.scopeKey = 'account-B:epoch-2'; context.reporterInfo.name = 'changed'; intent.modelId = 'changed'; intent.temperature = 1.5;
      value.combatants[0]!.data.name = 'changed'; return events;
    });
    const options = { ...native.options, providerTarget: { kind: 'custom' as const, profileId: 'custom-1' } };
    const result = await executeArenaDirect(options, value, intent, context, new AbortController().signal);
    expect(result.scopeKey).toBe('account-A:epoch-1'); expect(native.request?.modelId).toBe('fixture-model'); expect(native.request?.temperature).toBe(0.5);
    expect(native.request?.arenaInputJson).toContain('甲');
    if (result.status === 'completed') expect(result.historyCandidate?.scopeKey).toBe('account-A:epoch-1');
  });
  it('accepts Arena structured output above the legacy parser and result limits', async () => {
    const body = '中'.repeat(400000); const native = harness(JSON.stringify({ ...report, article: { ...report.article, body } }));
    const result = await executeArenaDirect(native.options, input(), task('non-stream'), host(), new AbortController().signal);
    expect(result.status).toBe('completed');
    if (result.status === 'completed') expect(result.report.article.body).toBe(body);
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['eof', 'sequence', 'identity', 'duplicate', 'late', 'failed', 'length', 'different-terminal'] as const)('%s preserves accepted body without a candidate or replay', async kind => {
    const native = harness('保留的正文', events => {
      const terminal = events.at(-1)!;
      if (kind === 'eof') return events.slice(0, -1);
      if (kind === 'duplicate' || kind === 'late') return [...events, kind === 'duplicate' ? terminal : { ...events[2]!, sequence: events.length }];
      if (kind === 'sequence' || kind === 'identity') return [...events.slice(0, 3), { ...events[2]!, sequence: kind === 'sequence' ? 99 : 3, requestId: kind === 'identity' ? 'wrong' : 'arena-1' }];
      if (terminal.type !== 'result') throw new Error('fixture');
      if (kind === 'failed') terminal.result = { requestId: 'arena-1', contractVersion: 1, mode: 'direct-local', status: 'failed', error: { code: 'service-unavailable' } };
      else if (terminal.result.status === 'completed') {
        if (kind === 'length') terminal.result.finishReason = 'length';
        else terminal.result.output.text = '未经接受的替换';
      }
      return events;
    });
    const result = await executeArenaDirect(native.options, input(), task(), host(), new AbortController().signal);
    expect(['failed', 'invalid-output']).toContain(result.status); expect(result.rawText).toBe('保留的正文');
    expect(result).not.toHaveProperty('historyCandidate'); expect(native.invoke).toHaveBeenCalledTimes(1);
  });
  it('early abort never dispatches; late abort never accepts queued terminal or writes a candidate', async () => {
    const early = new AbortController(); early.abort(); const native = harness();
    expect((await executeArenaDirect(native.options, input(), task(), host(), early.signal)).status).toBe('cancelled'); expect(native.invoke).not.toHaveBeenCalled();
    const late = new AbortController(); const active = harness('已接受正文');
    const result = await executeArenaDirect(active.options, input(), task(), host(), late.signal, partial => { if (partial.rawText) late.abort(); });
    expect(result).toMatchObject({ status: 'cancelled', rawText: '已接受正文' }); expect(result).not.toHaveProperty('historyCandidate');
    expect(active.invoke.mock.calls.filter(([cmd]) => cmd.startsWith('stream_'))).toHaveLength(1);
    expect(active.invoke.mock.calls.filter(([cmd]) => cmd === 'cancel_direct_ai')).toHaveLength(1);
  });
  it('does not expose reasoning or trailers as display Markdown or trust trailer usage', async () => {
    const native = harness(); const partials: string[] = [];
    const result = await executeArenaDirect(native.options, input(), task(), host(), new AbortController().signal, partial => partials.push(partial.markdown));
    expect(partials.join('')).not.toContain('MAHOSHOJO'); expect(partials.join('')).not.toContain('独立推理');
    expect(result.usage?.totalTokens).toBe(30); expect(result.rawText).toBe(streamText);
  });
  it('reuses provider capability gates and never dispatches unsupported/server targets', async () => {
    for (const providerTarget of [{ kind: 'system' as const }, { kind: 'preset' as const, providerId: 'not-in-catalog' }, { kind: 'preset' as const, providerId: 'anthropic' }]) {
      const native = harness(); const result = await executeArenaDirect({ ...native.options, providerTarget }, input(), task(), host(), new AbortController().signal);
      expect(result.status).toBe('failed'); expect(native.invoke).not.toHaveBeenCalled();
    }
    const native = harness(); const result = await executeArenaDirect({ ...native.options, providerTarget: { kind: 'preset', providerId: 'deepseek' } }, input(), { ...task(), modelId: 'deepseek-chat' }, host(), new AbortController().signal);
    expect(result.status).toBe('completed'); expect(native.invoke.mock.calls[0]?.[0]).toBe('stream_target_ai');
  });
  it('rejects unsupported ranked inputs and count overruns rather than truncating', async () => {
    for (const value of [{ ...input(), arenaFreeRankingEnabled: true }, { ...input(), combatants: Array(33).fill(input().combatants[0]) }, { ...input(), materials: Array(257).fill({}) }]) {
      const native = harness(); const result = await executeArenaDirect(native.options, value, task(), host(), new AbortController().signal);
      expect(result.status).toBe('failed'); expect(native.invoke).not.toHaveBeenCalled();
    }
  });
});

it('retains Hosted trim/slice guidance semantics without altering the frozen source', async () => {
  for (const mode of ['stream', 'non-stream'] as const) {
    const value = input();
    const guidance = `  ${'中'.repeat(199)}  末尾  `;
    const native = harness(mode === 'stream' ? streamText : JSON.stringify(report));
    const withGuidance = { ...value, settings: { ...value.settings, userGuidance: guidance } };
    const context = host();
    await executeArenaDirect(native.options, withGuidance, task(mode), context, new AbortController().signal);
    const payload = { ...buildArenaGenerationInputSnapshot(withGuidance), adjudicationResults: [] };
    const expected = assembleArenaGenerationPrompt({ payload: { ...payload, userGuidance: mode === 'stream' ? guidance.trim() : guidance.trim().slice(0, 200) }, outputContract: mode === 'stream' ? 'stream-markdown' : 'structured-report', reporterInfo: context.reporterInfo, adjudicationResults: [] });
    expect(native.request!.messages.at(-1)!.content).toBe(expected.prompt);
    expect(JSON.parse(native.request!.arenaInputJson!).userGuidance).toBe(guidance);
  }
});
it.each(['reject', 'null'] as const)('cancellation wins when asynchronous local metadata repair returns %s', async ending => {
  const abort = new AbortController();
  const repair = vi.spyOn(arenaCore, 'extractStreamUpdateMeta').mockImplementationOnce(async () => { abort.abort(); if (ending === 'reject') throw new Error('invalid local meta'); return null; });
  try {
    const native = harness();
    const result = await executeArenaDirect(native.options, input(), task(), host(), abort.signal);
    expect(result.status).toBe('cancelled'); expect(result.rawText).toBe(streamText); expect(result).not.toHaveProperty('historyCandidate');
  } finally { repair.mockRestore(); }
});

it('hands the existing pure history consumer one deduplicated candidate without writing it', async () => {
  const native = harness();
  const result = await executeArenaDirect(native.options, input(), { ...task(), requestId: '  arena-normalized  ' }, host(), new AbortController().signal);
  if (result.status !== 'completed' || !result.historyCandidate) throw new Error('missing completed candidate');
  expect(result.historyCandidate.generationId).toBe('arena-normalized');
  expect(result.requestId).toBe('arena-normalized');
  const first = appendNarrativeHistoryEntry([], result.historyCandidate, { fallbackId: 'ignored', createdAt: '2026-10-09T22:00:00Z' });
  const second = appendNarrativeHistoryEntry(first.entries, result.historyCandidate, { fallbackId: 'another', createdAt: '2026-10-09T22:01:00Z' });
  expect(first.appended).toBe(true); expect(second.appended).toBe(false); expect(second.entries).toHaveLength(1);
});

it('uses the last source metadata block even after an earlier complete block', async () => {
  const old = '<!-- MAHOSHOJO_ARENA_META {"report":{"winner":"旧胜者"},"impacts":[{"characterName":"甲","impact":"旧影响"}]} -->';
  const latest = '<!-- MAHOSHOJO_ARENA_META {"report":{"winner":"新胜者"},"impacts":[{"characterName":"甲","impact":"新影响"}]}';
  const native = harness(`# 正文\n\n${old}\n${latest}`);
  const result = await executeArenaDirect(native.options, input(), task(), host(), new AbortController().signal);
  expect(result.status).toBe('completed');
  if (result.status === 'completed') {
    expect(result.report.officialReport.winner).toBe('新胜者');
    expect(result.impacts).toEqual([{ characterName: '甲', impact: '新影响' }]);
  }
  const broken = harness(`# 正文\n\n${old}\n<!-- MAHOSHOJO_ARENA_META not-json`);
  const invalid = await executeArenaDirect(broken.options, input(), task(), host(), new AbortController().signal);
  expect(invalid.status).toBe('invalid-output'); expect(invalid.rawText).toContain('not-json');
  expect(invalid.markdown).toBe('# 正文'); expect(invalid).not.toHaveProperty('historyCandidate');
});

it.each(['MAHOSHOJO_ARENA_META', 'MAHOSHOJO_TELEMETRY_META'] as const)('never saves unfinished loose %s as report prose', async marker => {
  const raw = `正文\n${marker} {"${marker.includes('TELEMETRY') ? 'usage' : 'impacts'}":`;
  const native = harness(raw);
  const partials: string[] = [];
  const result = await executeArenaDirect(native.options, input(), task(), host(), new AbortController().signal, partial => partials.push(partial.markdown));
  expect(result.rawText).toBe(raw); expect(result.markdown).toBe('正文'); expect(partials.join('')).not.toContain(marker);
  if (marker === 'MAHOSHOJO_ARENA_META') {
    expect(result.status).toBe('invalid-output'); expect(result).not.toHaveProperty('historyCandidate');
  } else {
    expect(result.status).toBe('completed');
    if (result.status === 'completed') expect(result.historyCandidate?.content).toBe('正文');
  }
});

it('does not fall back to an old complete update when the latest loose update is cut off', async () => {
  const raw = '正文\n<!-- MAHOSHOJO_ARENA_META {"report":{"winner":"旧胜者"}} -->\nMAHOSHOJO_ARENA_META {"impacts":';
  const native = harness(raw);
  const result = await executeArenaDirect(native.options, input(), task(), host(), new AbortController().signal);
  expect(result.status).toBe('invalid-output'); expect(result.rawText).toBe(raw);
  expect(result.markdown).toBe('正文'); expect(result).not.toHaveProperty('historyCandidate');
});
