import { describe, expect, it, vi } from 'vitest';
import { FREE_GENERATION_SCHEMAS } from '@mahoshojo/ai-core/free-generation';
import type { AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { executeDesktopGeneration, GenerationTransportError, type DesktopGenerationFamily } from '../src/features/generation/executor';
import { CANCEL_DIRECT_AI_COMMAND, STREAM_DIRECT_AI_COMMAND } from '../src/platform/direct-ai-bridge';

const family: DesktopGenerationFamily<{ prompt: string }> = {
  streamRouteId: 'generate-free-stream', jsonRouteId: 'generate-free',
  buildHostedBody: (input) => input,
  createDirectConfig: () => ({ systemPrompt: 'JSON', temperature: 0.5, promptBuilder: i => i.prompt, schema: FREE_GENERATION_SCHEMAS.general, taskName: 'test' }),
  createDirectStreamConfig: () => ({ systemPrompt: 'Markdown only', temperature: 0.5, promptBuilder: i => i.prompt }),
  buildStructuredCard: data => ({ card: data as Record<string, unknown>, cardKind: 'structured' }),
  buildStreamCard: text => ({ card: { content: text }, cardKind: 'general' }),
  normalizeHostedJsonCard: () => { throw new Error('unused'); },
  createError: (text, cause) => new GenerationTransportError(text, cause), cardNoun: '卡',
};
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const setup = () => {
  const ready = deferred(); const end = deferred();
  let request!: AiExecutionRequest; let send!: (event: AiStreamEvent) => void;
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === CANCEL_DIRECT_AI_COMMAND) { end.resolve(); return; }
    expect(command).toBe(STREAM_DIRECT_AI_COMMAND);
    request = args!.request as AiExecutionRequest;
    send = (args!.onEvent as { onmessage: typeof send }).onmessage;
    ready.resolve(); await end.promise;
  });
  let seq = 0;
  const emit = (event: Record<string, unknown>) => send({ requestId: request.requestId, contractVersion: 1, mode: request.mode, sequence: seq++, ...event } as AiStreamEvent);
  return { invoke, ready, end, emit, get request() { return request; }, options: { invoke, profileId: 'p', createChannel: () => ({}) } };
};
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

describe('Direct 产品流式', () => {
  it('终态前真实交付正文，推理不混入正文，结束后使用通用卡与原始 usage', async () => {
    const h = setup(); const partial = vi.fn(); let settled = false;
    const promise = executeDesktopGeneration(family, h.options, { prompt: 'input' }, { requestId: 'stream-1', mode: 'direct-local', generationMode: 'stream' }, new AbortController().signal, partial).finally(() => { settled = true; });
    await h.ready.promise;
    expect(h.request.messages[0].content).toBe('Markdown only');
    h.emit({ type: 'started' }); h.emit({ type: 'reasoning-delta', delta: 'private thought' }); h.emit({ type: 'text-delta', delta: '# 标题\n' });
    await tick(); expect(settled).toBe(false); expect(partial).toHaveBeenLastCalledWith('# 标题\n');
    h.emit({ type: 'text-delta', delta: '完整正文' });
    h.emit({ type: 'result', result: { requestId: 'stream-1', contractVersion: 1, mode: 'direct-local', status: 'completed', finishReason: 'stop', output: { text: '# 标题\n完整正文', reasoning: 'private thought' }, usage: { outputTokens: 8, reasoningTokens: 3 } } }); h.end.resolve();
    expect(await promise).toMatchObject({ status: 'completed', cardKind: 'general', card: { content: '# 标题\n完整正文' }, reasoning: { text: 'private thought', status: 'done' }, result: { usage: { outputTokens: 8 } } });
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it('取消保留已展示正文且只取消同一请求，不自动重试', async () => {
    const h = setup(); const controller = new AbortController();
    const promise = executeDesktopGeneration(family, h.options, { prompt: 'input' }, { requestId: 'cancel-1', mode: 'direct-remote', generationMode: 'stream' }, controller.signal);
    await h.ready.promise; h.emit({ type: 'started' }); h.emit({ type: 'text-delta', delta: '已有正文' }); await tick(); controller.abort(); h.end.resolve();
    expect(await promise).toMatchObject({ status: 'cancelled', rawText: '已有正文' });
    expect(h.invoke).toHaveBeenCalledWith(CANCEL_DIRECT_AI_COMMAND, { requestId: 'cancel-1' });
  });
  it('不支持的家族在派发前失败', async () => {
    const h = setup();
    expect(await executeDesktopGeneration({ ...family, createDirectStreamConfig: undefined }, h.options, { prompt: 'x' }, { requestId: 'no-1', mode: 'direct-local', generationMode: 'stream' }, new AbortController().signal)).toMatchObject({ status: 'failed', code: 'invalid-request' });
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it.each(['length', 'content-filter', 'tool-calls', 'other'] as const)('非正常结束 %s 不把残稿当作成功卡', async finishReason => {
    const h = setup(); const promise = executeDesktopGeneration(family, h.options, { prompt: 'x' }, { requestId: 'end-1', mode: 'direct-local', generationMode: 'stream' }, new AbortController().signal);
    await h.ready.promise; h.emit({ type: 'started' }); h.emit({ type: 'text-delta', delta: '残稿' }); h.emit({ type: 'result', result: { requestId: 'end-1', contractVersion: 1, mode: 'direct-local', status: 'completed', finishReason, output: { text: '残稿' } } }); h.end.resolve();
    expect(await promise).toMatchObject({ status: 'invalid-output', rawText: '残稿' });
  });
});

describe('Web 与 Direct 共用空壳拒绝', () => {
  it.each(['{}', '{ \n }', '[]', '[ ]', 'null', 'undefined', '\uFEFF{}'])('不把 %s 保存成通用卡', async text => {
    const h = setup(); const promise = executeDesktopGeneration(family, h.options, { prompt: 'x' }, { requestId: 'empty-1', mode: 'direct-local', generationMode: 'stream' }, new AbortController().signal);
    await h.ready.promise; h.emit({ type: 'started' }); h.emit({ type: 'result', result: { requestId: 'empty-1', contractVersion: 1, mode: 'direct-local', status: 'completed', finishReason: 'stop', output: { text } } }); h.end.resolve();
    expect(await promise).toMatchObject({ status: 'invalid-output', rawText: text });
  });
});
