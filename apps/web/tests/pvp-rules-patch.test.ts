import { describe, expect, test } from 'vitest';

import { buildPvpScenarioRulesPatch } from '@/lib/pvp/rules-patch';

describe('buildPvpScenarioRulesPatch', () => {
  test('情景模式下保存情景会包含 mode=scenario', () => {
    const patch = buildPvpScenarioRulesPatch({
      mode: 'scenario',
      selection: {
        kind: 'data_card',
        id: 'card_1',
        updatedAt: '2025-01-01T00:00:00.000Z',
        name: '八角笼',
        isPublic: true,
        author: 'alice',
      },
    });

    expect(patch).toMatchObject({
      mode: 'scenario',
      _scenario: {
        kind: 'data_card',
        id: 'card_1',
      },
    });
  });

  test('非情景模式下仅保存 _scenario（不强制切换模式）', () => {
    const patch = buildPvpScenarioRulesPatch({
      mode: 'classic',
      selection: {
        kind: 'data_card',
        id: 'card_2',
        updatedAt: null,
        name: '某情景',
        isPublic: true,
        author: null,
      },
    });

    expect(patch).toMatchObject({
      _scenario: { kind: 'data_card', id: 'card_2' },
    });
    expect('mode' in patch).toBe(false);
  });

  test('清空情景会显式发送 _scenario=null', () => {
    const patch = buildPvpScenarioRulesPatch({ mode: 'scenario', selection: null });
    expect(patch).toEqual({ mode: 'scenario', _scenario: null });
  });
});

