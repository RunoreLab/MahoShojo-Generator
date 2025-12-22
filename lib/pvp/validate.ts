import { DEFAULT_PVP_RULES } from './defaults';
import type { PvpRoomRules } from './types';

const intInRange = (raw: unknown, fallback: number, min: number, max: number): number => {
  const n = Number.isFinite(raw as number) ? Math.floor(raw as number) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export const parsePvpRules = (input: unknown): { rules: PvpRoomRules } | { error: string } => {
  const raw = (input && typeof input === 'object') ? (input as any) : {};

  const participants = raw.participants ?? DEFAULT_PVP_RULES.participants;
  const participantCount = Number.isFinite(participants) ? Math.floor(participants) : DEFAULT_PVP_RULES.participants;
  if (participantCount < 2 || participantCount > 6) return { error: '人数超出范围（2-6）' };

  const cardsPerPlayer = intInRange(raw.cardsPerPlayer, DEFAULT_PVP_RULES.cardsPerPlayer, 1, 50);
  if (cardsPerPlayer < 1 || cardsPerPlayer > 50) return { error: '每人提交数量超出范围（1-50）' };

  const dealPerPlayer = intInRange(raw.dealPerPlayer, DEFAULT_PVP_RULES.dealPerPlayer, 1, 50);
  if (dealPerPlayer < 1 || dealPerPlayer > 50) return { error: '每人初始手牌数量超出范围（1-50）' };

  const dealWhenEmpty = intInRange(raw.dealWhenEmpty, DEFAULT_PVP_RULES.dealWhenEmpty, 1, 50);
  if (dealWhenEmpty < 1 || dealWhenEmpty > 50) return { error: '手牌为空时补发数量超出范围（1-50）' };

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

  const rules: PvpRoomRules = {
    participants: participantCount,
    cardsPerPlayer,
    dealPerPlayer,
    dealWhenEmpty,
    recycleUsedCards,
    dedupe,
    showAllSubmissions,
    shuffleDecks,
    mode,
    bestOf: { enabled, maxRounds, winCondition, tieBreaker },
    allowNonHostControl,
  };

  return { rules };
};
