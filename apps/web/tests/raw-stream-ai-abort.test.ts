import { describe, expect, test } from 'vitest';

import {
  buildStreamTextAbortOptions,
  classifyStreamRuntimeOutcome,
} from '@/lib/stream/raw-ai';

describe('stream/raw-ai abort options', () => {
  test('buildStreamTextAbortOptions 只在收到 signal 时传递 abortSignal', () => {
    const controller = new AbortController();

    expect(buildStreamTextAbortOptions(undefined)).toEqual({});
    expect(buildStreamTextAbortOptions(controller.signal)).toEqual({ abortSignal: controller.signal });
  });

  test('consumer cancel 没有 reason 时按 aborted 终态计数', () => {
    expect(classifyStreamRuntimeOutcome(undefined)).toBe('aborted');
    expect(classifyStreamRuntimeOutcome(null)).toBe('aborted');
    expect(classifyStreamRuntimeOutcome(new Error('timeout'))).toBe('timeout');
  });
});
