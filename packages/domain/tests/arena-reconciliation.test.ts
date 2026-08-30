import { describe, expect, it } from 'vitest';

import { hashArenaCombatantBaseRevision } from '../src/arena-reconciliation';

describe('Arena local-card base revision hash', () => {
  it('is stable across object key order and ignores transport-only combatant fields', async () => {
    const left = [{
      type: 'magical-girl',
      data: { name: 'A', level: 2 },
      isNative: true,
      isPreset: false,
      characterGuidance: null,
      sourceDataCardId: 'transport-only',
    }];
    const right = [{
      characterGuidance: null,
      isPreset: false,
      isNative: true,
      data: { level: 2, name: 'A' },
      type: 'magical-girl',
      filename: 'transport-only',
    }];

    await expect(hashArenaCombatantBaseRevision(left)).resolves.toBe(
      await hashArenaCombatantBaseRevision(right),
    );
  });

  it('changes when local card content changes', async () => {
    const before = [{ type: 'general-character', data: { name: 'A', state: 'before' } }];
    const after = [{ type: 'general-character', data: { name: 'A', state: 'after' } }];

    expect(await hashArenaCombatantBaseRevision(before)).not.toBe(
      await hashArenaCombatantBaseRevision(after),
    );
  });
});
