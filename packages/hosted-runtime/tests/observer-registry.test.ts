import { describe, expect, it } from 'vitest';

import { ObserverRegistry } from '../src/observer-registry';

describe('ObserverRegistry', () => {
  it('多轮非 LIFO 撤销会立即移除 entry，且保持最新有效 observer', () => {
    const registry = new ObserverRegistry<object>();
    const first = { id: 'first' };
    const middle = { id: 'middle' };
    const latest = { id: 'latest' };
    const unregisterFirst = registry.register(first);
    const unregisterMiddle = registry.register(middle);
    const unregisterLatest = registry.register(latest);

    unregisterMiddle();
    expect(registry.size).toBe(2);
    expect(registry.current()).toBe(latest);

    for (let cycle = 0; cycle < 20; cycle += 1) {
      const olderTransient = { cycle, order: 'older' };
      const newerTransient = { cycle, order: 'newer' };
      const unregisterOlder = registry.register(olderTransient);
      const unregisterNewer = registry.register(newerTransient);

      unregisterOlder();
      expect(registry.size).toBe(3);
      expect(registry.current()).toBe(newerTransient);

      unregisterNewer();
      expect(registry.size).toBe(2);
      expect(registry.current()).toBe(latest);
    }

    unregisterLatest();
    expect(registry.size).toBe(1);
    expect(registry.current()).toBe(first);
    unregisterFirst();
    expect(registry.size).toBe(0);
    expect(registry.current()).toBeUndefined();
  });

  it('clear 后旧 unregister 不会移除后续的新注册', () => {
    const registry = new ObserverRegistry<object>();
    const unregisterOld = registry.register({ id: 'old' });
    registry.clear();
    const current = { id: 'current' };
    registry.register(current);

    unregisterOld();

    expect(registry.size).toBe(1);
    expect(registry.current()).toBe(current);
  });
});
