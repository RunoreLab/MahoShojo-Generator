import { getDrizzleDbFromRuntime, type AppDrizzleDb } from '@/lib/db/drizzle';
import {
  deleteRedemptionCodesBatch,
  estimateRedemptionCodeValueCny,
  getAdminRedemptionCodeStats,
  hasRedemptionCode,
  insertRedemptionCodesBatch,
  listRedemptionCodesPage,
  type AdminRedemptionCodeStats,
  type RedemptionCodePageInput,
  type RedemptionCodePageResult,
} from '@/lib/db/repositories/redemption-codes';
import { json, readJson, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type GeneratedRedemptionCodeItem = {
  code: string;
  slotCount: number;
  estimatedValueCny: number;
};

type HandlerDeps = {
  getDb: () => AppDrizzleDb | null | unknown;
  listRedemptionCodesPage: (db: AppDrizzleDb | unknown, input: RedemptionCodePageInput) => Promise<RedemptionCodePageResult>;
  getAdminRedemptionCodeStats: (db: AppDrizzleDb | unknown) => Promise<AdminRedemptionCodeStats>;
  insertRedemptionCodesBatch: (db: AppDrizzleDb | unknown, rows: Array<{ code: string; slotCount: number }>) => Promise<void>;
  deleteRedemptionCodesBatch: (db: AppDrizzleDb | unknown, codes: string[]) => Promise<number>;
  hasRedemptionCode: (db: AppDrizzleDb | unknown, code: string) => Promise<boolean>;
  generateRandomCode: () => string;
};

const MAX_GENERATE_COUNT = 500;
const MAX_GENERATION_ATTEMPTS = 30;

const defaultDeps: HandlerDeps = {
  getDb: getDrizzleDbFromRuntime,
  listRedemptionCodesPage: listRedemptionCodesPage as HandlerDeps['listRedemptionCodesPage'],
  getAdminRedemptionCodeStats: getAdminRedemptionCodeStats as HandlerDeps['getAdminRedemptionCodeStats'],
  insertRedemptionCodesBatch: insertRedemptionCodesBatch as HandlerDeps['insertRedemptionCodesBatch'],
  deleteRedemptionCodesBatch: deleteRedemptionCodesBatch as HandlerDeps['deleteRedemptionCodesBatch'],
  hasRedemptionCode: hasRedemptionCode as HandlerDeps['hasRedemptionCode'],
  generateRandomCode: () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const randomValues = new Uint8Array(12);
    crypto.getRandomValues(randomValues);
    const raw = Array.from(randomValues, (value) => chars[value % chars.length]).join('');
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  },
};

const toInt = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toPositiveInt = (value: unknown, fallback: number): number => {
  const parsed = toInt(value, fallback);
  return Math.max(1, parsed);
};

const toOptionalNonNegativeInt = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = toInt(value, Number.NaN);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, parsed);
};

const normalizeCodes = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0),
    ),
  );
};

const getDbOrResponse = (deps: HandlerDeps): { db: AppDrizzleDb | unknown } | { response: Response } => {
  const db = deps.getDb();
  if (!db) return { response: json({ success: false, error: '数据库不可用' }, { status: 503 }) };
  return { db };
};

const buildListInput = (url: URL): RedemptionCodePageInput => ({
  page: toPositiveInt(url.searchParams.get('page'), 1),
  limit: Math.min(200, toPositiveInt(url.searchParams.get('limit'), 20)),
  search: url.searchParams.get('search') || undefined,
  minSlotCount: toOptionalNonNegativeInt(url.searchParams.get('minSlotCount')),
  maxSlotCount: toOptionalNonNegativeInt(url.searchParams.get('maxSlotCount')),
});

const generateUniqueCodes = async (
  deps: HandlerDeps,
  db: AppDrizzleDb | unknown,
  input: { count: number; slotCount: number },
): Promise<Array<{ code: string; slotCount: number }>> => {
  const generated: Array<{ code: string; slotCount: number }> = [];
  const seen = new Set<string>();
  let attempts = 0;

  while (generated.length < input.count && attempts < input.count * MAX_GENERATION_ATTEMPTS) {
    attempts += 1;
    const code = deps.generateRandomCode().trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    if (await deps.hasRedemptionCode(db, code)) continue;
    seen.add(code);
    generated.push({ code, slotCount: input.slotCount });
  }

  if (generated.length < input.count) {
    throw new Error(`兑换码生成冲突过多，仅生成 ${generated.length}/${input.count} 个`);
  }

  return generated;
};

export const createAdminRedemptionCodesHandler =
  (overrides: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    const deps: HandlerDeps = { ...defaultDeps, ...overrides };
    const dbResult = getDbOrResponse(deps);
    if ('response' in dbResult) return dbResult.response;
    const { db } = dbResult;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const pageResult = await deps.listRedemptionCodesPage(db, buildListInput(url));
      const stats = await deps.getAdminRedemptionCodeStats(db);
      return json(
        {
          success: true,
          items: pageResult.items,
          stats,
          total: pageResult.total,
          page: pageResult.page,
          limit: pageResult.limit,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (req.method === 'POST') {
      const payload = await readJson<Record<string, unknown>>(req);
      if ('response' in payload) return payload.response;

      const slotCount = toInt(payload.data.slotCount, 0);
      const count = toInt(payload.data.count, 0);
      if (slotCount <= 0) {
        return json({ success: false, error: '槽位数量必须是大于 0 的整数' }, { status: 400 });
      }
      if (count <= 0 || count > MAX_GENERATE_COUNT) {
        return json({ success: false, error: `生成数量必须是 1-${MAX_GENERATE_COUNT} 的整数` }, { status: 400 });
      }

      const rows = await generateUniqueCodes(deps, db, { count, slotCount });
      await deps.insertRedemptionCodesBatch(db, rows);
      const stats = await deps.getAdminRedemptionCodeStats(db);
      const generated: GeneratedRedemptionCodeItem[] = rows.map((row) => ({
        code: row.code,
        slotCount: row.slotCount,
        estimatedValueCny: estimateRedemptionCodeValueCny(row.slotCount),
      }));

      return json(
        {
          success: true,
          generated,
          stats,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (req.method === 'DELETE') {
      const payload = await readJson<Record<string, unknown>>(req);
      if ('response' in payload) return payload.response;
      const codes = normalizeCodes(payload.data.codes);
      if (codes.length === 0) {
        return json({ success: false, error: '请选择要废弃的兑换码' }, { status: 400 });
      }

      const deletedCount = await deps.deleteRedemptionCodesBatch(db, codes);
      const stats = await deps.getAdminRedemptionCodeStats(db);
      return json(
        {
          success: true,
          deletedCount,
          stats,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return json({ success: false, error: 'Method not allowed' }, { status: 405 });
  };

export default withPvpErrorBoundary(createAdminRedemptionCodesHandler());
