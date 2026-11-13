import { withFixtureStreamReceipt } from './helpers/stream-receipt-fixture';
import { describe, expect, it, vi } from 'vitest';
import * as teaCore from '@mahoshojo/ai-core/magic-tea-party';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { applyMagicTeaPartyMessageLimits, buildMagicTeaPartyChoicesPrompt, buildMagicTeaPartyChoicesPromptMessages, buildMagicTeaPartyHistory, buildMagicTeaPartyMainPrompt, buildMagicTeaPartyMainPromptMessages, buildMagicTeaPartySummarizePromptMessages, estimateMagicTeaPartyTokens, projectMagicTeaPartyChoices, resolveMagicTeaPartyMessageCharLimit, resolveMagicTeaPartyTokenBudget, trimMagicTeaPartyHistory, projectMagicTeaPartySummaryInput } from '@mahoshojo/ai-core/magic-tea-party';
import type { TeaMessageDocument, TeaReadRequest, TeaReadResponse } from '@mahoshojo/contracts/desktop-magic-tea-party';
import type { ResolvedDesktopAiTarget } from '../src/features/ai-config/desktop-ai-config';
import { desktopTeaSettings, executeTeaDirect, prepareTeaDirectRequest, teaSessionView, teaTerminalMessage, type TeaRecord } from '../src/features/magic-tea-party/direct';
import { editedTeaSummary, prepareTeaSummaryRequest, prepareTeaAutoSummaryRequest } from '../src/features/magic-tea-party/summary';
import type { TeaNativePort } from '../src/platform/magic-tea-party-native';

export const target: ResolvedDesktopAiTarget = { location: 'client', providerTarget: { kind: 'custom', profileId: 'tea-loopback' }, profile: null,
  mode: 'direct-local', modelId: 'synthetic', availableModelIds: ['synthetic'], generationOverrides: undefined, unavailableReason: null };
const record = (): TeaRecord => ({ instance: 'a'.repeat(32), revision: 1, session: { id: 'tea', title: '星光', createdAt: 1, updatedAt: 1, roles: [],
  settings: { providerId: 'openai', modelId: 'synthetic', maxContextMessages: 3, contextWindowTokens: 8192 } } });
