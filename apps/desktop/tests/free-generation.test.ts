import { describe, expect, it, vi } from 'vitest';
import {
  buildFreeStructuredPrompt,
  FREE_GENERATION_SCHEMAS,
} from '@mahoshojo/ai-core/free-generation';
import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { HostedGenerationEvent } from '@mahoshojo/contracts/desktop-cloud';
import {
  executeFreeGeneration,
  FreeGenerationError,
  type FreeGenerationInput,
} from '../src/features/free/generation';
import { STREAM_DIRECT_AI_COMMAND } from '../src/platform/direct-ai-bridge';
import { HOSTED_AI_REQUEST_COMMAND, STREAM_HOSTED_AI_COMMAND } from '../src/platform/cloud-bridge';

const input: FreeGenerationInput = {
  prompt: '写一个怕水的火系魔法少女',
  schema: 'magical-girl',
  language: '简体中文',
  attachments: [{ name: '设定.txt', type: 'text/plain', size: 12, content: '参考设定' }],
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

const magicalGirlCard = {
  codename: '焰汐',
  appearance: { outfit: '红裙', accessories: '焰环', colorScheme: '红', overallLook: '明亮' },
  magicConstruct: { name: '焰杖', form: '杖', basicAbilities: ['点火'], description: '召焰' },
  wonderlandRule: { name: '焰间', description: '燃而不烫', tendency: '守护', activation: '握杖' },
  blooming: { name: '焰华', evolvedAbilities: ['燎原'], evolvedForm: '焰翼', evolvedOutfit: '礼裙', powerLevel: '中花' },
  analysis: { personalityAnalysis: '外向', abilityReasoning: '控火', coreTraits: ['勇'], predictionBasis: '提示词' },
};

describe('Desktop Free generation seam', () => {
  it('direct 通路用共源 prompt/schema，产出带 templateId 的非原生结构化卡并剥除伪造签名', async () => {
    const native = directHarness(JSON.stringify({ ...magicalGirlCard, signature: 'forged', userAnswers: [{ q: 'x' }] }));
    const outcome = await executeFreeGeneration(native.options, input, { requestId: 'f-1', mode: 'direct-local' }, new AbortController().signal);
    const expectedPrompt = buildFreeStructuredPrompt({ schema: 'magical-girl', prompt: input.prompt, language: input.language, attachments: input.attachments });
    expect(native.request!.messages[1]!.content).toBe(expectedPrompt);
    expect(native.request!.messages[1]!.content).toContain('参考设定');
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('magical-girl');
    expect(outcome.card).toMatchObject(magicalGirlCard);
    expect(outcome.card.templateId).toBe('魔法少女/心之花/魔法少女（自由生成）');
    expect(outcome.card).not.toHaveProperty('signature');
    expect(outcome.card).not.toHaveProperty('userAnswers');
  });

  it.each(['scenario'] as const)('direct %s schema 在 metadata.created_at 缺省时按本机时刻补齐', async (schema) => {
    const scenarioData = {
      title: '雨后采访',
      scenario_type: '采访',
      description: 'd',
      elements: {
        scene: { time: '傍晚', place: '天台', features: '积水' },
        roles: [{ name: '记者', description: '问话' }],
        events: '采访', atmosphere: '静', development: ['和解'],
      },
    };
    const native = directHarness(JSON.stringify(scenarioData));
    const outcome = await executeFreeGeneration(
      native.options, { ...input, schema }, { requestId: 'f-2', mode: 'direct-remote' }, new AbortController().signal,
    );
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('scenario');
    const metadata = outcome.card.metadata as { created_at?: string };
    expect(typeof metadata.created_at).toBe('string');
    expect(outcome.card).not.toHaveProperty('signature');
  });

  it.each([
    ['  ', '空白提示词'],
  ] as const)('dispatch 前拒绝：%s', async (prompt) => {
    const native = directHarness('{}');
    await expect(executeFreeGeneration(native.options, { ...input, prompt }, { requestId: 'f-x', mode: 'direct-local' }, new AbortController().signal))
      .rejects.toThrow('请先输入提示词');
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('direct 通路断流错误包装为 FreeGenerationError 并保留已收正文', async () => {
    let send: ((event: AiStreamEvent) => void) | undefined;
    let fail: (() => void) | undefined;
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      send = (args!.onEvent as { onmessage: (event: AiStreamEvent) => void }).onmessage;
      send({ type: 'started', requestId: 'f-3', contractVersion: 1, mode: 'direct-local', sequence: 0 });
      await new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('lost')); });
    });
    const pending = executeFreeGeneration({ invoke, profileId: 'p', createChannel: () => ({}) }, input, { requestId: 'f-3', mode: 'direct-local' }, new AbortController().signal);
    send!({ type: 'text-delta', requestId: 'f-3', contractVersion: 1, mode: 'direct-local', sequence: 1, delta: '半截' });
    fail!();
    await expect(pending).rejects.toMatchObject({ name: 'FreeGenerationError', rawText: '半截' });
    await expect(Promise.reject(new FreeGenerationError('x', null))).rejects.toBeInstanceOf(Error);
  });
});

