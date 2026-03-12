import {
  normalizeScenarioBattleStoryTotalChapters,
  readScenarioBattleStoryConfig,
} from '@/lib/scenario-battle-story';

import type {
  BattleStoryChapterPlan,
  BattleStoryChapterPlanLimit,
  BattleStoryPromptChapterPlanState,
} from '@/lib/ai-session/battle-story/types';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export type BattleStoryDraftChapterPlanMode = 'auto' | 'none' | 'custom';

export const normalizeBattleStoryTotalChapters = (
  value: unknown
): number | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return normalizeScenarioBattleStoryTotalChapters(Number(trimmed));
  }
  return normalizeScenarioBattleStoryTotalChapters(value);
};

export const normalizeBattleStoryChapterPlan = (
  value: unknown
): BattleStoryChapterPlan | null => {
  if (!isRecord(value)) return null;
  const totalChapters = normalizeBattleStoryTotalChapters(value.totalChapters);
  if (!totalChapters) return null;
  const source =
    value.source === 'scenario'
      ? 'scenario'
      : value.source === 'user'
        ? 'user'
        : null;
  if (!source) return null;
  return {
    totalChapters,
    source,
    locked: value.locked === true,
  };
};

const resolveBattleStoryChapterPlanTotal = (value: unknown): number | null => {
  const normalizedPlan = normalizeBattleStoryChapterPlan(value);
  if (normalizedPlan) return normalizedPlan.totalChapters;
  if (!isRecord(value)) return null;
  return normalizeBattleStoryTotalChapters(value.totalChapters);
};

export const resolveBattleStoryInitialChapterPlan = (input: {
  scenario: unknown;
  userSelectionMode?: BattleStoryDraftChapterPlanMode;
  userDesiredTotalChapters?: unknown;
}): BattleStoryChapterPlan | null => {
  const scenarioConfig = readScenarioBattleStoryConfig(input.scenario);

  if (scenarioConfig?.planMode === 'fixed') {
    return {
      totalChapters: scenarioConfig.totalChapters,
      source: 'scenario',
      locked: true,
    };
  }

  if (input.userSelectionMode === 'custom') {
    const totalChapters = normalizeBattleStoryTotalChapters(input.userDesiredTotalChapters);
    if (!totalChapters) return null;
    return {
      totalChapters,
      source: 'user',
      locked: false,
    };
  }

  if (input.userSelectionMode === 'none') {
    return null;
  }

  if (scenarioConfig?.planMode === 'suggested') {
    return {
      totalChapters: scenarioConfig.totalChapters,
      source: 'scenario',
      locked: false,
    };
  }

  return null;
};

export const resolveBattleStoryPromptChapterPlanState = (input: {
  chapterPlan?: BattleStoryChapterPlan | BattleStoryChapterPlanLimit | null;
  chapterIndex?: number;
}): BattleStoryPromptChapterPlanState | null => {
  const totalChapters = resolveBattleStoryChapterPlanTotal(input.chapterPlan);
  const chapterIndex =
    typeof input.chapterIndex === 'number'
      ? Math.max(1, Math.floor(input.chapterIndex))
      : null;
  if (!totalChapters || !chapterIndex) return null;

  const isFinalChapter = chapterIndex >= totalChapters;
  const remainingChaptersIncludingCurrent = Math.max(1, totalChapters - chapterIndex + 1);
  const remainingChaptersAfterCurrent = Math.max(0, totalChapters - chapterIndex);
  const positionLabel =
    totalChapters === 1
      ? '单章完结'
      : isFinalChapter
        ? '终章'
        : chapterIndex === 1
          ? '开篇章'
          : chapterIndex === totalChapters - 1
            ? '终局前章'
            : '中段推进章';

  return {
    totalChapters,
    currentChapterIndex: chapterIndex,
    isFinalChapter,
    remainingChaptersIncludingCurrent,
    remainingChaptersAfterCurrent,
    positionLabel,
  };
};

export const isBattleStoryChapterPlanLimitReached = (input: {
  chapterPlan?: BattleStoryChapterPlan | null;
  completedChapterCount: number;
}): boolean => {
  const totalChapters = resolveBattleStoryChapterPlanTotal(input.chapterPlan);
  if (!totalChapters) return false;
  return Math.max(0, Math.floor(input.completedChapterCount)) >= totalChapters;
};

export const willBattleStoryChapterExceedPlan = (input: {
  chapterPlan?: BattleStoryChapterPlan | BattleStoryChapterPlanLimit | null;
  nextChapterIndex: number;
}): boolean => {
  const totalChapters = resolveBattleStoryChapterPlanTotal(input.chapterPlan);
  if (!totalChapters) return false;
  return Math.max(1, Math.floor(input.nextChapterIndex)) > totalChapters;
};

export const formatBattleStoryChapterProgress = (input: {
  completedChapterCount: number;
  chapterPlan?: BattleStoryChapterPlan | null;
}): string => {
  const chapterPlan = normalizeBattleStoryChapterPlan(input.chapterPlan);
  const completed = Math.max(0, Math.floor(input.completedChapterCount));
  if (!chapterPlan) {
    return `${completed} 章`;
  }
  return `${Math.min(completed, chapterPlan.totalChapters)} / ${chapterPlan.totalChapters}`;
};

export const formatBattleStoryChapterPlanSource = (
  chapterPlan?: BattleStoryChapterPlan | null
): string | null => {
  const normalized = normalizeBattleStoryChapterPlan(chapterPlan);
  if (!normalized) return null;
  if (normalized.source === 'scenario') {
    return normalized.locked ? '情景卡固定' : '情景卡建议';
  }
  return '用户设置';
};
