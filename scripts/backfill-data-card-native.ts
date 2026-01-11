#!/usr/bin/env bun

import { loadEnvConfig } from '@next/env';

import { queryFromD1 } from '@/lib/d1';
import { verifySignature } from '@/lib/signature';

type DataCardType = 'character' | 'scenario' | 'history';

interface CliOptions {
  dryRun: boolean;
  batchSize: number;
  concurrency: number;
  limit: number | null;
  startAfterId: string;
  type: DataCardType | null;
  publicOnly: boolean;
  approvedOnly: boolean;
  noCount: boolean;
}

type CandidateRow = {
  id: string;
  data: string;
  is_native: number | null;
};

type D1RowsResult<T> = {
  result?: Array<{ results?: T[] }>;
};

const hasD1Config = (): boolean => {
  return Boolean(process.env.D1_DATABASE_ID && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
};

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as D1RowsResult<T>)?.result?.[0]?.results;
  return Array.isArray(rows) ? rows : [];
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
  return args;
};

const parseBool = (value: string | undefined, defaultValue: boolean) => {
  if (value == null) return defaultValue;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  return defaultValue;
};

const parsePositiveInt = (value: string | undefined): number | null => {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
};

const parseOptions = (argv: string[]): CliOptions => {
  const args = parseArgs(argv);
  const typeValue = (args.get('--type') ?? '').trim();
  const type = (['character', 'scenario', 'history'] as const).includes(typeValue as any)
    ? (typeValue as DataCardType)
    : null;

  const limitValue = parsePositiveInt(args.get('--limit'));

  return {
    dryRun: parseBool(args.get('--dry-run'), false),
    batchSize: parsePositiveInt(args.get('--batch')) ?? 30,
    concurrency: parsePositiveInt(args.get('--concurrency')) ?? 4,
    limit: limitValue,
    startAfterId: (args.get('--start-after') ?? '').trim(),
    type,
    publicOnly: parseBool(args.get('--public-only'), false),
    approvedOnly: parseBool(args.get('--approved-only'), false),
    noCount: parseBool(args.get('--no-count'), false),
  };
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  const limit = Math.max(1, Math.floor(concurrency));

  let nextIndex = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current]!, current);
    }
  });

  await Promise.all(workers);
  return results;
};

const buildBaseWhere = (options: CliOptions): { whereSql: string; params: unknown[] } => {
  const conditions: string[] = ['dc.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (options.type) {
    conditions.push('dc.type = ?');
    params.push(options.type);
  }
  if (options.publicOnly) conditions.push('dc.is_public = 1');
  if (options.approvedOnly) conditions.push("dc.review_status = 'approved'");

  conditions.push("(dc.data LIKE '%\"signature\"%' OR dcm.is_native = 1)");

  return { whereSql: conditions.join(' AND '), params };
};

const countCandidates = async (options: CliOptions): Promise<number | null> => {
  const { whereSql, params } = buildBaseWhere(options);
  const result = (await queryFromD1(
    `SELECT COUNT(*) as total
     FROM data_cards dc
     INNER JOIN data_card_metrics dcm ON dcm.data_card_id = dc.id
     WHERE ${whereSql}
       AND dc.id > ?`,
    [...params, options.startAfterId],
  )) as any;

  const row = readRows<{ total?: unknown }>(result)[0];
  const total = typeof row?.total === 'number' ? row.total : typeof row?.total === 'string' ? Number(row.total) : null;
  return Number.isFinite(total) ? Math.max(0, Math.floor(total as number)) : null;
};

const fetchCandidateBatch = async (options: CliOptions, afterId: string, limit: number): Promise<CandidateRow[]> => {
  const { whereSql, params } = buildBaseWhere(options);
  const result = await queryFromD1(
    `SELECT dc.id as id, dc.data as data, dcm.is_native as is_native
     FROM data_cards dc
     INNER JOIN data_card_metrics dcm ON dcm.data_card_id = dc.id
     WHERE ${whereSql}
       AND dc.id > ?
     ORDER BY dc.id
     LIMIT ?`,
    [...params, afterId, limit],
  );
  return readRows<CandidateRow>(result);
};

type VerifyResult =
  | { ok: true; id: string; verified: boolean; existing: boolean | null; changed: boolean }
  | { ok: false; id: string; error: string };

const verifyOne = async (row: CandidateRow): Promise<VerifyResult> => {
  const existing = row.is_native === 1 ? true : row.is_native === 0 ? false : null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.data) as unknown;
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return { ok: false, id: row.id, error: 'data 不是有效 JSON' };
  }

  try {
    const verified = await verifySignature(parsed as any);
    return { ok: true, id: row.id, verified, existing, changed: existing !== verified };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, id: row.id, error: message };
  }
};

