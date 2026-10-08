import { describe, expect, it, vi } from 'vitest';
import {
  buildScenarioStructuredPrompt,
  SCENARIO_GENERATION_SCHEMA,
} from '@mahoshojo/ai-core/scenario-generation';
import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { HostedGenerationEvent } from '@mahoshojo/contracts/desktop-cloud';
import {
  executeScenarioGeneration,
  validateScenarioCard,
  ScenarioGenerationError,
  type ScenarioGenerationInput,
} from '../src/features/scenario/generation';
import { STREAM_DIRECT_AI_COMMAND } from '../src/platform/direct-ai-bridge';
import { HOSTED_AI_REQUEST_COMMAND, STREAM_HOSTED_AI_COMMAND } from '../src/platform/cloud-bridge';

const input: ScenarioGenerationInput = {
  answers: { '故事发生的场景是怎样的？': '雨后的天台', '希望故事的整体氛围是怎样的？': '安静' },
  language: 'zh-CN',
  fieldsToKeepEmpty: ['elements.roles'],
  titleHint: '',
};

const scenarioData = {
  title: '雨后采访',
  scenario_type: '采访',
  description: '天台上的一次对话',
  elements: {
    scene: { time: '傍晚', place: '天台', features: '积水' },
    roles: [],
    events: '采访',
    atmosphere: '安静',
    development: ['和解', '告别'],
  },
};

const directHarness = (text: string) => {
  let sent: AiExecutionRequest | undefined;
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command !== STREAM_DIRECT_AI_COMMAND) throw new Error(`unexpected command: ${command}`);
    sent = args!.request as AiExecutionRequest;
    const channel = args!.onEvent as { onmessage: (event: AiStreamEvent) => void };
    const identity = { requestId: sent.requestId, contractVersion: 1 as const, mode: sent.mode };
    channel.onmessage({ type: 'started', ...identity, sequence: 0 });
    const result: AiExecutionResult = { ...identity, status: 'completed', output: { text }, finishReason: 'stop' };
    channel.onmessage({ type: 'result', ...identity, sequence: 1, result });
  });
  return { invoke, options: { invoke, profileId: 'p', createChannel: () => ({}) }, get request() { return sent; } };
};

describe('Desktop Scenario generation seam', () => {
  it('direct 通路用共源 prompt/schema，补 metadata.created_at 并剥除伪造签名', async () => {
    const forged = { ...scenarioData, signature: 'forged', metadata: { signature: 'forged', forged: true } };
    const native = directHarness(JSON.stringify(forged));
    const outcome = await executeScenarioGeneration(native.options, input, { requestId: 's-1', mode: 'direct-local' }, new AbortController().signal);
    const expectedPrompt = buildScenarioStructuredPrompt({
      answers: input.answers,
      language: input.language,
      fieldsToKeepEmpty: input.fieldsToKeepEmpty,
    });
    expect(native.request!.messages[1]!.content).toBe(expectedPrompt);
    expect(native.request!.messages[1]!.content).toContain('雨后的天台');
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('scenario');
    expect(outcome.card).toMatchObject(scenarioData);
    const metadata = outcome.card.metadata as Record<string, unknown>;
    expect(typeof metadata.created_at).toBe('string');
    // 白名单归一化：signature/forged 键与顶层 signature 均不保留（direct 永不签名）。
    expect(Object.keys(metadata).sort()).toEqual(['created_at']);
    expect(outcome.card).not.toHaveProperty('signature');
  });

  it('全部回答为空时 dispatch 前拒绝', async () => {
    const native = directHarness('{}');
    await expect(executeScenarioGeneration(
      native.options,
      { ...input, answers: { '故事发生的场景是怎样的？': '  ' } },
      { requestId: 's-x', mode: 'direct-local' },
      new AbortController().signal,
    )).rejects.toThrow('请至少填写一个问题的回答');
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('direct 通路断流错误包装为 ScenarioGenerationError 并保留已收正文', async () => {
    let send: ((event: AiStreamEvent) => void) | undefined;
    let fail: (() => void) | undefined;
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      send = (args!.onEvent as { onmessage: (event: AiStreamEvent) => void }).onmessage;
      send({ type: 'started', requestId: 's-3', contractVersion: 1, mode: 'direct-local', sequence: 0 });
      await new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('lost')); });
    });
    const pending = executeScenarioGeneration({ invoke, profileId: 'p', createChannel: () => ({}) }, input, { requestId: 's-3', mode: 'direct-local' }, new AbortController().signal);
    send!({ type: 'text-delta', requestId: 's-3', contractVersion: 1, mode: 'direct-local', sequence: 1, delta: '半截' });
    fail!();
    await expect(pending).rejects.toMatchObject({ name: 'ScenarioGenerationError', rawText: '半截' });
    await expect(Promise.reject(new ScenarioGenerationError('x', null))).rejects.toBeInstanceOf(Error);
  });
});

