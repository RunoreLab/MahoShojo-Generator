import { describe, expect, test } from 'bun:test';

import { CREATOR_TEMPLATE_IDS, isCreatorStreamTemplate } from '@/lib/creator/templates';
import { loadBuildRulePresetById, loadBuildRulePresetIndex } from '@/lib/creator/build-rules';

describe('creator build rules', () => {
  test('template list and stream detection stay stable', () => {
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

  test('presets index and data load via static JSON', () => {
    const index = loadBuildRulePresetIndex();
    expect(index.some((preset) => preset.id === 'arena-trpg-lite')).toBe(true);

    const preset = loadBuildRulePresetById('arena-trpg-lite');
    expect(preset.supportedTemplates).toEqual(['general', 'magical-girl']);
    expect(typeof preset.allowStandalone).toBe('boolean');
    expect(preset.projectionPolicy).toBe('primary-structured');
    expect(preset.mainRuleEligible).toBe(true);
    expect(
      preset.blocks.some((block) => block.id === 'powerLevel/select' && block.type === 'select')
    ).toBe(true);
    expect(
      preset.blocks.some(
        (block) => block.id === 'coreAttributes/point-buy' && block.type === 'point-buy'
      )
    ).toBe(true);
    expect(
      preset.blocks.some(
        (block) => block.id === 'specialties/multi-select' && block.type === 'multi-select'
      )
    ).toBe(true);
    expect(
      preset.blocks.some(
        (block) => block.id === 'derivedStats/derived' && block.type === 'derived'
      )
    ).toBe(true);
    expect(
      preset.blocks.some((block) => block.id === 'ruleNotice/section' && block.type === 'section')
    ).toBe(true);
  });

  test('loads throw when preset missing', () => {
    expect(() => loadBuildRulePresetById('missing-id')).toThrow(
      /Build rule preset "missing-id" is not available/
    );
  });
});
