#!/usr/bin/env bun

import { loadEnvConfig } from '@next/env';

import { queryFromD1 } from '@/lib/d1';
import { upsertDataCardMetrics } from '@/lib/database/data-card-metrics';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import { verifySignature } from '@/lib/signature';

type DataCardType = 'character' | 'scenario' | 'history' | 'questionnaire';

interface CliOptions {
  dryRun: boolean;
  force: boolean;
  batchSize: number;
  concurrency: number;
  limit: number | null;
  startAfterId: string;
  type: DataCardType | null;
  publicOnly: boolean;
  approvedOnly: boolean;
  skipSignature: boolean;
  recomputeNative: boolean;
  writeDetails: boolean;
  noCount: boolean;
}

type CandidateRow = {
  id: string;
  type: DataCardType;
  is_public: number;
  review_status: 'pending' | 'approved' | 'rejected';
  updated_at: string;
  data: string;
  metrics_updated_at: string | null;
  metrics_is_native: number | null;
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
    force: parseBool(args.get('--force'), false),
    batchSize: parsePositiveInt(args.get('--batch')) ?? 20,
    concurrency: parsePositiveInt(args.get('--concurrency')) ?? 4,
    limit: limitValue,
    startAfterId: (args.get('--start-after') ?? '').trim(),
    type,
    publicOnly: parseBool(args.get('--public-only'), false),
    approvedOnly: parseBool(args.get('--approved-only'), false),
    skipSignature: parseBool(args.get('--skip-signature'), false),
    recomputeNative: parseBool(args.get('--recompute-native'), false),
    writeDetails: parseBool(args.get('--write-details'), true),
    noCount: parseBool(args.get('--no-count'), false),
  };
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
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

  if (!options.force) {
    conditions.push('(dcm.data_card_id IS NULL OR dcm.data_card_updated_at <> dc.updated_at)');
  }

  return { whereSql: conditions.join(' AND '), params };
};

const countCandidates = async (options: CliOptions): Promise<number | null> => {
  const { whereSql, params } = buildBaseWhere(options);
  const sql = `
    SELECT COUNT(*) as total
    FROM data_cards dc
    LEFT JOIN data_card_metrics dcm ON dcm.data_card_id = dc.id
    WHERE ${whereSql}
      AND dc.id > ?
  `;
  const result = (await queryFromD1(sql, [...params, options.startAfterId])) as any;
  const row = readRows<{ total?: unknown }>(result)[0];
  const total = typeof row?.total === 'number' ? row.total : typeof row?.total === 'string' ? Number(row.total) : null;
  return Number.isFinite(total) ? Math.max(0, Math.floor(total as number)) : null;
};

const fetchCandidateBatch = async (options: CliOptions, afterId: string, limit: number): Promise<CandidateRow[]> => {
  const { whereSql, params } = buildBaseWhere(options);

  const sql = `
    SELECT
      dc.id,
      dc.type,
      dc.is_public,
      dc.review_status,
      dc.updated_at,
      dc.data,
      dcm.data_card_updated_at as metrics_updated_at,
      dcm.is_native as metrics_is_native
    FROM data_cards dc
    LEFT JOIN data_card_metrics dcm ON dcm.data_card_id = dc.id
    WHERE ${whereSql}
      AND dc.id > ?
    ORDER BY dc.id
    LIMIT ?
  `;

  const result = await queryFromD1(sql, [...params, afterId, limit]);
  return readRows<CandidateRow>(result);
};

type ProcessResult =
  | { ok: true; id: string; written: boolean }
  | { ok: false; id: string; error: string };

const processOne = async (row: CandidateRow, options: CliOptions, hasSignatureKey: boolean): Promise<ProcessResult> => {
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
    const tech = computeTechIndex(parsed);

    const existingIsNative = row.metrics_is_native === 1 ? true : row.metrics_is_native === 0 ? false : null;
    const shouldPreserveNative = !options.recomputeNative && row.metrics_updated_at !== null;
    const isNative = shouldPreserveNative
      ? existingIsNative
      : options.skipSignature || !hasSignatureKey
        ? null
        : await verifySignature(parsed as any).catch(() => null);

    if (options.dryRun) {
      return { ok: true, id: row.id, written: false };
    }

    const ok = await upsertDataCardMetrics({
      dataCardId: row.id,
      techScore: tech.techScore,
      techLevel: tech.techLevel,
      isNative,
      dataCardUpdatedAt: row.updated_at,
      detailsJson: options.writeDetails
        ? {
            raw: tech.raw,
            derived: tech.derived,
            components: tech.components,
            notes: tech.notes,
          }
        : null,
    });

    if (!ok) return { ok: false, id: row.id, error: '写入 data_card_metrics 失败' };
    return { ok: true, id: row.id, written: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, id: row.id, error: message };
  }
};