const updateIsNativeBatch = async (
  diffs: Array<{ id: string; isNative: boolean }>,
): Promise<void> => {
  if (diffs.length === 0) return;

  const nowIso = new Date().toISOString();
  const caseParts = diffs.map(() => 'WHEN ? THEN ?').join(' ');
  const wherePlaceholders = diffs.map(() => '?').join(', ');

  const params: unknown[] = [];
  for (const diff of diffs) {
    params.push(diff.id, diff.isNative ? 1 : 0);
  }
  params.push(nowIso);
  for (const diff of diffs) {
    params.push(diff.id);
  }

  await queryFromD1(
    `UPDATE data_card_metrics
     SET is_native = CASE data_card_id ${caseParts} ELSE is_native END,
         updated_at = ?
     WHERE data_card_id IN (${wherePlaceholders})`,
    params,
  );
};

async function main() {
  loadEnvConfig(process.cwd(), true);

  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    console.log(`
批量重算 data_card_metrics.is_native（仅原生性，不重算技术值）

用法：
  bun scripts/backfill-data-card-native.ts [options]

必需环境变量：
  CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID / SIGNATURE_SECRET_KEY

常用示例：
  bun scripts/backfill-data-card-native.ts --dry-run --limit 50
  bun scripts/backfill-data-card-native.ts --batch 30 --concurrency 4
  bun scripts/backfill-data-card-native.ts --type character

Options：
  --dry-run                仅校验不落库
  --batch <n>              每批拉取数量（默认 30）
  --concurrency <n>        并发校验数量（默认 4）
  --limit <n>              最多处理 n 张（默认不限）
  --start-after <id>       仅处理 id 大于该值的卡（断点续跑）
  --type <character|scenario|history>  仅处理指定类型
  --public-only            仅处理公开卡
  --approved-only          仅处理已审核通过的卡
  --no-count               跳过“预计处理数量”的 COUNT 查询
`);
    return;
  }

  if (!hasD1Config()) {
    throw new Error('缺少 Cloudflare D1 配置：CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID');
  }

  if (!process.env.SIGNATURE_SECRET_KEY) {
    throw new Error('缺少 SIGNATURE_SECRET_KEY：为避免误把全部卡写为非原生，拒绝执行。');
  }

  const options = parseOptions(rawArgs);

  console.log('[backfill-native] 开始重算 is_native...');
  console.log(
    JSON.stringify(
      {
        dryRun: options.dryRun,
        type: options.type ?? 'all',
        publicOnly: options.publicOnly,
        approvedOnly: options.approvedOnly,
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        limit: options.limit ?? 'unlimited',
        startAfterId: options.startAfterId || '(none)',
      },
      null,
      2,
    ),
  );

  const total = options.noCount ? null : await countCandidates(options).catch(() => null);
  if (total != null) {
    console.log(`[backfill-native] 预计需处理 ${total} 张卡。`);
  }

  let processed = 0;
  let changed = 0;
  let setTrue = 0;
  let setFalse = 0;
  let errors = 0;

  let afterId = options.startAfterId;
  const hardLimit = options.limit ?? Number.POSITIVE_INFINITY;

  while (processed < hardLimit) {
    const remaining = hardLimit - processed;
    const take = Math.max(1, Math.min(options.batchSize, remaining));

    const batch = await fetchCandidateBatch(options, afterId, take);
    if (batch.length === 0) break;

    afterId = batch[batch.length - 1]!.id;

    const results = await mapWithConcurrency(batch, options.concurrency, (row) => verifyOne(row));
    const diffs: Array<{ id: string; isNative: boolean }> = [];

    for (const result of results) {
      processed += 1;
      if (!result.ok) {
        errors += 1;
        console.warn(`[backfill-native] 校验失败: ${result.id}: ${result.error}`);
        continue;
      }

      if (!result.changed) continue;
      changed += 1;
      diffs.push({ id: result.id, isNative: result.verified });
      if (result.verified) setTrue += 1;
      else setFalse += 1;
    }

    if (!options.dryRun && diffs.length > 0) {
      await updateIsNativeBatch(diffs);
    }

    const prefix = total != null ? `${processed}/${total}` : String(processed);
    console.log(
      `[backfill-native] 进度 ${prefix}，变更 ${changed}（true=${setTrue}, false=${setFalse}），失败 ${errors}（afterId=${afterId}）`,
    );
  }

  console.log('[backfill-native] 完成。');
  console.table({
    processed,
    changed,
    setTrue,
    setFalse,
    errors,
    dryRun: options.dryRun,
    startAfterId: options.startAfterId || null,
    endAfterId: afterId || null,
  });
}

main().catch((error) => {
  console.error('[backfill-native] 脚本执行失败:', error);
  process.exitCode = 1;
});

