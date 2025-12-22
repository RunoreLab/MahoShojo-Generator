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

export type PvpMode = 'daily' | 'classic' | 'kizuna' | 'scenario';

export type PvpWinCondition = 'mostWinsAfterMaxRounds';
export type PvpTieBreaker = 'draw';

export type PvpDrawSource = 'public' | 'preset' | 'preset+public';

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
  dealWhenEmpty: number; // 当手牌为空时补发数量
  drawSource: PvpDrawSource; // 提交牌池用尽后的抽取来源（0 提交时也用于开局发牌）
  recycleUsedCards: boolean; // 已使用的卡牌是否可被重新发放
  dedupe: boolean;
  /**
   * 是否在房间内向所有人展示“所有玩家提交的卡组详情”。
   * 默认 true；关闭时仅能看到自己的提交详情（仍会展示所有人的提交进度）。
   */
  showAllSubmissions: boolean;
  /**
   * 是否将所有玩家提交的卡混合为同一牌池并洗牌后发牌。
   * 默认 true；关闭时每位玩家仅从自己提交的卡组中抽取手牌（按提交顺序）。
   */
  shuffleDecks: boolean;
  mode: PvpMode;
  bestOf: PvpBestOfRules;
  /**
   * 是否允许非房主玩家调整 AI 设置并触发结算（默认 false，更安全）。
   * 兼容旧房间：若缺失则视为 false。
   */
  allowNonHostControl?: boolean;
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

export type PvpScenarioSelection = {
  content: Record<string, unknown>;
  fileName: string;
  isNative?: boolean;
  sourceDataCardId?: string | null;
  sourceDataCardUpdatedAt?: string | null;
  sourceDataCardName?: string | null;
  sourceIsPublic?: boolean | null;
  sourceAuthor?: string | null;
};