describe('Desktop Free hosted generation', () => {
  const hostedInput: FreeGenerationInput = { ...input, attachments: [input.attachments[0]!] };

  it('hosted-json 走 generate-free 路由，body 投影与 Web 同形且无 customProvider', async () => {
    let request: { routeId: string; body: Record<string, unknown> } | undefined;
    const card = { ...magicalGirlCard, templateId: '魔法少女/心之花/魔法少女（自由生成）' };
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== HOSTED_AI_REQUEST_COMMAND) throw new Error(`unexpected command: ${command}`);
      request = args!.request as typeof request;
      return { status: 200, body: { data: card, aiMeta: { aiReasoning: { status: 'done', source: 'sdk', text: 'r' } } } };
    });
    const outcome = await executeFreeGeneration({ invoke, profileId: '' }, hostedInput, { requestId: 'h-1', mode: 'hosted-json' }, new AbortController().signal);
    expect(request).toMatchObject({ routeId: 'generate-free' });
    expect(request!.body).toMatchObject({
      schema: 'magical-girl',
      prompt: input.prompt,
      language: '简体中文',
      attachments: [{ name: '设定.txt', type: 'text/plain', size: 12, content: '参考设定' }],
    });
    expect(request!.body).not.toHaveProperty('customProvider');
    expect(outcome).toMatchObject({ status: 'completed', cardKind: 'magical-girl', card: card });
    if (outcome.status === 'completed') expect(outcome.reasoning).toMatchObject({ status: 'done' });
  });

  it('hosted-stream 走 generate-free-stream，Markdown → 通用卡（scenario 用通用情景卡）', async () => {
    for (const [schema, routeExpect] of [['general', 'general'] as const, ['general-scenario', 'general-scenario'] as const]) {
      let send: ((event: HostedGenerationEvent) => void) | undefined;
      const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
        send = (args!.onEvent as { onmessage: (event: HostedGenerationEvent) => void }).onmessage;
        send({ event: 'markdown', data: { chunk: '# 雨后\n\n正文内容' } });
        send({ event: 'done', data: { ok: true } });
      });
      const outcome = await executeFreeGeneration(
        { invoke, profileId: '', createChannel: () => ({}) },
        { ...hostedInput, schema },
        { requestId: `hs-${schema}`, mode: 'hosted-stream' },
        new AbortController().signal,
      );
      expect(invoke).toHaveBeenCalledWith(STREAM_HOSTED_AI_COMMAND, expect.objectContaining({
        request: expect.objectContaining({ routeId: 'generate-free-stream' }),
      }));
      expect(outcome.status).toBe('completed');
      if (outcome.status !== 'completed') throw new Error('expected completed');
      expect(outcome.cardKind).toBe(routeExpect);
      const record = outcome.card as Record<string, unknown>;
      expect(record.templateId).toBe(schema === 'general' ? '通用角色' : '通用情景');
      expect(schema === 'general' ? record.name : record.title).toBe('雨后');
    }
  });

  it('hosted-json 归一化失败投影为 invalid-output 而非 uncertain', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { data: { bogus: true }, aiMeta: null } }));
    const outcome = await executeFreeGeneration({ invoke, profileId: '' }, hostedInput, { requestId: 'h-2', mode: 'hosted-json' }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'invalid-output', mode: 'hosted-json', message: '服务器返回的数据卡未通过校验。' });
  });

  it('schema 指令与 FREE_GENERATION_SCHEMAS 同一份', () => {
    expect(FREE_GENERATION_SCHEMAS['general-scenario'].parse({ title: 't', content: 'c' })).toEqual({ title: 't', content: 'c' });
  });
});
