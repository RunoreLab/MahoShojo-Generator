#!/usr/bin/env -S pnpm exec tsx

import { loadEnvConfig } from '@next/env';

import {
  listArenaRatedPublicCharacterCards,
  listDataCardPayloadRowsByIds,
} from '@/lib/database/data-card-tech-index';
import { computeTechIndex } from '@/lib/metrics/techIndex';

type Queue = 'strict' | 'free';

type EligibleRow = {
  dataCardId: string;
  rating: number;
  games: number;
};

type CardRow = {
  id: string;
  name: string | null;
  data: string;
};

type Options = {
  queue: Queue;
  minGames: number;
  sample: number;
  seed: number;
  batchSize: number;
  topN: number;
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
};

const parseArgs = (argv: string[]): Options => {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, rawValue] = token.split('=', 2);
    if (rawValue != null) {
      args.set(key, rawValue);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i += 1;
      continue;
    }
    args.set(key, '1');
  }

  const queueRaw = (args.get('--queue') ?? '').trim();
  const queue: Queue = queueRaw === 'free' ? 'free' : 'strict';

  return {
    queue,
    minGames: parsePositiveInt(args.get('--min-games'), 5),
    sample: parsePositiveInt(args.get('--sample'), 350),
    seed: parsePositiveInt(args.get('--seed'), 42),
    batchSize: parsePositiveInt(args.get('--batch'), 40),
    topN: parsePositiveInt(args.get('--top'), 15),
  };
};

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
};

const mean = (values: number[]) => {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

const rankValues = (values: number[]) => {
  const entries = values.map((value, idx) => ({ value, idx })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);

  let i = 0;
  while (i < entries.length) {
    let j = i;
    while (j + 1 < entries.length && entries[j + 1]!.value === entries[i]!.value) j += 1;
    const avgRank = (i + j + 2) / 2;
    for (let k = i; k <= j; k += 1) ranks[entries[k]!.idx] = avgRank;
    i = j + 1;
  }

  return ranks;
};

const pearson = (a: number[], b: number[]) => {
  if (a.length !== b.length || a.length < 2) return null;
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? null : num / den;
};

const spearman = (x: number[], y: number[]) => pearson(rankValues(x), rankValues(y));

const makeRng = (seed: number) => {
  let x = (seed >>> 0) || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
};

const shuffleInPlace = <T,>(arr: T[], rand: () => number) => {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
};

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  const safeSize = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += safeSize) out.push(items.slice(i, i + safeSize));
  return out;
};