const rows = [1, 2, 3, 4].map(id => ({ ordinal: id, message: { id: `m${id}`, sessionId: 'tea', createdAt: id, role: 'user' as const, content: id === 3 ? '中😀'.repeat(20000) : `row-${id}` } }));
const paged = (source: Array<{ ordinal: number; message: TeaMessageDocument }> = rows) => {
  const read = vi.fn(async (input: TeaReadRequest): Promise<TeaReadResponse> => {
    if (input.request.action !== 'messages') throw new Error('unexpected');
    const index = input.request.cursor?.ordinal ?? 0; const page = source.slice(index, index + 2);
    const last = page.at(-1);
    return { version: 1, result: { action: 'messages', catalogRevision: 1, sessionId: 'tea', instance: 'a'.repeat(32), revision: 1, rows: page,
      nextCursor: last && index + page.length < source.length ? { ordinal: last.ordinal, id: last.message.id } : null } };
  });
  return { read, mutate: vi.fn() } satisfies TeaNativePort;
};
describe('Desktop Tea actual shared prompt and Direct bridge', () => {
  it.each(['provider', 'stopped', 'failed'] as const)('keeps %s reasoning in the canonical envelope without changing the accepted body', completion => {
    const placeholder: TeaMessageDocument = { id: 'a', sessionId: 'tea', role: 'assistant', content: '', createdAt: 1, status: 'streaming' };
    for (const kind of ['chat', 'choices', 'summary'] as const) {
      const value = teaTerminalMessage(placeholder, { completion, rawText: '  正文😀  ', reasoning: '  思考原文😀  ' }, 'markdown', kind);
      expect(value.meta?.aiReasoning).toEqual({ status: completion === 'provider' ? 'done' : 'error', source: 'provider', text: '  思考原文😀  ' });
      expect(value.meta).not.toHaveProperty('reasoningText');
      expect(value.meta?.rawOutput).toBe('  正文😀  ');
      expect(value.status).toBe(completion === 'provider' ? 'done' : 'error');
    }
  });

  it.each(['markdown', 'jsonl'] as const)('uses the shared choices prompt and its own budget without mutating %s preferences or adding an opening/continue instruction', async outputFormat => {
    const value = record(); value.session.settings.outputFormat = outputFormat; value.session.draft = '不能发送的草稿'; const port = paged(); const before = JSON.stringify(value);
    const request = await prepareTeaDirectRequest(port, value, target, null, 'request', () => true, 'choices');
    const session = teaSessionView(value.session); const base = { session, roles: [], messages: [], worldbookText: '', stylePrompt: '', updates: 'off' as const };
    const budget = resolveMagicTeaPartyTokenBudget(session.settings, 'openai');
    const selected = trimMagicTeaPartyHistory(buildMagicTeaPartyHistory(rows.map(row => row.message), { includeEmptyContent: false }), {
      maxMessages: budget.maxContextMessages, tokenBudget: Math.max(0, budget.historyBudgetTokens - estimateMagicTeaPartyTokens(buildMagicTeaPartyChoicesPrompt(base), 'openai')),
      providerId: 'openai', userDisplayName: '旅人', minKeep: 2 });
    const limited = applyMagicTeaPartyMessageLimits(selected, resolveMagicTeaPartyMessageCharLimit(budget.contextWindowTokens));
    const expected = buildMagicTeaPartyChoicesPromptMessages({ ...base, messages: limited.messages.map(message => ({ ...message, sessionId: value.session.id, createdAt: 0 })) });
    expect(request.messages).toEqual([{ role: 'system', content: expected.systemPrompt }, { role: 'user', content: expected.prompt }]); expect(request.messages.map(message => message.content).join('\n')).not.toContain('不能发送的草稿');
    expect(JSON.stringify(value)).toBe(before); expect(port.read).toHaveBeenCalledTimes(4);
    for (const [call] of port.read.mock.calls) expect(call.request).toMatchObject({ expectedRevision: value.revision, instance: value.instance });
    const emptyRequest = await prepareTeaDirectRequest(paged([]), value, target, null, 'empty', () => true, 'choices');
    expect(emptyRequest.messages).toEqual([
      { role: 'system', content: buildMagicTeaPartyChoicesPromptMessages(base).systemPrompt },
      { role: 'user', content: buildMagicTeaPartyChoicesPromptMessages(base).prompt },
    ]);
  });
  it.each(['provider', 'stopped', 'failed'] as const)('uses the same terminal choices projection for %s completion and preserves unsupported side-channel raw bytes', completion => {
    const rawText = '{"type":"choices","items":[{"id":"c1","text":"喝茶"}]}\n{"type":"summary","text":"不应用摘要"}\n{"type":"updates","items":[]}';
    const outcome = { completion, rawText, reasoning: '' }; const projection = projectMagicTeaPartyChoices({ rawText, completion: completion === 'provider' ? 'completed' : completion });
    const message = teaTerminalMessage({ id: 'a', sessionId: 'tea', role: 'assistant', content: '', createdAt: 1, status: 'streaming' }, outcome, 'jsonl', 'choices');
    expect(message).toMatchObject({ status: projection.status, choices: projection.choices, segments: projection.segments,
      meta: { rawOutput: rawText, outputFormat: 'jsonl', kind: 'choices', choicesValid: Boolean(projection.lastChoices) } });
    expect(message).not.toHaveProperty('summary'); expect(message).not.toHaveProperty('updates');
  });
  it('constructs the same Web history pipeline through two bounded revision-fenced passes', async () => {
    const value = record(); const port = paged();
    const input = { id: 'new', sessionId: 'tea', createdAt: 5, role: 'user' as const, content: '继续喝茶' };
    const request = await prepareTeaDirectRequest(port, value, target, input, 'request', () => true);
    const session = teaSessionView(value.session); const base = { session, roles: [], messages: [], worldbookText: '', stylePrompt: '', requestChoices: false };
    const budget = resolveMagicTeaPartyTokenBudget(session.settings, 'openai');
    const history = buildMagicTeaPartyHistory([...rows.map(row => row.message), input], { includeEmptyContent: false });
    const selected = trimMagicTeaPartyHistory(history, { maxMessages: budget.maxContextMessages,
      tokenBudget: Math.max(0, budget.historyBudgetTokens - estimateMagicTeaPartyTokens(buildMagicTeaPartyMainPrompt(base), 'openai')), providerId: 'openai', userDisplayName: '旅人', minKeep: 2 });
    const limited = applyMagicTeaPartyMessageLimits(selected, resolveMagicTeaPartyMessageCharLimit(budget.contextWindowTokens));
    const expected = buildMagicTeaPartyMainPromptMessages({ ...base, messages: limited.messages.map(message => ({ ...message, sessionId: 'tea', createdAt: 0 })) });
    expect(request.messages).toEqual([{ role: 'system', content: expected.systemPrompt }, { role: 'user', content: expected.prompt }]);
    expect(port.read).toHaveBeenCalledTimes(4);
    for (const [call] of port.read.mock.calls) expect(call.request).toMatchObject({ instance: value.instance, expectedRevision: 1 });
    expect(/[\uD800-\uDFFF]/u.test(expected.systemPrompt + expected.prompt)).toBe(false);
    expect(expected.systemPrompt).not.toContain('row-');
    expect(expected.systemPrompt).not.toContain('继续喝茶');
    expect(expected.prompt).toContain('继续喝茶');
    expect(value.session.settings.maxContextMessages).toBe(3);
  });
  it('abandons all partial history on second-pass revision failure before any model invocation', async () => {
    const port = paged(); const original = port.read.getMockImplementation()!; let calls = 0;
    port.read.mockImplementation(async input => { if (++calls === 3) throw new Error('tea-conflict'); return original(input); });
    await expect(prepareTeaDirectRequest(port, record(), target, null, 'request', () => true)).rejects.toThrow('tea-conflict');
    expect(port.mutate).not.toHaveBeenCalled();
  });
  it('does not apply an 800k whole-session gate or silently clamp an extreme history setting', async () => {
    const value = record(); value.session.settings.maxContextMessages = 1;
    const huge = [{ ordinal: 1, message: { ...rows[0]!.message, content: '中'.repeat(900000) } }];
    const request = await prepareTeaDirectRequest(paged(huge), value, target, null, 'request', () => true);
    expect(request.messages.map(message => message.content).join('\n').length).toBeLessThan(20000);
    value.session.settings.maxContextMessages = 10001;
    await expect(prepareTeaDirectRequest(paged(), value, target, null, 'request', () => true)).rejects.toThrow('10000');
    expect(value.session.settings.maxContextMessages).toBe(10001);
  });
  it('projects unknown settings away without changing the archive and suppresses unsupported side-channel calls', () => {
    const value = { providerId: 'openai', modelId: 'm', injectedEndpoint: 'https://invalid.example', outputPlan: { choices: 'on', summary: 'on', updates: 'on', unknown: 'leave in archive' }, enableSummary: true };
    const original = JSON.stringify(value); const projected = desktopTeaSettings(value);
    expect(projected).not.toHaveProperty('injectedEndpoint');
    expect(projected.outputPlan).toEqual({ choices: 'on', summary: 'off', updates: 'off' });
    expect(JSON.stringify(value)).toBe(original);
  });
  it('uses the actual Native stream adapter and retains accepted Unicode prefixes after protocol failure', async () => {
    const request = { requestId: 'request', contractVersion: 1 as const, mode: 'direct-local' as const, messages: [{ role: 'user' as const, content: 'synthetic' }] };
    const identity = { requestId: request.requestId, contractVersion: 1 as const, mode: request.mode };
    const invoke = vi.fn(withFixtureStreamReceipt(async (_command: string, args?: Record<string, unknown>) => {
      const channel = args?.onEvent as { onmessage: (_event: AiStreamEvent) => void };
      channel.onmessage({ ...identity, sequence: 0, type: 'started' });
      channel.onmessage({ ...identity, sequence: 1, type: 'text-delta', delta: '中😀' });
      channel.onmessage({ ...identity, sequence: 7, type: 'text-delta', delta: '不可接受' });
    }));
    const progress = vi.fn();
    const outcome = await executeTeaDirect({ invoke, profileId: 'tea-loopback', createChannel: () => ({}) }, request, new AbortController().signal, progress);
    expect(outcome).toMatchObject({ completion: 'failed', rawText: '中😀' });
    const message = teaTerminalMessage({ id: 'a', sessionId: 'tea', role: 'assistant', content: '', createdAt: 1, status: 'streaming' }, outcome, 'markdown');
    expect(message).toMatchObject({ status: 'error', content: '中😀', meta: { rawOutput: '中😀', completion: 'failed' } });
  });
});


