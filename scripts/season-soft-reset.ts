import { loadEnvConfig } from '@next/env';

import { computeSeasonStartRating, type SeasonResetPolicy } from '@/lib/arena/season-reset';

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
  const factor = parseNumber(args.get('--factor'), defaultFactor);
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
      `[season-soft-reset] dry-run：queue=${queue} policy=${policy} base=${base} factor=${factor} step=${step} minStart=${minStart} maxStart=${maxStart}`
    );
    if (!apply) {
      console.log('[season-soft-reset] 未传入 --apply，已跳过实际更新。');
      console.log('  如需执行写入，请运行：bun tsx scripts/season-soft-reset.ts --apply');
    }
    return;
  }

  const where = queue === 'all' ? '' : 'WHERE queue = ?';

  const buildRatingExpr = (): { expr: string; params: unknown[] } => {
    if (policy === 'soft') {
      return {
        expr: `(
  WITH vars(raw, minRating, maxRating) AS (
    SELECT
      CAST(ROUND(? + (arena_ratings.rating - ?) * ?) AS INTEGER) AS raw,
      ? AS minRating,
      ? AS maxRating
  )
  SELECT CAST(MIN(maxRating, MAX(minRating, raw)) AS INTEGER) FROM vars
)`,
        params: [base, base, factor, minStart, maxStart],
      };
    }

    return {
      expr: `(
  WITH vars(raw, step, base, minRating, maxRating) AS (
    SELECT
      CAST(ROUND(? + (arena_ratings.rating - ?) * ?) AS INTEGER) AS raw,
      ? AS step,
      ? AS base,
      ? AS minRating,
      ? AS maxRating
  )
  SELECT CAST(
    MIN(maxRating, MAX(minRating,
      CASE
        WHEN raw < base THEN CAST((raw + step - 1) / step AS INTEGER) * step
        ELSE CAST(raw / step AS INTEGER) * step
      END
    )) AS INTEGER
  )
  FROM vars
)`,
      params: [base, base, factor, step, base, minStart, maxStart],
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
    `[season-soft-reset] 完成：changes=${changes} queue=${queue} policy=${policy} base=${base} factor=${factor} step=${step} minStart=${minStart} maxStart=${maxStart}`
  );
};

main().catch((error) => {
  console.error('[season-soft-reset] 失败:', error);
  process.exitCode = 1;
});
