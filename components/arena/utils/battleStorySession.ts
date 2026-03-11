'use client';

import { randomUUID } from '@/lib/crypto';
import type {
  BattleStoryChapterRecord,
  BattleStoryDeterministicDigest,
  BattleStorySessionRecord,
  BattleStorySessionSeed,
  BattleStorySessionSource,
  BattleStorySummaryMeta,
} from '@/lib/ai-session/battle-story/types';

import type {
  AuxiliaryScenarioState,
  BattleMode,
  BattleSettings,
  Combatant,
  CombatantData,
  QuestionnaireSelection,
  ScenarioState,
  StoryLengthOption,
} from '../types';

const normalizeText = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const isCombatantData = (combatant: Combatant): combatant is CombatantData => {
  return 'data' in combatant;
};

const getCombatantName = (combatant: CombatantData | Record<string, unknown>): string => {
  const raw =
    (combatant as CombatantData)?.data?.codename ||
    (combatant as CombatantData)?.data?.name ||
    (combatant as Record<string, unknown>)?.['codename'] ||
    (combatant as Record<string, unknown>)?.['name'];
  return normalizeText(raw);
};

const normalizeNameToken = (value: string): string => {
  return value
    .trim()
    .replace(/^[“”"'「」『』《》【】\[\]（）()]+|[“”"'「」『』《》【】\[\]（）()]+$/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
};

const buildScenarioTitle = (scenario: ScenarioState): string => {
  return (
    normalizeText((scenario.content as any)?.title) ||
    normalizeText((scenario.content as any)?.name) ||
    normalizeText(scenario.fileName).replace(/\.json$/i, '')
  );
};

export type BattleStoryArenaSeedSnapshot = {
  source: BattleStorySessionSource;
  seed: BattleStorySessionSeed;
  workingCombatants: Array<Record<string, unknown>>;
  titleHint: string;
};

export type BattleStorySummaryRefreshPlan = {
  previousSummary?: string;
  coveredUntilChapterIndex: number;
  digests: Array<BattleStoryDeterministicDigest & { chapterId: string; index: number }>;
};

export const buildBattleStorySessionSeedSnapshot = (input: {
  combatants: Combatant[];
  battleMode: BattleMode;
  scenario: ScenarioState;
  auxScenarios: AuxiliaryScenarioState[];
  selectedQuestionnaires: QuestionnaireSelection[];
  selectedLanguage: string;
  storyLength: StoryLengthOption;
  settings: BattleSettings;
  providerMode: 'system' | 'custom';
  providerId: string;
  modelId?: string | null;
}): BattleStoryArenaSeedSnapshot => {
  const readableCombatants = input.combatants.filter(isCombatantData);
  const workingCombatants = readableCombatants.map((combatant) => ({
    type: combatant.type,
    data: combatant.data,
    isNative: combatant.isValid,
    isPreset: combatant.isPreset,
    filename: combatant.isPreset ? combatant.filename : null,
    teamId: typeof combatant.teamId === 'number' ? combatant.teamId : null,
    characterGuidance:
      typeof combatant.characterGuidance === 'string' ? combatant.characterGuidance : null,
    sourceDataCardId: combatant.sourceDataCardId,
    sourceDataCardUpdatedAt: combatant.sourceDataCardUpdatedAt,
  }));

  const scenarioTitle = buildScenarioTitle(input.scenario);
  const rosterNames = readableCombatants
    .map((combatant) => getCombatantName(combatant))
    .filter(Boolean);
  const rosterLabel =
    rosterNames.length <= 3
      ? rosterNames.join(' × ')
      : `${rosterNames.slice(0, 3).join(' × ')} 等 ${rosterNames.length} 人`;

  const titleHint =
    input.battleMode === 'scenario' && scenarioTitle
      ? `${scenarioTitle}${rosterLabel ? `｜${rosterLabel}` : ''}`
      : rosterLabel || '未命名连续战报';

  return {
    source: {
      mode: input.battleMode,
      language: input.selectedLanguage,
      storyLength: input.storyLength,
      generationMode: 'stream',
      providerMode: input.providerMode,
      providerId: input.providerId,
      ...(input.modelId ? { modelId: input.modelId } : {}),
    },
    seed: {
      combatants: workingCombatants,
      scenario: input.battleMode === 'scenario' ? input.scenario.content : null,
      auxScenarios:
        input.battleMode === 'scenario' ? input.auxScenarios.map((item) => item.content) : [],
      questionnaires: input.selectedQuestionnaires.map((selection) => ({
        id: selection.questionnaire.id,
        title: selection.questionnaire.title,
        kind: selection.questionnaire.kind,
        ...(selection.useLore === false ? { useLore: false } : {}),
        ...(selection.useLore === false
          ? {}
          : (selection.questionnaire.loreMarkdown
              ? { loreMarkdown: selection.questionnaire.loreMarkdown }
              : {})),
      })),
      settings: {
        readArenaHistory: input.settings.readArenaHistory,
        writeArenaHistory: input.settings.writeArenaHistory,
        readCurrentState: input.settings.readCurrentState,
        writeCurrentState: input.settings.writeCurrentState,
        readNarrativeHistory: input.settings.readNarrativeHistory,
        writeNarrativeHistory: input.settings.writeNarrativeHistory,
      },
    },
    workingCombatants,
    titleHint,
  };
};

export const mergeUpdatedCombatantsIntoWorkingCombatants = (
  workingCombatants: unknown[],
  updatedCombatants: Array<Record<string, unknown>>
): Array<Record<string, unknown>> => {
  if (!Array.isArray(workingCombatants) || workingCombatants.length === 0) return [];
  if (!Array.isArray(updatedCombatants) || updatedCombatants.length === 0) {
    return workingCombatants.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
    );
  }

  const updateByName = new Map<string, Record<string, unknown>>();
  updatedCombatants.forEach((combatant) => {
    const name = getCombatantName(combatant);
    if (!name) return;
    updateByName.set(normalizeNameToken(name), combatant);
  });

  return workingCombatants
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((combatant) => {
      const currentData =
        combatant.data && typeof combatant.data === 'object'
          ? (combatant.data as Record<string, unknown>)
          : null;
      const currentName = currentData ? getCombatantName(currentData) : '';
      if (!currentName) return combatant;

      const matched = updateByName.get(normalizeNameToken(currentName));
      if (!matched) return combatant;

      return {
        ...combatant,
        data: matched,
      };
    });
};

export const resolveBattleStorySummaryRefreshPlan = (input: {
  session: BattleStorySessionRecord;
  chapters: BattleStoryChapterRecord[];
  minPendingChapters?: number;
  maxDigestCount?: number;
}): BattleStorySummaryRefreshPlan | null => {
  const minPendingChapters = Math.max(1, Math.floor(input.minPendingChapters ?? 3));
  const maxDigestCount = Math.max(1, Math.floor(input.maxDigestCount ?? 6));
  const activeChapters = input.chapters
    .filter((chapter) => chapter.status !== 'superseded')
    .sort((left, right) => left.index - right.index);

  if (activeChapters.length < minPendingChapters) {
    return null;
  }

  const coveredUntil = input.session.summaryMeta?.coveredUntilChapterIndex ?? 0;
  const pending = activeChapters.filter((chapter) => chapter.index > coveredUntil);

  if (pending.length < minPendingChapters) {
    return null;
  }

  const digestItems = pending.slice(-maxDigestCount).map((chapter) => ({
    chapterId: chapter.id,
    index: chapter.index,
    ...chapter.deterministicDigest,
  }));

  if (digestItems.length === 0) return null;

  return {
    ...(input.session.sessionSummary ? { previousSummary: input.session.sessionSummary } : {}),
    coveredUntilChapterIndex: digestItems[digestItems.length - 1]!.index,
    digests: digestItems,
  };
};

export const buildBattleStoryExportMarkdown = (
  session: BattleStorySessionRecord,
  chapters: BattleStoryChapterRecord[]
): string => {
  const activeChapters = chapters
    .filter((chapter) => chapter.status !== 'superseded')
    .sort((left, right) => left.index - right.index);

  const header = [
    `# ${normalizeText(session.title) || '未命名连续战报'}`,
    '',
    `> 模式：${session.source.mode}｜语言：${session.source.language}｜章节数：${activeChapters.length}`,
    `> 会话 ID：${session.id}`,
  ];

  if (session.branchOf?.sessionId && session.branchOf?.chapterId) {
    header.push(`> 分支来源：${session.branchOf.sessionId} / ${session.branchOf.chapterId}`);
  }
  if (session.sessionSummary) {
    header.push('');
    header.push('## 会话摘要');
    header.push(session.sessionSummary.trim());
  }

  const chapterBlocks = activeChapters
    .map((chapter) => chapter.markdown.trim())
    .filter(Boolean);

  return [...header, '', '---', '', chapterBlocks.join('\n\n---\n\n')]
    .filter(Boolean)
    .join('\n');
};

export const cloneBattleStoryActiveChaptersForNewSession = (input: {
  chapters: BattleStoryChapterRecord[];
  newSessionId: string;
}): {
  chapters: BattleStoryChapterRecord[];
  chapterIdMap: Map<string, string>;
} => {
  const activeChapters = input.chapters
    .filter((chapter) => chapter.status !== 'superseded')
    .sort((left, right) => left.index - right.index);

  const chapterIdMap = new Map<string, string>();
  const cloned = activeChapters.map((chapter) => {
    const nextId = randomUUID();
    chapterIdMap.set(chapter.id, nextId);
    return {
      ...chapter,
      id: nextId,
      sessionId: input.newSessionId,
      status: 'active' as const,
      supersededByChapterId: null,
    };
  });

  const normalized = cloned.map((chapter) => ({
    ...chapter,
    sourceChapterId: chapter.sourceChapterId ? (chapterIdMap.get(chapter.sourceChapterId) ?? null) : null,
  }));

  return {
    chapters: normalized,
    chapterIdMap,
  };
};

export const remapBattleStorySummaryMeta = (
  summaryMeta: BattleStorySummaryMeta | undefined,
  chapterIdMap: Map<string, string>
): BattleStorySummaryMeta | undefined => {
  if (!summaryMeta) return undefined;

  const coveredChapterIds = summaryMeta.coveredChapterIds
    .map((chapterId) => chapterIdMap.get(chapterId) ?? null)
    .filter((chapterId): chapterId is string => Boolean(chapterId));

  return {
    ...summaryMeta,
    coveredChapterIds,
  };
};
