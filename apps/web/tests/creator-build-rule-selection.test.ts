import { describe, expect, test } from 'vitest';

import { reconcileCreatorBuildRuleSelection } from '@/lib/creator/build-rule-selection';

describe('creator build-rule selection', () => {
  test('切到 general-scenario 时会剔除不兼容的默认规则', () => {
    const result = reconcileCreatorBuildRuleSelection({
      template: 'general-scenario',
      selectedRuleIds: ['arena-trpg-lite'],
      primaryRuleId: 'arena-trpg-lite',
    });

    expect(result.selectedRuleIds).toEqual([]);
    expect(result.primaryRuleId).toBeNull();
  });

  test('兼容模板时保留已选规则与主规则', () => {
    const result = reconcileCreatorBuildRuleSelection({
      template: 'general',
      selectedRuleIds: ['arena-trpg-lite'],
      primaryRuleId: 'arena-trpg-lite',
    });

    expect(result.selectedRuleIds).toEqual(['arena-trpg-lite']);
    expect(result.primaryRuleId).toBe('arena-trpg-lite');
  });

  test('切到 canshou 时保留兼容的预设规则', () => {
    const result = reconcileCreatorBuildRuleSelection({
      template: 'canshou',
      selectedRuleIds: ['dnd-5e-lite', 'coc-7e-lite'],
      primaryRuleId: 'coc-7e-lite',
    });

    expect(result.selectedRuleIds).toEqual(['dnd-5e-lite', 'coc-7e-lite']);
    expect(result.primaryRuleId).toBe('coc-7e-lite');
  });
});
