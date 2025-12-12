import { z } from 'zod';

export const MagicalGirlSchema = z
  .object({
    codename: z.string().min(1, '缺少 codename 字段'),
    appearance: z.object({
      outfit: z.string().min(1, '缺少 appearance.outfit'),
      accessories: z.string().min(1, '缺少 appearance.accessories'),
      colorScheme: z.string().min(1, '缺少 appearance.colorScheme'),
      overallLook: z.string().min(1, '缺少 appearance.overallLook'),
    }),
    magicConstruct: z.object({
      name: z.string().min(1, '缺少 magicConstruct.name'),
      form: z.string().min(1, '缺少 magicConstruct.form'),
      basicAbilities: z.string().min(1, '缺少 magicConstruct.basicAbilities'),
      description: z.string().min(1, '缺少 magicConstruct.description'),
    }),
    wonderlandRule: z.object({
      name: z.string().min(1, '缺少 wonderlandRule.name'),
      description: z.string().min(1, '缺少 wonderlandRule.description'),
      tendency: z.string().min(1, '缺少 wonderlandRule.tendency'),
      activation: z.string().min(1, '缺少 wonderlandRule.activation'),
    }),
    blooming: z.object({
      name: z.string().min(1, '缺少 blooming.name'),
      evolvedAbilities: z.string().min(1, '缺少 blooming.evolvedAbilities'),
      evolvedForm: z.string().min(1, '缺少 blooming.evolvedForm'),
      evolvedOutfit: z.string().min(1, '缺少 blooming.evolvedOutfit'),
      powerLevel: z.string().min(1, '缺少 blooming.powerLevel'),
    }),
    analysis: z.object({
      personalityAnalysis: z.string().min(1, '缺少 analysis.personalityAnalysis'),
      abilityReasoning: z.string().min(1, '缺少 analysis.abilityReasoning'),
      coreTraits: z.string().min(1, '缺少 analysis.coreTraits'),
      predictionBasis: z.string().min(1, '缺少 analysis.predictionBasis'),
    }),
  })
  .passthrough();

export const CanshouSchema = z
  .object({
    name: z.string().min(1, '缺少 name'),
    coreConcept: z.string().min(1, '缺少 coreConcept'),
    coreEmotion: z.string().min(1, '缺少 coreEmotion'),
    evolutionStage: z.string().min(1, '缺少 evolutionStage'),
    appearance: z.string().min(1, '缺少 appearance'),
    materialAndSkin: z.string().min(1, '缺少 materialAndSkin'),
    featuresAndAppendages: z.string().min(1, '缺少 featuresAndAppendages'),
    attackMethod: z.string().min(1, '缺少 attackMethod'),
    specialAbility: z.string().min(1, '缺少 specialAbility'),
    origin: z.string().min(1, '缺少 origin'),
    birthEnvironment: z.string().min(1, '缺少 birthEnvironment'),
    researcherNotes: z.string().min(1, '缺少 researcherNotes'),
  })
  .passthrough();

export const ScenarioSchema = z
  .object({
    title: z.string().min(1, '缺少 title'),
    elements: z.any(),
  })
  .passthrough();

export const BattleSettingsSchema = z.object({
  readArenaHistory: z.boolean(),
  readArenaHistoryLimit: z.number().min(1).max(999),
  isArenaHistoryUnlimited: z.boolean(),
  writeArenaHistory: z.boolean(),
  readCurrentState: z.boolean(),
  writeCurrentState: z.boolean(),
});

export const StoryPreferencesSchema = z.object({
  selectedLevel: z.string(),
  selectedLanguage: z.string().min(1, '请选择语言'),
  userGuidance: z.string().max(50, '提示语不应超过 50 字').optional(),
});

export type BattleSettingsFormValues = z.infer<typeof BattleSettingsSchema>;
export type StoryPreferencesFormValues = z.infer<typeof StoryPreferencesSchema>;
