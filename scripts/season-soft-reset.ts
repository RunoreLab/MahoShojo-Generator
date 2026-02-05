import { loadEnvConfig } from '@next/env';

import {
  computeSeasonStartRating,
  computeSeasonStartRatingAdvanced,
  type GamesFactorSchedule,
  type InactivityFactorCap,
  type SeasonResetPolicy,
} from '@/lib/arena/season-reset';
import { deriveSeasonResetAutoTuning, type SeasonResetAutoTuningResult, type SeasonResetAutoTuningStats } from '@/lib/arena/season-reset-auto';

type Queue = 'strict' | 'free' | 'all';
type ArenaQueue = 'strict' | 'free';

type QueryFromD1 = (sql: string, params?: unknown[]) => Promise<unknown>;

const hasD1Config = (): boolean => {
  return Boolean(process.env.D1_DATABASE_ID && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
};

const readRows = <T>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const readChanges = (result: unknown): number => {
  const changes = (result as any)?.result?.[0]?.meta?.changes;
  return typeof changes === 'number' && Number.isFinite(changes) ? Math.max(0, Math.floor(changes)) : 0;
};

const parseArgs = (argv: string[]) => {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
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
      i++;
      continue;
    }
    args.set(key, '1');
  }
  return args;
};

const parseQueue = (value: string | undefined): Queue => {
  const v = (value ?? '').trim();
  if (v === 'strict' || v === 'free' || v === 'all') return v;
  return 'all';
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const parsePolicy = (value: string | undefined): SeasonResetPolicy => {
  const v = (value ?? '').trim();
  if (v === 'soft' || v === 'hundreds_toward_base') return v;
  return 'hundreds_toward_base';
};

const parseIntArg = (value: string | undefined, fallback: number): number => {
  const n = parseNumber(value, fallback);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
};

const parseFactorArg = (value: string | undefined, fallback: number): number => {
  const n = parseNumber(value, fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};

const hasAnyFlag = (args: Map<string, string>, flags: string[]): boolean => {
  for (const f of flags) {
    if (args.has(f)) return true;
  }
  return false;
};

const queryQueueStats = async (queryFromD1: QueryFromD1, queue: Queue) => {
  const where = queue === 'all' ? '' : 'WHERE queue = ?';
  const params: unknown[] = queue === 'all' ? [] : [queue];
  const sql = `SELECT queue, COUNT(*) as count, MIN(rating) as minRating, MAX(rating) as maxRating
    FROM arena_ratings
    ${where}
    GROUP BY queue
    ORDER BY queue ASC;`;
  const result = await queryFromD1(sql, params);
  return readRows<{ queue: string; count: number; minRating: number; maxRating: number }>(result);
};

type RatingSampleRow = {
  entityType: string;
  entityId: string;
  queue: ArenaQueue;
  rating: number;
  games: number;
  updatedAt: string;
};

const queryRatingSamples = async (queryFromD1: QueryFromD1, queue: ArenaQueue, limit: number) => {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.min(50, Math.floor(limit))) : 0;
  if (safeLimit <= 0) return { top: [] as RatingSampleRow[], bottom: [] as RatingSampleRow[] };

  const where = 'WHERE queue = ?';
  const params: unknown[] = [queue];

  const baseSql = `SELECT entity_type as entityType, entity_id as entityId, queue, rating, games, updated_at as updatedAt
    FROM arena_ratings
    ${where}`;

  const topResult = await queryFromD1(
    `${baseSql}
     ORDER BY rating DESC, games DESC, updated_at DESC, entity_type ASC, entity_id ASC
     LIMIT ?;`,
    [...params, safeLimit]
  );
  const bottomResult = await queryFromD1(
    `${baseSql}
     ORDER BY rating ASC, games DESC, updated_at DESC, entity_type ASC, entity_id ASC
     LIMIT ?;`,
    [...params, safeLimit]
  );

  return {
    top: readRows<RatingSampleRow>(topResult),
    bottom: readRows<RatingSampleRow>(bottomResult),
  };
};

type AutoTuningSummaryRow = {
  total: number;
  played: number;
  maxRatingPlayed: number | null;
  top20AvgRatingPlayed: number | null;
  aboveMaxStartPlayed: number;
  inactive30DaysPlayed: number;
};

const queryAutoTuningSummary = async (
  queryFromD1: QueryFromD1,
  queue: ArenaQueue,
  nowIso: string,
  maxStartRating: number
): Promise<AutoTuningSummaryRow> => {
  const result = await queryFromD1(
    `SELECT
      (SELECT COUNT(*) FROM arena_ratings WHERE queue = ?) as total,
      (SELECT COUNT(*) FROM arena_ratings WHERE queue = ? AND games > 0) as played,
      (SELECT MAX(rating) FROM arena_ratings WHERE queue = ? AND games > 0) as maxRatingPlayed,
      (SELECT AVG(rating) FROM (SELECT rating FROM arena_ratings WHERE queue = ? AND games > 0 ORDER BY rating DESC LIMIT 20)) as top20AvgRatingPlayed,
      (SELECT COUNT(*) FROM arena_ratings WHERE queue = ? AND games > 0 AND rating >= ?) as aboveMaxStartPlayed,
      (SELECT COUNT(*) FROM arena_ratings WHERE queue = ? AND games > 0 AND (julianday(?) - julianday(updated_at)) >= 30) as inactive30DaysPlayed`,
    [queue, queue, queue, queue, queue, maxStartRating, queue, nowIso]
  );
  const row = readRows<AutoTuningSummaryRow>(result)[0];
  return {
    total: typeof row?.total === 'number' ? Math.max(0, Math.floor(row.total)) : 0,
    played: typeof row?.played === 'number' ? Math.max(0, Math.floor(row.played)) : 0,
    maxRatingPlayed: typeof row?.maxRatingPlayed === 'number' ? Math.max(0, Math.floor(row.maxRatingPlayed)) : null,
    top20AvgRatingPlayed: typeof row?.top20AvgRatingPlayed === 'number' ? row.top20AvgRatingPlayed : null,
    aboveMaxStartPlayed: typeof row?.aboveMaxStartPlayed === 'number' ? Math.max(0, Math.floor(row.aboveMaxStartPlayed)) : 0,
    inactive30DaysPlayed: typeof row?.inactive30DaysPlayed === 'number' ? Math.max(0, Math.floor(row.inactive30DaysPlayed)) : 0,
  };
};

type QuantilesRow = { n: number; p25: number | null; p60: number | null };

const queryPlayedGamesQuantiles = async (queryFromD1: QueryFromD1, queue: ArenaQueue): Promise<QuantilesRow> => {
  const countResult = await queryFromD1(
    `SELECT COUNT(*) as n
     FROM arena_ratings
     WHERE queue = ? AND games > 0;`,
    [queue]
  );
  const countRow = readRows<{ n: number }>(countResult)[0];
  const n = typeof countRow?.n === 'number' ? Math.max(0, Math.floor(countRow.n)) : 0;
  if (n <= 0) return { n: 0, p25: null, p60: null };

  const offset25 = Math.max(0, Math.floor((n - 1) * 0.25));
  const offset60 = Math.max(0, Math.floor((n - 1) * 0.6));

  const p25Result = await queryFromD1(
    `SELECT games as value
     FROM arena_ratings
     WHERE queue = ? AND games > 0
     ORDER BY games ASC
     LIMIT 1 OFFSET ?;`,
    [queue, offset25]
  );
  const p60Result = await queryFromD1(
    `SELECT games as value
     FROM arena_ratings
     WHERE queue = ? AND games > 0
     ORDER BY games ASC
     LIMIT 1 OFFSET ?;`,
    [queue, offset60]
  );

  const p25Row = readRows<{ value: number }>(p25Result)[0];
  const p60Row = readRows<{ value: number }>(p60Result)[0];

  return {
    n,
    p25: typeof p25Row?.value === 'number' ? Math.max(0, Math.floor(p25Row.value)) : null,
    p60: typeof p60Row?.value === 'number' ? Math.max(0, Math.floor(p60Row.value)) : null,
  };
};

type InactiveQuantilesRow = { n: number; p85: number | null };

const queryPlayedInactiveDaysP85 = async (
  queryFromD1: QueryFromD1,
  queue: ArenaQueue,
  nowIso: string
): Promise<InactiveQuantilesRow> => {
  const countResult = await queryFromD1(
    `SELECT COUNT(*) as n
     FROM arena_ratings
     WHERE queue = ? AND games > 0;`,
    [queue]
  );
  const countRow = readRows<{ n: number }>(countResult)[0];
  const n = typeof countRow?.n === 'number' ? Math.max(0, Math.floor(countRow.n)) : 0;
  if (n <= 0) return { n: 0, p85: null };

  const offset85 = Math.max(0, Math.floor((n - 1) * 0.85));
  const valueResult = await queryFromD1(
    `SELECT (julianday(?) - julianday(updated_at)) as inactiveDays
     FROM arena_ratings
     WHERE queue = ? AND games > 0
     ORDER BY inactiveDays ASC
     LIMIT 1 OFFSET ?;`,
    [nowIso, queue, offset85]
  );
  const row = readRows<{ inactiveDays: number }>(valueResult)[0];
  return {
    n,
    p85: typeof row?.inactiveDays === 'number' ? Math.max(0, row.inactiveDays) : null,
  };
};

const querySeasonResetAutoTuningStats = async (
  queryFromD1: QueryFromD1,
  queue: ArenaQueue,
  nowIso: string,
  maxStartRating: number
): Promise<SeasonResetAutoTuningStats> => {
  const [summary, gamesQuantiles, inactiveQuantiles] = await Promise.all([
    queryAutoTuningSummary(queryFromD1, queue, nowIso, maxStartRating),
    queryPlayedGamesQuantiles(queryFromD1, queue),
    queryPlayedInactiveDaysP85(queryFromD1, queue, nowIso),
  ]);

  return {
    total: summary.total,
    played: summary.played,
    maxRatingPlayed: summary.maxRatingPlayed,
    top20AvgRatingPlayed: summary.top20AvgRatingPlayed,
    aboveMaxStartPlayed: summary.aboveMaxStartPlayed,
    gamesP25Played: gamesQuantiles.p25,
    gamesP60Played: gamesQuantiles.p60,
    inactiveP85DaysPlayed: inactiveQuantiles.p85,
    inactive30DaysPlayed: summary.inactive30DaysPlayed,
  };
};

const formatAutoTuning = (queue: ArenaQueue, auto: SeasonResetAutoTuningResult) => {
  const gf = auto.gamesFactor;
  const ic = auto.inactivityCap;
  const m = auto.meta;
  return [
    `[auto] queue=${queue}`,
    `stats: spread=${m.spread} norm=${m.spreadNormalized.toFixed(2)} aboveMax=${(m.aboveMaxStartRatio * 100).toFixed(1)}% inactive30=${(m.inactive30Ratio * 100).toFixed(1)}%`,
    `gamesFactor: gamesMid=${gf.gamesMid} gamesHigh=${gf.gamesHigh} factorLow=${gf.factorLow.toFixed(3)} factorMid=${gf.factorMid.toFixed(3)} factorHigh=${gf.factorHigh.toFixed(3)}`,
    `inactivityCap: inactiveDays=${ic.inactiveDays} inactiveFactor=${ic.inactiveFactor.toFixed(3)}`,
  ].join('\n  ');
};

const main = async () => {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.has('--help') || args.has('-h')) {
    console.log(`[season-soft-reset]
用法：
  bun tsx scripts/season-soft-reset.ts [--queue all|strict|free] [--policy soft|hundreds_toward_base] [--base 1000] [--factor 1] [--step 100] [--min-start 800] [--max-start 1500] [--apply] [--dry-run] [--require-db]

默认策略（更像成熟排位的赛季收敛）：
  policy=hundreds_toward_base（向初始值方向“整档/整百”归位）
  1) raw = round(base + (oldRating - base) * factor)
  2) raw < base：向上取整到 step（例如 901→1000）
     raw >= base：向下取整到 step（例如 1099→1000）
  3) clamp 到 [minStart, maxStart]

默认会启用“动态回收”（auto tuning）：
  - 按上赛季对局数（games）分段回收力度
  - 按活跃度（updated_at 距今天数）额外回收
  - 参数从数据库读取，并根据当前赛季排行榜状况智能推导

  如需回退到“仅整百归位 + 上下限夹紧”（不启用动态回收），传入：--no-auto（或 --manual）
  如需仅关闭其中一项：
    --no-factor-by-games
    --no-inactivity

可选策略（旧版）：
  policy=soft（仅执行 Soft Reset）：
    newRating = round(base + (oldRating - base) * factor)
    并 clamp 到 [minStart, maxStart]
  并清空 games / wins / losses / draws（新赛季重新定级）

进阶机制（可选，支持手动指定参数；auto tuning 也会使用同一套机制）：
  1) 按上赛季对局数分段回收力度（更像“场次越少越不确定，回收到 base 越多”）
     - 手动开启方式：传入任意 --factor-by-games / --factor-low / --factor-mid / --factor-high
     - 规则：
       games < gamesMid  -> factorLow
       games < gamesHigh -> factorMid
       else              -> factorHigh
     - 参数：
       --games-mid 10 --games-high 30 --factor-low 0.6 --factor-mid 0.8 --factor-high 1

  2) 不活跃额外回收（按 updated_at 计算，与上面机制叠加，取更小 factor）
     - 手动开启方式：--inactive-days 30（配合 --inactive-factor 0.7）
     - 规则：若距今 >= inactiveDays，则 effectiveFactor = min(factor, inactiveFactor)

观测工具（可选）：
  --preview 10：在 dry-run 时打印 top/bottom 样例的 old→new 变化，便于确认参数效果
  `);
    return;
  }

  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

  const queue = parseQueue(args.get('--queue'));
  const policy = parsePolicy(args.get('--policy') ?? args.get('--mode'));
  const base = Math.floor(parseNumber(args.get('--base'), 1000));
  const step = Math.floor(parseNumber(args.get('--step'), 100));
  const minStart = Math.floor(parseNumber(args.get('--min-start') ?? args.get('--minStart'), 800));
  const maxStart = Math.floor(parseNumber(args.get('--max-start') ?? args.get('--maxStart'), 1500));
  const defaultFactor = policy === 'soft' ? 0.5 : 1;
  const factor = parseFactorArg(args.get('--factor'), defaultFactor);

  const manualGamesFactorRequested =
    args.has('--factor-by-games') ||
    args.has('--factorByGames') ||
    hasAnyFlag(args, ['--factor-low', '--factor-mid', '--factor-high', '--games-mid', '--games-high']);

  const manualGamesMid = parseIntArg(args.get('--games-mid') ?? args.get('--gamesMid'), 10);
  const manualGamesHigh = parseIntArg(args.get('--games-high') ?? args.get('--gamesHigh'), 30);
  const manualFactorLow = parseFactorArg(args.get('--factor-low') ?? args.get('--factorLow'), 0.6);
  const manualFactorMid = parseFactorArg(args.get('--factor-mid') ?? args.get('--factorMid'), 0.8);
  const manualFactorHigh = parseFactorArg(args.get('--factor-high') ?? args.get('--factorHigh'), 1);

  const manualInactivityFlagged = hasAnyFlag(args, ['--inactive-days', '--inactiveDays', '--inactive-factor', '--inactiveFactor']);
  const manualInactiveDays = parseIntArg(args.get('--inactive-days') ?? args.get('--inactiveDays'), 0);
  const manualInactiveFactor = parseFactorArg(args.get('--inactive-factor') ?? args.get('--inactiveFactor'), 0.7);
  const manualInactivityEnabled = manualInactiveDays > 0;

  const preview = parseIntArg(args.get('--preview'), 0);

  const apply = args.has('--apply') || args.has('--yes') || args.has('-y');
  const dryRun = args.has('--dry-run') || args.has('--dryRun') || !apply;
  const requireDb = args.has('--require-db') || args.has('--requireDb');

  const autoDisabled = args.has('--no-auto') || args.has('--noAuto') || args.has('--manual');
  const autoGamesDisabled = args.has('--no-factor-by-games') || args.has('--noFactorByGames');
  const autoInactivityDisabled = args.has('--no-inactivity') || args.has('--noInactivity');

  const autoEnabled = !autoDisabled;
  const autoGamesEnabled = autoEnabled && !autoGamesDisabled;
  const autoInactivityEnabled = autoEnabled && !autoInactivityDisabled;

  // 统一在脚本入口做一次校验，避免 UPDATE 中途“半写入”。
  computeSeasonStartRating(base, {
    policy,
    baseRating: base,
    factor,
    step,
    minStartRating: minStart,
    maxStartRating: maxStart,
  });
  if (manualGamesFactorRequested) {
    if (manualGamesMid < 0) throw new Error('参数错误：--games-mid 必须 >= 0');
    if (manualGamesHigh < manualGamesMid) throw new Error('参数错误：--games-high 必须 >= --games-mid');
  }
  if (manualInactivityEnabled && manualInactiveDays < 0) throw new Error('参数错误：--inactive-days 必须 >= 0');

  if (!hasD1Config()) {
    if (requireDb) throw new Error('缺少 D1 配置（CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID）');
    console.warn('[season-soft-reset] 未检测到 D1 配置，跳过实际重置（仅用于本地/CI 验证）。');
    return;
  }

  const { queryFromD1 } = await import('../lib/d1');
  const nowIso = new Date().toISOString();

  const targetQueues: ArenaQueue[] = queue === 'all' ? ['strict', 'free'] : [queue];

  const resolveAdvancedForQueue = async (q: ArenaQueue) => {
    const manualGamesFactor: GamesFactorSchedule | null = manualGamesFactorRequested && !autoGamesDisabled
      ? {
          enabled: true,
          gamesMid: manualGamesMid,
          gamesHigh: manualGamesHigh,
          factorLow: manualFactorLow,
          factorMid: manualFactorMid,
          factorHigh: manualFactorHigh,
        }
      : null;

    const manualInactivityCap: InactivityFactorCap | null = manualInactivityEnabled && !autoInactivityDisabled
      ? {
          enabled: true,
          inactiveDays: manualInactiveDays,
          inactiveFactor: manualInactiveFactor,
        }
      : null;

    const shouldAutoGames = autoGamesEnabled && !manualGamesFactorRequested;
    const shouldAutoInactivity = autoInactivityEnabled && !manualInactivityFlagged;
    const needsAuto = shouldAutoGames || shouldAutoInactivity;

    const auto = needsAuto
      ? deriveSeasonResetAutoTuning({
          baseRating: base,
          maxStartRating: maxStart,
          stats: await querySeasonResetAutoTuningStats(queryFromD1, q, nowIso, maxStart),
        })
      : null;

    const gamesFactor = manualGamesFactor ?? (shouldAutoGames ? auto?.gamesFactor ?? null : null);
    const inactivityCap = manualInactivityCap ?? (shouldAutoInactivity ? auto?.inactivityCap ?? null : null);

    return { queue: q, gamesFactor, inactivityCap, auto };
  };

  const resolved = await Promise.all(targetQueues.map(resolveAdvancedForQueue));

  const before = await queryQueueStats(queryFromD1, queue);
  console.log('[season-soft-reset] 重置前：', before);

  if (dryRun) {
    console.log(`[season-soft-reset] dry-run：queue=${queue} policy=${policy} base=${base} factor=${factor} step=${step} minStart=${minStart} maxStart=${maxStart} auto=${autoEnabled ? 1 : 0}`);
    for (const r of resolved) {
      if (r.auto) console.log(`[season-soft-reset] ${formatAutoTuning(r.queue, r.auto)}`);
      console.log(
        `[season-soft-reset] resolved：queue=${r.queue} factorByGames=${r.gamesFactor?.enabled ? 1 : 0} gamesMid=${r.gamesFactor?.gamesMid ?? 0} gamesHigh=${r.gamesFactor?.gamesHigh ?? 0} factorLow=${r.gamesFactor?.factorLow ?? 0} factorMid=${r.gamesFactor?.factorMid ?? 0} factorHigh=${r.gamesFactor?.factorHigh ?? 0} inactivity=${r.inactivityCap?.enabled ? 1 : 0} inactiveDays=${r.inactivityCap?.inactiveDays ?? 0} inactiveFactor=${r.inactivityCap?.inactiveFactor ?? 0}`
      );
    }

    if (preview > 0) {
      const print = (title: string, rows: RatingSampleRow[]) => {
        console.log(`[season-soft-reset] 预览：${title}（${rows.length} 条）`);
        for (const row of rows) {
          const oldRating = typeof row.rating === 'number' ? row.rating : base;
          const games = typeof row.games === 'number' ? row.games : 0;
          const updatedAtIso = typeof row.updatedAt === 'string' ? row.updatedAt : nowIso;
          const perQueue = resolved.find((r) => r.queue === row.queue);
          const advancedOpts = {
            policy,
            baseRating: base,
            factor,
            step,
            minStartRating: minStart,
            maxStartRating: maxStart,
            gamesFactor: perQueue?.gamesFactor ?? null,
            inactivityCap: perQueue?.inactivityCap ?? null,
          } as const;
          const next = computeSeasonStartRatingAdvanced(oldRating, { games, updatedAtIso }, advancedOpts, nowIso);
          console.log(
            `  ${row.queue}\t${row.entityType}\t${row.entityId}\t${oldRating}\t(g=${games})\t${updatedAtIso}\t=>\t${next}`
          );
        }
      };

      for (const q of targetQueues) {
        const samples = await queryRatingSamples(queryFromD1, q, preview);
        print(`Top (${q})`, samples.top);
        print(`Bottom (${q})`, samples.bottom);
      }
    }

    if (!apply) {
      console.log('[season-soft-reset] 未传入 --apply，已跳过实际更新。');
      console.log('  如需执行写入，请运行：bun tsx scripts/season-soft-reset.ts --apply');
    }
    return;
  }

  const buildBaseFactorExpr = (gamesFactor: GamesFactorSchedule | null): { expr: string; params: unknown[] } => {
    if (!gamesFactor?.enabled) return { expr: '?', params: [factor] };
    return {
      expr: `CASE
  WHEN arena_ratings.games < ? THEN ?
  WHEN arena_ratings.games < ? THEN ?
  ELSE ?
END`,
      params: [gamesFactor.gamesMid, gamesFactor.factorLow, gamesFactor.gamesHigh, gamesFactor.factorMid, gamesFactor.factorHigh],
    };
  };

  const buildRatingExpr = (gamesFactor: GamesFactorSchedule | null, inactivityCap: InactivityFactorCap | null): { expr: string; params: unknown[] } => {
    const baseFactor = buildBaseFactorExpr(gamesFactor);
    const inactiveDaysValue = inactivityCap?.enabled ? inactivityCap.inactiveDays : 0;
    const inactiveFactorValue = inactivityCap?.enabled ? inactivityCap.inactiveFactor : 1;

    if (policy === 'soft') {
      return {
        expr: `(
  WITH vars(base, baseFactor, minRating, maxRating, nowIso, inactiveDays, inactiveFactor) AS (
    SELECT
      ? AS base,
      ${baseFactor.expr} AS baseFactor,
      ? AS minRating,
      ? AS maxRating,
      ? AS nowIso,
      ? AS inactiveDays,
      ? AS inactiveFactor
  )
  , eff(effFactor, base, minRating, maxRating) AS (
    SELECT
      CASE
        WHEN inactiveDays > 0 AND (julianday(nowIso) - julianday(arena_ratings.updated_at)) >= inactiveDays
          THEN MIN(baseFactor, inactiveFactor)
        ELSE baseFactor
      END,
      base, minRating, maxRating
    FROM vars
  )
  , calc(raw, minRating, maxRating) AS (
    SELECT
      CAST(ROUND(base + (arena_ratings.rating - base) * effFactor) AS INTEGER),
      minRating,
      maxRating
    FROM eff
  )
  SELECT CAST(MIN(maxRating, MAX(minRating, raw)) AS INTEGER) FROM calc
)`,
        params: [base, ...baseFactor.params, minStart, maxStart, nowIso, inactiveDaysValue, inactiveFactorValue],
      };
    }

    return {
      expr: `(
  WITH vars(base, baseFactor, step, minRating, maxRating, nowIso, inactiveDays, inactiveFactor) AS (
    SELECT
      ? AS base,
      ${baseFactor.expr} AS baseFactor,
      ? AS step,
      ? AS minRating,
      ? AS maxRating,
      ? AS nowIso,
      ? AS inactiveDays,
      ? AS inactiveFactor
  )
  , eff(effFactor, base, step, minRating, maxRating) AS (
    SELECT
      CASE
        WHEN inactiveDays > 0 AND (julianday(nowIso) - julianday(arena_ratings.updated_at)) >= inactiveDays
          THEN MIN(baseFactor, inactiveFactor)
        ELSE baseFactor
      END,
      base, step, minRating, maxRating
    FROM vars
  )
  , calc(raw, base, step, minRating, maxRating) AS (
    SELECT
      CAST(ROUND(base + (arena_ratings.rating - base) * effFactor) AS INTEGER),
      base,
      step,
      minRating,
      maxRating
    FROM eff
  )
  SELECT CAST(
    MIN(maxRating, MAX(minRating,
      CASE
        WHEN raw < base THEN CAST((raw + step - 1) / step AS INTEGER) * step
        ELSE CAST(raw / step AS INTEGER) * step
      END
    )) AS INTEGER
  )
  FROM calc
)`,
      params: [base, ...baseFactor.params, step, minStart, maxStart, nowIso, inactiveDaysValue, inactiveFactorValue],
    };
  };

  let changes = 0;
  console.log(`[season-soft-reset] apply：queue=${queue} policy=${policy} base=${base} factor=${factor} step=${step} minStart=${minStart} maxStart=${maxStart} auto=${autoEnabled ? 1 : 0}`);
  for (const r of resolved) {
    if (r.auto) console.log(`[season-soft-reset] ${formatAutoTuning(r.queue, r.auto)}`);
    console.log(
      `[season-soft-reset] resolved：queue=${r.queue} factorByGames=${r.gamesFactor?.enabled ? 1 : 0} gamesMid=${r.gamesFactor?.gamesMid ?? 0} gamesHigh=${r.gamesFactor?.gamesHigh ?? 0} factorLow=${r.gamesFactor?.factorLow ?? 0} factorMid=${r.gamesFactor?.factorMid ?? 0} factorHigh=${r.gamesFactor?.factorHigh ?? 0} inactivity=${r.inactivityCap?.enabled ? 1 : 0} inactiveDays=${r.inactivityCap?.inactiveDays ?? 0} inactiveFactor=${r.inactivityCap?.inactiveFactor ?? 0}`
    );
  }
  for (const r of resolved) {
    const { expr: ratingExpr, params: ratingParams } = buildRatingExpr(r.gamesFactor, r.inactivityCap);
    const params: unknown[] = [...ratingParams, nowIso, r.queue];
    const updateSql = `UPDATE arena_ratings
      SET rating = ${ratingExpr},
          games = 0,
          wins = 0,
          losses = 0,
          draws = 0,
          last_delta = NULL,
          last_applied_at = NULL,
          updated_at = ?
      WHERE queue = ?;`;
    try {
      const updateResult = await queryFromD1(updateSql, params);
      changes += readChanges(updateResult);
    } catch (error) {
      console.warn('[season-soft-reset] 更新 last_delta / last_applied_at 失败（将回退到旧字段集）:', error);
      const fallbackSql = `UPDATE arena_ratings
        SET rating = ${ratingExpr},
            games = 0,
            wins = 0,
            losses = 0,
            draws = 0,
            updated_at = ?
        WHERE queue = ?;`;
      const updateResult = await queryFromD1(fallbackSql, params);
      changes += readChanges(updateResult);
    }
  }

  const after = await queryQueueStats(queryFromD1, queue);
  console.log('[season-soft-reset] 重置后：', after);
  console.log(
    `[season-soft-reset] 完成：changes=${changes} queue=${queue} policy=${policy} base=${base} factor=${factor} step=${step} minStart=${minStart} maxStart=${maxStart} auto=${autoEnabled ? 1 : 0}`
  );
};

main().catch((error) => {
  console.error('[season-soft-reset] 失败:', error);
  process.exitCode = 1;
});
