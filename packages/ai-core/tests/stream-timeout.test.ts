import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildStreamSoftTimeoutMessage,
  createStreamReadWithTimeout,
  DEFAULT_STREAM_READ_IDLE_TIMEOUT_MS,
  DEFAULT_STREAM_READ_TOTAL_TIMEOUT_MS,
  StreamReadTimeoutError,
  type CreateStreamReadWithTimeoutOptions,
  type StreamReadTimeoutKind,
  type StreamReadTimeoutMode,
  type StreamSoftTimeoutEvent,
} from '@mahoshojo/ai-core/stream-timeout';

const createPendingStream = () => {
  let controller!: ReadableStreamDefaultController<string>;
  const reader = new ReadableStream<string>({ start(value) { controller = value; } }).getReader();
  return { reader, get controller() { return controller; } };
};

describe('stream timeout shared contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('retains the five-minute idle and ten-minute total defaults and exact messages', () => {
    expect(DEFAULT_STREAM_READ_IDLE_TIMEOUT_MS).toBe(300_000);
    expect(DEFAULT_STREAM_READ_TOTAL_TIMEOUT_MS).toBe(600_000);
    for (const [kind, timeoutMs, soft, hard] of [
      ['idle', 300_000, '已超过 300 秒仍未收到新内容，建议手动终止后重试。', '流式读取超时：300s 内未收到新内容，已终止。请重试。'],
      ['total', 600_000, '已超过 600 秒仍未结束生成，建议手动终止后重试。', '流式生成超时：超过 600s 仍未结束，已终止。请重试。'],
    ] as const) {
      const timeoutKind: StreamReadTimeoutKind = kind;
      expect(buildStreamSoftTimeoutMessage({ kind: timeoutKind, timeoutMs })).toBe(soft);
      expect(new StreamReadTimeoutError(kind, timeoutMs).message).toBe(hard);
      expect(new StreamReadTimeoutError(kind, timeoutMs, '生成')).toMatchObject({
        name: 'StreamReadTimeoutError', kind, timeoutMs, label: '生成', message: `【生成】${hard}`,
      });
    }
    expect(buildStreamSoftTimeoutMessage({ kind: 'idle', timeoutMs: 1 })).toBe(
      '已超过 1 秒仍未收到新内容，建议手动终止后重试。',
    );
  });

  it('defaults to hard rejection with the same error passed to the callback', async () => {
    const { reader } = createPendingStream();
    const onTimeout = vi.fn();
    const pending = createStreamReadWithTimeout({ idleTimeoutMs: 50, label: '原行为', onTimeout })(reader);
    const rejection = expect(pending).rejects.toMatchObject({ kind: 'idle', timeoutMs: 50, label: '原行为' });
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout.mock.calls[0]?.[0]).toBeInstanceOf(StreamReadTimeoutError);
    expect(vi.getTimerCount()).toBe(0);
    await reader.cancel();
  });

  it('keeps a soft read alive through both default thresholds and deduplicates alerts', async () => {
    const stream = createPendingStream();
    const onTimeout = vi.fn();
    const softEvents: StreamSoftTimeoutEvent[] = [];
    const mode: StreamReadTimeoutMode = 'soft';
    const options: CreateStreamReadWithTimeoutOptions = {
      mode,
      idleTimeoutMs: DEFAULT_STREAM_READ_IDLE_TIMEOUT_MS,
      totalTimeoutMs: DEFAULT_STREAM_READ_TOTAL_TIMEOUT_MS,
      label: '等待',
      onSoftTimeout: (event) => { softEvents.push(event); },
      onTimeout,
    };
    const read = createStreamReadWithTimeout(options);
    const settled = vi.fn();
    const pending = read(stream.reader).then((result) => { settled(); return result; });
    await vi.advanceTimersByTimeAsync(299_999);
    expect(softEvents).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(softEvents).toEqual([{ kind: 'idle', timeoutMs: 300_000, elapsedMs: 300_000, label: '等待' }]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(softEvents).toEqual([
      { kind: 'idle', timeoutMs: 300_000, elapsedMs: 300_000, label: '等待' },
      { kind: 'total', timeoutMs: 600_000, elapsedMs: 600_000, label: '等待' },
    ]);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(softEvents).toHaveLength(2);
    expect(settled).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
    stream.controller.enqueue('迟到正文');
    expect(await pending).toEqual({ value: '迟到正文', done: false });
    stream.controller.close();
    expect(await read(stream.reader)).toEqual({ value: undefined, done: true });
    expect(softEvents).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors external activity and preserves total deadline priority in hard mode', async () => {
    const { reader } = createPendingStream();
    let lastActivityAtMs = Date.now();
    const onTimeout = vi.fn();
    const pending = createStreamReadWithTimeout({
      idleTimeoutMs: 50, totalTimeoutMs: 100, getLastActivityAtMs: () => lastActivityAtMs, onTimeout,
    })(reader);
    const rejection = expect(pending).rejects.toMatchObject({ kind: 'total', timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(40);
    lastActivityAtMs = Date.now();
    await vi.advanceTimersByTimeAsync(40);
    expect(onTimeout).not.toHaveBeenCalled();
    lastActivityAtMs = Date.now();
    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    expect(onTimeout).toHaveBeenCalledTimes(1);
    await reader.cancel();
  });

  it('soft mode still observes idle after the total alert', async () => {
    const stream = createPendingStream();
    const events: StreamSoftTimeoutEvent[] = [];
    const pending = createStreamReadWithTimeout({
      mode: 'soft', idleTimeoutMs: 100, totalTimeoutMs: 50, onSoftTimeout: (event) => { events.push(event); },
    })(stream.reader);
    await vi.advanceTimersByTimeAsync(100);
    expect(events).toEqual([
      { kind: 'total', timeoutMs: 50, elapsedMs: 50 },
      { kind: 'idle', timeoutMs: 100, elapsedMs: 100 },
    ]);
    stream.controller.close();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['hard', 'soft'] as const)('cleans up the %s watch on reader errors', async (mode) => {
    const stream = createPendingStream();
    const error = new Error('upstream stopped');
    const pending = createStreamReadWithTimeout({ mode, idleTimeoutMs: 100 })(stream.reader);
    const rejection = expect(pending).rejects.toBe(error);
    stream.controller.error(error);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('bundles the explicit stream-timeout entry for browsers with no process or host I/O dependencies', async () => {
  const result = await build({
    absWorkingDir: process.cwd(),
    bundle: true,
    write: false,
    metafile: true,
    platform: 'browser',
    format: 'esm',
    stdin: {
      contents: "export * from '@mahoshojo/ai-core/stream-timeout';",
      loader: 'ts',
      resolveDir: process.cwd(),
      sourcefile: 'stream-timeout-browser.ts',
    },
  });
  const inputs = Object.keys(result.metafile?.inputs ?? {}).filter((input) => input !== 'stream-timeout-browser.ts');
  expect(inputs).toEqual(['src/stream-timeout.ts']);
  expect(result.metafile?.outputs['stdin.js']?.imports).toEqual([]);
  expect(result.outputFiles[0]?.text).not.toMatch(/\bprocess\b|\bfetch\b|hosted-runtime|node:|@tauri|cloudflare/iu);
});
