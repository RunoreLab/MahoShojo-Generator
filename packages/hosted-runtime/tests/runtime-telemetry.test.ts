import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  beginAiUpstream,
  observeD1RoundTrip,
  registerHostedRuntimeObserver,
  resetHostedRuntimeObserverForTests,
  type AiUpstreamFinishObservation,
  type D1RoundTripInput,
  type D1RoundTripObservation,
  type HostedRuntimeObserver,
} from '@mahoshojo/hosted-runtime/telemetry';

type Recorder = {
  observer: HostedRuntimeObserver;
  aiStarts: number;
  ttfb: Array<{ durationMs: number }>;
  finishes: AiUpstreamFinishObservation[];
  d1: D1RoundTripObservation[];
};

const createRecorder = (): Recorder => {
  const recorder: Recorder = {
    aiStarts: 0,
    ttfb: [],
    finishes: [],
    d1: [],
    observer: undefined as unknown as HostedRuntimeObserver,
  };
  recorder.observer = {
    beginAiUpstream: () => {
      recorder.aiStarts += 1;
      return {
        recordTtfb: (durationMs) => recorder.ttfb.push({ durationMs }),
        finish: (observation) => recorder.finishes.push(observation),
      };
    },
    observeD1RoundTrip: (observation) => recorder.d1.push(observation),
  };
  return recorder;
};

afterEach(() => {
  resetHostedRuntimeObserverForTests();
});

