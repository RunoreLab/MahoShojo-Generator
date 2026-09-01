import { describe, expect, it, vi } from 'vitest';

import { runArenaGenerationEffectOnce } from '@/lib/arena/generation-effect-ledger';

describe('Arena generation effect in-flight coalescing', () => {
  it('同 generation 的并发 effect 在页面进程内合并', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const effect = vi.fn(async () => {
      await gate;
      return { updatedCombatants: [{ combatantIndex: 0, data: { name: 'A' } }] };
    });

    const first = runArenaGenerationEffectOnce({ generationId: 'generation-1', effect });
    const second = runArenaGenerationEffectOnce({ generationId: 'generation-1', effect });
    release();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('完成后不永久缓存 response，变化 roster 的 retry 会重新请求服务端', async () => {
    const effect = vi.fn(async () => ({ call: effect.mock.calls.length }));

    await runArenaGenerationEffectOnce({ generationId: 'generation-1', effect });
    await runArenaGenerationEffectOnce({ generationId: 'generation-1', effect });

    expect(effect).toHaveBeenCalledTimes(2);
  });
});
