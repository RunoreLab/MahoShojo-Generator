'use client';

import { randomUUID } from '@/lib/crypto';
import type {
  BattleStoryChapterCardSnapshot,
  BattleStoryChapterRecord,
  BattleStoryDeterministicDigest,
  BattleStoryReporterInfo,
  BattleStorySessionRecord,
  BattleStorySessionSeed,
  BattleStorySessionSource,
  BattleStoryStreamUpdateMetaDebug,
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

export const BATTLE_STORY_FAILURE_COOLDOWN_MS = 3_000;
export const BATTLE_STORY_SUMMARY_REFRESH_MIN_INTERVAL_MS = 30_000;

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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const normalizeReporterInfo = (value: unknown): BattleStoryReporterInfo | null => {
  if (!isRecord(value)) return null;
  const name = normalizeText(value.name);
  const publication = normalizeText(value.publication);
  if (!name || !publication) return null;
  return { name, publication };
};

const normalizeCharacterGuidances = (
  value: unknown
): BattleStoryChapterCardSnapshot['characterGuidances'] | null => {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map((item) => {
      if (!isRecord(item)) return null;
      const characterName = normalizeText(item.characterName);
      const guidance = normalizeText(item.guidance);
      if (!characterName || !guidance) return null;
      return { characterName, guidance };
    })
    .filter((item): item is NonNullable<BattleStoryChapterCardSnapshot['characterGuidances']>[number] => Boolean(item));
  return normalized.length > 0 ? normalized : null;
};

const normalizeAiUsage = (value: unknown): BattleStoryChapterCardSnapshot['aiUsage'] | null => {
  if (!isRecord(value)) return null;
  const normalized: NonNullable<BattleStoryChapterCardSnapshot['aiUsage']> = {};
  const fields: Array<keyof NonNullable<BattleStoryChapterCardSnapshot['aiUsage']>> = [
    'promptTokens',
    'reasoningTokens',
    'completionTokens',
    'totalTokens',
    'cachedTokens',
  ];
  for (const field of fields) {
    const tokenValue = value[field];
    if (typeof tokenValue === 'number' && Number.isFinite(tokenValue)) {
      normalized[field] = tokenValue;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
};

const buildInlineMetaDebugFromReportJson = (
  reportJson: Record<string, unknown>
): BattleStoryStreamUpdateMetaDebug | null => {
  const report = isRecord(reportJson.report) ? reportJson.report : null;
  const impacts = Array.isArray(reportJson.impacts) ? reportJson.impacts : null;
  if (!report && !impacts) return null;

  return {
    source: 'inline',
    parseOk: true,
    meta: {
      ...(report ? { report } : {}),
      ...(impacts ? { impacts: impacts as any } : {}),
    },
    raw: JSON.stringify(
      {
        ...(report ? { report } : {}),
        ...(impacts ? { impacts } : {}),
      },
      null,
      2
    ),
    rawTruncated: false,
  };
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
  trigger:
    | 'pending-chapter-threshold'
    | 'pending-digest-char-threshold'
    | 'initial-summary-chapter-threshold';
  pendingDigestChars: number;
};

const estimateBattleStoryDigestChars = (digest: BattleStoryDeterministicDigest): number => {
  const impactChars = Array.isArray(digest.impactDigest)
    ? digest.impactDigest.reduce((total, item) => {
        return (
          total +
          normalizeText(item.characterName).length +
          normalizeText(item.impact).length +
          normalizeText(item.currentStateSummary).length
        );
      }, 0)
    : 0;

  return (
    normalizeText(digest.chapterTitle).length +
    normalizeText(digest.winner).length +
    normalizeText(digest.officialConclusion).length +
    normalizeText(digest.bodyExcerpt).length +
    impactChars
  );
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

export const parseBattleStoryStreamMetaHeader = (
  rawHeader: string | null | undefined
): {
  generationId: string | null;
  snapshot: Partial<BattleStoryChapterCardSnapshot>;
} => {
  if (!rawHeader) {
    return { generationId: null, snapshot: {} };
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(rawHeader));
    const generationId =
      typeof parsed?.generationId === 'string' && parsed.generationId.trim()
        ? parsed.generationId.trim()
        : null;
    const reporterInfo = normalizeReporterInfo(parsed?.reporterInfo);
    const userGuidance = normalizeText(parsed?.userGuidance) || null;
    const characterGuidances = normalizeCharacterGuidances(parsed?.characterGuidances);
    const aiModel =
      typeof parsed?.ai?.model === 'string' && parsed.ai.model.trim()
        ? parsed.ai.model.trim()
        : null;
    const adjudicationResults = Array.isArray(parsed?.adjudicationResults)
      ? (parsed.adjudicationResults as BattleStoryChapterCardSnapshot['adjudicationResults'])
      : null;

    return {
      generationId,
      snapshot: {
        ...(reporterInfo ? { reporterInfo } : {}),
        ...(userGuidance ? { userGuidance } : {}),
        ...(characterGuidances ? { characterGuidances } : {}),
        ...(adjudicationResults ? { adjudicationResults } : {}),
        ...(aiModel ? { aiModel } : {}),
      },
    };
  } catch {
    return { generationId: null, snapshot: {} };
  }
};

export const resolveBattleStoryScenarioName = (
  session: Pick<BattleStorySessionRecord, 'source' | 'seed'> | null | undefined
): string | undefined => {
  if (!session || session.source.mode !== 'scenario') return undefined;
  if (!isRecord(session.seed.scenario)) return undefined;
  const title = normalizeText(session.seed.scenario.title) || normalizeText(session.seed.scenario.name);
  return title || undefined;
};

export const resolveBattleStoryChapterCardSnapshot = (
  chapter: Pick<BattleStoryChapterRecord, 'cardSnapshot' | 'reportJson'> | null | undefined
): BattleStoryChapterCardSnapshot | null => {
  if (!chapter) return null;
  const stored = chapter.cardSnapshot ?? null;
  const inlineMeta = buildInlineMetaDebugFromReportJson(chapter.reportJson);

  if (!stored && !inlineMeta) return null;

  return {
    ...(stored ?? {}),
    ...(!stored?.reporterInfo ? {} : { reporterInfo: stored.reporterInfo }),
    ...(!stored?.characterGuidances ? {} : { characterGuidances: stored.characterGuidances }),
    ...(!stored?.adjudicationResults ? {} : { adjudicationResults: stored.adjudicationResults }),
    ...(!stored?.aiUsage ? {} : { aiUsage: normalizeAiUsage(stored.aiUsage) ?? stored.aiUsage }),
    ...(stored?.streamUpdateMetaDebug ? {} : inlineMeta ? { streamUpdateMetaDebug: inlineMeta } : {}),
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
  minPendingDigestChars?: number;
  firstSummaryChapterThreshold?: number;
  maxDigestCount?: number;
}): BattleStorySummaryRefreshPlan | null => {
  const minPendingChapters = Math.max(1, Math.floor(input.minPendingChapters ?? 3));
  const minPendingDigestChars = Math.max(1, Math.floor(input.minPendingDigestChars ?? 1800));
  const firstSummaryChapterThreshold = Math.max(1, Math.floor(input.firstSummaryChapterThreshold ?? 6));
  const maxDigestCount = Math.max(1, Math.floor(input.maxDigestCount ?? 6));
  const activeChapters = input.chapters
    .filter((chapter) => chapter.status !== 'superseded')
    .sort((left, right) => left.index - right.index);

  const coveredUntil = input.session.summaryMeta?.coveredUntilChapterIndex ?? 0;
  const pending = activeChapters.filter((chapter) => chapter.index > coveredUntil);

  if (pending.length === 0) {
    return null;
  }

  const pendingDigestChars = pending.reduce((total, chapter) => {
    return total + estimateBattleStoryDigestChars(chapter.deterministicDigest);
  }, 0);

  const hasSessionSummary = Boolean(normalizeText(input.session.sessionSummary));
  const trigger =
    pending.length >= minPendingChapters
      ? 'pending-chapter-threshold'
      : pendingDigestChars >= minPendingDigestChars
        ? 'pending-digest-char-threshold'
        : (!hasSessionSummary && activeChapters.length >= firstSummaryChapterThreshold)
          ? 'initial-summary-chapter-threshold'
          : null;

  if (!trigger) {
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
    trigger,
    pendingDigestChars,
  };
};

export const resolveBattleStoryRequestCooldownMs = (input: {
  fullCooldownMs: number;
  retryAfterMs?: number | null;
  requestAccepted: boolean;
  status?: number | null;
}): number => {
  if (input.status === 429) {
    return Math.max(1, Math.floor(input.retryAfterMs ?? input.fullCooldownMs));
  }

  if (input.requestAccepted) {
    return Math.max(1, Math.floor(input.fullCooldownMs));
  }

  return BATTLE_STORY_FAILURE_COOLDOWN_MS;
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
