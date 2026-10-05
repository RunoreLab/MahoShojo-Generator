import { describe, expect, it, vi } from 'vitest';

import type { AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';

import {
  CANCEL_DIRECT_AI_COMMAND,
  STREAM_DIRECT_AI_COMMAND,
} from '../src/platform/direct-ai-bridge';
import { createDesktopAiExecutionPort } from '../src/platform/desktop-ai-execution';

const request: AiExecutionRequest = {
  requestId: 'req-1',
  contractVersion: 1,
  mode: 'direct-local',
  messages: [{ role: 'user', content: 'hello' }],
};

const identity = { requestId: 'req-1', contractVersion: 1, mode: 'direct-local' } as const;

const completedStream: AiStreamEvent[] = [
  { type: 'started', ...identity, sequence: 0 },
  { type: 'text-delta', ...identity, sequence: 1, delta: '你' },
  { type: 'text-delta', ...identity, sequence: 2, delta: '好' },
  {
    type: 'result',
    ...identity,
    sequence: 3,
    result: {
      status: 'completed',
      requestId: 'req-1',
      contractVersion: 1,
      mode: 'direct-local',
      output: { text: '你好' },
      finishReason: 'stop',
    },
  },
];

/**
 * 用可控的 sink 驱动 native 事件序列。
 *
 * 事件从 `__deliver` 注入，而不是靠假 invoke 立即 resolve —— 这样才能验证流是**按序、按个**
 * 交付的，而不是被一次性倒出。
 */
const createHarness = () => {
  // 真实 Channel 依赖 WebView 的 window，因此这里注入一个只暴露 onmessage 的替身。
  const channel = { onmessage: undefined as ((event: AiStreamEvent) => void) | undefined };
  const createChannel = () => channel;
  let deliver: ((event: AiStreamEvent) => void) | undefined;
  let finish: (() => void) | undefined;
  let failWith: (() => void) | undefined;
  let commandArguments: Record<string, unknown> | undefined;

  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === STREAM_DIRECT_AI_COMMAND) {
      commandArguments = args;
      const passed = (args as { onEvent: { onmessage?: (event: AiStreamEvent) => void } }).onEvent;
      deliver = (event) => passed.onmessage?.(event);
      await new Promise<void>((resolve, reject) => {
        finish = resolve;
        failWith = () => reject(new Error('native stream failed'));
      });
      return undefined;
    }
    return undefined;
  });

  const options = { invoke, createChannel, profileId: 'p1' };

  return {
    options,
    invoke,
    createChannel,
    get commandArguments() {
      return commandArguments;
    },
    deliver: (event: AiStreamEvent) => deliver?.(event),
    finish: () => finish?.(),
    fail: () => failWith?.(),
  };
};

