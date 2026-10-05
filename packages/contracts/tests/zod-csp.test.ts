import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFunction = globalThis.Function;

afterEach(() => {
  Object.defineProperty(globalThis, 'Function', {
    configurable: true,
    writable: true,
    value: originalFunction,
  });
  vi.resetModules();
});

describe('Zod CSP compatibility', () => {
  it('constructs and parses shared schemas without Function constructor evaluation', async () => {
    const blockedFunction = vi.fn(() => {
      throw new Error('CSP_EVAL_BLOCKED');
    });
    Object.defineProperty(globalThis, 'Function', {
      configurable: true,
      writable: true,
      value: blockedFunction,
    });
    vi.resetModules();

    const [{ z }, { OnlineDataCardTypeSchema }] = await Promise.all([
      import('../src/zod'),
      import('../src/data-cards'),
    ]);

    expect(z.config()).toMatchObject({ jitless: true });
    expect(OnlineDataCardTypeSchema.safeParse('character')).toMatchObject({ success: true });
    expect(blockedFunction).not.toHaveBeenCalled();
  });
});
