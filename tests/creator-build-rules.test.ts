import { describe, expect, test } from 'bun:test';

import { loadBuildRulePresetById, loadBuildRulePresetIndex } from '@/lib/creator/build-rules';
import {
  CREATOR_TEMPLATE_IDS,
  isCreatorStreamTemplate,
  isCreatorTemplateSupportedInGenerationMode,
} from '@/lib/creator/templates';

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
    expect(isCreatorTemplateSupportedInGenerationMode('non-stream', 'magical-girl')).toBe(true);
    expect(isCreatorTemplateSupportedInGenerationMode('non-stream', 'canshou')).toBe(true);
    expect(isCreatorTemplateSupportedInGenerationMode('non-stream', 'general')).toBe(false);
  });

  test('arena-trpg-lite 出现在规则预设索引中', async () => {
    const index = await loadBuildRulePresetIndex();
    expect(index.some((item) => item.id === 'arena-trpg-lite')).toBe(true);
  });

  test('arena-trpg-lite 支持 general / magical-girl / canshou 且声明 primary-structured', async () => {
    const preset = await loadBuildRulePresetById('arena-trpg-lite');
    expect(preset.supportedTemplates).toEqual(['general', 'magical-girl', 'canshou']);
    expect(preset.projectionPolicy).toBe('primary-structured');
    expect(preset.allowStandalone).toBe(true);
    expect(preset.mainRuleEligible).toBe(true);
  });

  test('三套规则预设都声明支持 canshou 模板', () => {
    expect(loadBuildRulePresetById('arena-trpg-lite').supportedTemplates).toContain('canshou');
    expect(loadBuildRulePresetById('dnd-5e-lite').supportedTemplates).toContain('canshou');
    expect(loadBuildRulePresetById('coc-7e-lite').supportedTemplates).toContain('canshou');
  });

  test('规则索引包含 arena / dnd / coc / 无限恐怖FXv137 四套预设', () => {
    const index = loadBuildRulePresetIndex();

    expect(index.map((item) => item.id)).toEqual([
      'arena-trpg-lite',
      'dnd-5e-lite',
      'coc-7e-lite',
      'wuxiankongbu-fx-v137',
    ]);
  });

  test('dnd-5e-lite 声明 stat-array 与 number-group block', () => {
    const preset = loadBuildRulePresetById('dnd-5e-lite');

    expect(preset.blocks.some((block) => block.type === 'stat-array')).toBe(true);
    expect(preset.blocks.some((block) => block.type === 'number-group')).toBe(true);
  });

  test('coc-7e-lite 声明 occupation 与 derivedStats block', () => {
    const preset = loadBuildRulePresetById('coc-7e-lite');

    expect(preset.blocks.some((block) => block.id === 'occupation')).toBe(true);
    expect(preset.blocks.some((block) => block.id === 'derivedStats')).toBe(true);
  });

  test('wuxiankongbu-fx-v137 声明九项属性、十二项技能与专长 block', () => {
    const preset = loadBuildRulePresetById('wuxiankongbu-fx-v137');
    const attributes = preset.blocks.find((block) => block.id === 'coreAttributes');
    const skills = preset.blocks.find((block) => block.id === 'skills');

    expect(attributes?.type).toBe('stat-array');
    expect(attributes?.fields?.map((field) => field.id)).toEqual([
      'INT',
      'PER',
      'RES',
      'STR',
      'DEX',
      'STA',
      'PRE',
      'MAN',
      'COM',
    ]);
    expect(skills?.type).toBe('stat-array');
    expect(skills?.fields).toHaveLength(12);
    expect(preset.blocks.some((block) => block.id === 'specialties')).toBe(true);
  });

  test('arena-trpg-lite 的力量层级选项带有预算 meta', () => {
    const preset = loadBuildRulePresetById('arena-trpg-lite');
    const powerLevelBlock = preset.blocks.find((block) => block.id === 'powerLevel');
    const seedOption = powerLevelBlock?.options?.find((option) => option.value === 'seed');

    expect(seedOption?.meta).toEqual({
      attributePoints: 280,
      specialtyPoints: 4,
    });
  });
});
