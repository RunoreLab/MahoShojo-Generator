import { DEFAULT_PVP_RULES } from './defaults';
import type { PvpRoomRules } from './types';
import type { AdjudicatorEvent } from '@/types/arena';

const intInRange = (raw: unknown, fallback: number, min: number, max: number): number => {
  const n = Number.isFinite(raw as number) ? Math.floor(raw as number) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));

const safeTrim = (value: unknown, maxLen: number): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
};

const allowedLevels = new Set(['', '种级', '芽级', '叶级', '蕾级', '花级']);
const allowedStoryLengths = new Set(['default', 'short', 'standard', 'detailed', 'long']);

const sanitizeAdjudicationEvents = (input: unknown): AdjudicatorEvent[] => {
  const root = Array.isArray(input) ? input : [];
  const maxNodes = 200;
  const maxDepth = 8;
  let budget = maxNodes;

  const sanitizeOutcome = (raw: unknown, depth: number): any | null => {
    if (!isRecord(raw)) return null;
    if (budget <= 0) return null;
    const id = safeTrim(raw.id, 64);
    const name = safeTrim(raw.name, 64);
    const probability = Number.isFinite(raw.probability as number) ? Math.max(0, Math.min(100, Number(raw.probability))) : 0;
    if (!id || !name) return null;
    budget -= 1;
    const chainedEventRaw = raw.chainedEvent;
    const chainedEvent = depth < maxDepth && chainedEventRaw && isRecord(chainedEventRaw)
      ? (() => {
          const event = sanitizeEvent((chainedEventRaw as any).event, depth + 1);
          return event ? { event } : undefined;
        })()
      : undefined;
    return {
      id,
      name,
      probability,
      ...(chainedEvent ? { chainedEvent } : {}),
    };
  };

  const sanitizeEvent = (raw: unknown, depth: number): AdjudicatorEvent | null => {
    if (!isRecord(raw)) return null;
    if (budget <= 0) return null;
    if (depth > maxDepth) return null;
    const id = safeTrim(raw.id, 64);
    const description = safeTrim(raw.description, 200);
    const type = raw.type === 'binary' || raw.type === 'custom' ? raw.type : null;
    if (!id || !description || !type) return null;

    budget -= 1;

    if (type === 'binary') {
      const probabilityRaw = raw.probability;
      const probability = Number.isFinite(probabilityRaw as number) ? Math.max(1, Math.min(100, Math.floor(Number(probabilityRaw)))) : undefined;
      const onSuccessRaw = raw.onSuccess;
      const onFailureRaw = raw.onFailure;
      const onSuccess =
        depth < maxDepth && onSuccessRaw && isRecord(onSuccessRaw)
          ? (() => {
              const next = sanitizeEvent((onSuccessRaw as any).event, depth + 1);
              return next ? { event: next } : undefined;
            })()
          : undefined;
      const onFailure =
        depth < maxDepth && onFailureRaw && isRecord(onFailureRaw)
          ? (() => {
              const next = sanitizeEvent((onFailureRaw as any).event, depth + 1);
              return next ? { event: next } : undefined;
            })()
          : undefined;
      return {
        id,
        description,
        type,
        ...(probability !== undefined ? { probability } : {}),
        ...(onSuccess ? { onSuccess } : {}),
        ...(onFailure ? { onFailure } : {}),
      };
    }

    const outcomesRaw = Array.isArray(raw.outcomes) ? raw.outcomes : [];
    const outcomes = outcomesRaw.map((o) => sanitizeOutcome(o, depth)).filter(Boolean);
    return {
      id,
      description,
      type,
      ...(outcomes.length > 0 ? { outcomes } : {}),
    } as AdjudicatorEvent;
  };

  const sanitized = root.map((e) => sanitizeEvent(e, 0)).filter(Boolean) as AdjudicatorEvent[];
  return sanitized;
};

