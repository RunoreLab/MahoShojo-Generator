import { describe, expect, test } from 'bun:test';

import { loadBuildRulePresetById, loadBuildRulePresetIndex } from '@/lib/creator/build-rules';
import { CREATOR_TEMPLATE_IDS, isCreatorStreamTemplate } from '@/lib/creator/templates';

describe('creator build rules', () => {
  test('creator 模板枚举与 stream 边界固定', () => {
    expect(CREATOR_TEMPLATE_IDS).toEqual([
      'magical-girl',
      'canshou',
      'general',
      'scenario',
      'general-scenario',
    ]);
    expect(isCreatorStreamTemplate('general')).toBe(true);
    expect(isCreatorStreamTemplate('scenario')).toBe(false);
  });

  test('arena-trpg-lite 出现在规则预设索引中', async () => {
    const index = await loadBuildRulePresetIndex();
    expect(index.some((item) => item.id === 'arena-trpg-lite')).toBe(true);
  });

  test('arena-trpg-lite 只支持 general / magical-girl 且声明 primary-structured', async () => {
    const preset = await loadBuildRulePresetById('arena-trpg-lite');
    expect(preset.supportedTemplates).toEqual(['general', 'magical-girl']);
    expect(preset.projectionPolicy).toBe('primary-structured');
    expect(preset.allowStandalone).toBe(true);
    expect(preset.mainRuleEligible).toBe(true);
  });
});
