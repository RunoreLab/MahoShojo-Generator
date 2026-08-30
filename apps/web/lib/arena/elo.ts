export type EloPredictionV1 = {
  method: 'elo';
  version: 1;
  player: { rating: number; games: number };
  opponent: { rating: number; games: number };
  /**
   * Elo 期望得分（在“无平局”假设下可视为胜率）。
   * 取值范围 [0,1]。
   */
  expectedScore: number;
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0.5;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

export const computeEloExpectedScore = (ratingA: number, ratingB: number): number => {
  const a = Number.isFinite(ratingA) ? ratingA : 0;
  const b = Number.isFinite(ratingB) ? ratingB : a;
  const exp = (b - a) / 400;
  const expected = 1 / (1 + Math.pow(10, exp));
  return clamp01(expected);
};

