import { describe, expect, it, vi } from 'vitest';
import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { createSublimationGenerationCore } from '@mahoshojo/ai-core/sublimation-generation';
import type { HostedGenerationEvent } from '@mahoshojo/contracts/desktop-cloud';
import { createBlankSublimationCharacterCard } from '@mahoshojo/domain/sublimation';
import { executeSublimationGeneration, prepareSublimationInput, validateSublimationCard, type SublimationGenerationInput } from '../src/features/sublimation/generation';
import { buildSublimationInput, createInitialSublimationDraft } from '../src/features/sublimation/session';
import { STREAM_DIRECT_AI_COMMAND } from '../src/platform/direct-ai-bridge';
import { HOSTED_AI_REQUEST_COMMAND, STREAM_HOSTED_AI_COMMAND } from '../src/platform/cloud-bridge';

const source = {
  templateId: '通用角色', name: '夜雨', content: '完整原设定', signature: 'source-signature',
  _extension: { nested: ['must survive'] },
  arena_history: { attributes: { world_line_id: 'original-world', extension: 'keep' }, entries: [
    { id: 5, type: 'battle', title: '战斗', impact: '懂得信任', legacy: { keep: true } },
    { id: 8, type: 'sublimation', title: '前次成长', impact: '承担责任', extra: 'keep' },
  ] },
  current_state: { summary: '受伤', fields: [{ id: 'hp', label: '体力', type: 'number', value: 3, extra: 'keep' }], extra: 'keep' },
};
const input = (patch: Partial<SublimationGenerationInput> = {}): SublimationGenerationInput => ({
  ...buildSublimationInput({ ...createInitialSublimationDraft(), originalData: structuredClone(source), arenaHistoryRetentionStrategy: 'keep-all' }), ...patch,
});
const aiResult = { updatedCharacterData: { name: '夜雨「新生」', content: '全新设定', current_state: { summary: '振作' } }, sublimationEvent: { title: '新生', impact: '跨越过去' } };
const directHarness = (text: string, finishReason: 'stop' | 'length' = 'stop') => {
  let sent: AiExecutionRequest | undefined;
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command !== STREAM_DIRECT_AI_COMMAND) throw new Error(`unexpected command: ${command}`);
    sent = args!.request as AiExecutionRequest;
    const channel = args!.onEvent as { onmessage: (event: AiStreamEvent) => void };
    const identity = { requestId: sent.requestId, contractVersion: 1 as const, mode: sent.mode };
    channel.onmessage({ type: 'started', ...identity, sequence: 0 });
    channel.onmessage({ type: 'text-delta', ...identity, sequence: 1, delta: text });
    const result: AiExecutionResult = { ...identity, status: 'completed', output: { text }, finishReason };
    channel.onmessage({ type: 'result', ...identity, sequence: 2, result });
  });
  return { invoke, options: { invoke, profileId: 'test-profile', createChannel: () => ({}) }, get request() { return sent; } };
};
const runDirect = (value = input(), text = JSON.stringify(aiResult)) => {
  const native = directHarness(text);
  return { native, result: executeSublimationGeneration(native.options, value, { requestId: 'sublimation-1', mode: 'direct-local' }, new AbortController().signal) };
};

