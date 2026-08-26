import { describe, expect, it } from 'vitest';
import { selectHostedDrRuntime } from '../src/hosted-dr';

describe('Hosted DR runtime selector', () => {
  it('把尚未 dispatch 的 safe read 在 primary unavailable 时交给 Next DR', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'safe-read',
      dispatchState: 'not-dispatched',
      primaryHealth: 'unavailable',
      hasDurableIdempotencyProof: false,
    })).toBe('next-dr');
  });

  it('只让带 durable proof 的幂等命令在 primary unavailable 时进入 Next DR', () => {
    const input = {
      requestClass: 'durably-idempotent-command' as const,
      dispatchState: 'not-dispatched' as const,
      primaryHealth: 'unavailable' as const,
    };

    expect(selectHostedDrRuntime({
      ...input,
      hasDurableIdempotencyProof: true,
    })).toBe('next-dr');
    expect(selectHostedDrRuntime({
      ...input,
      hasDurableIdempotencyProof: false,
    })).toBe('fail-closed');
  });

  it('允许控制面把尚未 dispatch 的非幂等新 operation 直接选择到 Next DR', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'not-dispatched',
      primaryHealth: 'unavailable',
      hasDurableIdempotencyProof: false,
    })).toBe('next-dr');
  });

  it.each(['dispatched', 'unknown'] as const)(
    '对 %s 的非幂等 operation fail closed，禁止透明第二次 POST',
    (dispatchState) => {
      expect(selectHostedDrRuntime({
        requestClass: 'non-idempotent-operation',
        dispatchState,
        primaryHealth: 'unavailable',
        hasDurableIdempotencyProof: false,
      })).toBe('fail-closed');
    },
  );

  it('primary 健康时只把后续未 dispatch 请求交给 Hono，不改变既有请求的决定', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'not-dispatched',
      primaryHealth: 'healthy',
      hasDurableIdempotencyProof: false,
    })).toBe('hono-primary');
    expect(selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'unknown',
      primaryHealth: 'healthy',
      hasDurableIdempotencyProof: false,
    })).toBe('fail-closed');
  });

  it('primary 健康状态不明确时 fail closed', () => {
    expect(selectHostedDrRuntime({
      requestClass: 'safe-read',
      dispatchState: 'not-dispatched',
      primaryHealth: 'unknown',
      hasDurableIdempotencyProof: false,
    })).toBe('fail-closed');
  });
});
