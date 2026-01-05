import type { GamesFactorSchedule, InactivityFactorCap } from './season-reset';

export type SeasonResetAutoTuningStats = {
  total: number;
  played: number;

  maxRatingPlayed: number | null;
  top20AvgRatingPlayed: number | null;
  aboveMaxStartPlayed: number;

  gamesP25Played: number | null;
  gamesP60Played: number | null;

  inactiveP85DaysPlayed: number | null;
  inactive30DaysPlayed: number;
};

export type SeasonResetAutoTuningMeta = {
  spread: number;
  spreadNormalized: number;
  aboveMaxStartRatio: number;
  inactive30Ratio: number;
  usedTop20Avg: boolean;
};

export type SeasonResetAutoTuningResult = {
  gamesFactor: GamesFactorSchedule;
  inactivityCap: InactivityFactorCap;
  meta: SeasonResetAutoTuningMeta;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const clampInt = (value: number, min: number, max: number): number => {
  const n = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.min(max, Math.max(min, n));
};

const readNonNegativeIntOrNull = (value: unknown): number | null => {
  if (!isFiniteNumber(value)) return null;
  const n = Math.floor(value);
  return n >= 0 ? n : null;
};

const readNonNegativeNumberOrNull = (value: unknown): number | null => {
  if (!isFiniteNumber(value)) return null;
  return value >= 0 ? value : null;
};

export const deriveSeasonResetAutoTuning = (input: {
  baseRating: number;
  maxStartRating: number;
  stats: SeasonResetAutoTuningStats;
}): SeasonResetAutoTuningResult => {
  const baseRating = Math.floor(input.baseRating);
  const maxStartRating = Math.floor(input.maxStartRating);
  const stats = input.stats;

  const played = Math.max(0, Math.floor(stats.played));
  const denom = Math.max(1, played);

  const aboveMaxStartPlayed = Math.max(0, Math.floor(stats.aboveMaxStartPlayed));
  const inactive30DaysPlayed = Math.max(0, Math.floor(stats.inactive30DaysPlayed));

  const aboveMaxStartRatio = clamp(aboveMaxStartPlayed / denom, 0, 1);
  const inactive30Ratio = clamp(inactive30DaysPlayed / denom, 0, 1);

  const maxRatingPlayed = readNonNegativeIntOrNull(stats.maxRatingPlayed);
  const top20AvgRatingPlayed = readNonNegativeNumberOrNull(stats.top20AvgRatingPlayed);

  const usedTop20Avg =
    top20AvgRatingPlayed != null && Number.isFinite(top20AvgRatingPlayed) && top20AvgRatingPlayed > 0;
  const spreadFrom = usedTop20Avg ? Math.round(top20AvgRatingPlayed!) : maxRatingPlayed ?? baseRating;
  const spread = Math.max(0, spreadFrom - baseRating);

  const denomSpread = Math.max(1, maxStartRating - baseRating);
  const spreadNormalized = clamp(spread / denomSpread, 0, 2);

  // ------------------------------------------------------------
  // gamesFactor：按场次分段回收，分段阈值从“有对局记录”的分布推导。
  // ------------------------------------------------------------
  const gamesP25Played = readNonNegativeIntOrNull(stats.gamesP25Played);
  const gamesP60Played = readNonNegativeIntOrNull(stats.gamesP60Played);

  const gamesMidRaw = gamesP25Played ?? (played >= 20 ? 10 : 5);
  const gamesHighRaw = gamesP60Played ?? (played >= 50 ? 30 : 20);

  const gamesMid = clampInt(Math.round(gamesMidRaw), 5, 25);
  const gamesHigh = clampInt(Math.max(Math.round(gamesHighRaw), gamesMid + 5), gamesMid + 5, 80);

  let factorHigh = 1;
  if (aboveMaxStartRatio >= 0.25 || spreadNormalized >= 1.6) factorHigh = 0.9;
  else if (aboveMaxStartRatio >= 0.1 || spreadNormalized >= 1.2) factorHigh = 0.95;

  const midDrop = 0.05 + 0.12 * spreadNormalized;
  let factorMid = clamp(factorHigh - midDrop, 0.6, factorHigh);

  const lowExtraDrop = 0.12 + 0.12 * spreadNormalized;
  let factorLow = clamp(factorMid - lowExtraDrop, 0.35, factorMid);

  // 对局规模很小：降低“回收力度差异”，避免一个赛季只有少数样本时过拟合。
  if (played > 0 && played < 40) {
    factorMid = clamp(factorMid + 0.03, 0, factorHigh);
    factorLow = clamp(factorLow + 0.05, 0, factorMid);
  }

  // ------------------------------------------------------------
  // inactivityCap：长时间不活跃额外回收（cap），阈值从分位数推导。
  // ------------------------------------------------------------
  const inactiveP85DaysPlayed = readNonNegativeNumberOrNull(stats.inactiveP85DaysPlayed);
  const inactiveDaysRaw = inactiveP85DaysPlayed ?? 30;
  const inactiveDays = clampInt(Math.round(Math.max(30, inactiveDaysRaw)), 30, 180);

  const inactivePressure = clamp(inactive30Ratio / 0.3, 0, 1);
  const inactiveDrop = 0.15 + 0.15 * inactivePressure;
  const inactiveFactor = clamp(factorMid - inactiveDrop, 0.35, 0.9);

  return {
    gamesFactor: {
      enabled: true,
      gamesMid,
      gamesHigh,
      factorLow,
      factorMid,
      factorHigh,
    },
    inactivityCap: {
      enabled: true,
      inactiveDays,
      inactiveFactor,
    },
    meta: {
      spread,
      spreadNormalized,
      aboveMaxStartRatio,
      inactive30Ratio,
      usedTop20Avg,
    },
  };
};

