#!/usr/bin/env bun

import { loadEnvConfig } from '@next/env';

import {
  listArenaRatedPublicCharacterCards,
  listDataCardPayloadRowsByIds,
} from '@/lib/database/data-card-tech-index';
import { computeTechIndex } from '@/lib/metrics/techIndex';

type EligibleRow = {
  dataCardId: string;
  rating: number;
  games: number;
};

type CardRow = {
  id: string;
  data: string;
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

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const parseArgs = (argv: string[]) => {
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

  const stepRaw = Number(args.get('--step'));
  const step = Number.isFinite(stepRaw) ? Math.min(0.2, Math.max(0.02, stepRaw)) : 0.05;

  const minGamesRaw = Number(args.get('--min-games'));
  const minGames = Number.isFinite(minGamesRaw) ? Math.max(0, Math.floor(minGamesRaw)) : 5;

  const topKRaw = Number(args.get('--top'));
  const topK = Number.isFinite(topKRaw) ? Math.max(1, Math.min(50, Math.floor(topKRaw))) : 12;

  const minControlRaw = Number(args.get('--min-control'));
  const minControl = Number.isFinite(minControlRaw) ? clamp01(minControlRaw) : 0;

  const minMechanicsRaw = Number(args.get('--min-mechanics'));
  const minMechanics = Number.isFinite(minMechanicsRaw) ? clamp01(minMechanicsRaw) : 0;

  const minStructureRaw = Number(args.get('--min-structure'));
  const minStructure = Number.isFinite(minStructureRaw) ? clamp01(minStructureRaw) : 0;

  const minCodeRaw = Number(args.get('--min-code'));
  const minCode = Number.isFinite(minCodeRaw) ? clamp01(minCodeRaw) : 0;

  const maxSizeRaw = Number(args.get('--max-size'));
  const maxSize = Number.isFinite(maxSizeRaw) ? clamp01(maxSizeRaw) : 1;

  return {
    step,
    minGames,
    topK,
    constraints: {
      minControl,
      minMechanics,
      minStructure,
      minCode,
      maxSize,
    },
  };
};

type RowFeatures = {
  rating: number;
  scoreControl: number;
  scoreMechanics: number;
  scoreStructure: number;
  scoreCode: number;
  scoreSize: number;
  kwExploit: number;
  exploitBoost: number;
};

async function main() {
  loadEnvConfig(process.cwd(), true);

  const opts = parseArgs(process.argv.slice(2));

  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.D1_DATABASE_ID) {
    throw new Error('缺少 Cloudflare D1 配置：CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID');
  }

  const eligibleRows = (await listArenaRatedPublicCharacterCards({
    queue: 'strict',
    minGames: opts.minGames,
  })) as EligibleRow[];
  const ids = eligibleRows
    .map((row) => (typeof row.dataCardId === 'string' ? row.dataCardId.trim() : ''))
    .filter(Boolean);

  const dataById = new Map<string, string>();
  const chunkSize = 80;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batchIds = ids.slice(i, i + chunkSize);
    const cardRows = (await listDataCardPayloadRowsByIds(batchIds)) as CardRow[];
    for (const row of cardRows) {
      if (typeof row.id !== 'string') continue;
      if (typeof row.data !== 'string') continue;
      dataById.set(row.id, row.data);
    }
  }

  const features: RowFeatures[] = [];
  for (const row of eligibleRows) {
    const id = typeof row.dataCardId === 'string' ? row.dataCardId.trim() : '';
    if (!id) continue;
    const rawData = dataById.get(id);
    if (typeof rawData !== 'string' || !rawData.trim()) continue;

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawData) as unknown;
    } catch {
      parsed = null;
    }
    if (!parsed) continue;

    const tech = computeTechIndex(parsed);
    features.push({
      rating: typeof row.rating === 'number' ? row.rating : Number(row.rating),
      scoreControl: tech.components.scoreControl,
      scoreMechanics: tech.components.scoreMechanics,
      scoreStructure: tech.components.scoreStructure,
      scoreCode: tech.components.scoreCode,
      scoreSize: tech.components.scoreSize,
      kwExploit: tech.raw.kwExploit,
      exploitBoost: tech.raw.kwExploit > 0 ? 10 : 0,
    });
  }

  const ratings = features.map((f) => f.rating);

  const grid = (() => {
    const step = opts.step;
    const ticks = Math.round(1 / step);
    const values: number[] = [];
    for (let i = 0; i <= ticks; i += 1) values.push(i * step);
    values[values.length - 1] = 1;
    return values;
  })();

  const results: Array<{ weights: Record<string, number>; pearson: number | null; spearman: number | null }> = [];

  for (const wControl of grid) {
    for (const wMechanics of grid) {
      for (const wStructure of grid) {
        for (const wCode of grid) {
          const sum = wControl + wMechanics + wStructure + wCode;
          if (sum > 1) continue;
          const wSize = 1 - sum;
          if (wControl < opts.constraints.minControl) continue;
          if (wMechanics < opts.constraints.minMechanics) continue;
          if (wStructure < opts.constraints.minStructure) continue;
          if (wCode < opts.constraints.minCode) continue;
          if (wSize > opts.constraints.maxSize) continue;

          const scores: number[] = [];
          for (const f of features) {
            const base =
              100 *
              (wControl * f.scoreControl +
                wMechanics * f.scoreMechanics +
                wStructure * f.scoreStructure +
                wCode * f.scoreCode +
                wSize * f.scoreSize);
            const boosted = base + (f.kwExploit > 0 ? f.exploitBoost : 0);
            scores.push(Math.round(100 * clamp01(boosted / 100)));
          }

          const rPearson = pearson(ratings, scores);
          const rSpearman = spearman(ratings, scores);
          results.push({
            weights: {
              control: wControl,
              mechanics: wMechanics,
              structure: wStructure,
              code: wCode,
              size: wSize,
            },
            pearson: rPearson,
            spearman: rSpearman,
          });
        }
      }
    }
  }

  results.sort((a, b) => {
    const sa = a.spearman ?? -999;
    const sb = b.spearman ?? -999;
    if (sb !== sa) return sb - sa;
    const pa = a.pearson ?? -999;
    const pb = b.pearson ?? -999;
    return pb - pa;
  });

  console.log(
    JSON.stringify(
      {
        queue: 'strict',
        minGames: opts.minGames,
        n: features.length,
        step: opts.step,
        constraints: opts.constraints,
        top: results.slice(0, opts.topK),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[tech-index-tune-strict-weights] 脚本执行失败:', error);
  process.exit(1);
});
