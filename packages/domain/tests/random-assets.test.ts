// content/random-assets 全量条目校验。
//
// generateRandomMagicalGirl/generateRandomCanshou 直接组合素材、不补缺失
// 字段；各宿主对结果的校验沿用生成 Schema（残兽
// `CANSHOU_GENERATION_SCHEMA`、魔法少女 `MAGICAL_GIRL_DETAILS_SCHEMA`，
// 均在 @mahoshojo/ai-core）。任一素材条目缺字段即有小概率产出非法结果
// ——「直升机残兽」缺 `materialAndSkin` 曾致 desktop 快速随机偶发失败。
//
// 组合语义决定了逐条目校验即全量覆盖：每个文件只向组合结果贡献自己负责
// 的字段，且各文件字段互不相交，因此任一组合合法 ⟺ 每条素材各自合法。
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import mgCodenameAppearance from '../../../content/random-assets/magical-girl/codename_appearance.json';
import mgMagicConstruct from '../../../content/random-assets/magical-girl/magicConstruct.json';
import mgWonderlandRule from '../../../content/random-assets/magical-girl/wonderlandRule.json';
import mgBlooming from '../../../content/random-assets/magical-girl/blooming.json';
import mgAnalysis from '../../../content/random-assets/magical-girl/analysis.json';
import canshouNameAppearance from '../../../content/random-assets/canshou/name_appearance.json';
import canshouCore from '../../../content/random-assets/canshou/core.json';
import canshouStage from '../../../content/random-assets/canshou/stage.json';
import canshouAbilities from '../../../content/random-assets/canshou/abilities.json';
import canshouLore from '../../../content/random-assets/canshou/lore.json';

// 与 `CANSHOU_GENERATION_SCHEMA` 必填字段对齐（平铺字符串；额外字段允许，
// 组合时会被后续素材段覆盖）。
const canshouNameAppearanceEntry = z.object({
  name: z.string(),
  appearance: z.string(),
  materialAndSkin: z.string(),
  featuresAndAppendages: z.string(),
});
const canshouCoreEntry = z.object({
  coreConcept: z.string(),
  coreEmotion: z.string(),
});
const canshouStageEntry = z.object({ evolutionStage: z.string() });
const canshouAbilitiesEntry = z.object({
  attackMethod: z.string(),
  specialAbility: z.string(),
});
const canshouLoreEntry = z.object({
  origin: z.string(),
  birthEnvironment: z.string(),
  researcherNotes: z.string(),
});

// 与 `MAGICAL_GIRL_DETAILS_SCHEMA` 各顶层字段对齐。
const mgCodenameAppearanceEntry = z.object({
  codename: z.string(),
  appearance: z.object({
    outfit: z.string(),
    accessories: z.string(),
    colorScheme: z.string(),
    overallLook: z.string(),
  }),
});
const mgMagicConstructEntry = z.object({
  name: z.string(),
  form: z.string(),
  basicAbilities: z.array(z.string()),
  description: z.string(),
});
const mgWonderlandRuleEntry = z.object({
  name: z.string(),
  description: z.string(),
  tendency: z.string(),
  activation: z.string(),
});
const mgBloomingEntry = z.object({
  name: z.string(),
  evolvedAbilities: z.array(z.string()),
  evolvedForm: z.string(),
  evolvedOutfit: z.string(),
  powerLevel: z.string(),
});
const mgAnalysisEntry = z.object({
  personalityAnalysis: z.string(),
  abilityReasoning: z.string(),
  coreTraits: z.array(z.string()),
  predictionBasis: z.string(),
  background: z.object({
    belief: z.string(),
    bonds: z.string(),
  }),
});

const ASSET_CASES: ReadonlyArray<{
  file: string;
  entries: readonly unknown[];
  schema: z.ZodTypeAny;
}> = [
  { file: 'canshou/name_appearance.json', entries: canshouNameAppearance, schema: canshouNameAppearanceEntry },
  { file: 'canshou/core.json', entries: canshouCore, schema: canshouCoreEntry },
  { file: 'canshou/stage.json', entries: canshouStage, schema: canshouStageEntry },
  { file: 'canshou/abilities.json', entries: canshouAbilities, schema: canshouAbilitiesEntry },
  { file: 'canshou/lore.json', entries: canshouLore, schema: canshouLoreEntry },
  { file: 'magical-girl/codename_appearance.json', entries: mgCodenameAppearance, schema: mgCodenameAppearanceEntry },
  { file: 'magical-girl/magicConstruct.json', entries: mgMagicConstruct, schema: mgMagicConstructEntry },
  { file: 'magical-girl/wonderlandRule.json', entries: mgWonderlandRule, schema: mgWonderlandRuleEntry },
  { file: 'magical-girl/blooming.json', entries: mgBlooming, schema: mgBloomingEntry },
  { file: 'magical-girl/analysis.json', entries: mgAnalysis, schema: mgAnalysisEntry },
];

describe('content/random-assets 素材条目', () => {
  for (const { file, entries, schema } of ASSET_CASES) {
    it(`${file} 每条素材都携带本段必填字段`, () => {
      expect(entries.length, `${file} 为空素材库`).toBeGreaterThan(0);
      entries.forEach((entry, index) => {
        const parsed = schema.safeParse(entry);
        expect(
          parsed.success,
          `${file} 第 ${index + 1} 条不合法：${parsed.success ? '' : parsed.error.message}`,
        ).toBe(true);
      });
    });
  }
});