describe('Desktop sublimation shared executor', () => {
  it('direct structured uses exact shared core, finalizes history and state, never signs or mutates input', async () => {
    const value = input({ userGuidance: '守护同伴', narrativeHistory: '某次重逢', loreText: '城市设定', defaultQuestions: { magicalGirl: ['注入题干'], canshou: [] } });
    const before = structuredClone(value);
    const { native, result } = runDirect(value); const outcome = await result;
    const expected = createSublimationGenerationCore({
      ...prepareSublimationInput(value), originalData: value.originalData, targetTemplate: value.targetTemplate,
      language: value.language, userGuidance: value.userGuidance, narrativeHistory: value.narrativeHistory,
      loreText: value.loreText, fieldsToPreserve: [], allowReshapeNames: false, defaultQuestions: value.defaultQuestions!,
      stateOptions: { readArenaHistory: true, writeArenaHistory: true, readCurrentState: true, writeCurrentState: true },
    });
    expect(native.request!.messages[1]!.content).toBe(expected.promptBuilder());
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error(JSON.stringify(outcome));
    expect(outcome.cardKind).toBe('general');
    expect(outcome.card).toMatchObject({ name: '夜雨「新生」', content: '全新设定', current_state: { summary: '振作', fields: source.current_state.fields } });
    expect(outcome.card).not.toHaveProperty('signature');
    const history = outcome.card.arena_history as typeof source.arena_history;
    expect(history.entries.slice(0, 2)).toEqual(source.arena_history.entries);
    expect(history.attributes).toMatchObject(source.arena_history.attributes);
    expect(history.entries.at(-1)).toMatchObject({ type: 'sublimation', title: '新生' });
    expect(value).toEqual(before); expect(native.invoke).toHaveBeenCalledTimes(1);
  });
  it('direct prompt consumes typed Lore once, excludes disabled sources and remains unsigned', async () => {
    const selectedQuestionnaires = [
      { source: 'preset' as const, questionnaire: { id: 'preset', kind: 'magical-girl' as const, title: '预设源', questions: [], loreMarkdown: '唯一设定证据', nativeAllowed: true } },
      { source: 'upload' as const, questionnaire: { id: 'off', kind: 'magical-girl' as const, title: '关闭源', questions: [], loreMarkdown: '不能进入提示词' }, useLore: false },
    ];
    const { native, result } = runDirect(input({ selectedQuestionnaires }));
    const outcome = await result;
    expect(native.request!.messages[1]!.content).toContain('唯一设定证据');
    expect(native.request!.messages[1]!.content).not.toContain('不能进入提示词');
    expect(String(native.request!.messages[1]!.content).split('唯一设定证据')).toHaveLength(2);
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') expect(outcome.card).not.toHaveProperty('signature');
  });
  it('preserve fields and disabled state/history writes survive local finalize', async () => {
    const outcome = await runDirect(input({ fieldsToPreserve: ['name'], writeArenaHistory: false, writeCurrentState: false })).result;
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('not completed');
    expect(outcome.card.name).toBe('夜雨');
    expect(outcome.card.arena_history).toEqual(source.arena_history);
    expect(outcome.card.current_state).toEqual(source.current_state);
  });
  it.each(['magical-girl', 'canshou'] as const)('supports %s and normalizes answers with injected questions', async (targetTemplate) => {
    const generated = { ...createBlankSublimationCharacterCard(targetTemplate), userAnswers: ['新的回答'] };
    const outcome = await runDirect(input({ targetTemplate, defaultQuestions: { magicalGirl: ['专属问题'], canshou: ['专属问题'] } }), JSON.stringify({ ...aiResult, updatedCharacterData: generated })).result;
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error(JSON.stringify(outcome));
    expect(outcome.cardKind).toBe(targetTemplate);
    expect(outcome.card.userAnswers).toEqual([{ question: '专属问题', answer: '新的回答' }]);
  });
  it('loads canonical default-question assets offline when no injection is supplied', async () => {
    const originalData = { ...createBlankSublimationCharacterCard('magical-girl'), userAnswers: ['我会保护大家'] };
    const { native, result } = runDirect(input({ originalData, targetTemplate: 'magical-girl' }), JSON.stringify({ ...aiResult, updatedCharacterData: createBlankSublimationCharacterCard('magical-girl') }));
    await result; expect(native.request!.messages[1]!.content).toContain('你的真实名字是？');
    expect(native.request!.messages[1]!.content).toContain('我会保护大家');
  });
  it.each(['direct-local', 'direct-remote'] as const)('%s stream applies read flags and saves unsigned general card', async (mode) => {
    const native = directHarness('# 新生\n\n角色设定\n\n## 升华事件\n### 初次和解\n终于相信伙伴');
    const outcome = await executeSublimationGeneration(native.options, input({ readArenaHistory: false, readCurrentState: false }), { requestId: 'stream-1', mode, generationMode: 'stream' }, new AbortController().signal);
    expect(native.request?.messages).toHaveLength(1);
    expect(native.request!.messages[0]!.content).not.toContain('JSON Schema');
    expect(native.request!.messages[0]!.content).not.toContain('懂得信任');
    expect(native.request!.messages[0]!.content).not.toContain('受伤');
    expect(outcome).toMatchObject({ status: 'completed', mode, cardKind: 'general', card: { name: '新生', current_state: source.current_state } });
    if (outcome.status === 'completed') expect(outcome.card).not.toHaveProperty('signature');
  });
  it('invalid or incomplete output is not replayed and retains raw text', async () => {
    for (const text of ['{broken', '{}']) {
      const { native, result } = runDirect(input(), text);
      expect(await result).toMatchObject({ status: 'invalid-output', rawText: text });
      expect(native.invoke).toHaveBeenCalledTimes(1);
    }
    const native = directHarness(JSON.stringify(aiResult), 'length');
    expect(await executeSublimationGeneration(native.options, input(), { requestId: 'length-1', mode: 'direct-local' }, new AbortController().signal)).toMatchObject({ status: 'invalid-output' });
  });
  it.each([
    { originalData: {} }, { targetTemplate: 'scenario' }, { fieldsToPreserve: ['not-a-field'] },
    { userGuidance: 'x'.repeat(201) }, { writeCurrentState: 'false' },
    { originalData: { ...source, arena_history: { entries: [null] } } },
  ])('rejects invalid input before IPC: %j', async (patch) => {
    const native = directHarness('{}');
    await expect(executeSublimationGeneration(native.options, input(patch as Partial<SublimationGenerationInput>), { requestId: 'invalid-1', mode: 'direct-local' }, new AbortController().signal)).rejects.toThrow();
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it('never silently truncates stream narrative or overwrites source control fields', async () => {
    const native = directHarness('{}');
    await expect(executeSublimationGeneration(native.options, input({ narrativeHistory: 'x'.repeat(8001) }), { requestId: 'long', mode: 'hosted-stream' }, new AbortController().signal)).rejects.toThrow('8000');
    await expect(executeSublimationGeneration(native.options, input({ originalData: { ...source, language: '原始语言' } }), { requestId: 'collision', mode: 'hosted-json' }, new AbortController().signal)).rejects.toThrow('字段冲突');
    expect(native.invoke).not.toHaveBeenCalled();
  });
});

describe('Desktop sublimation hosted JSON / SSE', () => {
  it('unwraps sublimatedData without changing signed body and sends original text', async () => {
    let request: { routeId: string; body: Record<string, unknown> } | undefined;
    const card = { ...structuredClone(source), signature: '  official-signature  ', metadata: { author: '保留', signature: 'also-kept' } };
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe(HOSTED_AI_REQUEST_COMMAND); request = args!.request as typeof request;
      return { status: 200, body: { data: { sublimatedData: card, unchangedFields: [], targetTemplate: 'general' }, aiMeta: { aiReasoning: { status: 'done', source: 'sdk', text: 'reason' } } } };
    });
    const outcome = await executeSublimationGeneration({ invoke, profileId: '' }, input({ userGuidance: ' 完整引导 ', narrativeHistory: ' 完整历史 ', loreText: ' 完整设定 ' }), { requestId: 'hosted-1', mode: 'hosted-json' }, new AbortController().signal);
    expect(request?.routeId).toBe('generate-sublimation');
    expect(request!.body).toMatchObject({ ...source, userGuidance: ' 完整引导 ', narrativeHistory: ' 完整历史 ', readArenaHistory: true });
    expect(request!.body.questionnaires).toEqual([expect.objectContaining({ loreMarkdown: ' 完整设定 ' })]);
    expect(request!.body).not.toHaveProperty('customProvider');
    expect(outcome).toMatchObject({ status: 'completed', card, reasoning: { text: 'reason' } });
    if (outcome.status === 'completed') expect(outcome.card).toEqual(card);
  });
  it('hosted SSE uses fixed route and shared result builder with retained history', async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe(STREAM_HOSTED_AI_COMMAND);
      expect(args!.request).toMatchObject({ routeId: 'generate-sublimation-stream', body: { readArenaHistory: true } });
      const channel = args!.onEvent as { onmessage: (event: HostedGenerationEvent) => void };
      channel.onmessage({ event: 'markdown', data: { chunk: '# 流式升华\n\n新设定\n\n## 升华事件\n标题：成长\n影响：勇敢前行' } });
      channel.onmessage({ event: 'done', data: { ok: true } });
    });
    const outcome = await executeSublimationGeneration({ invoke, profileId: '', createChannel: () => ({}) }, input({ writeArenaHistory: false }), { requestId: 'hosted-stream-1', mode: 'hosted-stream' }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'completed', cardKind: 'general', card: { arena_history: source.arena_history, current_state: source.current_state } });
  });
  it('4 MiB UTF-8 body budget rejects oversized request before dispatch', async () => {
    const invoke = vi.fn();
    const outcome = await executeSublimationGeneration({ invoke, profileId: '' }, input({ originalData: { ...source, content: '中'.repeat(1_400_000) } }), { requestId: 'budget-1', mode: 'hosted-json' }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'failed', code: 'invalid-request' }); expect(invoke).not.toHaveBeenCalled();
  });
  it.each([
    { sublimatedData: source, targetTemplate: 'canshou', unchangedFields: [] },
    { sublimatedData: null, targetTemplate: 'general', unchangedFields: [] },
    { sublimatedData: { ...source, name: 3 }, targetTemplate: 'general', unchangedFields: [] },
  ])('invalid hosted data retains raw response as invalid-output', async (data) => {
    const invoke = vi.fn(async () => ({ status: 200, body: { data, aiMeta: null } }));
    expect(await executeSublimationGeneration({ invoke, profileId: '' }, input(), { requestId: 'bad-hosted', mode: 'hosted-json' }, new AbortController().signal)).toMatchObject({ status: 'invalid-output', rawText: JSON.stringify({ data, aiMeta: null }) });
  });
  it('ambiguous hosted network failure stays uncertain, without replay', async () => {
    const invoke = vi.fn(async () => { throw new Error('connection lost'); });
    expect(await executeSublimationGeneration({ invoke, profileId: '' }, input(), { requestId: 'uncertain-1', mode: 'hosted-json' }, new AbortController().signal)).toMatchObject({ status: 'uncertain' }); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('pre-aborted intent never validates or dispatches', async () => {
    const invoke = vi.fn(); const controller = new AbortController(); controller.abort();
    expect(await executeSublimationGeneration({ invoke, profileId: '' }, input({ originalData: {} }), { requestId: 'abort-1', mode: 'hosted-json' }, controller.signal)).toMatchObject({ status: 'cancelled' }); expect(invoke).not.toHaveBeenCalled();
  });
});

