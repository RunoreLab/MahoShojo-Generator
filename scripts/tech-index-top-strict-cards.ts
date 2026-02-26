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
  updatedAt: string;
};

type CardRow = {
  id: string;
  name: string | null;
  data: string;
};

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

  const limitRaw = Number(args.get('--limit'));
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 30;

  const minGamesRaw = Number(args.get('--min-games'));
  const minGames = Number.isFinite(minGamesRaw) ? Math.max(0, Math.floor(minGamesRaw)) : 5;

  const full = args.get('--full') === '1' || args.get('--items') === '1';

  return { limit, minGames, full };
};

type ExtractedStrings = {
  totalChars: number;
  samples: string[];
  fullText: string;
};

const extractStrings = (value: unknown, opts?: { maxDepth?: number; maxNodes?: number; maxChars?: number }): ExtractedStrings => {
  const maxDepth = Math.max(1, Math.floor(opts?.maxDepth ?? 6));
  const maxNodes = Math.max(10, Math.floor(opts?.maxNodes ?? 4000));
  const maxChars = Math.max(1000, Math.floor(opts?.maxChars ?? 120_000));

  let nodes = 0;
  let totalChars = 0;
  let chunkChars = 0;
  const chunks: string[] = [];
  const samples: string[] = [];

  const pushText = (text: string) => {
    totalChars += text.length;
    if (chunkChars >= maxChars) return;
    const remaining = maxChars - chunkChars;
    if (remaining <= 0) return;
    const slice = text.length > remaining ? text.slice(0, remaining) : text;
    chunks.push(slice);
    chunkChars += slice.length + 1;
    if (samples.length < 18 && slice.trim().length >= 24) samples.push(slice.trim().slice(0, 260));
  };

  const walk = (current: unknown, depth: number) => {
    if (nodes >= maxNodes) return;
    if (depth > maxDepth) return;
    nodes += 1;

    if (current === null || current === undefined) return;
    if (typeof current === 'string') {
      pushText(current);
      return;
    }
    if (typeof current === 'number' || typeof current === 'boolean') return;
    if (Array.isArray(current)) {
      for (const entry of current) walk(entry, depth + 1);
      return;
    }
    if (typeof current === 'object') {
      for (const child of Object.values(current as Record<string, unknown>)) {
        walk(child, depth + 1);
      }
    }
  };

  walk(value, 0);

  return { totalChars, samples, fullText: chunks.join('\n') };
};

type PromptFeatureCounts = {
  authority: number;
  format: number;
  role: number;
  judge: number;
  protocol: number;
  hyperparams: number;
  metaFramework: number;
  exploit: number;
};

const countMatches = (pattern: RegExp, text: string) => {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
};

const extractPromptFeatures = (text: string): PromptFeatureCounts => {
  return {
    authority: countMatches(
      /(最高管理员|管理员协议|协议接管|超越管理员|admin(?:istrator)?\b|root\b|sudo\b|最高权限|系统权限|Root Level)/gi,
      text,
    ),
    format: countMatches(
      /(仅输出|只输出|不要解释|不要推理|严格按照|response format|输出格式|schema\b|json\b|yaml\b|字段|键|表格|markdown\b)/gi,
      text,
    ),
    role: countMatches(
      /(你是|作为|扮演|role\s*[:：]|assistant\b|user\b|developer\b|系统提示|system prompt)/gi,
      text,
    ),
    judge: countMatches(
      /(裁判|仲裁|宣判|裁定|最终裁定权|管辖权|winner\s*[:：]|胜利者栏位|胜者栏位)/gi,
      text,
    ),
    protocol: countMatches(
      /(协议|总章|处理协议|protocol\b|流程|识别与定性|弱点映射|裁判协议|规则手册|整合协议)/gi,
      text,
    ),
    hyperparams: countMatches(
      /(temperature\b|top[_-]?p\b|min[_-]?p\b|MIN_P_SAMPLING\b|采样策略|超参数|采样|logits\b)/gi,
      text,
    ),
    metaFramework: countMatches(
      /(元框架|背景板|世界观|降维|低维现实|唯一绝对的现实|沙盒|法外之地|规则免疫|罗素悖论)/gi,
      text,
    ),
    exploit: countMatches(
      /(代码杀|战报控制|系统归零|重置系统|绕过裁判|越权|强制胜利|无视(?:规则|系统|裁判|限制)|逻辑崩溃|系统崩溃|Bug\b|错误|矛盾)/gi,
      text,
    ),
  };
};

