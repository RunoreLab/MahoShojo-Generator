import { describe, expect, it } from 'vitest';

import { applyPostBattleUpdates } from '@/lib/arena/service';

describe('Arena post-battle generation idempotency', () => {
  it('does not append history or rewrite current state twice for one generation', async () => {
    const combatants = [{
      type: 'magical-girl',
      isNative: false,
      data: { name: 'A', templateId: 'magical-girl' },
    }];
    const report = {
      headline: '终局战报',
      mode: 'daily',
      officialReport: { winner: 'A' },
    } as never;
    const impacts = [{
      characterName: 'A',
      impact: '成长',
      currentStateSummary: '平静',
    }];
    const options = {
      writeArenaHistory: true,
      writeCurrentState: true,
      generationId: 'generation-1',
      baseRevisionHash: 'a'.repeat(64),
    };

    const first = await applyPostBattleUpdates(combatants, report, impacts, null, null, options);
    const second = await applyPostBattleUpdates([
      { ...combatants[0], data: first[0] },
    ], report, impacts, null, null, options);

    expect(first[0].arena_history.entries).toHaveLength(1);
    expect(first[0].arena_history.entries[0].metadata.generation_id).toBe('generation-1');
    expect(first[0].arena_history.entries[0].metadata.base_revision_hash).toBe('a'.repeat(64));
    expect(first[0].current_state.generation_id).toBe('generation-1');
    expect(first[0].current_state.base_revision_hash).toBe('a'.repeat(64));
    expect(second).toEqual([]);
  });
});
