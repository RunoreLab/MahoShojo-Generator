import { describe, expect, it } from 'vitest';

import { inferTemplate } from '@/lib/data-card-converter';
import { resolveArenaDataCardTemplate } from '@/components/arena/utils/data-card-template';

describe('Arena data card template resolution', () => {
  it('uses the database scenario type when an irregular scenario is structurally unknown', () => {
    const irregularScenario = {
      templateId: '通用情景',
      title: '回合制战斗',
      arena: { combatants: [] },
    };

    expect(inferTemplate(irregularScenario)).toBe('unknown');
    expect(resolveArenaDataCardTemplate(irregularScenario, 'scenario')).toBe('scenario');
  });

  it('keeps structural inference authoritative for recognized content', () => {
    const character = { codename: '星辉' };

    expect(resolveArenaDataCardTemplate(character, 'scenario')).toBe('magical-girl');
  });

  it('does not treat unknown non-scenario cards as scenarios', () => {
    expect(resolveArenaDataCardTemplate({ arbitrary: true }, 'character')).toBe('unknown');
  });
});
