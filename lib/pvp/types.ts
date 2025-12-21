export type PvpCardKind = 'data_card' | 'preset' | 'snapshot';

export interface PvpDataCardRef {
  kind: 'data_card';
  id: string;
  updatedAt: string | null;
}

export interface PvpPresetRef {
  kind: 'preset';
  filename: string;
}

export interface PvpSnapshotRef {
  kind: 'snapshot';
  id: string;
}

export type PvpCardRef = PvpDataCardRef | PvpPresetRef | PvpSnapshotRef;

export type PvpCombatantType = 'magical-girl' | 'canshou' | 'general-character';

export type PvpMode = 'classic' | 'kizuna' | 'scenario';

export type PvpWinCondition = 'mostWinsAfterMaxRounds';
export type PvpTieBreaker = 'draw';

export interface PvpBestOfRules {
  enabled: boolean;
  maxRounds: number;
  winCondition: PvpWinCondition;
  tieBreaker: PvpTieBreaker;
}

export interface PvpRoomRules {
  participants: number; // 2-6（前端与校验层限制）
  cardsPerPlayer: number; // 每人提交数量
  dealPerPlayer: number;  // 每人初始手牌数量
  dedupe: boolean;
  mode: PvpMode;
  bestOf: PvpBestOfRules;
}

export interface PvpSubmittedCard {
  ref: PvpDataCardRef | PvpPresetRef;
  name: string;
  type: PvpCombatantType;
  dataJson: string;
  source: {
    isPublic: boolean;
    authorUsername?: string | null;
  };
}

export interface PvpSubmissionPayload {
  cards: PvpSubmittedCard[];
  hasPrivateCard: boolean;
}

export interface PvpHandState {
  cards: PvpSnapshotRef[];
  discarded: PvpSnapshotRef[];
  drawPile: PvpSnapshotRef[];
}

export interface PvpWinnerResolution {
  winnerUserId: number | null;
  winnerName: string;
  rawWinnerText?: string | null;
  attempts: number;
  error?: string | null;
}
