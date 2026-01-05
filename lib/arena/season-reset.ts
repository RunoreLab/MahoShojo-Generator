export type SeasonResetPolicy = 'soft' | 'hundreds_toward_base';

export type SeasonResetOptions = {
  policy: SeasonResetPolicy;

  baseRating: number;
  factor: number;

  step: number;
  minStartRating: number;
  maxStartRating: number;
};

export type GamesFactorSchedule = {
  enabled: boolean;
  gamesMid: number;
  gamesHigh: number;
  factorLow: number;
  factorMid: number;
  factorHigh: number;
};

export type InactivityFactorCap = {
  enabled: boolean;
  inactiveDays: number;
  inactiveFactor: number;
};

export type SeasonResetAdvancedOptions = SeasonResetOptions & {
  gamesFactor?: GamesFactorSchedule | null;
  inactivityCap?: InactivityFactorCap | null;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const roundToInt = (value: number): number => Math.round(value);

const parseIsoDate = (value: string | null | undefined): Date | null => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
};

const diffDays = (a: Date, b: Date): number => {
  const ms = a.getTime() - b.getTime();
  return ms / (24 * 60 * 60 * 1000);
};

const assertValidOptions = (opts: SeasonResetOptions) => {
  if (!isFiniteNumber(opts.baseRating)) throw new Error('baseRating 必须是有限数字');
  if (!isFiniteNumber(opts.factor)) throw new Error('factor 必须是有限数字');
  if (opts.factor < 0 || opts.factor > 1) throw new Error('factor 必须在 [0, 1] 范围内');

  if (!isFiniteNumber(opts.step)) throw new Error('step 必须是有限数字');
  if (!Number.isInteger(opts.step) || opts.step <= 0) throw new Error('step 必须是正整数');

  if (!isFiniteNumber(opts.minStartRating) || !isFiniteNumber(opts.maxStartRating)) {
    throw new Error('minStartRating / maxStartRating 必须是有限数字');
  }
  if (!Number.isInteger(opts.minStartRating) || !Number.isInteger(opts.maxStartRating)) {
    throw new Error('minStartRating / maxStartRating 必须是整数');
  }
  if (opts.minStartRating > opts.maxStartRating) throw new Error('minStartRating 不能大于 maxStartRating');

  if (!Number.isInteger(opts.baseRating)) throw new Error('baseRating 必须是整数');
  if (opts.policy === 'hundreds_toward_base' && opts.baseRating % opts.step !== 0) {
    throw new Error('baseRating 必须能被 step 整除（确保“整百/整档”归位网格一致）');
  }
};

const floorToStep = (value: number, step: number): number => Math.floor(value / step) * step;
const ceilToStep = (value: number, step: number): number => Math.ceil(value / step) * step;

export const computeSeasonStartRating = (oldRating: number, opts: SeasonResetOptions): number => {
  assertValidOptions(opts);

  const rating = isFiniteNumber(oldRating) ? roundToInt(oldRating) : opts.baseRating;
  const base = opts.baseRating;

  const raw = roundToInt(base + (rating - base) * opts.factor);

  if (opts.policy === 'soft') {
    return clamp(raw, opts.minStartRating, opts.maxStartRating);
  }

  const snapped = raw < base ? ceilToStep(raw, opts.step) : floorToStep(raw, opts.step);
  return clamp(snapped, opts.minStartRating, opts.maxStartRating);
};

const assertValidGamesFactor = (value: GamesFactorSchedule) => {
  if (!value.enabled) return;
  if (!Number.isInteger(value.gamesMid) || value.gamesMid < 0) throw new Error('gamesMid 必须是 >= 0 的整数');
  if (!Number.isInteger(value.gamesHigh) || value.gamesHigh < value.gamesMid) throw new Error('gamesHigh 必须是 >= gamesMid 的整数');
  for (const [k, v] of [
    ['factorLow', value.factorLow],
    ['factorMid', value.factorMid],
    ['factorHigh', value.factorHigh],
  ] as const) {
    if (!isFiniteNumber(v) || v < 0 || v > 1) throw new Error(`${k} 必须在 [0, 1] 范围内`);
  }
};

const assertValidInactivityCap = (value: InactivityFactorCap) => {
  if (!value.enabled) return;
  if (!Number.isInteger(value.inactiveDays) || value.inactiveDays < 0) throw new Error('inactiveDays 必须是 >= 0 的整数');
  if (!isFiniteNumber(value.inactiveFactor) || value.inactiveFactor < 0 || value.inactiveFactor > 1) {
    throw new Error('inactiveFactor 必须在 [0, 1] 范围内');
  }
};

export const pickSeasonResetFactor = (input: {
  baseFactor: number;
  games: number;
  updatedAtIso: string | null;
  nowIso: string;
  gamesFactor?: GamesFactorSchedule | null;
  inactivityCap?: InactivityFactorCap | null;
}): number => {
  const baseFactor = isFiniteNumber(input.baseFactor) ? input.baseFactor : 1;
  let factor = clamp(baseFactor, 0, 1);

  const games = Number.isFinite(input.games) ? Math.max(0, Math.floor(input.games)) : 0;

  if (input.gamesFactor?.enabled) {
    assertValidGamesFactor(input.gamesFactor);
    if (games < input.gamesFactor.gamesMid) factor = input.gamesFactor.factorLow;
    else if (games < input.gamesFactor.gamesHigh) factor = input.gamesFactor.factorMid;
    else factor = input.gamesFactor.factorHigh;
  }

  if (input.inactivityCap?.enabled) {
    assertValidInactivityCap(input.inactivityCap);
    const now = parseIsoDate(input.nowIso);
    const updatedAt = parseIsoDate(input.updatedAtIso);
    if (now && updatedAt) {
      const days = diffDays(now, updatedAt);
      if (Number.isFinite(days) && days >= input.inactivityCap.inactiveDays) {
        factor = Math.min(factor, input.inactivityCap.inactiveFactor);
      }
    }
  }

  return clamp(factor, 0, 1);
};

export const computeSeasonStartRatingAdvanced = (
  oldRating: number,
  snapshot: { games: number; updatedAtIso: string | null },
  opts: SeasonResetAdvancedOptions,
  nowIso: string
): number => {
  const effectiveFactor = pickSeasonResetFactor({
    baseFactor: opts.factor,
    games: snapshot.games,
    updatedAtIso: snapshot.updatedAtIso,
    nowIso,
    gamesFactor: opts.gamesFactor ?? null,
    inactivityCap: opts.inactivityCap ?? null,
  });

  return computeSeasonStartRating(oldRating, {
    policy: opts.policy,
    baseRating: opts.baseRating,
    factor: effectiveFactor,
    step: opts.step,
    minStartRating: opts.minStartRating,
    maxStartRating: opts.maxStartRating,
  });
};
