import { computeTechIndex, DEFAULT_TECH_INDEX_CONFIG, type TechIndexConfig } from '@/lib/metrics/techIndex';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename } from 'node:path';

interface CliOptions {
  inputRoot: string;
  sampleLimit?: number;
  seed?: number;
  rankingFile?: string;
  rankingSearchRoot?: string;
}

const parseArgs = (argv: string[]): CliOptions => {
  const opts: Partial<CliOptions> = {};

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--input' || arg === '-i') {
      opts.inputRoot = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg === '--sample') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) opts.sampleLimit = value;
      i += 1;
      continue;
    }
    if (arg === '--seed') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) opts.seed = value;
      i += 1;
      continue;
    }
    if (arg === '--ranking') {
      opts.rankingFile = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--ranking-search-root') {
      opts.rankingSearchRoot = argv[i + 1];
      i += 1;
      continue;
    }
  }

  if (!opts.inputRoot) {
    throw new Error('缺少参数：--input <目录>，例如：--input "/mnt/d/04-生活与娱乐/魔法少女竞技场"');
  }

  return opts as CliOptions;
};

const decodeUtf16be = (buffer: Uint8Array) => {
  const swapped = new Uint8Array(buffer.byteLength);
  for (let i = 0; i < buffer.byteLength; i += 2) {
    swapped[i] = buffer[i + 1]!;
    swapped[i + 1] = buffer[i]!;
  }
  return new TextDecoder('utf-16le').decode(swapped);
};

