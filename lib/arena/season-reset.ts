export type SeasonResetPolicy = 'soft' | 'hundreds_toward_base';

export type SeasonResetOptions = {
  policy: SeasonResetPolicy;

  baseRating: number;
  factor: number;

  step: number;
  minStartRating: number;
  maxStartRating: number;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const roundToInt = (value: number): number => Math.round(value);

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
