import { describe, expect, test } from 'bun:test';

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
});