describe('Desktop Scenario hosted generation', () => {
  it('hosted-json 走 generate-scenario，body 投影与 Web 同形且无 customProvider；签名串保留', async () => {
    let request: { routeId: string; body: Record<string, unknown> } | undefined;
    const signed = { ...scenarioData, metadata: { created_at: '2026-01-01T00:00:00.000Z', signature: 'sig-1', forged: 'x' } };
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== HOSTED_AI_REQUEST_COMMAND) throw new Error(`unexpected command: ${command}`);
      request = args!.request as typeof request;
      return { status: 200, body: { data: signed, aiMeta: { aiReasoning: { status: 'done', source: 'sdk', text: 'r' } } } };
    });
    const outcome = await executeScenarioGeneration({ invoke, profileId: '' }, input, { requestId: 'h-1', mode: 'hosted-json' }, new AbortController().signal);
    expect(request).toMatchObject({ routeId: 'generate-scenario' });
    expect(request!.body).toMatchObject({
      answers: input.answers,
      language: 'zh-CN',
      fieldsToKeepEmpty: ['elements.roles'],
    });
    expect(request!.body).not.toHaveProperty('customProvider');
    expect(request!.body).not.toHaveProperty('titleHint');
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    const metadata = outcome.card.metadata as Record<string, unknown>;
    // 白名单归一化：created_at/signature 保留（服务器签名如实归属），伪造键丢弃。
    expect(metadata).toEqual({ created_at: '2026-01-01T00:00:00.000Z', signature: 'sig-1' });
    if (outcome.status === 'completed') expect(outcome.reasoning).toMatchObject({ status: 'done' });
  });

  it('hosted-stream 走 generate-scenario-stream，titleHint 下发且作本地卡兜底标题', async () => {
    let send: ((event: HostedGenerationEvent) => void) | undefined;
    let request: { routeId: string; body: Record<string, unknown> } | undefined;
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      request = args!.request as typeof request;
      send = (args!.onEvent as { onmessage: (event: HostedGenerationEvent) => void }).onmessage;
      send({ event: 'markdown', data: { chunk: '# 夜雨祭\n\n正文内容' } });
      send({ event: 'done', data: { ok: true } });
    });
    const outcome = await executeScenarioGeneration(
      { invoke, profileId: '', createChannel: () => ({}) },
      { ...input, titleHint: '夜雨' },
      { requestId: 'hs-1', mode: 'hosted-stream' },
      new AbortController().signal,
    );
    expect(invoke).toHaveBeenCalledWith(STREAM_HOSTED_AI_COMMAND, expect.objectContaining({
      request: expect.objectContaining({ routeId: 'generate-scenario-stream' }),
    }));
    expect(request!.body.titleHint).toBe('夜雨');
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('general-scenario');
    // Markdown 首行标题优先于 titleHint（hint 仅作兜底）。
    expect(outcome.card).toMatchObject({ templateId: '通用情景', title: '夜雨祭' });
  });

  it('hosted-json 归一化失败投影为 invalid-output 而非 uncertain', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { data: { bogus: true }, aiMeta: null } }));
    const outcome = await executeScenarioGeneration({ invoke, profileId: '' }, input, { requestId: 'h-2', mode: 'hosted-json' }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'invalid-output', mode: 'hosted-json', message: '服务器返回的情景卡未通过校验。' });
  });
});

describe('validateScenarioCard（草稿恢复/保存前校验）', () => {
  it('scenario 保留 signature 供 provenance 判定并归一 metadata 白名单', () => {
    const card = validateScenarioCard('scenario', {
      ...scenarioData,
      signature: 'forged-top',
      metadata: { signature: 'sig-keep', bogus: 1 },
    });
    const metadata = card.metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual(['created_at', 'signature']);
    expect(metadata.signature).toBe('sig-keep');
    expect(card).not.toHaveProperty('signature');
  });

  it('general-scenario 归一 templateId 并剥除 signature/metadata', () => {
    const card = validateScenarioCard('general-scenario', {
      title: 't', content: 'c', signature: 'x', metadata: { signature: 'y' },
    });
    expect(card).toEqual({ templateId: '通用情景', title: 't', content: 'c' });
  });

  it('损坏输入抛错', () => {
    expect(() => validateScenarioCard('scenario', { bogus: true })).toThrow('情景数据');
    expect(() => validateScenarioCard('general-scenario', { title: 1 })).toThrow('通用情景卡损坏');
    expect(() => validateScenarioCard('scenario', 'x')).toThrow('数据卡损坏');
  });

  it('schema 与 ai-core SCENARIO_GENERATION_SCHEMA 同一份', () => {
    expect(SCENARIO_GENERATION_SCHEMA.parse(scenarioData)).toEqual(scenarioData);
  });
});