async function main() {
  loadEnvConfig(process.cwd(), true);

  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    console.log(`
批量回填/重算数据卡技术值（tech index）

用法：
  bun scripts/backfill-data-card-tech-index.ts [options]

必需环境变量：
  CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID

可选环境变量：
  SIGNATURE_SECRET_KEY（用于签名校验；仅在首次写入 is_native 或显式 --recompute-native 时生效）

常用示例：
  bun scripts/backfill-data-card-tech-index.ts --dry-run --limit 20
  bun scripts/backfill-data-card-tech-index.ts --batch 10 --concurrency 2
  bun scripts/backfill-data-card-tech-index.ts --force --write-details false
  bun scripts/backfill-data-card-tech-index.ts --start-after <dataCardId>

Options：
  --dry-run                仅计算不落库
  --force                  忽略 updated_at 对比，强制重算所有卡
  --batch <n>              每批拉取数量（默认 20）
  --concurrency <n>         并发写入数量（默认 4）
  --limit <n>              最多处理 n 张（默认不限）
  --start-after <id>       仅处理 id 大于该值的卡（断点续跑）
  --type <character|scenario|history>  仅处理指定类型
  --public-only            仅处理公开卡
  --approved-only          仅处理已审核通过的卡
  --skip-signature         跳过签名校验（is_native 写 null）
  --recompute-native       忽略已存在的 is_native，重新校验签名并回填
  --write-details <bool>   是否写入 details_json（默认 true）
  --no-count               跳过“预计处理数量”的 COUNT 查询
`);
    return;
  }

  const options = parseOptions(rawArgs);

  if (!hasD1Config()) {
    throw new Error('缺少 Cloudflare D1 配置：CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID');
  }

  const hasSignatureKey = Boolean(process.env.SIGNATURE_SECRET_KEY);

  console.log('[backfill-tech-index] 开始批量计算技术值...');
  console.log(
    JSON.stringify(
      {
        dryRun: options.dryRun,
        force: options.force,
        type: options.type ?? 'all',
        publicOnly: options.publicOnly,
        approvedOnly: options.approvedOnly,
        skipSignature: options.skipSignature,
        recomputeNative: options.recomputeNative,
        writeDetails: options.writeDetails,
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        limit: options.limit ?? 'unlimited',
        startAfterId: options.startAfterId || '(none)',
        signatureEnabled: hasSignatureKey,
      },
      null,
      2
    )
  );

  const total = options.noCount ? null : await countCandidates(options).catch(() => null);
  if (total != null) {
    console.log(`[backfill-tech-index] 预计需处理 ${total} 张卡。`);
  }

  let processed = 0;
  let written = 0;
  let errors = 0;
  const failedIds: string[] = [];

  let afterId = options.startAfterId;
  const hardLimit = options.limit ?? Number.POSITIVE_INFINITY;

  while (processed < hardLimit) {
    const remaining = hardLimit - processed;
    const take = Math.max(1, Math.min(options.batchSize, remaining));

    const batch = await fetchCandidateBatch(options, afterId, take);
    if (batch.length === 0) break;

    afterId = batch[batch.length - 1]!.id;

    const results = await mapWithConcurrency(batch, options.concurrency, (row) => processOne(row, options, hasSignatureKey));

    for (const result of results) {
      processed += 1;
      if (result.ok) {
        if (result.written) written += 1;
      } else {
        errors += 1;
        failedIds.push(result.id);
        console.warn(`[backfill-tech-index] 处理失败: ${result.id}: ${result.error}`);
      }
    }

    const prefix = total != null ? `${processed}/${total}` : String(processed);
    console.log(`[backfill-tech-index] 进度 ${prefix}，已写入 ${written}，失败 ${errors}（afterId=${afterId}）`);
  }

  console.log('[backfill-tech-index] 完成。');
  console.table({
    processed,
    written,
    errors,
    dryRun: options.dryRun,
    force: options.force,
    startAfterId: options.startAfterId || null,
    endAfterId: afterId || null,
  });

  if (failedIds.length > 0) {
    console.log('[backfill-tech-index] 失败的 data_card_id 列表（可用于排查/重跑）：');
    for (const id of failedIds) {
      console.log(id);
    }
  }
}

main().catch((error) => {
  console.error('[backfill-tech-index] 脚本执行失败:', error);
  process.exit(1);
});