it('validation retains signed body, nested unknown properties, legacy state and history', () => {
  const card = { ...createBlankSublimationCharacterCard('magical-girl'), signature: ' sig ',
    appearance: { outfit: '新装', custom: { retained: true } }, _custom: true,
    arena_history: { entries: [{ id: 'old-string-id', metadata: { questionnaire_lore_used: true }, extra: 1 }] },
    current_state: { summary: '旧状态', unexpected: true },
  };
  expect(validateSublimationCard('magical-girl', card)).toEqual(card);
});

it.each([
  ['keep-all', 3], ['keep-sublimation-only', 2], ['reset-all', 1],
] as const)('structured result applies %s without changing the original history', async (strategy, count) => {
  const value = input({ arenaHistoryRetentionStrategy: strategy });
  const before = structuredClone(value.originalData);
  const outcome = await runDirect(value).result;
  expect(outcome.status).toBe('completed');
  if (outcome.status !== 'completed') throw new Error(JSON.stringify(outcome));
  const history = outcome.card.arena_history as typeof source.arena_history;
  expect(history.entries).toHaveLength(count);
  if (strategy === 'reset-all') expect(history.attributes.world_line_id).not.toBe('original-world');
  else expect(history.attributes.world_line_id).toBe('original-world');
  expect(value.originalData).toEqual(before);
});

