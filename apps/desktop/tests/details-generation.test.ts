import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createMagicalGirlDetailsGenerationConfig, type MagicalGirlDetailsGenerationInput } from '@mahoshojo/ai-core/magical-girl-details-generation';
import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { HostedGenerationEvent } from '@mahoshojo/contracts/desktop-cloud';
import { executeDetailsGeneration, type DetailsGenerationInput } from '../src/features/details/generation';
import { CANCEL_DIRECT_AI_COMMAND, STREAM_DIRECT_AI_COMMAND } from '../src/platform/direct-ai-bridge';
import { CANCEL_HOSTED_AI_COMMAND, HOSTED_AI_REQUEST_COMMAND, STREAM_HOSTED_AI_COMMAND } from '../src/platform/cloud-bridge';

const legacy = JSON.parse(readFileSync(new URL('../../../packages/ai-core/fixtures/magical-girl-details-legacy.json', import.meta.url), 'utf8'));
const input: MagicalGirlDetailsGenerationInput = legacy.cases[0].input;
const intent = { requestId: 'details-test', mode: 'direct-local' as const, flowers: legacy.cases[0].input.flowers as string };
const generated = {
  codename: '潮汐花',
  appearance: { outfit: '蓝白礼服', accessories: '贝壳', colorScheme: '蓝白', overallLook: '沉静' },
  magicConstruct: { name: '潮镜', form: '手镜', basicAbilities: ['折射'], description: '映照记忆' },
  wonderlandRule: { name: '潮间', description: '潮汐往复', tendency: '守护', activation: '举镜' },
  blooming: { name: '潮镜繁开', evolvedAbilities: ['回潮'], evolvedForm: '巨镜', evolvedOutfit: '长裙', powerLevel: '强花' },
  analysis: { personalityAnalysis: '坚韧', abilityReasoning: '守护', coreTraits: ['坚定'], predictionBasis: '问卷', background: { belief: '守护', bonds: '同伴' } },
};

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

