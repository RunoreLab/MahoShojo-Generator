import type { PvpRoomRules } from './types';

export const DEFAULT_PVP_RULES: PvpRoomRules = {
  participants: 2,
  cardsPerPlayer: 10,
  dealPerPlayer: 5,
  dedupe: true,
  mode: 'classic',
  bestOf: {
    enabled: true,
    maxRounds: 3,
    winCondition: 'mostWinsAfterMaxRounds',
    tieBreaker: 'draw',
  },
  allowNonHostControl: false,
};
