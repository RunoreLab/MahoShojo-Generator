import { describe, expect, it, vi } from 'vitest';
import {
  buildUnsignedCanshouCard,
  createCanshouGenerationConfig,
  type CanshouGeneratedData,
} from '@mahoshojo/ai-core/canshou-generation';
import { CANSHOU_LORE } from '@mahoshojo/domain/canshou-lore';
import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { HostedGenerationEvent } from '@mahoshojo/contracts/desktop-cloud';
import {
  executeCanshouGeneration,
  type CanshouGenerationInput,
} from '../src/features/canshou/generation';
import { STREAM_DIRECT_AI_COMMAND } from '../src/platform/direct-ai-bridge';
import { CANCEL_HOSTED_AI_COMMAND, HOSTED_AI_REQUEST_COMMAND, STREAM_HOSTED_AI_COMMAND } from '../src/platform/cloud-bridge';

const generated: CanshouGeneratedData = {
  name: '巢穴回声',
  coreConcept: '被遗弃巢穴的思念凝聚成兽',
  coreEmotion: '孤独与守护',
  evolutionStage: '幼年期',
  appearance: '半透明的小型兽体',
  materialAndSkin: '雾状表皮',
  featuresAndAppendages: '尾部有风铃状附属物',
  attackMethod: '回声震荡',
  specialAbility: '记录并重现声音',
  origin: '诞生自废弃巢穴',
  birthEnvironment: '城市地下空洞',
  researcherNotes: '建议观察而非驱逐',
};

const input: CanshouGenerationInput = {
  answers: [{ question: '起源？', answer: '巢穴', questionId: 'q1', questionnaireId: 'canshou-default', questionnaireTitle: '默认残兽问卷' }],
  language: '简体中文',
  loreText: '设定正文',
  hosted: {
    selections: [{
      source: 'preset' as const,
      questionnaire: {
        id: 'canshou-default',
        title: '默认残兽问卷',
        kind: 'canshou' as const,
        loreMarkdown: '设定正文',
        questions: [],
      },
    }],
    allowNativeSignature: true,
  },
};
const intent = { requestId: 'canshou-test', mode: 'direct-local' as const };

const harness = (text = JSON.stringify(generated), finishReason: 'stop' | 'length' = 'stop', status: 'completed' | 'failed' = 'completed') => {
  let sent: AiExecutionRequest | undefined;
  let deliver: (() => void) | undefined;
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command !== STREAM_DIRECT_AI_COMMAND) throw new Error('unexpected command');
    sent = args!.request as AiExecutionRequest;
    const channel = args!.onEvent as { onmessage: (event: AiStreamEvent) => void };
    const identity = { requestId: sent.requestId, contractVersion: 1 as const, mode: sent.mode };
    channel.onmessage({ type: 'started', ...identity, sequence: 0 });
    await new Promise<void>((resolve) => {
      deliver = () => {
        const result: AiExecutionResult = status === 'completed'
          ? { ...identity, status, output: { text }, finishReason }
          : { ...identity, status, error: { code: 'service-unavailable' } };
        channel.onmessage({ type: 'result', ...identity, sequence: 1, result });
        resolve();
      };
    });
  });
  return { options: { invoke, profileId: 'saved-profile', createChannel: () => ({}) }, invoke, get request() { return sent; }, finish: () => deliver?.() };
};

describe('Desktop Canshou direct generation', () => {
  it('uses the shared canshou config, freezes answers, and produces an unsigned canshou card', async () => {
    const native = harness(JSON.stringify({ ...generated, signature: 'untrusted-signature' }));
    const mutableInput = structuredClone(input);
    const pending = executeCanshouGeneration(native.options, mutableInput, intent, new AbortController().signal);
    const config = createCanshouGenerationConfig(CANSHOU_LORE);
    expect(native.request!.messages[1]!.content).toBe(config.promptBuilder(input));
    expect(native.request!.messages[0]!.content).toContain(config.systemPrompt);
    expect(native.request!.messages[0]!.content).toContain(CANSHOU_LORE);
    mutableInput.answers[0]!.answer = '生成期间的新编辑';
    native.finish();
    const outcome = await pending;
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('canshou');
    expect(outcome.card).toMatchObject(generated);
    expect(outcome.card).not.toHaveProperty('signature');
    const userAnswers = outcome.card.userAnswers as Array<{ answer: string }>;
    expect(userAnswers[0]!.answer).toBe('巢穴');
    expect(userAnswers[0]).not.toHaveProperty('questionnaireId');
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.request).not.toHaveProperty('thinking');
  });

  it.each([
    ['无有效 JSON', 'stop'],
    [JSON.stringify(generated), 'length'],
    ['{"__proto__":{"admin":true}}', 'stop'],
  ] as const)('retains invalid/incomplete output without a second dispatch', async (raw, finish) => {
    const native = harness(raw, finish);
    const pending = executeCanshouGeneration(native.options, input, intent, new AbortController().signal);
    native.finish();
    await expect(pending).resolves.toMatchObject({ status: 'invalid-output', rawText: raw });
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch a cancelled intent or empty questionnaire', async () => {
    const native = harness();
    const controller = new AbortController();
    controller.abort();
    await expect(executeCanshouGeneration(native.options, input, intent, controller.signal)).resolves.toMatchObject({ status: 'cancelled' });
    await expect(executeCanshouGeneration(native.options, { ...input, answers: [] }, intent, new AbortController().signal)).rejects.toThrow('问卷');
    expect(native.invoke).not.toHaveBeenCalled();
  });
});