const readTextWithBom = (filePath: string) => {
  const bytes = readFileSync(filePath);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16be(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  return new TextDecoder('utf-8').decode(bytes);
};

const safeParseJson = (text: string) => {
  const cleaned = text.replace(/^\uFEFF+/, '');
  return JSON.parse(cleaned) as unknown;
};

const listJsonFiles = async (root: string) => {
  const files: string[] = [];

  const walk = async (dir: string) => {
    let entries: Array<import('node:fs').Dirent> = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(path);
    }
  };

  await walk(root);
  return files;
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

const normalizeNameToken = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·•「」『』【】()[\]（）《》<>“”"':：,，。.!！?？\-—_]/g, '')
    .replace(/v\d+(\.\d+)?/g, '')
    .replace(/版本/g, '');

const splitNameTokens = (name: string) => {
  const parts = name
    .split(/[ \t·•【】「」『』()（）《》<>“”"':：,，。.!！?？\-—_]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  const tokens = new Set<string>();
  tokens.add(name);
  for (const part of parts) tokens.add(part);

  return [...tokens]
    .map((token) => normalizeNameToken(token))
    .filter((token) => token.length >= 2 && /[a-z\u4e00-\u9fff]/i.test(token))
    .sort((a, b) => b.length - a.length);
};

type RankingTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T10086';

const parseRanking = (rankingText: string) => {
  const lines = rankingText.split(/\r?\n/);
  let currentTier: RankingTier | null = null;
  const entries: Array<{ tier: RankingTier; name: string }> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('备注')) {
      currentTier = null;
      continue;
    }

    if (line.startsWith('T0')) currentTier = 'T0';
    else if (line.includes('T1')) currentTier = 'T1';
    else if (line.includes('T2')) currentTier = 'T2';
    else if (line.includes('T3')) currentTier = 'T3';
    else if (line.includes('T10086')) currentTier = 'T10086';

    if (!currentTier) continue;
    if (!line.startsWith('·')) continue;
    const name = line.replace(/^·\s*/, '').trim();
    if (!name) continue;
    entries.push({ tier: currentTier, name });
  }

  return entries;
};

const findBestMatchFile = (name: string, candidateFiles: string[]) => {
  const tokens = splitNameTokens(name);
  if (tokens.length === 0) return null;
  let best: { file: string; score: number; matchedTokenLength: number } | null = null;
  for (const file of candidateFiles) {
    const base = basename(file, '.json');
    const normalizedBase = normalizeNameToken(base);
    let matchedTokenLength = 0;
    for (const token of tokens) {
      if (normalizedBase.includes(token)) {
        matchedTokenLength = token.length;
        break;
      }
    }
    if (matchedTokenLength === 0) continue;

    const folderBias = file.includes('/ALL/')
      ? -12
      : file.includes('/守擂选手/')
        ? -6
        : file.includes('/参赛选手/')
          ? 6
          : 0;
    const score = Math.abs(normalizedBase.length - matchedTokenLength) + folderBias;
    if (!best) {
      best = { file, score, matchedTokenLength };
      continue;
    }
    if (matchedTokenLength > best.matchedTokenLength) {
      best = { file, score, matchedTokenLength };
      continue;
    }
    if (matchedTokenLength === best.matchedTokenLength && score < best.score) {
      best = { file, score, matchedTokenLength };
    }
  }

  return best?.file ?? null;
};

const tierRankValue: Record<RankingTier, number> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
  T10086: 4
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

const computeTechIndexWithOverrides = (jsonValue: unknown, overrides?: Partial<TechIndexConfig>) => {
  const config = overrides
    ? ({
        ...DEFAULT_TECH_INDEX_CONFIG,
        ...overrides,
        limits: { ...DEFAULT_TECH_INDEX_CONFIG.limits, ...overrides.limits },
        caps: { ...DEFAULT_TECH_INDEX_CONFIG.caps, ...overrides.caps },
        weights: { ...DEFAULT_TECH_INDEX_CONFIG.weights, ...overrides.weights }
      } satisfies TechIndexConfig)
    : DEFAULT_TECH_INDEX_CONFIG;
  return computeTechIndex(jsonValue, config);
};

const main = async () => {
  const opts = parseArgs(process.argv);
  const inputFiles = await listJsonFiles(opts.inputRoot);

  const seed = opts.seed ?? 42;
  const rng = (() => {
    let x = seed >>> 0;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 2 ** 32;
    };
  })();

  const shuffled = [...inputFiles];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }

  const files =
    opts.sampleLimit && opts.sampleLimit < shuffled.length ? shuffled.slice(0, opts.sampleLimit) : shuffled;
  const scores: number[] = [];
  const levels: Record<string, number> = {};
  let parsed = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const json = safeParseJson(readTextWithBom(file));
      const result = computeTechIndexWithOverrides(json);
      parsed += 1;
      scores.push(result.techScore);
      levels[result.techLevel] = (levels[result.techLevel] ?? 0) + 1;
    } catch {
      failed += 1;
    }
  }

  const distribution = {
    scanned: files.length,
    parsed,
    failed,
    score: {
      mean: mean(scores),
      p50: percentile(scores, 0.5),
      p80: percentile(scores, 0.8),
      p90: percentile(scores, 0.9),
      p95: percentile(scores, 0.95),
      p99: percentile(scores, 0.99),
      max: scores.length ? Math.max(...scores) : null
    },
    levelCounts: levels
  };

  console.log('=== Tech Index 分布（样本）===');
  console.log(JSON.stringify(distribution, null, 2));

  if (!opts.rankingFile) return;
  const rankingText = readTextWithBom(opts.rankingFile);
  const rankingEntries = parseRanking(rankingText);

  const searchRoot = opts.rankingSearchRoot ?? opts.inputRoot;
  const searchFiles = await listJsonFiles(searchRoot);

  const rankingRows: Array<{
    tier: RankingTier;
    name: string;
    file: string | null;
    techScore: number | null;
    techLevel: string | null;
  }> = [];

  const tierScores: Record<RankingTier, number[]> = { T0: [], T1: [], T2: [], T3: [], T10086: [] };
  const tierRanks: number[] = [];
  const tierScoreVector: number[] = [];

  for (const entry of rankingEntries) {
    const file = findBestMatchFile(entry.name, searchFiles);
    if (!file) {
      rankingRows.push({ tier: entry.tier, name: entry.name, file: null, techScore: null, techLevel: null });
      continue;
    }

    try {
      const json = safeParseJson(readTextWithBom(file));
      const result = computeTechIndexWithOverrides(json);
      rankingRows.push({ tier: entry.tier, name: entry.name, file, techScore: result.techScore, techLevel: result.techLevel });
      tierScores[entry.tier].push(result.techScore);
      tierRanks.push(tierRankValue[entry.tier]);
      tierScoreVector.push(result.techScore);
    } catch {
      rankingRows.push({ tier: entry.tier, name: entry.name, file, techScore: null, techLevel: null });
    }
  }

  const tierSummary = (Object.keys(tierScores) as RankingTier[]).map((tier) => {
    const values = tierScores[tier];
    return {
      tier,
      n: values.length,
      mean: mean(values),
      p50: percentile(values, 0.5),
      p80: percentile(values, 0.8),
      p90: percentile(values, 0.9),
      max: values.length ? Math.max(...values) : null
    };
  });

  const rho = spearman(tierRanks, tierScoreVector);
  const unmatchedNames = rankingRows.filter((row) => row.file === null).map((row) => row.name);
  const parseFailedNames = rankingRows.filter((row) => row.file !== null && row.techScore === null).map((row) => row.name);

  console.log('\n=== 榜单角色对照（V8.0）===');
  console.log(
    JSON.stringify(
      {
        rankingEntries: rankingEntries.length,
        matched: rankingRows.filter((row) => row.techScore !== null).length,
        unmatched: rankingRows.filter((row) => row.file === null).length,
        parseFailed: rankingRows.filter((row) => row.file !== null && row.techScore === null).length,
        spearmanRho: rho,
        tierSummary,
        unmatchedNames,
        parseFailedNames
      },
      null,
      2
    )
  );

  const worstTierRows = rankingRows
    .filter((row) => row.techScore !== null)
    .sort((a, b) => (a.techScore! - b.techScore!));
  const bestTierRows = rankingRows
    .filter((row) => row.techScore !== null)
    .sort((a, b) => (b.techScore! - a.techScore!));

  console.log('\n=== 榜单角色 Top 15（techScore最高）===');
  console.log(
    JSON.stringify(
      bestTierRows.slice(0, 15).map((row) => ({ tier: row.tier, name: row.name, techScore: row.techScore, techLevel: row.techLevel, file: row.file })),
      null,
      2
    )
  );
  console.log('\n=== 榜单角色 Bottom 15（techScore最低）===');
  console.log(
    JSON.stringify(
      worstTierRows.slice(0, 15).map((row) => ({ tier: row.tier, name: row.name, techScore: row.techScore, techLevel: row.techLevel, file: row.file })),
      null,
      2
    )
  );
};

await main();
