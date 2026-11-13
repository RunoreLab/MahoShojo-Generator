import { ARENA_MAGICAL_GIRL_RULES } from '../arena-generation/prompt';
import { NARRATIVE_MODE_STYLES } from '../narrative-rules';
import { buildArenaDefaultScenario, buildArenaWorldbook } from '@mahoshojo/domain/tavern-card/worldbook';
import type { TavernCharacterBook } from '@mahoshojo/domain/tavern-card/worldbook';
import type { MagicTeaPartyChoiceCount, MagicTeaPartyPreferences, MagicTeaPartySession } from '@mahoshojo/domain/magic-tea-party/types';

export type MagicTeaPartyPresetId = 'arena-classic' | 'arena-kizuna' | 'arena-daily';

export type MagicTeaPartyPreset = {
  id: MagicTeaPartyPresetId;
  title: string;
  description: string;
  systemPrompt: string;
  worldbookPresetId: 'arena-core';
  worldbook: TavernCharacterBook;
  defaultScenario: { title: string; content: string };
  defaultSettings: {
    outputFormat: 'jsonl' | 'markdown';
    enableChoices: boolean;
    choiceCount: MagicTeaPartyChoiceCount;
  };
};

export const MAGIC_TEA_PARTY_PRESETS: MagicTeaPartyPreset[] = [
  {
    id: 'arena-classic',
    title: '经典战报',
    description: '复刻竞技场经典战报口吻，偏叙事。',
    systemPrompt: `${NARRATIVE_MODE_STYLES.classic}\n\n${ARENA_MAGICAL_GIRL_RULES}`,
    worldbookPresetId: 'arena-core',
    worldbook: buildArenaWorldbook({ includeCore: true }),
    defaultScenario: { title: 'A.R.E.N.A.', content: buildArenaDefaultScenario() },
    defaultSettings: { outputFormat: 'jsonl', enableChoices: true, choiceCount: 3 },
  },
  {
    id: 'arena-kizuna',
    title: '羁绊战报',
    description: '更强调感情与羁绊的战斗故事。',
    systemPrompt: NARRATIVE_MODE_STYLES.kizuna,
    worldbookPresetId: 'arena-core',
    worldbook: buildArenaWorldbook({ includeCore: true }),
    defaultScenario: { title: 'A.R.E.N.A.', content: buildArenaDefaultScenario() },
    defaultSettings: { outputFormat: 'jsonl', enableChoices: true, choiceCount: 3 },
  },
  {
    id: 'arena-daily',
    title: '日常互动',
    description: '偏日常互动的轻量模式。',
    systemPrompt: NARRATIVE_MODE_STYLES.daily,
    worldbookPresetId: 'arena-core',
    worldbook: buildArenaWorldbook({ includeCore: true }),
    defaultScenario: { title: 'A.R.E.N.A.', content: buildArenaDefaultScenario() },
    defaultSettings: { outputFormat: 'jsonl', enableChoices: true, choiceCount: 4 },
  },
];

export const getMagicTeaPartyPreset = (id: string | null | undefined): MagicTeaPartyPreset | null => {
  const needle = typeof id === 'string' ? id.trim() : '';
  if (!needle) return null;
  return MAGIC_TEA_PARTY_PRESETS.find((preset) => preset.id === needle) ?? null;
};

export type MagicTeaPartyPresetSource = Pick<MagicTeaPartySession, 'settings' | 'scenario' | 'auxScenarios'>;

export type MagicTeaPartyPresetProjection = {
  action: 'apply' | 'remove';
  preset: MagicTeaPartyPreset;
  patch: MagicTeaPartyPresetSource;
  preferencePatch: Partial<Pick<MagicTeaPartyPreferences,
    'lastPresetId' | 'lastWorldbookPresetId' | 'outputFormat' | 'enableChoices' | 'choiceCount'>>;
};

/** The host owns confirmation, timestamps and persistence. Selecting the active preset removes it. */
export const projectMagicTeaPartyPreset = (
  source: MagicTeaPartyPresetSource,
  presetId: string,
): MagicTeaPartyPresetProjection | null => {
  const preset = getMagicTeaPartyPreset(presetId);
  if (!preset) return null;
  if (source.settings.presetId === preset.id) {
    const scenario = source.scenario;
    const clearScenario = scenario?.source === 'preset' || scenario?.presetId === preset.id || scenario?.id === 'preset-scenario';
    return {
      action: 'remove',
      preset,
      patch: {
        settings: { ...source.settings, presetId: undefined, worldbookPresetId: undefined },
        scenario: clearScenario ? undefined : scenario,
        auxScenarios: (Array.isArray(source.auxScenarios) ? source.auxScenarios : []).filter(item => item.source !== 'preset' && item.presetId !== preset.id),
      },
      preferencePatch: { lastPresetId: undefined, lastWorldbookPresetId: undefined },
    };
  }
  return {
    action: 'apply',
    preset,
    patch: {
      settings: {
        ...source.settings,
        presetId: preset.id,
        worldbookPresetId: preset.worldbookPresetId,
        ...preset.defaultSettings,
        outputPlan: {
          ...(source.settings.outputPlan ?? { summary: 'off', updates: 'off' }),
          choices: source.settings.outputPlan?.choices === 'on' ? 'on' : 'auto',
        },
      },
      scenario: {
        id: 'preset-scenario',
        title: preset.defaultScenario.title,
        presetId: preset.id,
        source: 'preset',
        card: {
          title: preset.defaultScenario.title,
          content: preset.defaultScenario.content,
          templateId: '通用情景卡（Markdown）',
        },
      },
      auxScenarios: [],
    },
    preferencePatch: {
      lastPresetId: preset.id,
      lastWorldbookPresetId: preset.worldbookPresetId,
      ...preset.defaultSettings,
    },
  };
};
