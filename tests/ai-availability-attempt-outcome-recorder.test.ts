import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordAiChannelOutcome = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock('@/lib/ai/availability/record-outcome', () => ({
  recordAiChannelOutcome: (input: unknown) => recordAiChannelOutcome(input),
}));

import {
  createAttemptOutcomeRecorder,
  pipeStreamWithAttemptOutcome,
  wrapResponseWithAttemptOutcome,
} from '@/lib/ai/availability/attempt-outcome-recorder';

async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const chunks: T[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as T);
  }
  return chunks;
}

describe('createAttemptOutcomeRecorder', () => {
  beforeEach(() => {
    recordAiChannelOutcome.mockClear();
  });

  it('无 channelContext 时全部 no-op', () => {
    const recorder = createAttemptOutcomeRecorder(undefined);
    recorder.recordSuccess();
    recorder.recordFromError(new Error('boom'));
    expect(recorder.settled).toBe(false);
    expect(recordAiChannelOutcome).not.toHaveBeenCalled();
  });

  it('同一 attempt 只提交一次（先到先得）', () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'nova-cervus',
      modelId: '[鹿鹿10]gemini-3.1-pro-preview',
    });

    recorder.recordFromError(
      Object.assign(new Error('状态码=503，模型暂时不可用'), {
        name: 'AI_APICallError',
        statusCode: 503,
      }),
    );
    recorder.recordSuccess(); // 不得覆盖 failure

    expect(recorder.settled).toBe(true);
    expect(recordAiChannelOutcome).toHaveBeenCalledTimes(1);
    expect(recordAiChannelOutcome).toHaveBeenCalledWith({
      providerId: 'nova-cervus',
      modelId: '[鹿鹿10]gemini-3.1-pro-preview',
      outcome: 'failure',
      errorClass: 'server_error',
    });
  });

  it('recordSuccess 记 success', () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'system',
      modelId: 'default',
    });
    recorder.recordSuccess();
    expect(recordAiChannelOutcome).toHaveBeenCalledWith({
      providerId: 'system',
      modelId: 'default',
      outcome: 'success',
    });
  });

  it('recordFromCancel(timeout) → failure/timeout', () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'system',
      modelId: 'default',
    });
    recorder.recordFromCancel('timeout');
    expect(recordAiChannelOutcome).toHaveBeenCalledWith({
      providerId: 'system',
      modelId: 'default',
      outcome: 'failure',
      errorClass: 'timeout',
    });
  });

  it('recordFromCancel(客户端断开) → excluded/user_cancel', () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'system',
      modelId: 'default',
    });
    recorder.recordFromCancel('client disconnected');
    expect(recordAiChannelOutcome).toHaveBeenCalledWith({
      providerId: 'system',
      modelId: 'default',
      outcome: 'excluded',
      errorClass: 'user_cancel',
    });
  });

  it('自定义渠道 503 计入 failure（不被 excluded）', () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'nova-cervus',
      modelId: 'm',
    });
    recorder.recordFromError(
      new Error('AI_APICallError: 状态码=503，当前模型暂时不可用（HTTP 503）'),
    );
    expect(recordAiChannelOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        errorClass: 'server_error',
      }),
    );
  });
});

describe('pipeStreamWithAttemptOutcome', () => {
  beforeEach(() => {
    recordAiChannelOutcome.mockClear();
  });

  it('正常读完 → success（默认 recordSuccessOnClose）', async () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'system',
      modelId: 'default',
    });
    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('hello');
        controller.close();
      },
    });

    const scored = pipeStreamWithAttemptOutcome(source, recorder);
    const chunks = await readAll(scored);

    expect(chunks).toEqual(['hello']);
    expect(recordAiChannelOutcome).toHaveBeenCalledWith({
      providerId: 'system',
      modelId: 'default',
      outcome: 'success',
    });
  });

  it('recordSuccessOnClose=false 时正常结束不记 success', async () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'system',
      modelId: 'default',
    });
    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('x');
        controller.close();
      },
    });

    await readAll(pipeStreamWithAttemptOutcome(source, recorder, { recordSuccessOnClose: false }));
    expect(recorder.settled).toBe(false);
    expect(recordAiChannelOutcome).not.toHaveBeenCalled();

    // 由 onFinish 路径提交
    recorder.recordSuccess();
    expect(recordAiChannelOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success' }),
    );
  });

  it('读流抛错 → failure', async () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'nova-cervus',
      modelId: 'm',
    });
    const source = new ReadableStream<string>({
      pull() {
        throw Object.assign(new Error('upstream 503'), {
          name: 'AI_APICallError',
          statusCode: 503,
        });
      },
    });

    const scored = pipeStreamWithAttemptOutcome(source, recorder);
    const reader = scored.getReader();
    await expect(reader.read()).rejects.toThrow(/upstream 503|503/);

    expect(recordAiChannelOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        errorClass: 'server_error',
      }),
    );
  });

  it('cancel → excluded/user_cancel', async () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'system',
      modelId: 'default',
    });
    const source = new ReadableStream<string>({
      start() {
        // 永不结束，等待 cancel
      },
    });

    const scored = pipeStreamWithAttemptOutcome(source, recorder);
    const reader = scored.getReader();
    await reader.cancel('client-abort');

    expect(recordAiChannelOutcome).toHaveBeenCalledWith({
      providerId: 'system',
      modelId: 'default',
      outcome: 'excluded',
      errorClass: 'user_cancel',
    });
  });

  it('onError 先记 failure 后 close 不会再记 success', async () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'system',
      modelId: 'default',
    });

    // 模拟 stream 中 onError 先触发
    recorder.recordFromError(
      Object.assign(new Error('mid-stream fail'), { statusCode: 502 }),
    );

    const source = new ReadableStream<string>({
      start(controller) {
        controller.close();
      },
    });
    await readAll(pipeStreamWithAttemptOutcome(source, recorder));

    expect(recordAiChannelOutcome).toHaveBeenCalledTimes(1);
    expect(recordAiChannelOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        errorClass: 'server_error',
      }),
    );
  });
});

describe('wrapResponseWithAttemptOutcome', () => {
  beforeEach(() => {
    recordAiChannelOutcome.mockClear();
  });

  it('包装 Response.body，消费完成后记 success', async () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'system',
      modelId: 'default',
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('ok'));
        controller.close();
      },
    });
    const response = new Response(body, { status: 200 });
    const wrapped = wrapResponseWithAttemptOutcome(response, recorder);

    const text = await wrapped.text();
    expect(text).toBe('ok');
    expect(recordAiChannelOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success' }),
    );
  });

  it('streamObject 模式：close 不记 success，onFinish local_parse 可记 excluded', async () => {
    const recorder = createAttemptOutcomeRecorder({
      providerId: 'system',
      modelId: 'default',
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{bad'));
        controller.close();
      },
    });
    const wrapped = wrapResponseWithAttemptOutcome(new Response(body), recorder, {
      recordSuccessOnClose: false,
    });
    await wrapped.text();
    expect(recordAiChannelOutcome).not.toHaveBeenCalled();

    // 模拟 onFinish 发现 schema 错误
    recorder.recordClassification({ outcome: 'excluded', errorClass: 'local_parse' });
    expect(recordAiChannelOutcome).toHaveBeenCalledWith({
      providerId: 'system',
      modelId: 'default',
      outcome: 'excluded',
      errorClass: 'local_parse',
    });
  });
});
