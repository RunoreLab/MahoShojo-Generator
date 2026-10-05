import { describe, expect, it } from 'vitest';

import { materializeRandomCombatants } from '@/components/arena/hooks/useBattleActions';

describe('Arena random combatant origin trust', () => {
  it('本地随机生成角色未经来源验签时不标记为原生', () => {
    const combatants = materializeRandomCombatants([{
      type: 'random-magical-girl',
      id: 'random-magical-girl-1',
      filename: '随机魔法少女',
      teamId: 7,
    }, {
      type: 'random-canshou',
      id: 'random-canshou-1',
      filename: '随机残兽',
      teamId: 8,
    }]);

    expect(combatants).toHaveLength(2);
    expect(combatants).toEqual([
      expect.objectContaining({
        type: 'magical-girl',
        isValid: false,
        isPreset: false,
        teamId: 7,
      }),
      expect.objectContaining({
        type: 'canshou',
        isValid: false,
        isPreset: false,
        teamId: 8,
      }),
    ]);
  });
});