describe('Desktop Details generation seam', () => {
  it('uses the Hosted fixture and shared Prompt, freezes answers, and produces an unsigned card', async () => {
    const native = harness(JSON.stringify({ ...generated, signature: 'untrusted-signature' }));
    const mutableInput = structuredClone(input);
    const pending = executeDetailsGeneration(native.options, mutableInput, intent, new AbortController().signal);
    const config = createMagicalGirlDetailsGenerationConfig(() => intent.flowers);
    expect(native.request!.messages[1]!.content).toBe(config.promptBuilder(input));
    expect(native.request!.messages[0]!.content).toContain(config.systemPrompt);
    mutableInput.answers[0]!.answer = '生成期间的新编辑';
    native.finish();
    const outcome = await pending;
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.card).toMatchObject(generated);
    const userAnswers = outcome.card.userAnswers as Array<{ answer: string }>;
    expect(userAnswers[0]!.answer).toBe(input.answers[0]!.answer);
    expect(outcome.card).not.toHaveProperty('signature');
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
    const pending = executeDetailsGeneration(native.options, input, intent, new AbortController().signal);
    native.finish();
    await expect(pending).resolves.toMatchObject({ status: 'invalid-output', rawText: raw });
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it('repairs a fenced JSON response locally', async () => {
    const native = harness('```json\n' + JSON.stringify(generated) + '\n```');
    const pending = executeDetailsGeneration(native.options, input, intent, new AbortController().signal);
    native.finish();
    await expect(pending).resolves.toMatchObject({ status: 'completed', card: generated });
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it('keeps a provider failure without Hosted fallback', async () => {
    const native = harness('', 'stop', 'failed');
    const pending = executeDetailsGeneration(native.options, input, { ...intent, mode: 'direct-remote' }, new AbortController().signal);
    native.finish();
    await expect(pending).resolves.toMatchObject({ status: 'failed', mode: 'direct-remote' });
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch a cancelled intent or empty questionnaire', async () => {
    const native = harness();
    const controller = new AbortController();
    controller.abort();
    await expect(executeDetailsGeneration(native.options, input, intent, controller.signal)).resolves.toMatchObject({ status: 'cancelled' });
    await expect(executeDetailsGeneration(native.options, { ...input, answers: [] }, intent, new AbortController().signal)).rejects.toThrow('问卷');
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'failed', 'disconnect'] as const)('retains received partial output on %s without retry', async (ending) => {
    const controller = new AbortController();
    let send: ((event: AiStreamEvent) => void) | undefined;
    let finish: (() => void) | undefined;
    let fail: (() => void) | undefined;
    const identity = { requestId: intent.requestId, contractVersion: 1 as const, mode: intent.mode };
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === CANCEL_DIRECT_AI_COMMAND) { finish?.(); return true; }
      send = (args!.onEvent as { onmessage: (event: AiStreamEvent) => void }).onmessage;
      send({ type: 'started', ...identity, sequence: 0 });
      await new Promise<void>((resolve, reject) => { finish = resolve; fail = () => reject(new Error('lost connection')); });
    });
    const onPartialText = vi.fn();
    const pending = executeDetailsGeneration({ invoke, profileId: 'saved-profile', createChannel: () => ({}) }, input, intent, controller.signal, onPartialText);
    send!({ type: 'text-delta', ...identity, sequence: 1, delta: '已收到的部分角色正文' });
    // 让共享归约器消费 delta 后再模拟上游中断，避免把尚未消费的队列当作已展示正文。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onPartialText).toHaveBeenCalledExactlyOnceWith('已收到的部分角色正文');
    if (ending === 'cancel') controller.abort();
    else if (ending === 'failed') {
      send!({ type: 'result', ...identity, sequence: 2, result: { ...identity, status: 'failed', error: { code: 'service-unavailable' } } });
      finish!();
    } else fail!();
    if (ending === 'disconnect') await expect(pending).rejects.toMatchObject({ rawText: '已收到的部分角色正文' });
    else await expect(pending).resolves.toMatchObject({ status: ending === 'cancel' ? 'cancelled' : 'failed', rawText: '已收到的部分角色正文' });
    expect(invoke.mock.calls.filter(([command]) => command === STREAM_DIRECT_AI_COMMAND)).toHaveLength(1);
  });
});

const hostedInput: DetailsGenerationInput = {
  answers: [{ question: '信念', answer: '守护', questionId: 'MG-1', questionnaireId: 'q-1', questionnaireTitle: '默认问卷' }],
  language: '简体中文',
  loreText: '设定正文',
  hosted: {
    selections: [{
      source: 'preset' as const,
      questionnaire: {
        id: 'q-1',
        title: '默认问卷',
        kind: 'magical-girl' as const,
        loreMarkdown: '设定正文',
        questions: [],
      },
    }],
    allowNativeSignature: true,
  },
};
const hostedStreamIntent = { requestId: 'hosted-stream-1', mode: 'hosted-stream' as const, flowers: '百合' };
const hostedJsonIntent = { requestId: 'hosted-json-1', mode: 'hosted-json' as const, flowers: '百合' };

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

