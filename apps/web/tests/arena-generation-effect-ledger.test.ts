import { describe, expect, it, vi } from 'vitest';

import {
  ARENA_GENERATION_EFFECT_LEDGER_KEY,
  runArenaGenerationEffectOnce,
} from '@/lib/arena/generation-effect-ledger';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('Arena generation effect ledger', () => {
  const baseA = 'a'.repeat(64);
  const baseB = 'b'.repeat(64);

  it('keeps multiple generations so an older resumed terminal does not repeat effects', async () => {
    const storage = new MemoryStorage();
    const effect = vi.fn(async (generationId: string) => ({ generationId, signed: true }));

    await runArenaGenerationEffectOnce({
      generationId: 'generation-1', baseRevisionHash: baseA,
      storage, effect: () => effect('generation-1'),
    });
    await runArenaGenerationEffectOnce({
      generationId: 'generation-2', baseRevisionHash: baseB,
      storage, effect: () => effect('generation-2'),
    });
    await expect(runArenaGenerationEffectOnce({
      generationId: 'generation-1', baseRevisionHash: baseA,
      storage, effect: () => effect('generation-1'),
    })).resolves.toEqual({ generationId: 'generation-1', signed: true });

    expect(effect).toHaveBeenCalledTimes(2);
    expect(JSON.parse(storage.getItem(ARENA_GENERATION_EFFECT_LEDGER_KEY)!)).toMatchObject({
      version: 2,
      entries: {
        [`generation-1:${baseA}`]: { result: { generationId: 'generation-1', signed: true } },
        [`generation-2:${baseB}`]: { result: { generationId: 'generation-2', signed: true } },
      },
    });
  });

  it('coalesces concurrent same-generation effects even without Web Locks', async () => {
    const storage = new MemoryStorage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const effect = vi.fn(async () => {
      await gate;
      return { updatedCombatants: [{ name: 'A' }] };
    });

    const first = runArenaGenerationEffectOnce({
      generationId: 'generation-1', baseRevisionHash: baseA, storage, effect,
    });
    const second = runArenaGenerationEffectOnce({
      generationId: 'generation-1', baseRevisionHash: baseA, storage, effect,
    });
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { updatedCombatants: [{ name: 'A' }] },
      { updatedCombatants: [{ name: 'A' }] },
    ]);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a cached local result for a different card base revision', async () => {
    const storage = new MemoryStorage();
    const effect = vi.fn(async () => ({ call: effect.mock.calls.length }));

    await runArenaGenerationEffectOnce({
      generationId: 'generation-1', baseRevisionHash: baseA, storage, effect,
    });
    await runArenaGenerationEffectOnce({
      generationId: 'generation-1', baseRevisionHash: baseB, storage, effect,
    });

    expect(effect).toHaveBeenCalledTimes(2);
  });
});
