import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOVELAI_SETTINGS, NOVELAI_MODELS, NOVELAI_SIZES,
  parseNovelAISettings, getNovelAIPromptProfile, buildNovelAIPromptRewriteInstruction,
  type NovelAISettings,
} from '../src/novelai';

describe('NovelAI 非秘密参数', () => {
  it('保留现有默认值、Curated 选项与尺寸，不把宿主 Base URL 放进解析结果', () => {
    expect(NOVELAI_MODELS).toEqual(['nai-diffusion-4-5-curated', 'nai-diffusion-5-curated']);
    expect(NOVELAI_SIZES).toEqual(['832x1216', '1216x832', '1024x1024']);
    const settings = { ...DEFAULT_NOVELAI_SETTINGS, baseUrl: 'host-owned' };
    const parsed = parseNovelAISettings(settings);
    expect(parsed).toMatchObject({ model: NOVELAI_MODELS[0], size: NOVELAI_SIZES[0], steps: 28, scale: 7, seed: '' });
    expect(parsed.negativePrompt).toBe(DEFAULT_NOVELAI_SETTINGS.negativePrompt);
    expect(parsed).not.toHaveProperty('baseUrl');
    expect(settings.baseUrl).toBe('host-owned');
  });

  it.each(['', '   ', '0', ' 42 ', '00042', '4294967295'])('种子 %j 只沿用 trim，不补随机数或改写数字串', (seed) => {
    const settings = { ...DEFAULT_NOVELAI_SETTINGS, seed };
    expect(parseNovelAISettings(settings).seed).toBe(seed.trim());
    expect(settings.seed).toBe(seed);
  });

  it.each([
    { steps: 1, scale: 0 }, { steps: 50, scale: 10 }, { scale: 0.1 },
    { negativePrompt: 'x'.repeat(20_000) },
  ])('接受原有有效边界', (patch) => {
    const settings = { ...DEFAULT_NOVELAI_SETTINGS, ...patch };
    expect(parseNovelAISettings(settings)).toMatchObject(patch);
  });

  it('负面提示词保留原始空白，修剪仍由请求 adapter 完成', () => {
    expect(parseNovelAISettings({ ...DEFAULT_NOVELAI_SETTINGS, negativePrompt: '  lowres\n' }).negativePrompt).toBe('  lowres\n');
  });

  it.each([
    { model: 'nai-diffusion-5-full' }, { size: '512x512' },
    { steps: NaN }, { steps: 0 }, { steps: 51 }, { steps: 1.5 }, { steps: '28' },
    { scale: NaN }, { scale: -0.1 }, { scale: 10.1 }, { scale: Infinity }, { scale: '0' },
    { seed: '-1' }, { seed: '1.5' }, { seed: '1e2' }, { seed: '4294967296' },
    { negativePrompt: 'x'.repeat(20_001) },
  ])('拒绝非法参数且不静默回退默认值', (patch) => {
    expect(() => parseNovelAISettings({ ...DEFAULT_NOVELAI_SETTINGS, ...patch } as NovelAISettings))
      .toThrow('请检查 NovelAI 参数：步数 1–50，强度 0–10，种子留空或填写 0–4294967295 的整数');
  });
});

describe('NovelAI 纯 Prompt 指令', () => {
  it.each(NOVELAI_MODELS)('按 %s 的原有预算构造指令，质量词仍须显式启用', (model) => {
    const profile = getNovelAIPromptProfile(model)!;
    const plain = buildNovelAIPromptRewriteInstruction(model);
    expect(plain).toContain(profile.guidance);
    expect(plain).toContain(`up to ${profile.textCharacterLimit} rendered text characters`);
    expect(plain).toContain('Artist preservation');
    expect(plain).toContain('FIRST and ONLY response');
    expect(buildNovelAIPromptRewriteInstruction(model, { requirements: '只修改披风' })).toBe(plain);
    expect(buildNovelAIPromptRewriteInstruction(model, { addQualityTags: true })).toContain(profile.quality);
  });

  it.each(['unknown', '__proto__', 'constructor'])('未知模型 %s 不回退到另一个模型', (model) => {
    expect(getNovelAIPromptProfile(model)).toBeUndefined();
    expect(() => buildNovelAIPromptRewriteInstruction(model)).toThrow('V4.5 Curated / V5 Curated');
  });
});
