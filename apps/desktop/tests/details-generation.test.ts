import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createMagicalGirlDetailsGenerationConfig, type MagicalGirlDetailsGenerationInput } from '@mahoshojo/ai-core/magical-girl-details-generation';
import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { executeDetailsGeneration } from '../src/features/details/generation';
import { CANCEL_DIRECT_AI_COMMAND, STREAM_DIRECT_AI_COMMAND } from '../src/platform/direct-ai-bridge';

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
    expect(outcome.card.userAnswers[0]!.answer).toBe(input.answers[0]!.answer);
    expect(outcome.card).not.toHaveProperty('signature');
    expect(outcome.card.userAnswers[0]).not.toHaveProperty('questionnaireId');
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