async function main() {
  loadEnvConfig(process.cwd(), true);

  const opts = parseArgs(process.argv.slice(2));

  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.D1_DATABASE_ID) {
    throw new Error('缺少 Cloudflare D1 配置：CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID');
  }

  const eligibleRows = (await listArenaRatedPublicCharacterCards({
    queue: opts.queue,
    minGames: opts.minGames,
  })) as EligibleRow[];
  const eligible = eligibleRows
    .map((row) => ({
      dataCardId: typeof row.dataCardId === 'string' ? row.dataCardId : '',
      rating: typeof row.rating === 'number' ? row.rating : Number(row.rating),
      games: typeof row.games === 'number' ? row.games : Number(row.games),
    }))
    .filter((row) => row.dataCardId && Number.isFinite(row.rating) && Number.isFinite(row.games));

  const rng = makeRng(opts.seed);
  const shuffled = [...eligible];
  shuffleInPlace(shuffled, rng);

  const sampleRows = shuffled.slice(0, Math.min(opts.sample, shuffled.length));
  const sampleIds = sampleRows.map((row) => row.dataCardId);
  const ratingById = new Map(sampleRows.map((row) => [row.dataCardId, row] as const));

  const cardRows: CardRow[] = [];
  for (const batchIds of chunk(sampleIds, opts.batchSize)) {
    const rows = (await listDataCardPayloadRowsByIds(batchIds)) as CardRow[];
    cardRows.push(
      ...rows.filter((row) => typeof row.id === 'string' && typeof row.data === 'string' && row.id.trim())
    );
  }

  const computed: Array<{
    dataCardId: string;
    name: string | null;
    rating: number;
    games: number;
    techScore: number;
    techLevel: string;
    components: {
      scoreControl: number;
      scoreMechanics: number;
      scoreStructure: number;
      scoreCode: number;
      scoreSize: number;
    };
    derived: {
      techDensityPer1kChars: number;
      mechanicsDensityPer1kChars: number;
      codeDensityPer1kChars: number;
    };
    raw: {
      kwMust: number;
      kwSystem: number;
      kwFormat: number;
      kwRole: number;
      kwMeta: number;
      kwExploit: number;
      kwDice: number;
      kwCombat: number;
      jsonTotalKeys: number;
      jsonTotalNodes: number;
      jsonUniqueKeyCount: number;
      jsonStringCharsTotal: number;
      bulletLineCount: number;
      headingLineCount: number;
    };
  }> = [];

  let parseFailed = 0;
  for (const row of cardRows) {
    const base = ratingById.get(row.id);
    if (!base) continue;

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.data) as unknown;
    } catch {
      parsed = null;
    }
    if (!parsed) {
      parseFailed += 1;
      continue;
    }

    const tech = computeTechIndex(parsed);
    computed.push({
      dataCardId: row.id,
      name: typeof row.name === 'string' ? row.name : null,
      rating: base.rating,
      games: base.games,
      techScore: tech.techScore,
      techLevel: tech.techLevel,
      components: tech.components,
      derived: tech.derived,
      raw: {
        kwMust: tech.raw.kwMust,
        kwSystem: tech.raw.kwSystem,
        kwFormat: tech.raw.kwFormat,
        kwRole: tech.raw.kwRole,
        kwMeta: tech.raw.kwMeta,
        kwExploit: tech.raw.kwExploit,
        kwDice: tech.raw.kwDice,
        kwCombat: tech.raw.kwCombat,
        jsonTotalKeys: tech.raw.jsonTotalKeys,
        jsonTotalNodes: tech.raw.jsonTotalNodes,
        jsonUniqueKeyCount: tech.raw.jsonUniqueKeyCount,
        jsonStringCharsTotal: tech.raw.jsonStringCharsTotal,
        bulletLineCount: tech.raw.bulletLineCount,
        headingLineCount: tech.raw.headingLineCount,
      },
    });
  }

  const ratings = computed.map((row) => row.rating);
  const techScores = computed.map((row) => row.techScore);
  const scoreControl = computed.map((row) => row.components.scoreControl);
  const scoreMechanics = computed.map((row) => row.components.scoreMechanics);
  const scoreStructure = computed.map((row) => row.components.scoreStructure);
  const scoreCode = computed.map((row) => row.components.scoreCode);
  const scoreSize = computed.map((row) => row.components.scoreSize);

  const kwCombat = computed.map((row) => row.raw.kwCombat);
  const kwExploit = computed.map((row) => row.raw.kwExploit);
  const techDensity = computed.map((row) => row.derived.techDensityPer1kChars);
  const mechanicsDensity = computed.map((row) => row.derived.mechanicsDensityPer1kChars);

  const byRatingDesc = [...computed].sort((a, b) => b.rating - a.rating || b.games - a.games || a.dataCardId.localeCompare(b.dataCardId));
  const byTechDesc = [...computed].sort((a, b) => b.techScore - a.techScore || b.rating - a.rating || a.dataCardId.localeCompare(b.dataCardId));

  const topRatedWindow = byRatingDesc.slice(0, Math.min(60, byRatingDesc.length));
  const highRatingLowTech = [...topRatedWindow].sort((a, b) => a.techScore - b.techScore).slice(0, opts.topN);

  const bottomRatedWindow = [...byRatingDesc].reverse().slice(0, Math.min(60, byRatingDesc.length));
  const lowRatingHighTech = [...bottomRatedWindow].sort((a, b) => b.techScore - a.techScore).slice(0, opts.topN);

  const summary = {
    queue: opts.queue,
    minGames: opts.minGames,
    seed: opts.seed,
    sampleRequested: opts.sample,
    eligibleCount: eligible.length,
    sampledCount: sampleRows.length,
    fetchedCount: cardRows.length,
    computedCount: computed.length,
    parseFailed,
    rating: {
      mean: mean(ratings),
      p50: percentile(ratings, 0.5),
      p80: percentile(ratings, 0.8),
      p90: percentile(ratings, 0.9),
      max: ratings.length ? Math.max(...ratings) : null,
    },
    techScore: {
      mean: mean(techScores),
      p50: percentile(techScores, 0.5),
      p80: percentile(techScores, 0.8),
      p90: percentile(techScores, 0.9),
      max: techScores.length ? Math.max(...techScores) : null,
    },
    correlation: {
      pearson: pearson(ratings, techScores),
      spearman: spearman(ratings, techScores),
    },
    componentCorrelation: {
      scoreControl: { pearson: pearson(ratings, scoreControl), spearman: spearman(ratings, scoreControl) },
      scoreMechanics: { pearson: pearson(ratings, scoreMechanics), spearman: spearman(ratings, scoreMechanics) },
      scoreStructure: { pearson: pearson(ratings, scoreStructure), spearman: spearman(ratings, scoreStructure) },
      scoreCode: { pearson: pearson(ratings, scoreCode), spearman: spearman(ratings, scoreCode) },
      scoreSize: { pearson: pearson(ratings, scoreSize), spearman: spearman(ratings, scoreSize) },
    },
    rawCorrelation: {
      kwCombat: { pearson: pearson(ratings, kwCombat), spearman: spearman(ratings, kwCombat) },
      kwExploit: { pearson: pearson(ratings, kwExploit), spearman: spearman(ratings, kwExploit) },
      techDensityPer1kChars: { pearson: pearson(ratings, techDensity), spearman: spearman(ratings, techDensity) },
      mechanicsDensityPer1kChars: { pearson: pearson(ratings, mechanicsDensity), spearman: spearman(ratings, mechanicsDensity) },
    },
    samples: {
      highRatingLowTech,
      lowRatingHighTech,
      topTech: byTechDesc.slice(0, opts.topN),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('[tech-index-audit] 脚本执行失败:', error);
  process.exit(1);
});
