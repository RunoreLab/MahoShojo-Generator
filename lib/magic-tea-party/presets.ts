import { SYSTEM_PROMPTS } from '@/lib/arena/constants';
import { buildArenaDefaultScenario, buildArenaWorldbook } from '@/lib/tavern-card';
import type { TavernCharacterBook } from '@/lib/tavern-card';

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
    choiceCount: 2 | 3 | 4;
  };
};

export const MAGIC_TEA_PARTY_PRESETS: MagicTeaPartyPreset[] = [
  {
    id: 'arena-classic',
    title: '经典战报',
    description: '复刻竞技场经典战报口吻，偏叙事、不默认生成选项。',
    systemPrompt: SYSTEM_PROMPTS.classic,
    worldbookPresetId: 'arena-core',
    worldbook: buildArenaWorldbook({ includeCore: true }),
    defaultScenario: { title: 'A.R.E.N.A.', content: buildArenaDefaultScenario() },
    defaultSettings: { outputFormat: 'markdown', enableChoices: false, choiceCount: 3 },
  },
  {
    id: 'arena-kizuna',
    title: '羁绊战报',
    description: '更强调感情与羁绊的战斗故事，可手动触发选项推进剧情。',
    systemPrompt: SYSTEM_PROMPTS.kizuna,
    worldbookPresetId: 'arena-core',
    worldbook: buildArenaWorldbook({ includeCore: true }),
    defaultScenario: { title: 'A.R.E.N.A.', content: buildArenaDefaultScenario() },
    defaultSettings: { outputFormat: 'markdown', enableChoices: true, choiceCount: 3 },
  },
  {
    id: 'arena-daily',
    title: '日常互动',
    description: '偏日常互动的轻量模式，默认结构化输出并提供选项。',
    systemPrompt: SYSTEM_PROMPTS.daily,
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