const sumCounts = (counts: PromptFeatureCounts) =>
  counts.authority +
  counts.format +
  counts.role +
  counts.judge +
  counts.protocol +
  counts.hyperparams +
  counts.metaFramework +
  counts.exploit;

async function main() {
  loadEnvConfig(process.cwd(), true);

  const opts = parseArgs(process.argv.slice(2));

  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.D1_DATABASE_ID) {
    throw new Error('缺少 Cloudflare D1 配置：CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID');
  }

  const topRows = (await listArenaRatedPublicCharacterCards({
    queue: 'strict',
    minGames: opts.minGames,
    limit: opts.limit,
  })) as EligibleRow[];
  const ids = topRows.map((row) => row.dataCardId).filter((id) => typeof id === 'string' && id.trim());
  if (!ids.length) {
    console.log(JSON.stringify({ ok: true, items: [], note: '没有符合条件的 strict 榜单数据。' }, null, 2));
    return;
  }

  const cardRows = (await listDataCardPayloadRowsByIds(ids)) as CardRow[];
  const cardById = new Map(cardRows.map((row) => [row.id, row] as const));

  const items: Array<{
    rank: number;
    dataCardId: string;
    name: string | null;
    rating: number;
    games: number;
    updatedAt: string;
    techScore: number;
    techLevel: string;
    promptEngineeringSignals: PromptFeatureCounts;
    promptEngineeringSignalSum: number;
    mechanicsSignals: { kwDice: number; kwCombat: number };
    structureSignals: { bulletLineCount: number; headingLineCount: number; jsonUniqueKeyCount: number };
    sizeSignals: { jsonStringCharsTotal: number; jsonLongestStringChars: number };
  }> = [];

  let parseFailed = 0;
  for (let i = 0; i < topRows.length; i += 1) {
    const row = topRows[i]!;
    const card = cardById.get(row.dataCardId);
    if (!card) continue;

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(card.data) as unknown;
    } catch {
      parsed = null;
    }
    if (!parsed) {
      parseFailed += 1;
      continue;
    }

    const extracted = extractStrings(parsed);
    const prompt = extractPromptFeatures(extracted.fullText);
    const tech = computeTechIndex(parsed);

    items.push({
      rank: i + 1,
      dataCardId: row.dataCardId,
      name: typeof card.name === 'string' ? card.name : null,
      rating: typeof row.rating === 'number' ? row.rating : Number(row.rating),
      games: typeof row.games === 'number' ? row.games : Number(row.games),
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : String(row.updatedAt),
      techScore: tech.techScore,
      techLevel: tech.techLevel,
      promptEngineeringSignals: prompt,
      promptEngineeringSignalSum: sumCounts(prompt),
      mechanicsSignals: { kwDice: tech.raw.kwDice, kwCombat: tech.raw.kwCombat },
      structureSignals: {
        bulletLineCount: tech.raw.bulletLineCount,
        headingLineCount: tech.raw.headingLineCount,
        jsonUniqueKeyCount: tech.raw.jsonUniqueKeyCount,
      },
      sizeSignals: {
        jsonStringCharsTotal: tech.raw.jsonStringCharsTotal,
        jsonLongestStringChars: tech.raw.jsonLongestStringChars,
      },
    });
  }

  const groupCount = (key: keyof PromptFeatureCounts) => items.filter((it) => it.promptEngineeringSignals[key] > 0).length;

  const summary = {
    queue: 'strict',
    minGames: opts.minGames,
    limit: opts.limit,
    full: opts.full,
    fetched: ids.length,
    parsed: items.length,
    parseFailed,
    promptEngineeringCoverage: {
      authority: groupCount('authority'),
      format: groupCount('format'),
      role: groupCount('role'),
      judge: groupCount('judge'),
      protocol: groupCount('protocol'),
      hyperparams: groupCount('hyperparams'),
      metaFramework: groupCount('metaFramework'),
      exploit: groupCount('exploit'),
    },
    topByPromptEngineeringSignalSum: [...items]
      .sort((a, b) => b.promptEngineeringSignalSum - a.promptEngineeringSignalSum || b.techScore - a.techScore)
      .slice(0, 12)
      .map((it) => ({
        rank: it.rank,
        dataCardId: it.dataCardId,
        name: it.name,
        rating: it.rating,
        games: it.games,
        techScore: it.techScore,
        sum: it.promptEngineeringSignalSum,
        signals: it.promptEngineeringSignals,
      })),
  };

  const output = opts.full ? { ...summary, items } : summary;

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error('[tech-index-top-strict-cards] 脚本执行失败:', error);
  process.exit(1);
});
