import { describe, expect, test } from 'vitest';

import { relayAbortSignal, STREAM_ABORT_REASON_USER } from '@/lib/stream/abort';

describe('stream/abort relayAbortSignal', () => {
  test('会把 source signal 的中断原因透传给目标 controller', () => {
    const source = new AbortController();
    const target = new AbortController();

    const cleanup = relayAbortSignal(source.signal, target);
    source.abort(STREAM_ABORT_REASON_USER);

    expect(target.signal.aborted).toBe(true);
    expect(target.signal.reason).toBe(STREAM_ABORT_REASON_USER);

    cleanup();
  });

  test('source signal 已经中断时会立刻同步到目标 controller', () => {
    const source = new AbortController();
    source.abort('pre-aborted');

    const target = new AbortController();
    relayAbortSignal(source.signal, target);

    expect(target.signal.aborted).toBe(true);
    expect(target.signal.reason).toBe('pre-aborted');
  });
});
