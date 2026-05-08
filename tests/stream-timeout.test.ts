import { describe, expect, test } from 'bun:test';

import { createStreamReadWithTimeout, StreamReadTimeoutError } from '@/lib/stream/timeout';

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
});