describe('Desktop Details hosted generation', () => {
  it('routes hosted-stream through the stream command with business body and builds a general card', async () => {
    const native = hostedStreamHarness();
    const onPartialText = vi.fn();
    const pending = executeDetailsGeneration({ invoke: native.invoke, profileId: '', createChannel: () => ({}) }, hostedInput, hostedStreamIntent, new AbortController().signal, onPartialText);
    expect(native.request).toMatchObject({ requestId: 'hosted-stream-1', routeId: 'generate-magical-girl-details-stream' });
    expect(native.request!.body).toMatchObject({
      allowNativeSignature: true,
      language: '简体中文',
      questionnaireSelections: [{ source: 'preset', kind: 'magical-girl', presetId: 'q-1' }],
    });
    expect(native.request!.body).not.toHaveProperty('customProvider');
    native.send({ event: 'reasoning', data: { source: 'sdk', status: 'thinking', chunk: '思考' } });
    native.send({ event: 'markdown', data: { chunk: '名字：潮汐花\n\n## 角色介绍\n\n守护' } });
    native.send({ event: 'reasoning_done', data: { source: 'sdk', status: 'done' } });
    native.send({ event: 'done', data: { ok: true } });
    native.finish();
    const outcome = await pending;
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('general');
    expect(outcome.card).toMatchObject({ name: '潮汐花' });
    expect(outcome.card.userAnswers).toEqual([{ question: '信念', answer: '守护', questionId: 'MG-1' }]);
    expect(outcome.reasoning).toMatchObject({ status: 'done', source: 'sdk', text: '思考' });
    expect(onPartialText).toHaveBeenCalled();
  });

  it('maps hosted-stream server error event to failed with message and keeps markdown', async () => {
    const native = hostedStreamHarness();
    const pending = executeDetailsGeneration({ invoke: native.invoke, profileId: '', createChannel: () => ({}) }, hostedInput, hostedStreamIntent, new AbortController().signal);
    native.send({ event: 'markdown', data: { chunk: '半截正文' } });
    native.send({ event: 'error', data: { ok: false, error: '上游过载', code: 'service-unavailable' } });
    native.finish();
    await expect(pending).resolves.toMatchObject({ status: 'failed', mode: 'hosted-stream', rawText: '半截正文', message: '上游过载', code: 'service-unavailable' });
  });

  it('aborts hosted-stream via cancel command and keeps received markdown', async () => {
    const native = hostedStreamHarness();
    const controller = new AbortController();
    const pending = executeDetailsGeneration({ invoke: native.invoke, profileId: '', createChannel: () => ({}) }, hostedInput, hostedStreamIntent, controller.signal);
    native.send({ event: 'markdown', data: { chunk: '已收到正文' } });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ status: 'cancelled', rawText: '已收到正文' });
    expect(native.cancelled).toEqual(['hosted-stream-1']);
  });

  it('routes hosted-json through the json command and preserves server signature and aiMeta reasoning', async () => {
    const card = {
      ...generated,
      templateId: '魔法少女/心之花/魔法少女（问卷生成）',
      userAnswers: [{ question: '信念', answer: '守护' }],
      signature: 'server-issued-signature',
    };
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== HOSTED_AI_REQUEST_COMMAND) throw new Error(`unexpected command: ${command}`);
      expect(args!.request).toMatchObject({ requestId: 'hosted-json-1', routeId: 'generate-magical-girl-details' });
      expect((args!.request as { body: Record<string, unknown> }).body).not.toHaveProperty('customProvider');
      return { status: 200, body: { data: card, aiMeta: { aiReasoning: { status: 'done', source: 'sdk', text: '推理' } } } };
    });
    const outcome = await executeDetailsGeneration({ invoke, profileId: '' }, hostedInput, hostedJsonIntent, new AbortController().signal);
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('magical-girl');
    expect(outcome.card).toMatchObject({ codename: '潮汐花', signature: 'server-issued-signature' });
    expect(outcome.reasoning).toMatchObject({ status: 'done', text: '推理' });
  });

  it.each([
    [429, { error: '请求过于频繁', retryAfterSeconds: 30 }, 30],
    [500, null, undefined],
  ] as const)('maps hosted-json HTTP %i to failed without retry', async (status, body, retryAfterSeconds) => {
    const invoke = vi.fn(async () => ({ status, body }));
    await expect(executeDetailsGeneration({ invoke, profileId: '' }, hostedInput, hostedJsonIntent, new AbortController().signal))
      .resolves.toMatchObject({ status: 'failed', mode: 'hosted-json', ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reports invalid-output when hosted-json data fails card validation', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { data: { bogus: true }, aiMeta: null } }));
    await expect(executeDetailsGeneration({ invoke, profileId: '' }, hostedInput, hostedJsonIntent, new AbortController().signal))
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
    const pending = executeDetailsGeneration({ invoke, profileId: '' }, hostedInput, hostedJsonIntent, controller.signal);
    controller.abort();
    // 请求仍在飞行：取消确认与否都无法证明服务器没有执行——不得声称干净取消。
    resolveRequest?.({ status: 200, body: null });
    await expect(pending).resolves.toMatchObject({ status: 'uncertain', mode: 'hosted-json' });
    expect(cancelled).toEqual(['hosted-json-1']);
    expect(invoke.mock.calls.filter(([command]) => command === HOSTED_AI_REQUEST_COMMAND)).toHaveLength(1);
  });

  it.each([
    ['cancelled', 'native select 取消时 send 可能已在飞行中'],
    ['network-error', '网络中断/超时'],
    ['invalid-response', '响应不可信'],
    ['bridge-invalid', 'native 返回契约外载荷'],
    ['internal-error', '未分类 IPC/native 失败的归一码，不能证明未 dispatch'],
    ['not-authenticated', '本命令不会产生的登录流程码，真出现也不可信'],
  ] as const)('maps unprovable-stage %s failure to uncertain without replay', async (code, _label) => {
    const invoke = vi.fn(async (command: string) => {
      if (command === HOSTED_AI_REQUEST_COMMAND) {
        if (code === 'bridge-invalid') return { unexpected: 'shape' };
        throw { code, message: `${code} happened` };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const outcome = await executeDetailsGeneration({ invoke, profileId: '' }, hostedInput, hostedJsonIntent, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'uncertain', mode: 'hosted-json' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    'invalid-request',
    'protocol-mismatch',
    'server-unavailable',
    'storage-unavailable',
  ] as const)('keeps pre-dispatch %s failure as an ordinary failed outcome', async (code) => {
    const invoke = vi.fn(async (command: string) => {
      if (command === HOSTED_AI_REQUEST_COMMAND) throw { code, message: `${code} happened` };
      throw new Error(`unexpected command: ${command}`);
    });
    const outcome = await executeDetailsGeneration({ invoke, profileId: '' }, hostedInput, hostedJsonIntent, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'failed', mode: 'hosted-json', code });
  });

  it.each(['hosted-stream', 'hosted-json'] as const)('does not dispatch a pre-aborted %s intent', async (mode) => {
    const invoke = vi.fn(async () => { throw new Error('unexpected invoke'); });
    const controller = new AbortController();
    controller.abort();
    const intent = mode === 'hosted-stream' ? hostedStreamIntent : hostedJsonIntent;
    await expect(
      executeDetailsGeneration(
        { invoke, profileId: '', createChannel: () => ({}) },
        hostedInput,
        intent,
        controller.signal,
      ),
    ).resolves.toMatchObject({ status: 'cancelled', mode, reason: 'aborted' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('keeps an abort that raced a pre-dispatch failure as honest cancelled', async () => {
    const controller = new AbortController();
    let rejectRequest: ((reason: unknown) => void) | undefined;
    const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      if (command === CANCEL_HOSTED_AI_COMMAND) return true;
      return new Promise<never>((_resolve, reject) => { rejectRequest = reject; });
    });
    const pending = executeDetailsGeneration({ invoke, profileId: '' }, hostedInput, hostedJsonIntent, controller.signal);
    controller.abort();
    // DESK-094 探测失败属于 dispatch 前终态：生成请求从未上线路，取消语义干净。
    rejectRequest?.({ code: 'server-unavailable', message: '项目服务暂不可达' });
    await expect(pending).resolves.toMatchObject({ status: 'cancelled', mode: 'hosted-json' });
  });
});
