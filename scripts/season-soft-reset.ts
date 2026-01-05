import { loadEnvConfig } from '@next/env';

import { computeSeasonStartRating, computeSeasonStartRatingAdvanced, type SeasonResetPolicy } from '@/lib/arena/season-reset';

type Queue = 'strict' | 'free' | 'all';

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
  queue: string;
  rating: number;
  games: number;
  updatedAt: string;
};

const queryRatingSamples = async (queryFromD1: QueryFromD1, queue: Queue, limit: number) => {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.min(50, Math.floor(limit))) : 0;
  if (safeLimit <= 0) return { top: [] as RatingSampleRow[], bottom: [] as RatingSampleRow[] };

  const where = queue === 'all' ? '' : 'WHERE queue = ?';
  const params: unknown[] = queue === 'all' ? [] : [queue];

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

可选策略（旧版）：
  policy=soft（仅执行 Soft Reset）：
    newRating = round(base + (oldRating - base) * factor)
    并 clamp 到 [minStart, maxStart]
  并清空 games / wins / losses / draws（新赛季重新定级）

进阶机制（可选，默认关闭）：
  1) 按上赛季对局数分段回收力度（更像“场次越少越不确定，回收到 base 越多”）
     - 开启方式：传入任意 --factor-by-games / --factor-low / --factor-mid / --factor-high
     - 规则：
       games < gamesMid  -> factorLow
       games < gamesHigh -> factorMid
       else              -> factorHigh
     - 参数：
       --games-mid 10 --games-high 30 --factor-low 0.6 --factor-mid 0.8 --factor-high 1

  2) 不活跃额外回收（按 updated_at 计算，与上面机制叠加，取更小 factor）
     - 开启方式：--inactive-days 30（配合 --inactive-factor 0.7）
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

  const enableFactorByGames =
    args.has('--factor-by-games') ||
    args.has('--factorByGames') ||
    hasAnyFlag(args, ['--factor-low', '--factor-mid', '--factor-high', '--games-mid', '--games-high']);

  const gamesMid = parseIntArg(args.get('--games-mid') ?? args.get('--gamesMid'), 10);
  const gamesHigh = parseIntArg(args.get('--games-high') ?? args.get('--gamesHigh'), 30);
  const factorLow = parseFactorArg(args.get('--factor-low') ?? args.get('--factorLow'), 0.6);
  const factorMid = parseFactorArg(args.get('--factor-mid') ?? args.get('--factorMid'), 0.8);
  const factorHigh = parseFactorArg(args.get('--factor-high') ?? args.get('--factorHigh'), 1);

  const inactiveDays = parseIntArg(args.get('--inactive-days') ?? args.get('--inactiveDays'), 0);
  const inactiveFactor = parseFactorArg(args.get('--inactive-factor') ?? args.get('--inactiveFactor'), 0.7);
  const enableInactivity = inactiveDays > 0;

  const preview = parseIntArg(args.get('--preview'), 0);

  const apply = args.has('--apply') || args.has('--yes') || args.has('-y');
  const dryRun = args.has('--dry-run') || args.has('--dryRun') || !apply;
  const requireDb = args.has('--require-db') || args.has('--requireDb');

  // 统一在脚本入口做一次校验，避免 UPDATE 中途“半写入”。
  computeSeasonStartRating(base, {
    policy,
    baseRating: base,
    factor,
    step,
    minStartRating: minStart,
    maxStartRating: maxStart,
  });
  if (enableFactorByGames) {
    if (gamesMid < 0) throw new Error('参数错误：--games-mid 必须 >= 0');
    if (gamesHigh < gamesMid) throw new Error('参数错误：--games-high 必须 >= --games-mid');
  }
  if (enableInactivity && inactiveDays < 0) throw new Error('参数错误：--inactive-days 必须 >= 0');

  if (!hasD1Config()) {
    if (requireDb) throw new Error('缺少 D1 配置（CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID）');
    console.warn('[season-soft-reset] 未检测到 D1 配置，跳过实际重置（仅用于本地/CI 验证）。');
    return;
  }

  const { queryFromD1 } = await import('../lib/d1');
  const nowIso = new Date().toISOString();

  const before = await queryQueueStats(queryFromD1, queue);
  console.log('[season-soft-reset] 重置前：', before);

  if (dryRun) {
    console.log(
      `[season-soft-reset] dry-run：queue=${queue} policy=${policy} base=${base} factor=${factor} step=${step} minStart=${minStart} maxStart=${maxStart} factorByGames=${enableFactorByGames ? 1 : 0} gamesMid=${gamesMid} gamesHigh=${gamesHigh} factorLow=${factorLow} factorMid=${factorMid} factorHigh=${factorHigh} inactiveDays=${inactiveDays} inactiveFactor=${inactiveFactor}`
    );

    if (preview > 0) {
      const samples = await queryRatingSamples(queryFromD1, queue, preview);
      const advancedOpts = {
        policy,
        baseRating: base,
        factor,
        step,
        minStartRating: minStart,
        maxStartRating: maxStart,
        gamesFactor: enableFactorByGames
          ? {
              enabled: true,
              gamesMid,
              gamesHigh,
              factorLow,
              factorMid,
              factorHigh,
            }
          : null,
        inactivityCap: enableInactivity
          ? {
              enabled: true,
              inactiveDays,
              inactiveFactor,
            }
          : null,
      } as const;

      const print = (title: string, rows: RatingSampleRow[]) => {
        console.log(`[season-soft-reset] 预览：${title}（${rows.length} 条）`);
        for (const row of rows) {
          const oldRating = typeof row.rating === 'number' ? row.rating : base;
          const games = typeof row.games === 'number' ? row.games : 0;
          const updatedAtIso = typeof row.updatedAt === 'string' ? row.updatedAt : nowIso;
          const next = computeSeasonStartRatingAdvanced(oldRating, { games, updatedAtIso }, advancedOpts, nowIso);
          console.log(
            `  ${row.queue}\t${row.entityType}\t${row.entityId}\t${oldRating}\t(g=${games})\t${updatedAtIso}\t=>\t${next}`
          );
        }
      };

      print('Top', samples.top);
      print('Bottom', samples.bottom);
    }

    if (!apply) {
      console.log('[season-soft-reset] 未传入 --apply，已跳过实际更新。');
      console.log('  如需执行写入，请运行：bun tsx scripts/season-soft-reset.ts --apply');
    }
    return;
  }

  const where = queue === 'all' ? '' : 'WHERE queue = ?';

  const buildBaseFactorExpr = (): { expr: string; params: unknown[] } => {
    if (!enableFactorByGames) return { expr: '?', params: [factor] };
    return {
      expr: `CASE
  WHEN arena_ratings.games < ? THEN ?
  WHEN arena_ratings.games < ? THEN ?
  ELSE ?
END`,
      params: [gamesMid, factorLow, gamesHigh, factorMid, factorHigh],
    };
  };

  const buildRatingExpr = (): { expr: string; params: unknown[] } => {
    const baseFactor = buildBaseFactorExpr();
    const inactiveDaysValue = enableInactivity ? inactiveDays : 0;
    const inactiveFactorValue = enableInactivity ? inactiveFactor : 1;

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

  const { expr: ratingExpr, params: ratingParams } = buildRatingExpr();
  const params: unknown[] = [...ratingParams, nowIso];
  if (queue !== 'all') params.push(queue);

  const updateSql = `UPDATE arena_ratings
    SET rating = ${ratingExpr},
        games = 0,
        wins = 0,
        losses = 0,
        draws = 0,
        updated_at = ?
    ${where};`;
  const updateResult = await queryFromD1(updateSql, params);
  const changes = readChanges(updateResult);

  const after = await queryQueueStats(queryFromD1, queue);
  console.log('[season-soft-reset] 重置后：', after);
  console.log(
    `[season-soft-reset] 完成：changes=${changes} queue=${queue} policy=${policy} base=${base} factor=${factor} step=${step} minStart=${minStart} maxStart=${maxStart} factorByGames=${enableFactorByGames ? 1 : 0} gamesMid=${gamesMid} gamesHigh=${gamesHigh} factorLow=${factorLow} factorMid=${factorMid} factorHigh=${factorHigh} inactiveDays=${inactiveDays} inactiveFactor=${inactiveFactor}`
  );
};

main().catch((error) => {
  console.error('[season-soft-reset] 失败:', error);
  process.exitCode = 1;
});
