export type RankedMatchmakingBucket = 'near' | 'mid' | 'far';

export type RankedMatchmakingBand = {
  bucket: RankedMatchmakingBucket;
  minDiffInclusive: number;
  maxDiffInclusive: number;
  bucketWeight: number;
  queryLimit: number;
};

export const STRICT_MATCHMAKING_BANDS: readonly RankedMatchmakingBand[] = [
  { bucket: 'near', minDiffInclusive: 0, maxDiffInclusive: 250, bucketWeight: 0.55, queryLimit: 60 },
  { bucket: 'mid', minDiffInclusive: 251, maxDiffInclusive: 900, bucketWeight: 0.30, queryLimit: 60 },
  { bucket: 'far', minDiffInclusive: 901, maxDiffInclusive: 10000, bucketWeight: 0.15, queryLimit: 80 },
] as const;

export type RatedCandidate = { rating: number; games: number };

type PickOptions = {
  rng?: () => number;
  diffScale?: number;
  diffBaseline?: number;
  gamesScale?: number;
  gamesBaseline?: number;
  bands?: readonly RankedMatchmakingBand[];
};

const clamp01 = (value: number): number => (value <= 0 ? 0 : value >= 1 ? 1 : value);

const defaultRng = (): number => {
  try {
    const cryptoObj = (globalThis as any)?.crypto as Crypto | undefined;
    if (cryptoObj?.getRandomValues) {
      const buf = new Uint32Array(1);
      cryptoObj.getRandomValues(buf);
      return (buf[0] ?? 0) / 4294967296;
    }
  } catch {
    // 忽略，回退到 Math.random
  }
  return Math.random();
};

const safeRng = (rng: (() => number) | undefined): (() => number) =>
  typeof rng === 'function' ? rng : defaultRng;

export const computeMatchmakingWeight = (input: {
  targetRating: number;
  candidateRating: number;
  candidateGames: number;
  rng?: () => number;
  diffScale?: number;
  diffBaseline?: number;
  gamesScale?: number;
  gamesBaseline?: number;
}): number => {
  const diffScaleRaw = input.diffScale;
  const diffScale =
    typeof diffScaleRaw === 'number' && Number.isFinite(diffScaleRaw) ? Math.max(1, diffScaleRaw) : 650;

  const diffBaselineRaw = input.diffBaseline;
  const diffBaseline =
    typeof diffBaselineRaw === 'number' && Number.isFinite(diffBaselineRaw) ? clamp01(diffBaselineRaw) : 0.10;

  const gamesScaleRaw = input.gamesScale;
  const gamesScale =
    typeof gamesScaleRaw === 'number' && Number.isFinite(gamesScaleRaw) ? Math.max(1, gamesScaleRaw) : 10;

  const gamesBaselineRaw = input.gamesBaseline;
  const gamesBaseline =
    typeof gamesBaselineRaw === 'number' && Number.isFinite(gamesBaselineRaw) ? clamp01(gamesBaselineRaw) : 0.35;
  const rng = safeRng(input.rng);

  const target = Number.isFinite(input.targetRating) ? input.targetRating : 0;
  const rating = Number.isFinite(input.candidateRating) ? input.candidateRating : target;
  const games = Number.isFinite(input.candidateGames) ? Math.max(0, input.candidateGames) : 0;

  const diff = Math.abs(rating - target);
  const closeness = Math.exp(-diff / diffScale);
  const diffWeight = diffBaseline + (1 - diffBaseline) * closeness;

  // gamesScale 越小，越偏好低局数；使用 sqrt 减缓“新号碾压”倾向。
  // 为避免“低局数压过分差”，将 gamesWeight 压缩到 [gamesBaseline, 1]。
  const gamesWeightRaw = 1 / Math.sqrt(1 + games / gamesScale);
  const gamesWeight = gamesBaseline + (1 - gamesBaseline) * gamesWeightRaw;

  // 轻微随机扰动：打散“权重接近时总是同一个”的固定性，但不会颠覆整体趋势。
  const noise = 1 + rng() * 0.05;
  const weight = diffWeight * gamesWeight * noise;

  return Number.isFinite(weight) && weight > 0 ? weight : 0;
};

const pickWeightedIndex = (weights: readonly number[], rng: () => number): number => {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (!Number.isFinite(sum) || sum <= 0) return 0;
  let roll = rng() * sum;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) return i;
  }
  return Math.max(0, weights.length - 1);
};

const bucketForDiff = (diff: number, bands: readonly RankedMatchmakingBand[]): RankedMatchmakingBucket | null => {
  const d = Number.isFinite(diff) ? Math.max(0, diff) : 0;
  for (const band of bands) {
    if (d >= band.minDiffInclusive && d <= band.maxDiffInclusive) return band.bucket;
  }
  return null;
};

export const pickStrictMatchmakingCandidate = <T extends RatedCandidate>(
  candidates: readonly T[],
  targetRating: number,
  options: PickOptions = {}
): T | null => {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const rng = safeRng(options.rng);
  const bands = options.bands ?? STRICT_MATCHMAKING_BANDS;
  const target = Number.isFinite(targetRating) ? targetRating : 0;

  const grouped = new Map<RankedMatchmakingBucket, { items: T[]; weights: number[]; bucketWeight: number }>();
  for (const band of bands) {
    grouped.set(band.bucket, { items: [], weights: [], bucketWeight: band.bucketWeight });
  }

  for (const c of candidates) {
    const rating = Number.isFinite(c.rating) ? c.rating : target;
    const diff = Math.abs(rating - target);
    const bucket = bucketForDiff(diff, bands);
    if (!bucket) continue;
    const group = grouped.get(bucket);
    if (!group) continue;
    group.items.push(c);
    group.weights.push(
      computeMatchmakingWeight({
        targetRating: target,
        candidateRating: rating,
        candidateGames: c.games,
        rng,
        diffScale: options.diffScale,
        diffBaseline: options.diffBaseline,
        gamesScale: options.gamesScale,
        gamesBaseline: options.gamesBaseline,
      })
    );
  }

  const availableBuckets = Array.from(grouped.entries()).filter(([, g]) => g.items.length > 0);
  if (availableBuckets.length === 0) return candidates[0] ?? null;
  if (availableBuckets.length === 1) {
    const only = availableBuckets[0]![1];
    return only.items[pickWeightedIndex(only.weights, rng)] ?? only.items[0] ?? null;
  }

  const bucketWeights = availableBuckets.map(([, g]) => g.bucketWeight);
  const pickedBucketIndex = pickWeightedIndex(bucketWeights, rng);
  const pickedGroup = availableBuckets[pickedBucketIndex]?.[1] ?? availableBuckets[0]![1];

  return pickedGroup.items[pickWeightedIndex(pickedGroup.weights, rng)] ?? pickedGroup.items[0] ?? null;
};
