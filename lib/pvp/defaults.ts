import type { PvpRoomRules } from './types';

export const DEFAULT_PVP_RULES: PvpRoomRules = {
  participants: 2,
  cardsPerPlayer: 4,
  dealPerPlayer: 3,
  dedupe: true,
  mode: 'classic',
  bestOf: {
    enabled: false,
    maxRounds: 3,
    winCondition: 'mostWinsAfterMaxRounds',
    tieBreaker: 'draw',
  },
};