it('permits a complete hosted source above the old 256 KiB budget without truncating it', async () => {
  const content = '中'.repeat(100_000);
  const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
    expect((args!.request as { body: { content: string } }).body.content).toBe(content);
    return { status: 200, body: { data: { sublimatedData: source, unchangedFields: [], targetTemplate: 'general' }, aiMeta: null } };
  });
  const outcome = await executeSublimationGeneration({ invoke, profileId: '' }, input({ originalData: { ...source, content } }), { requestId: 'large-valid', mode: 'hosted-json' }, new AbortController().signal);
  expect(outcome.status).toBe('completed'); expect(invoke).toHaveBeenCalledTimes(1);
});

it('direct stream transport failure retains accepted partial text with the family error', async () => {
  let fail: (() => void) | undefined;
  const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
    const request = args!.request as AiExecutionRequest;
    const channel = args!.onEvent as { onmessage: (event: AiStreamEvent) => void };
    const identity = { requestId: request.requestId, contractVersion: 1 as const, mode: request.mode };
    channel.onmessage({ ...identity, sequence: 0, type: 'started' });
    channel.onmessage({ ...identity, sequence: 1, type: 'text-delta', delta: '# 半截输出' });
    await new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('lost')); });
  });
  let partial = '';
  const result = executeSublimationGeneration({ invoke, profileId: 'p', createChannel: () => ({}) }, input(), { requestId: 'lost-stream', mode: 'direct-local', generationMode: 'stream' }, new AbortController().signal, (text) => { partial = text; });
  await vi.waitFor(() => expect(partial).toBe('# 半截输出'));
  fail!();
  await expect(result).rejects.toMatchObject({ name: 'SublimationGenerationError', rawText: '# 半截输出' });
});