const hostedStreamHarness = () => {
  let request: { requestId: string; routeId: string; body: Record<string, unknown> } | undefined;
  let send: ((event: HostedGenerationEvent) => void) | undefined;
  let finish: (() => void) | undefined;
  const cancelled: string[] = [];
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === CANCEL_HOSTED_AI_COMMAND) {
      cancelled.push(String((args as { requestId: string }).requestId));
      finish?.();
      return true;
    }
    if (command !== STREAM_HOSTED_AI_COMMAND) throw new Error(`unexpected command: ${command}`);
    request = args!.request as typeof request;
    send = (args!.onEvent as { onmessage: (event: HostedGenerationEvent) => void }).onmessage;
    await new Promise<void>((resolve) => { finish = resolve; });
  });
  return { invoke, get request() { return request; }, send: (event: HostedGenerationEvent) => send?.(event), finish: () => finish?.(), cancelled };
};

describe('Desktop Canshou hosted generation', () => {
  const hostedStreamIntent = { requestId: 'hosted-stream-1', mode: 'hosted-stream' as const };
  const hostedJsonIntent = { requestId: 'hosted-json-1', mode: 'hosted-json' as const };

  it('routes hosted-stream through the canshou stream route and builds a general card', async () => {
    const native = hostedStreamHarness();
    const onPartialText = vi.fn();
    const pending = executeCanshouGeneration({ invoke: native.invoke, profileId: '', createChannel: () => ({}) }, input, hostedStreamIntent, new AbortController().signal, onPartialText);
    expect(native.request).toMatchObject({ requestId: 'hosted-stream-1', routeId: 'generate-canshou-stream' });
    expect(native.request!.body).toMatchObject({
      allowNativeSignature: true,
      language: '简体中文',
      questionnaireSelections: [{ source: 'preset', kind: 'canshou', presetId: 'canshou-default' }],
    });
    expect(native.request!.body).not.toHaveProperty('customProvider');
    native.send({ event: 'reasoning', data: { source: 'sdk', status: 'thinking', chunk: '分析' } });
    native.send({ event: 'markdown', data: { chunk: '名字：巢穴回声\n\n## 角色介绍\n\n守护巢穴' } });
    native.send({ event: 'reasoning_done', data: { source: 'sdk', status: 'done' } });
    native.send({ event: 'done', data: { ok: true } });
    native.finish();
    const outcome = await pending;
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('general');
    expect(outcome.card).toMatchObject({ name: '巢穴回声' });
    expect(outcome.card.userAnswers).toEqual([{ question: '起源？', answer: '巢穴', questionId: 'q1' }]);
    expect(outcome.reasoning).toMatchObject({ status: 'done', source: 'sdk', text: '分析' });
    expect(onPartialText).toHaveBeenCalled();
  });

  it('falls back to the canshou default name when stream markdown yields no usable title', async () => {
    const native = hostedStreamHarness();
    const pending = executeCanshouGeneration({ invoke: native.invoke, profileId: '', createChannel: () => ({}) }, input, hostedStreamIntent, new AbortController().signal);
    // 空白正文无法解析出名字/标题：回落到家族默认名「残兽」（与 Web 一致，不再有二级回退）。
    native.send({ event: 'markdown', data: { chunk: '   \n  ' } });
    native.send({ event: 'done', data: { ok: true } });
    native.finish();
    const outcome = await pending;
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.card).toMatchObject({ name: '残兽' });
  });

  it('aborts hosted-stream via cancel command and keeps received markdown', async () => {
    const native = hostedStreamHarness();
    const controller = new AbortController();
    const pending = executeCanshouGeneration({ invoke: native.invoke, profileId: '', createChannel: () => ({}) }, input, hostedStreamIntent, controller.signal);
    native.send({ event: 'markdown', data: { chunk: '已收到正文' } });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ status: 'cancelled', rawText: '已收到正文' });
    expect(native.cancelled).toEqual(['hosted-stream-1']);
  });

  it('routes hosted-json through the canshou json route and preserves signature passthrough', async () => {
    const card = {
      ...generated,
      templateId: '魔法少女/心之花/残兽（问卷生成）',
      userAnswers: [{ question: '起源？', answer: '巢穴' }],
      signature: 'server-issued-signature',
    };
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== HOSTED_AI_REQUEST_COMMAND) throw new Error(`unexpected command: ${command}`);
      expect(args!.request).toMatchObject({ requestId: 'hosted-json-1', routeId: 'generate-canshou' });
      expect((args!.request as { body: Record<string, unknown> }).body).not.toHaveProperty('customProvider');
      return { status: 200, body: { data: card, aiMeta: { aiReasoning: { status: 'done', source: 'sdk', text: '推理' } } } };
    });
    const outcome = await executeCanshouGeneration({ invoke, profileId: '' }, input, hostedJsonIntent, new AbortController().signal);
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('canshou');
    expect(outcome.card).toMatchObject({ name: '巢穴回声', signature: 'server-issued-signature', templateId: '魔法少女/心之花/残兽（问卷生成）' });
    expect(outcome.reasoning).toMatchObject({ status: 'done', text: '推理' });
  });

  it.each([
    [429, { error: '请求过于频繁', retryAfterSeconds: 30 }, 30],
    [500, null, undefined],
  ] as const)('maps hosted-json HTTP %i to failed without retry', async (status, body, retryAfterSeconds) => {
    const invoke = vi.fn(async () => ({ status, body }));
    await expect(executeCanshouGeneration({ invoke, profileId: '' }, input, hostedJsonIntent, new AbortController().signal))
      .resolves.toMatchObject({ status: 'failed', mode: 'hosted-json', ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reports invalid-output when hosted-json data fails card validation', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { data: { bogus: true }, aiMeta: null } }));
    await expect(executeCanshouGeneration({ invoke, profileId: '' }, input, hostedJsonIntent, new AbortController().signal))
      .resolves.toMatchObject({ status: 'invalid-output', mode: 'hosted-json' });
  });

  it('reports uncertain when aborting a dispatched hosted-json request, never replaying it', async () => {
    const cancelled: string[] = [];
    let resolveRequest: ((value: { status: number; body: null }) => void) | undefined;
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === CANCEL_HOSTED_AI_COMMAND) {
        cancelled.push(String((args as { requestId: string }).requestId));
        return true;
      }
      return new Promise<{ status: number; body: null }>((resolve) => { resolveRequest = resolve; });
    });
    const controller = new AbortController();
    const pending = executeCanshouGeneration({ invoke, profileId: '' }, input, hostedJsonIntent, controller.signal);
    controller.abort();
    resolveRequest?.({ status: 200, body: null });
    await expect(pending).resolves.toMatchObject({ status: 'uncertain', mode: 'hosted-json' });
    expect(cancelled).toEqual(['hosted-json-1']);
    expect(invoke.mock.calls.filter(([command]) => command === HOSTED_AI_REQUEST_COMMAND)).toHaveLength(1);
  });

  it.each(['hosted-stream', 'hosted-json'] as const)('does not dispatch a pre-aborted %s intent', async (mode) => {
    const invoke = vi.fn(async () => { throw new Error('unexpected invoke'); });
    const controller = new AbortController();
    controller.abort();
    const item = mode === 'hosted-stream' ? hostedStreamIntent : hostedJsonIntent;
    await expect(
      executeCanshouGeneration(
        { invoke, profileId: '', createChannel: () => ({}) },
        input,
        item,
        controller.signal,
      ),
    ).resolves.toMatchObject({ status: 'cancelled', mode, reason: 'aborted' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('hosted-json 请求体与 direct 无关字段互不污染', async () => {
    // hosted 请求只带业务问卷字段：modelId/overrides 不透传给服务器。
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== HOSTED_AI_REQUEST_COMMAND) throw new Error('unexpected');
      const body = (args!.request as { body: Record<string, unknown> }).body;
      expect(body).not.toHaveProperty('modelId');
      expect(body).not.toHaveProperty('temperature');
      return { status: 200, body: { data: buildUnsignedCanshouCard(generated, input.answers), aiMeta: null } };
    });
    const outcome = await executeCanshouGeneration(
      { invoke, profileId: '' },
      input,
      { ...hostedJsonIntent, modelId: 'ignored-model', overrides: { temperature: 0.1 } },
      new AbortController().signal,
    );
    expect(outcome.status).toBe('completed');
  });
});