export const parsePvpRules = (input: unknown): { rules: PvpRoomRules } | { error: string } => {
  const raw = (input && typeof input === 'object') ? (input as any) : {};

  const participants = raw.participants ?? DEFAULT_PVP_RULES.participants;
  const participantCount = Number.isFinite(participants) ? Math.floor(participants) : DEFAULT_PVP_RULES.participants;
  if (participantCount < 2 || participantCount > 6) return { error: '人数超出范围（2-6）' };

  const submissionModeRaw = raw.submissionMode ?? DEFAULT_PVP_RULES.submissionMode;
  const submissionMode =
    submissionModeRaw === 'perPlayer' || submissionModeRaw === 'hostOnly'
      ? submissionModeRaw
      : DEFAULT_PVP_RULES.submissionMode;

  const cardsPerPlayer = intInRange(raw.cardsPerPlayer, DEFAULT_PVP_RULES.cardsPerPlayer, 0, 50);
  if (cardsPerPlayer < 0 || cardsPerPlayer > 50) return { error: '每人提交数量超出范围（0-50）' };

  const dealPerPlayer = intInRange(raw.dealPerPlayer, DEFAULT_PVP_RULES.dealPerPlayer, 1, 50);
  if (dealPerPlayer < 1 || dealPerPlayer > 50) return { error: '每人初始手牌数量超出范围（1-50）' };

  const dealWhenEmpty = intInRange(raw.dealWhenEmpty, DEFAULT_PVP_RULES.dealWhenEmpty, 1, 50);
  if (dealWhenEmpty < 1 || dealWhenEmpty > 50) return { error: '手牌为空时补发数量超出范围（1-50）' };

  const drawSourceRaw = raw.drawSource ?? DEFAULT_PVP_RULES.drawSource;
  const drawSource =
    drawSourceRaw === 'public' || drawSourceRaw === 'preset' || drawSourceRaw === 'preset+public'
      ? drawSourceRaw
      : DEFAULT_PVP_RULES.drawSource;

  const recycleUsedCards =
    typeof raw.recycleUsedCards === 'boolean' ? raw.recycleUsedCards : DEFAULT_PVP_RULES.recycleUsedCards;

  const dedupe = typeof raw.dedupe === 'boolean' ? raw.dedupe : DEFAULT_PVP_RULES.dedupe;

  const showAllSubmissions =
    typeof raw.showAllSubmissions === 'boolean' ? raw.showAllSubmissions : DEFAULT_PVP_RULES.showAllSubmissions;
  const shuffleDecks =
    typeof raw.shuffleDecks === 'boolean' ? raw.shuffleDecks : DEFAULT_PVP_RULES.shuffleDecks;

  const mode = raw.mode ?? DEFAULT_PVP_RULES.mode;
  if (mode !== 'daily' && mode !== 'classic' && mode !== 'kizuna' && mode !== 'scenario') {
    return { error: '对战模式不合法（需为 daily/classic/kizuna/scenario）' };
  }

  const bestOfRaw = (raw.bestOf && typeof raw.bestOf === 'object') ? raw.bestOf : {};
  const enabled = typeof bestOfRaw.enabled === 'boolean' ? bestOfRaw.enabled : DEFAULT_PVP_RULES.bestOf.enabled;
  const maxRounds = Number.isFinite(bestOfRaw.maxRounds) ? Math.floor(bestOfRaw.maxRounds) : DEFAULT_PVP_RULES.bestOf.maxRounds;
  if (maxRounds < 1 || maxRounds > 10) return { error: '最多轮次数超出范围（1-10）' };
  const winCondition = bestOfRaw.winCondition ?? DEFAULT_PVP_RULES.bestOf.winCondition;
  if (winCondition !== 'mostWinsAfterMaxRounds') return { error: '多局制胜利条件目前仅支持“最多胜场（打满轮次后结算）”' };
  const tieBreaker = bestOfRaw.tieBreaker ?? DEFAULT_PVP_RULES.bestOf.tieBreaker;
  if (tieBreaker !== 'draw') return { error: '多局制平局处理目前仅支持“平局”' };

  const allowNonHostControl =
    typeof raw.allowNonHostControl === 'boolean' ? raw.allowNonHostControl : DEFAULT_PVP_RULES.allowNonHostControl;

  const allowSpectators =
    typeof raw.allowSpectators === 'boolean' ? raw.allowSpectators : DEFAULT_PVP_RULES.allowSpectators;

  const allowSpectatorChat =
    typeof raw.allowSpectatorChat === 'boolean' ? raw.allowSpectatorChat : DEFAULT_PVP_RULES.allowSpectatorChat;

  const readArenaHistory =
    typeof raw.readArenaHistory === 'boolean' ? raw.readArenaHistory : DEFAULT_PVP_RULES.readArenaHistory;
  const readArenaHistoryLimit = intInRange(
    raw.readArenaHistoryLimit,
    DEFAULT_PVP_RULES.readArenaHistoryLimit,
    1,
    999
  );
  const isArenaHistoryUnlimited =
    typeof raw.isArenaHistoryUnlimited === 'boolean'
      ? raw.isArenaHistoryUnlimited
      : DEFAULT_PVP_RULES.isArenaHistoryUnlimited;
  const writeArenaHistory =
    typeof raw.writeArenaHistory === 'boolean' ? raw.writeArenaHistory : DEFAULT_PVP_RULES.writeArenaHistory;
  const readCurrentState =
    typeof raw.readCurrentState === 'boolean' ? raw.readCurrentState : DEFAULT_PVP_RULES.readCurrentState;
  const writeCurrentState =
    typeof raw.writeCurrentState === 'boolean' ? raw.writeCurrentState : DEFAULT_PVP_RULES.writeCurrentState;

  const selectedLevelRaw = typeof raw.selectedLevel === 'string' ? raw.selectedLevel : DEFAULT_PVP_RULES.selectedLevel;
  const selectedLevel = allowedLevels.has(selectedLevelRaw.trim()) ? selectedLevelRaw.trim() : DEFAULT_PVP_RULES.selectedLevel;

  const userGuidanceRaw = typeof raw.userGuidance === 'string' ? raw.userGuidance : DEFAULT_PVP_RULES.userGuidance;
  const userGuidance = userGuidanceRaw.trim().slice(0, 50);

  const storyLengthRaw = typeof raw.storyLength === 'string' ? raw.storyLength : DEFAULT_PVP_RULES.storyLength;
  const storyLength = allowedStoryLengths.has(storyLengthRaw) ? (storyLengthRaw as any) : DEFAULT_PVP_RULES.storyLength;

  const languageRaw = typeof raw.language === 'string' ? raw.language : DEFAULT_PVP_RULES.language;
  const language = languageRaw.trim().length <= 32 ? languageRaw.trim() : DEFAULT_PVP_RULES.language;

  const adjudicationEvents = sanitizeAdjudicationEvents(raw.adjudicationEvents);

  const rules: PvpRoomRules = {
    participants: participantCount,
    submissionMode,
    cardsPerPlayer: submissionMode === 'hostOnly' ? 0 : cardsPerPlayer,
    dealPerPlayer,
    dealWhenEmpty,
    drawSource,
    recycleUsedCards,
    dedupe,
    showAllSubmissions,
    shuffleDecks,
    mode,
    bestOf: { enabled, maxRounds, winCondition, tieBreaker },
    allowNonHostControl,
    allowSpectators,
    allowSpectatorChat,

    readArenaHistory,
    readArenaHistoryLimit,
    isArenaHistoryUnlimited,
    writeArenaHistory,
    readCurrentState,
    writeCurrentState,
    selectedLevel,
    userGuidance,
    storyLength,
    language,
    adjudicationEvents,
  };

  return { rules };
};