it.each(['', '{}'])('hosted stream empty body %j cannot become a completed character card', async (markdown) => {
  const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
    const channel = args!.onEvent as { onmessage: (event: HostedGenerationEvent) => void };
    channel.onmessage({ event: 'markdown', data: { chunk: markdown } });
    channel.onmessage({ event: 'done', data: { ok: true } });
  });
  await expect(executeSublimationGeneration({ invoke, profileId: '', createChannel: () => ({}) }, input(), { requestId: 'empty-stream', mode: 'hosted-stream' }, new AbortController().signal)).rejects.toMatchObject({ name: 'SublimationGenerationError', rawText: markdown });
});

it('structured and streamed final cards retain original extension paths and strip inherited trust claims', async () => {
  const originalData = { ...createBlankSublimationCharacterCard('magical-girl'),
    signature: 'inherited', isNative: true, isVerified: true,
    _extension: { list: ['original'] },
    appearance: { outfit: '旧服装', _tailoring: { id: 'original' } },
    analysis: { predictionBasis: '旧依据', _memo: { original: true } },
  };
  const structured = await runDirect(input({ originalData, targetTemplate: 'magical-girl' }), JSON.stringify({ ...aiResult, updatedCharacterData: createBlankSublimationCharacterCard('magical-girl') })).result;
  const native = directHarness('# 通用升华\n\n新角色设定');
  const streamed = await executeSublimationGeneration(native.options, input({ originalData, targetTemplate: 'general' }), { requestId: 'extensions-stream', mode: 'direct-local', generationMode: 'stream' }, new AbortController().signal);
  for (const outcome of [structured, streamed]) {
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error(JSON.stringify(outcome));
    expect(outcome.card).toMatchObject({ _extension: originalData._extension, appearance: { _tailoring: { id: 'original' } }, analysis: { _memo: { original: true } } });
    expect(outcome.card).not.toHaveProperty('signature');
    expect(outcome.card).not.toHaveProperty('isNative');
    expect(outcome.card).not.toHaveProperty('isVerified');
  }
});

it('extension shape conflict fails before dispatch rather than silently dropping original data', async () => {
  const native = directHarness('{}');
  const originalData = { ...createBlankSublimationCharacterCard('magical-girl'), appearance: { _tailoring: { id: 'keep' } } };
  await expect(executeSublimationGeneration(native.options, input({ originalData, targetTemplate: 'canshou' }), { requestId: 'conflict-1', mode: 'direct-local' }, new AbortController().signal)).rejects.toThrow();
  expect(native.invoke).not.toHaveBeenCalled();
});

it('legacy state write conflict is rejected before structured dispatch but streaming preserves it', async () => {
  const originalData = { ...source, current_state: { summary: '旧状态', fields: 'legacy text' } };
  const native = directHarness('# 原样状态\n\n新的设定');
  await expect(executeSublimationGeneration(native.options, input({ originalData }), { requestId: 'state-conflict', mode: 'direct-local' }, new AbortController().signal)).rejects.toThrow();
  expect(native.invoke).not.toHaveBeenCalled();
  const outcome = await executeSublimationGeneration(native.options, input({ originalData }), { requestId: 'state-stream', mode: 'direct-local', generationMode: 'stream' }, new AbortController().signal);
  expect(outcome).toMatchObject({ status: 'completed', card: { current_state: originalData.current_state } });
});
