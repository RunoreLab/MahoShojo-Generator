import { loadEnvConfig } from '@next/env';

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
  bun tsx scripts/season-soft-reset.ts [--queue all|strict|free] [--factor 0.5] [--base 1000] [--apply] [--dry-run] [--require-db]

默认策略（Soft Reset）：
  newRating = round(base + (oldRating - base) * factor)
  并清空 games / wins / losses / draws（新赛季重新定级）
`);
    return;
  }

  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

  const queue = parseQueue(args.get('--queue'));
  const factor = parseNumber(args.get('--factor'), 0.5);
  const base = Math.floor(parseNumber(args.get('--base'), 1000));
  const apply = args.has('--apply') || args.has('--yes') || args.has('-y');
  const dryRun = args.has('--dry-run') || args.has('--dryRun') || !apply;
  const requireDb = args.has('--require-db') || args.has('--requireDb');

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
    console.log(`[season-soft-reset] dry-run：queue=${queue} base=${base} factor=${factor}`);
    if (!apply) {
      console.log('[season-soft-reset] 未传入 --apply，已跳过实际更新。');
      console.log('  如需执行写入，请运行：bun tsx scripts/season-soft-reset.ts --apply');
    }
    return;
  }

  const where = queue === 'all' ? '' : 'WHERE queue = ?';
  const params: unknown[] = [
    base,
    base,
    factor,
    nowIso,
  ];
  if (queue !== 'all') params.push(queue);

  const updateSql = `UPDATE arena_ratings
    SET rating = CAST(ROUND(? + (rating - ?) * ?) AS INTEGER),
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
  console.log(`[season-soft-reset] 完成：changes=${changes} queue=${queue} base=${base} factor=${factor}`);
};

main().catch((error) => {
  console.error('[season-soft-reset] 失败:', error);
  process.exitCode = 1;
});
