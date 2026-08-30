import { describe, expect, it } from 'vitest';

import {
  classifyAiUpstreamOutcome,
  createAiUpstreamAttemptRuntime,
} from '@mahoshojo/hosted-runtime/ai-upstream';
import {
  registerHostedRuntimeObserver,
  resetHostedRuntimeObserverForTests,
} from '@mahoshojo/hosted-runtime/telemetry';

describe('package-owned AI upstream attempt seam', () => {
  it('records one TTFB and one terminal for a non-stream attempt', () => {
    const ttfb: number[] = [];
    const terminal: unknown[] = [];
    registerHostedRuntimeObserver({
      beginAiUpstream: () => ({
        recordTtfb: (value) => ttfb.push(value),
        finish: (value) => terminal.push(value),
      }),
      observeD1RoundTrip: () => undefined,
    });

    try {
      const runtime = createAiUpstreamAttemptRuntime(() => 10);
      runtime.recordTtfb();
      runtime.finish('success');
      runtime.finish('error');
      expect(ttfb).toHaveLength(1);
      expect(terminal).toHaveLength(1);
    } finally {
      resetHostedRuntimeObserverForTests();
    }
  });

  it('does not synthesize TTFB when terminal arrives before first response', () => {
    const ttfb: number[] = [];
    const terminal: unknown[] = [];
    registerHostedRuntimeObserver({
      beginAiUpstream: () => ({
        recordTtfb: (value) => ttfb.push(value),
        finish: (value) => terminal.push(value),
      }),
      observeD1RoundTrip: () => undefined,
    });

    try {
      const runtime = createAiUpstreamAttemptRuntime(() => 10);
      runtime.finish('error');
      runtime.finish('aborted');
      runtime.recordTtfb();
      expect(ttfb).toHaveLength(0);
      expect(terminal).toHaveLength(1);
    } finally {
      resetHostedRuntimeObserverForTests();
    }
  });

  it('keeps the first terminal classification when timeout races with abort', () => {
    const terminal: unknown[] = [];
    registerHostedRuntimeObserver({
      beginAiUpstream: () => ({
        recordTtfb: () => undefined,
        finish: (value) => terminal.push(value),
      }),
      observeD1RoundTrip: () => undefined,
    });

    try {
      const runtime = createAiUpstreamAttemptRuntime(() => 10);
      runtime.finish('timeout');
      runtime.finish('aborted');
      expect(terminal).toEqual([{ outcome: 'timeout', durationMs: 0 }]);
    } finally {
      resetHostedRuntimeObserverForTests();
    }
  });

  it('classifies undefined consumer cancellation as aborted and keeps canaries out', () => {
    expect(classifyAiUpstreamOutcome(undefined)).toBe('aborted');
    expect(classifyAiUpstreamOutcome(new Error('timeout'))).toBe('timeout');
    expect(classifyAiUpstreamOutcome(new Error('secret body provider url'))).toBe('error');
  });

  it('uses structured abort/timeout signals and never throws for hostile error objects', () => {
    expect(classifyAiUpstreamOutcome({ name: 'AbortError' })).toBe('aborted');
    expect(classifyAiUpstreamOutcome({ code: 'ABORT_ERR' })).toBe('aborted');
    expect(classifyAiUpstreamOutcome({ name: 'StreamReadTimeoutError' })).toBe('timeout');
    expect(classifyAiUpstreamOutcome({ code: 'UND_ERR_CONNECT_TIMEOUT' })).toBe('timeout');

    const hostile = Object.defineProperties({}, {
      name: { get: () => { throw new Error('name getter must not escape'); } },
      code: { get: () => { throw new Error('code getter must not escape'); } },
      message: { get: () => { throw new Error('message getter must not escape'); } },
      [Symbol.toPrimitive]: { value: () => { throw new Error('coercion must not escape'); } },
    });
    expect(() => classifyAiUpstreamOutcome(hostile)).not.toThrow();
    expect(classifyAiUpstreamOutcome(hostile)).toBe('error');
  });
});