describe('hosted runtime telemetry port', () => {
  it('每次 AI attempt 只记录一次 TTFB 和一次终态', () => {
    const recorder = createRecorder();
    registerHostedRuntimeObserver(recorder.observer);

    const attempt = beginAiUpstream();
    attempt.recordTtfb(12);
    attempt.recordTtfb(18);
    attempt.finish({ outcome: 'aborted', durationMs: 30 });
    attempt.recordTtfb(22);
    attempt.finish({ outcome: 'error', durationMs: 40 });

    expect(recorder.aiStarts).toBe(1);
    expect(recorder.ttfb).toEqual([{ durationMs: 12 }]);
    expect(recorder.finishes).toEqual([{ outcome: 'aborted', durationMs: 30 }]);
  });

  it('隔离 observer 的 begin、attempt 和 D1 回调异常', () => {
    const throwingAttempt = {
      recordTtfb: vi.fn(() => {
        throw new Error('ttfb failed');
      }),
      finish: vi.fn(() => {
        throw new Error('finish failed');
      }),
    };
    const throwingObserver: HostedRuntimeObserver = {
      beginAiUpstream: vi.fn(() => throwingAttempt),
      observeD1RoundTrip: vi.fn(() => {
        throw new Error('d1 failed');
      }),
    };
    registerHostedRuntimeObserver(throwingObserver);

    const attempt = beginAiUpstream();
    expect(() => attempt.recordTtfb(4)).not.toThrow();
    expect(() => attempt.recordTtfb(5)).not.toThrow();
    expect(() => attempt.finish({ outcome: 'error', durationMs: 8 })).not.toThrow();
    expect(() => attempt.finish({ outcome: 'success', durationMs: 9 })).not.toThrow();
    expect(() => observeD1RoundTrip({
      durationMs: 3,
      rowsRead: 1,
      rowsWritten: 0,
      outcome: 'error',
      errorClass: 'transport',
    })).not.toThrow();
    expect(throwingAttempt.recordTtfb).toHaveBeenCalledTimes(1);
    expect(throwingAttempt.finish).toHaveBeenCalledTimes(1);

    const beginFailure: HostedRuntimeObserver = {
      beginAiUpstream: () => {
        throw new Error('begin failed');
      },
      observeD1RoundTrip: () => undefined,
    };
    registerHostedRuntimeObserver(beginFailure);
    expect(() => {
      const failedAttempt = beginAiUpstream();
      failedAttempt.recordTtfb(1);
      failedAttempt.finish({ outcome: 'error', durationMs: 2 });
    }).not.toThrow();
  });

  it('撤销当前注册会恢复前一 observer，旧撤销函数不会覆盖新注册', () => {
    const first = createRecorder();
    const second = createRecorder();
    const unregisterFirst = registerHostedRuntimeObserver(first.observer);
    const unregisterSecond = registerHostedRuntimeObserver(second.observer);

    unregisterFirst();
    beginAiUpstream();
    expect(first.aiStarts).toBe(0);
    expect(second.aiStarts).toBe(1);

    unregisterSecond();
    beginAiUpstream();
    expect(first.aiStarts).toBe(0);
    expect(second.aiStarts).toBe(1);

    const restoreFirst = registerHostedRuntimeObserver(first.observer);
    const restoreSecond = registerHostedRuntimeObserver(second.observer);
    restoreSecond();
    beginAiUpstream();
    expect(first.aiStarts).toBe(1);
    restoreFirst();
  });

  it('把 duration 归一为非负有限数，并把 rows 归一为安全非负整数', () => {
    const recorder = createRecorder();
    registerHostedRuntimeObserver(recorder.observer);

    for (const durationMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const attempt = beginAiUpstream();
      attempt.recordTtfb(durationMs);
      attempt.finish({ outcome: 'success', durationMs });
    }
    observeD1RoundTrip({
      durationMs: Number.POSITIVE_INFINITY,
      rowsRead: -3.2,
      rowsWritten: 4.9,
      outcome: 'ok',
    });
    observeD1RoundTrip({
      durationMs: 7.5,
      rowsRead: Number.POSITIVE_INFINITY,
      rowsWritten: Number.MAX_VALUE,
      outcome: 'error',
      errorClass: 'timeout',
    });

    expect(recorder.ttfb).toEqual(Array.from({ length: 4 }, () => ({ durationMs: 0 })));
    expect(recorder.finishes).toEqual(Array.from(
      { length: 4 },
      () => ({ outcome: 'success', durationMs: 0 }),
    ));
    expect(recorder.d1).toEqual([
      {
        durationMs: 0,
        rowsRead: 0,
        rowsWritten: 4,
        outcome: 'ok',
        errorClass: 'none',
      },
      {
        durationMs: 7.5,
        rowsRead: 0,
        rowsWritten: Number.MAX_SAFE_INTEGER,
        outcome: 'error',
        errorClass: 'timeout',
      },
    ]);
  });

  it('把运行时非法分类收敛到固定低基数兜底值', () => {
    const recorder = createRecorder();
    registerHostedRuntimeObserver(recorder.observer);

    beginAiUpstream().finish({
      outcome: 'secret-provider' as AiUpstreamFinishObservation['outcome'],
      durationMs: 1,
    });
    observeD1RoundTrip({
      durationMs: 2,
      rowsRead: 0,
      rowsWritten: 0,
      outcome: 'secret-url' as D1RoundTripInput['outcome'],
      errorClass: 'secret-sql' as NonNullable<D1RoundTripInput['errorClass']>,
    });

    expect(recorder.finishes[0]).toEqual({ outcome: 'error', durationMs: 1 });
    expect(recorder.d1[0]).toEqual({
      durationMs: 2,
      rowsRead: 0,
      rowsWritten: 0,
      outcome: 'error',
      errorClass: 'unknown',
    });
  });

  it('默认 no-op 和 reset 后的 no-op 都安全可调用', () => {
    const recorder = createRecorder();
    const unregister = registerHostedRuntimeObserver(recorder.observer);
    resetHostedRuntimeObserverForTests();

    expect(() => {
      const attempt = beginAiUpstream();
      attempt.recordTtfb(1);
      attempt.finish({ outcome: 'success', durationMs: 2 });
      observeD1RoundTrip({
        durationMs: 3,
        rowsRead: 4,
        rowsWritten: 5,
        outcome: 'ok',
      });
      unregister();
    }).not.toThrow();
    expect(recorder.aiStarts).toBe(0);
    expect(recorder.d1).toEqual([]);
  });

  it('公开类型和转发值都不携带 secret/body/url/provider/sql metadata', () => {
    expectTypeOf<keyof AiUpstreamFinishObservation>()
      .toEqualTypeOf<'outcome' | 'durationMs'>();
    expectTypeOf<keyof D1RoundTripInput>()
      .toEqualTypeOf<'durationMs' | 'rowsRead' | 'rowsWritten' | 'outcome' | 'errorClass'>();
    expectTypeOf<keyof D1RoundTripObservation>()
      .toEqualTypeOf<'durationMs' | 'rowsRead' | 'rowsWritten' | 'outcome' | 'errorClass'>();

    const canary = 'hosted-runtime-sensitive-canary';
    const recorder = createRecorder();
    registerHostedRuntimeObserver(recorder.observer);
    const metadata = {
      secret: canary,
      body: canary,
      url: `https://${canary}.invalid`,
      provider: canary,
      sql: `SELECT '${canary}'`,
      credential: canary,
    };

    beginAiUpstream().finish({
      outcome: 'success',
      durationMs: 6,
      ...metadata,
    });
    observeD1RoundTrip({
      durationMs: 7,
      rowsRead: 2,
      rowsWritten: 1,
      outcome: 'ok',
      ...metadata,
    });

    expect(JSON.stringify({ finishes: recorder.finishes, d1: recorder.d1 }))
      .not.toContain(canary);
    expect(recorder.finishes[0]).toEqual({ outcome: 'success', durationMs: 6 });
    expect(recorder.d1[0]).toEqual({
      durationMs: 7,
      rowsRead: 2,
      rowsWritten: 1,
      outcome: 'ok',
      errorClass: 'none',
    });
  });
});