describe('DesktopAiExecutionPort', () => {
  it('collects the native stream into a single execute() result', async () => {
    const harness = createHarness();
    const port = createDesktopAiExecutionPort(harness.options);

    const pending = port.execute(request, new AbortController().signal);
    for (const event of completedStream) harness.deliver(event);
    harness.finish();

    await expect(pending).resolves.toMatchObject({
      status: 'completed',
      output: { text: '你好' },
    });
    // profileId 是唯一选择器：请求里不得出现 endpoint 或 secret。
    expect(harness.commandArguments?.profileId).toBe('p1');
    expect(harness.commandArguments?.request).toEqual(request);
    expect(JSON.stringify(harness.commandArguments)).not.toMatch(/https?:\/\/|sk-/u);
  });

  it('forwards stream events in order through stream()', async () => {
    const harness = createHarness();
    const port = createDesktopAiExecutionPort(harness.options);

    const collected: AiStreamEvent[] = [];
    const consuming = (async () => {
      for await (const event of port.stream(request, new AbortController().signal)) {
        collected.push(event);
      }
    })();

    for (const event of completedStream) harness.deliver(event);
    harness.finish();
    await consuming;

    expect(collected).toEqual(completedStream);
    expect(harness.commandArguments?.request).toEqual(request);
  });

  it('forwards the complete business request without retaining mutable caller input', async () => {
    const harness = createHarness();
    const input: AiExecutionRequest = {
      ...request,
      messages: [{ role: 'system', content: '问卷规则' }, { role: 'user', content: '问卷回答' }],
      modelId: 'chosen-model', temperature: 0.8, maxOutputTokens: 2048, responseFormat: 'json',
    };
    const expected = structuredClone(input);
    const pending = createDesktopAiExecutionPort(harness.options).execute(input, new AbortController().signal);
    input.messages[1]!.content = '调用后编辑';
    expect(harness.commandArguments?.request).toEqual(expected);
    for (const event of completedStream) harness.deliver(event);
    harness.finish();
    await pending;
  });

  it('rejects extra transport fields before IPC', async () => {
    const harness = createHarness();
    await expect(createDesktopAiExecutionPort(harness.options).execute(
      { ...request, endpoint: 'https://example.invalid' } as AiExecutionRequest,
      new AbortController().signal,
    )).rejects.toThrow();
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it('does not dispatch a pre-aborted streaming request', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    controller.abort();
    const stream = createDesktopAiExecutionPort(harness.options).stream(request, controller.signal)[Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({ done: true });
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it('cancels upstream when the consumer stops before completion', async () => {
    const harness = createHarness();
    const stream = createDesktopAiExecutionPort(harness.options).stream(request, new AbortController().signal)[Symbol.asyncIterator]();
    const first = stream.next();
    harness.deliver(completedStream[0] as AiStreamEvent);
    await first;
    if (!stream.return) throw new Error('stream iterator does not support return()');
    const stopped = stream.return(undefined);
    await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledWith(
      CANCEL_DIRECT_AI_COMMAND, { requestId: request.requestId },
    ));
    harness.finish();
    await stopped;
  });

  it('does not yield a queued delta after cancellation between yields', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const stream = createDesktopAiExecutionPort(harness.options).stream(request, controller.signal)[Symbol.asyncIterator]();
    const first = stream.next();
    for (const event of completedStream) harness.deliver(event);
    await first;
    controller.abort();
    harness.finish();
    await expect(stream.next()).resolves.toMatchObject({ done: true });
  });

  it('delegates protocol enforcement to ai-core instead of re-implementing it', async () => {
    const harness = createHarness();
    const port = createDesktopAiExecutionPort(harness.options);

    const pending = port.execute(request, new AbortController().signal);
    // 缺少 started：ai-core 的协议归约必须拒绝它。
    harness.deliver(completedStream[3] as AiStreamEvent);
    harness.finish();

    await expect(pending).rejects.toThrow(/started/u);
  });

  it('reports a cancelled result when the signal is already aborted', async () => {
    const harness = createHarness();
    const port = createDesktopAiExecutionPort(harness.options);

    const controller = new AbortController();
    controller.abort();

    await expect(port.execute(request, controller.signal)).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'aborted',
    });
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it('cancels the native request when the signal aborts mid-stream', async () => {
    const harness = createHarness();
    const port = createDesktopAiExecutionPort(harness.options);
    const controller = new AbortController();

    const pending = port.execute(request, controller.signal);
    harness.deliver(completedStream[0] as AiStreamEvent);
    controller.abort();
    harness.finish();

    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    // 只 abort 本地信号不够：必须打到 native 才能真正中止上游。
    expect(harness.invoke).toHaveBeenCalledWith(CANCEL_DIRECT_AI_COMMAND, {
      requestId: 'req-1',
    });
  });

  it.each(['execute', 'stream'] as const)('retains cancellation before native registration for %s', async (method) => {
    const harness = createHarness();
    const port = createDesktopAiExecutionPort(harness.options);
    const controller = new AbortController();
    const pending = method === 'execute'
      ? port.execute(request, controller.signal)
      : port.stream(request, controller.signal)[Symbol.asyncIterator]().next();
    controller.abort();
    expect(harness.invoke).not.toHaveBeenCalledWith(CANCEL_DIRECT_AI_COMMAND, expect.anything());
    harness.deliver(completedStream[0] as AiStreamEvent);
    expect(harness.invoke).toHaveBeenCalledWith(CANCEL_DIRECT_AI_COMMAND, { requestId: request.requestId });
    harness.finish();
    await pending;
  });

  it('stops yielding once the signal aborts mid-stream', async () => {
    const harness = createHarness();
    const port = createDesktopAiExecutionPort(harness.options);
    const controller = new AbortController();

    const collected: AiStreamEvent[] = [];
    const consuming = (async () => {
      for await (const event of port.stream(request, controller.signal)) {
        collected.push(event);
      }
    })();

    harness.deliver(completedStream[0] as AiStreamEvent);
    controller.abort();
    harness.deliver(completedStream[1] as AiStreamEvent);
    harness.finish();
    await consuming;

    expect(collected.every((event) => event.type === 'started')).toBe(true);
    expect(harness.invoke).toHaveBeenCalledWith(CANCEL_DIRECT_AI_COMMAND, {
      requestId: 'req-1',
    });
  });

  it('fails closed when the native stream fails with an unrecognized shape', async () => {
    const harness = createHarness();
    const port = createDesktopAiExecutionPort(harness.options);

    const pending = port.execute(request, new AbortController().signal);
    harness.fail();

    // 后端返回的不是 { code, message } 形状时，只暴露固定文案，不透传原始错误文本。
    await expect(pending).rejects.toThrow(/Direct AI execution failed/u);
  });

  it('preserves a structured native failure code', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === STREAM_DIRECT_AI_COMMAND) {
        throw { code: 'secret-store-unavailable', message: 'credential store is unavailable' };
      }
      return undefined;
    });
    const port = createDesktopAiExecutionPort({
      invoke,
      profileId: 'p1',
      createChannel: () => ({}),
    });

    await expect(port.execute(request, new AbortController().signal)).rejects.toMatchObject({
      name: 'DesktopAiError',
      code: 'secret-store-unavailable',
    });
  });
});