describe('Desktop manual summary input and terminal seam', () => {
  it('matches the actual Web projection over paged, non-contiguous, clipped history and excludes its own records', async () => {
    const value = record(); value.session.settings.maxContextMessages = 200; value.session.draft = 'NOT_SENT_DRAFT';
    value.session.protocolShadow = { unknown: 'NOT_SENT_PROTOCOL' }; value.session.settings.future = 'NOT_SENT_SETTING';
    const source = Array.from({ length: 205 }, (_, index) => ({ ordinal: index + 1,
      message: { id: `history-${index}`, sessionId: 'tea', createdAt: index, role: 'user' as const, content: `原始剧情-${index}` } }));
    source[201]!.message.content = 'SKIPPED_HUGE' + '中😀'.repeat(50000);
    source[204]!.message.content = '两层裁剪😀'.repeat(20000);
    const input: Array<{ ordinal: number; message: TeaMessageDocument }> = [...source,
      { ordinal: 206, message: { id: 'old-summary', sessionId: 'tea', createdAt: 206, role: 'assistant', status: 'done', content: 'NOT_SENT_SUMMARY_RECORD', meta: { kind: 'summary' } } }];
    const before = JSON.stringify([value, input]); const port = paged(input);
    const prepared = await prepareTeaSummaryRequest(port, value, target, 'summary-request', () => true);
    const history = buildMagicTeaPartyHistory(input.map(row => row.message), { includeEmptyContent: false });
    const settings = teaSessionView(value.session).settings; const budget = resolveMagicTeaPartyTokenBudget(settings, 'openai');
    const selected = trimMagicTeaPartyHistory(history, { maxMessages: budget.maxContextMessages, tokenBudget: budget.historyBudgetTokens, providerId: 'openai', userDisplayName: '旅人', minKeep: 2 });
    const expected = projectMagicTeaPartySummaryInput({ messages: selected, contextWindowTokens: budget.contextWindowTokens, language: settings.language, userDisplayName: '旅人', sourceMessageCount: history.length });
    const promptMessages = buildMagicTeaPartySummarizePromptMessages({ messages: expected.requestMessages, language: settings.language, userDisplayName: '旅人' });
    expect(prepared.request.messages).toEqual([{ role: 'system', content: promptMessages.systemPrompt }, { role: 'user', content: promptMessages.prompt }]);
    expect(`${promptMessages.systemPrompt}\n\n${promptMessages.prompt}`).toBe(expected.prompt);
    expect(promptMessages.systemPrompt).not.toContain('原始剧情');
    expect(prepared.summaryMeta).toEqual({ fromMessageId: 'history-0', toMessageId: 'history-204', coverage: expected.coverage });
    expect(expected.coverage.selectedMessageIds).not.toContain('history-201');
    expect(expected.coverage.clippedMessageIds).toContain('history-204');
    expect(expected.coverage.omittedMessageCount).toBeGreaterThan(0);
    expect(prepared.request.messages.map(message => message.content).join('\n')).not.toMatch(/NOT_SENT/);
    expect(JSON.stringify([value, input])).toBe(before); expect(port.mutate).not.toHaveBeenCalled();
  });
  it('context-clips each retained second-pass row before the summary projector owns the selected array', async () => {
    const projection = vi.spyOn(teaCore, 'projectMagicTeaPartySummaryInput');
    try {
      const value = record(); const source = [1, 2].map(ordinal => ({ ordinal, message: { ...rows[0]!.message, id: `large-${ordinal}`, content: '中😀'.repeat(30000) } }));
      const result = await prepareTeaSummaryRequest(paged(source), value, target, 'bounded', () => true);
      expect(projection).toHaveBeenCalledOnce(); const input = projection.mock.calls[0]![0];
      expect(input.messages.every(message => message.content.length <= 8000)).toBe(true);
      expect(input.contextClippedMessageIds).toEqual(['large-1', 'large-2']);
      expect(result.summaryMeta.coverage?.clippedMessageIds).toEqual(['large-1', 'large-2']);
    } finally { projection.mockRestore(); }
  });
  it('keeps a huge local source while bounding only its selected request, and never dispatches an empty or stale source', async () => {
    const value = record(); value.session.settings.maxContextMessages = 1;
    const big = [{ ordinal: 1, message: { ...rows[0]!.message, content: '中'.repeat(900000) } }];
    const result = await prepareTeaSummaryRequest(paged(big), value, target, 'big', () => true);
    expect(result.request.messages.map(message => message.content).join('\n').length).toBeLessThan(20000);
    await expect(prepareTeaSummaryRequest(paged([]), value, target, 'empty', () => true)).rejects.toThrow('还没有');
    await expect(prepareTeaSummaryRequest(paged(), value, target, 'stale', () => false)).rejects.toThrow('已失效');
  });
  it.each(['provider', 'stopped', 'failed'] as const)('does not parse summary content as choices or updates for %s', completion => {
    const rawText = '  {"type":"choices","items":[{"id":"c1","text":"不可行动"}]}\n{"type":"updates","drafts":[]}  ';
    const value = teaTerminalMessage({ id: 's', sessionId: 'tea', role: 'assistant', status: 'streaming', content: '', createdAt: 1 }, { completion, rawText, reasoning: '' }, 'jsonl', 'summary');
    expect(value).toMatchObject({ status: completion === 'provider' ? 'done' : 'error', content: rawText.trim(), meta: { kind: 'summary', rawOutput: rawText, completion } });
    expect(value.choices).toBeUndefined(); expect(value.segments).toBeUndefined(); expect(buildMagicTeaPartyHistory([value])).toEqual([]);
  });
  it.each(['', '  \n ', '\ud800'])('does not mark invalid summary %j successful and retains its exact raw output', rawText => {
    const value = teaTerminalMessage({ id: 's', sessionId: 'tea', role: 'assistant', status: 'streaming', content: '', createdAt: 1 }, { completion: 'provider', rawText, reasoning: '' }, 'markdown', 'summary');
    expect(value.status).toBe('error'); expect(value.meta?.rawOutput).toBe(rawText);
  });
  it('manual edits drop only coverage, preserve unrelated metadata and keep full stored text', () => {
    const value = record().session; value.summaryMeta = { updatedAt: 1, fromMessageId: 'a', toMessageId: 'b', tokenCount: 999, extension: { untouched: true }, coverage: { version: 1 } };
    value.summarySections = { original: '分节保留' }; const text = '  ' + '长摘要'.repeat(4000) + '  ';
    expect(editedTeaSummary(value, text, 99)).toEqual({ summary: text, summarySections: value.summarySections,
      summaryMeta: { updatedAt: 99, fromMessageId: 'a', toMessageId: 'b', extension: { untouched: true } } });
    expect(editedTeaSummary(value, ' ', 99)).toEqual({ summary: undefined, summarySections: undefined, summaryMeta: { extension: { untouched: true }, updatedAt: 99 } });
    expect(value.summaryMeta).toHaveProperty('coverage');
  });
});

