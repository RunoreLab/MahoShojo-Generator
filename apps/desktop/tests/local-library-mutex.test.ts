import { describe, expect, it, vi } from 'vitest';

import { runMaintenanceExclusive } from '../src/app/local-library-page';

/** 与页面相同的真实互斥计数器：断言锁被获取/释放，而非只断言回调被调用。 */
const lock = () => {
  let held = false;
  return {
    acquire: vi.fn((): boolean => {
      if (held) return false;
      held = true;
      return true;
    }),
    release: vi.fn((): void => {
      held = false;
    }),
    isHeld: () => held,
  };
};

describe('本地库页面级维护互斥（runMaintenanceExclusive）', () => {
  it('互斥已被持有时不执行动作', () => {
    const theLock = lock();
    void theLock.acquire();
    const action = vi.fn();
    runMaintenanceExclusive(theLock.acquire, theLock.release, action, () => false, () => () => {});
    expect(action).not.toHaveBeenCalled();
    expect(theLock.release).not.toHaveBeenCalled();
    expect(theLock.isHeld()).toBe(true);
  });

  it('动作完成后控制器已空闲：立即放锁，不产生订阅', () => {
    const theLock = lock();
    const subscribe = vi.fn(() => () => {});
    runMaintenanceExclusive(theLock.acquire, theLock.release, vi.fn(), () => false, subscribe);
    expect(theLock.release).toHaveBeenCalledTimes(1);
    expect(theLock.isHeld()).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('动作同步抛异常也必须放锁并继续上抛', () => {
    const theLock = lock();
    const failure = new Error('sync failure');
    expect(() =>
      runMaintenanceExclusive(
        theLock.acquire,
        theLock.release,
        () => { throw failure; },
        () => false,
        () => () => {},
      ),
    ).toThrow(failure);
    expect(theLock.release).toHaveBeenCalledTimes(1);
    expect(theLock.isHeld()).toBe(false);
  });

  it('控制器忙碌期间持锁，回到空闲时放锁且退订', () => {
    const theLock = lock();
    let busy = true;
    let listener: (() => void) | null = null;
    const unsubscribe = vi.fn();
    runMaintenanceExclusive(
      theLock.acquire,
      theLock.release,
      vi.fn(),
      () => busy,
      (next) => { listener = next; return unsubscribe; },
    );
    expect(theLock.isHeld()).toBe(true);
    expect(theLock.release).not.toHaveBeenCalled();

    // 忙碌期间的通知不放锁。
    listener!();
    expect(theLock.isHeld()).toBe(true);
    expect(theLock.release).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();

    busy = false;
    listener!();
    expect(theLock.release).toHaveBeenCalledTimes(1);
    expect(theLock.isHeld()).toBe(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    // 退订后即使误触发也不再二次放锁。
    busy = true;
    expect(theLock.release).toHaveBeenCalledTimes(1);
  });
});
