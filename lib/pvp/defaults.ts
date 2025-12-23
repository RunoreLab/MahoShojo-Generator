import type { PvpRoomRules } from './types';

export const DEFAULT_PVP_RULES: PvpRoomRules = {
  participants: 2,
  submissionMode: 'perPlayer',
  cardsPerPlayer: 10,
  dealPerPlayer: 5,
  dealWhenEmpty: 3,
  drawSource: 'public',
  recycleUsedCards: false,
  dedupe: true,
  showAllSubmissions: true,
  shuffleDecks: true,
  mode: 'classic',
  bestOf: {
    enabled: true,
    maxRounds: 3,
    winCondition: 'mostWinsAfterMaxRounds',
    tieBreaker: 'draw',
  },
  allowNonHostControl: false,
  allowSpectators: true,

  // 与竞技场对齐：默认“全关或无”，由房主在房间内统一设置并贯穿对局。
  readArenaHistory: false,
  readArenaHistoryLimit: 3,
  isArenaHistoryUnlimited: false,
  writeArenaHistory: false,
  readCurrentState: false,
  writeCurrentState: false,
  selectedLevel: '',
  userGuidance: '',
  storyLength: 'default',
  language: '',
  adjudicationEvents: [],
};