describe('Desktop bounded automatic summary preparation', () => {
  it('selects the same seed-aware prompt and real coverage through two fixed-revision passes', async () => {
    const value = record(); value.session.settings = { ...value.session.settings, autoSummaryEnabled: true, summaryMinGapMessages: 1 };
    value.session.summary = '旧摘要😀'.repeat(5000);
    const port = paged();
    const result = await prepareTeaAutoSummaryRequest(port, value, target, 'auto', () => true, 0);
    expect(result).not.toBeNull();
    const session = teaSessionView(value.session); const history = buildMagicTeaPartyHistory(rows.map(row => row.message), { includeEmptyContent: false });
    const budget = teaCore.resolveMagicTeaPartyAutoSummaryBudget({ settings: session.settings, providerId: 'openai', previousSummary: session.summary });
    const selected = trimMagicTeaPartyHistory(history, { maxMessages: budget.maxMessages, tokenBudget: budget.historyBudgetTokens, providerId: 'openai', userDisplayName: '旅人', minKeep: 2 });
    const expected = teaCore.projectMagicTeaPartyAutoSummaryInput({ messages: selected, seedContent: budget.seedContent, contextWindowTokens: budget.contextWindowTokens,
      language: session.settings.language, userDisplayName: '旅人', sourceMessageCount: history.length });
    const promptMessages = buildMagicTeaPartySummarizePromptMessages({ messages: expected.requestMessages, language: session.settings.language, userDisplayName: '旅人' });
    expect(result!.request.messages).toEqual([{ role: 'system', content: promptMessages.systemPrompt }, { role: 'user', content: promptMessages.prompt }]);
    expect(`${promptMessages.systemPrompt}\n\n${promptMessages.prompt}`).toBe(expected.prompt);
    expect(promptMessages.systemPrompt).not.toContain('旧摘要');
    expect(promptMessages.prompt).toContain('旧摘要');
    expect(result!.summaryMeta).toEqual({ fromMessageId: 'm1', toMessageId: 'm4', coverage: expected.coverage });
    expect(result!.autoSummaryThroughMessageId).toBe('m4'); expect(result!.request.maxOutputTokens).toBe(1200);
    expect(port.read).toHaveBeenCalledTimes(4);
    for (const [call] of port.read.mock.calls) expect(call.request).toMatchObject({ expectedRevision: value.revision, instance: value.instance });
    expect(expected.summaryInput.messageIds).toHaveLength(expected.coverage.selectedMessageIds.length + 1);
    const explicit = await prepareTeaAutoSummaryRequest(paged(), value, { ...target, generationOverrides: { maxOutputTokens: 321 } }, 'override', () => true, 0);
    expect(explicit!.request.maxOutputTokens).toBe(321);
  });
  it('does not read a second pass when disabled or the latest attempt has insufficient new source', async () => {
    const value = record(); const off = paged();
    expect(await prepareTeaAutoSummaryRequest(off, value, target, 'off', () => true, 2)).toBeNull();
    expect(off.read).toHaveBeenCalledTimes(2);
    value.session.settings.autoSummaryEnabled = true;
    value.session.settings.summaryMinGapMessages = 1;
    value.session.autoSummaryState = { lastAttemptedThroughMessageId: 'm4' };
    const attempted = paged(); expect(await prepareTeaAutoSummaryRequest(attempted, value, target, 'attempted', () => true, 2)).toBeNull();
    expect(attempted.read).toHaveBeenCalledTimes(2);
  });
  it('counts all eligible history for the original request drop ratio while retaining only a bounded tail', async () => {
    const value = record(); value.session.settings.maxContextMessages = 2;
    const report = vi.fn(); await prepareTeaDirectRequest(paged(), value, target, null, 'chat', () => true, 'chat', report);
    expect(report).toHaveBeenCalledExactlyOnceWith(0.5);
  });
  it('abandons an automatic second pass on revision change and cannot prepare a partial-source request', async () => {
    const value = record(); value.session.settings = { ...value.session.settings, autoSummaryEnabled: true, summaryMinGapMessages: 1 };
    const port = paged(); const original = port.read.getMockImplementation()!; let calls = 0;
    port.read.mockImplementation(async input => { if (++calls === 3) throw new Error('tea-stale'); return original(input); });
    await expect(prepareTeaAutoSummaryRequest(port, value, target, 'stale', () => true, 2)).rejects.toThrow('tea-stale');
    expect(port.mutate).not.toHaveBeenCalled();
  });
});
