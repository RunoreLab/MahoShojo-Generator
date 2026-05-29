import { describe, expect, test } from 'vitest';

import { buildStreamTextAbortOptions } from '@/lib/stream/raw-ai';

describe('stream/raw-ai abort options', () => {
  test('buildStreamTextAbortOptions 只在收到 signal 时传递 abortSignal', () => {
    const controller = new AbortController();

    expect(buildStreamTextAbortOptions(undefined)).toEqual({});
    expect(buildStreamTextAbortOptions(controller.signal)).toEqual({ abortSignal: controller.signal });
  });
});
