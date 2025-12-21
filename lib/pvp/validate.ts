import { DEFAULT_PVP_RULES } from './defaults';
import type { PvpRoomRules } from './types';

export const parsePvpRules = (input: unknown): { rules: PvpRoomRules } | { error: string } => {
  const raw = (input && typeof input === 'object') ? (input as any) : {};

  const participants = raw.participants ?? DEFAULT_PVP_RULES.participants;
  if (participants !== 2) return { error: 'PVP 目前仅支持 2 人房间' };

  const cardsPerPlayer = Number.isFinite(raw.cardsPerPlayer) ? Math.floor(raw.cardsPerPlayer) : DEFAULT_PVP_RULES.cardsPerPlayer;
  if (cardsPerPlayer < 1 || cardsPerPlayer > 10) return { error: 'cardsPerPlayer 超出范围(1-10)' };

  const dealPerPlayer = Number.isFinite(raw.dealPerPlayer) ? Math.floor(raw.dealPerPlayer) : DEFAULT_PVP_RULES.dealPerPlayer;
  if (dealPerPlayer < 1 || dealPerPlayer > 10) return { error: 'dealPerPlayer 超出范围(1-10)' };
  if (cardsPerPlayer <= dealPerPlayer) return { error: 'cardsPerPlayer 必须 > dealPerPlayer（保证对手手牌不可被直接推出）' };

  const dedupe = typeof raw.dedupe === 'boolean' ? raw.dedupe : DEFAULT_PVP_RULES.dedupe;

  const mode = raw.mode ?? DEFAULT_PVP_RULES.mode;
  if (mode !== 'classic' && mode !== 'kizuna' && mode !== 'scenario') {
    return { error: 'mode 必须是 classic/kizuna/scenario' };
  }

  const bestOfRaw = (raw.bestOf && typeof raw.bestOf === 'object') ? raw.bestOf : {};
  const enabled = typeof bestOfRaw.enabled === 'boolean' ? bestOfRaw.enabled : DEFAULT_PVP_RULES.bestOf.enabled;
  const maxRounds = Number.isFinite(bestOfRaw.maxRounds) ? Math.floor(bestOfRaw.maxRounds) : DEFAULT_PVP_RULES.bestOf.maxRounds;
  if (maxRounds < 1 || maxRounds > 10) return { error: 'bestOf.maxRounds 超出范围(1-10)' };
  const winCondition = bestOfRaw.winCondition ?? DEFAULT_PVP_RULES.bestOf.winCondition;
  if (winCondition !== 'mostWinsAfterMaxRounds') return { error: 'bestOf.winCondition 仅支持 mostWinsAfterMaxRounds' };
  const tieBreaker = bestOfRaw.tieBreaker ?? DEFAULT_PVP_RULES.bestOf.tieBreaker;
  if (tieBreaker !== 'draw') return { error: 'bestOf.tieBreaker 仅支持 draw' };

  const rules: PvpRoomRules = {
    participants: 2,
    cardsPerPlayer,
    dealPerPlayer,
    dedupe,
    mode,
    bestOf: { enabled, maxRounds, winCondition, tieBreaker },
  };

  if (enabled && dealPerPlayer < maxRounds) {
    return { error: '启用多局制时，dealPerPlayer 必须 >= maxRounds（保证必定结束）' };
  }

  return { rules };
};
