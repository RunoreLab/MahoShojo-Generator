import { describe, expect, test, vi } from 'vitest';

import {
  buildStreamSoftTimeoutMessage,
  createStreamReadWithTimeout,
  StreamReadTimeoutError,
  type StreamSoftTimeoutEvent,
} from '@/lib/stream/timeout';

describe('stream timeout', () => {
  test('idle timeout: reader.read 长时间无返回会被终止', async () => {
    const stream = new ReadableStream<string>({
      start() {
        // 永不 enqueue / close
      },
    });
    const reader = stream.getReader();
    const readWithTimeout = createStreamReadWithTimeout({ idleTimeoutMs: 50, totalTimeoutMs: 500, label: 'test-idle' });

    let err: unknown = null;
    try {
      await readWithTimeout(reader);
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(StreamReadTimeoutError);
    if (err instanceof StreamReadTimeoutError) {
      expect(err.kind).toBe('idle');
    }
  });

  test('正常情况：在超时前读取到 chunk', async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue('ok');
          controller.close();
        }, 10);
      },
    });
    const reader = stream.getReader();
    const readWithTimeout = createStreamReadWithTimeout({ idleTimeoutMs: 200, totalTimeoutMs: 1000, label: 'test-ok' });

    const first = await readWithTimeout(reader);
    expect(first.done).toBe(false);
    expect(first.value).toBe('ok');

    const second = await readWithTimeout(reader);
    expect(second.done).toBe(true);
  });

  test('外部活动会延长 idle timeout，直到读取到正文 chunk', async () => {
    let lastActivityAtMs: number | null = null;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const stream = new ReadableStream<string>({
      start(controller) {
        for (const delayMs of [20, 50, 80]) {
          timers.push(
            setTimeout(() => {
              lastActivityAtMs = Date.now();
            }, delayMs)
          );
        }
        timers.push(
          setTimeout(() => {
            controller.enqueue('ok-after-thinking');
            controller.close();
          }, 110)
        );
      },
    });
    const reader = stream.getReader();
    const readWithTimeout = createStreamReadWithTimeout({
      idleTimeoutMs: 40,
      totalTimeoutMs: 500,
      label: 'test-external-activity',
      getLastActivityAtMs: () => lastActivityAtMs,
    });

    try {
      const first = await readWithTimeout(reader);
      expect(first.done).toBe(false);
      expect(first.value).toBe('ok-after-thinking');
    } finally {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    }
  });

  test('total timeout：超过总时长后将立即终止后续 read', async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue('one');
        }, 5);
      },
    });
    const reader = stream.getReader();
    const readWithTimeout = createStreamReadWithTimeout({ idleTimeoutMs: 200, totalTimeoutMs: 30, label: 'test-total' });

    const first = await readWithTimeout(reader);
    expect(first.value).toBe('one');

    await new Promise((r) => setTimeout(r, 40));

    let err: unknown = null;
    try {
      await readWithTimeout(reader);
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(StreamReadTimeoutError);
    if (err instanceof StreamReadTimeoutError) {
      expect(err.kind).toBe('total');
    }
  });

  test('soft mode idle：超时只回调，不 reject，读流可继续', async () => {
    const softEvents: StreamSoftTimeoutEvent[] = [];
    const stream = new ReadableStream<string>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue('late');
          controller.close();
        }, 120);
      },
    });
    const reader = stream.getReader();
    const readWithTimeout = createStreamReadWithTimeout({
      mode: 'soft',
      idleTimeoutMs: 40,
      totalTimeoutMs: 5_000,
      label: 'test-soft-idle',
      onSoftTimeout: (event) => softEvents.push(event),
    });

    const first = await readWithTimeout(reader);
    expect(first.done).toBe(false);
    expect(first.value).toBe('late');
    expect(softEvents.some((event) => event.kind === 'idle')).toBe(true);
    expect(softEvents.filter((event) => event.kind === 'idle')).toHaveLength(1);
  });

  test('soft mode total：超时只回调一次，不 reject', async () => {
    const softEvents: StreamSoftTimeoutEvent[] = [];
    const stream = new ReadableStream<string>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue('one');
        }, 5);
        setTimeout(() => {
          controller.enqueue('two');
          controller.close();
        }, 80);
      },
    });
    const reader = stream.getReader();
    const readWithTimeout = createStreamReadWithTimeout({
      mode: 'soft',
      idleTimeoutMs: 5_000,
      totalTimeoutMs: 30,
      label: 'test-soft-total',
      onSoftTimeout: (event) => softEvents.push(event),
    });

    const first = await readWithTimeout(reader);
    expect(first.value).toBe('one');

    await new Promise((r) => setTimeout(r, 50));

    const second = await readWithTimeout(reader);
    expect(second.value).toBe('two');

    const totalEvents = softEvents.filter((event) => event.kind === 'total');
    expect(totalEvents.length).toBe(1);
    expect(totalEvents[0]?.timeoutMs).toBe(30);
  });

  test('buildStreamSoftTimeoutMessage 文案匹配 UI 约定', () => {
    expect(buildStreamSoftTimeoutMessage({ kind: 'idle', timeoutMs: 150_000 })).toBe(
      '已超过 150 秒仍未收到新内容，建议手动终止后重试。'
    );
    expect(buildStreamSoftTimeoutMessage({ kind: 'total', timeoutMs: 600_000 })).toBe(
      '已超过 600 秒仍未结束生成，建议手动终止后重试。'
    );
  });

  test('hard mode 默认行为不变：onTimeout 仍会触发', async () => {
    const onTimeout = vi.fn();
    const stream = new ReadableStream<string>({
      start() {
        // 永不返回
      },
    });
    const reader = stream.getReader();
    const readWithTimeout = createStreamReadWithTimeout({
      idleTimeoutMs: 40,
      totalTimeoutMs: 500,
      label: 'test-hard-default',
      onTimeout,
    });

    await expect(readWithTimeout(reader)).rejects.toBeInstanceOf(StreamReadTimeoutError);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
