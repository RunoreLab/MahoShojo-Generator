import { requireAuthUser } from '@/lib/auth/server';
import { getRuntimeD1Client } from '@/lib/db/drizzle';

export const runtime = 'edge';

type RedeemBatchResult = {
  invalidCode: boolean;
  slotCount: number;
};

type D1BatchStatementResult = {
  results?: Array<Record<string, unknown>>;
};

type D1BatchPreparedStatement = {
  bind: (...params: unknown[]) => unknown;
};

type D1BatchClient = {
  prepare: (sqlText: string) => D1BatchPreparedStatement;
  batch: (statements: unknown[]) => Promise<D1BatchStatementResult[]>;
};

type RedeemDeps = {
  requireAuthUser: typeof requireAuthUser;
  getRuntimeD1Client: typeof getRuntimeD1Client;
};

const defaultRedeemDeps: RedeemDeps = {
  requireAuthUser,
  getRuntimeD1Client,
};

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const isD1BatchClient = (value: unknown): value is D1BatchClient => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.prepare === 'function' && typeof record.batch === 'function';
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const executeRedeemBatch = async (
  client: D1BatchClient,
  userId: number,
  code: string,
): Promise<RedeemBatchResult> => {
  const updateUserStatement = client
    .prepare(`
      UPDATE users
      SET
        slot_count = COALESCE(slot_count, 0) + COALESCE((SELECT slot_count FROM redemption_codes WHERE code = ?), 0),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND EXISTS (SELECT 1 FROM redemption_codes WHERE code = ?)
      RETURNING COALESCE((SELECT slot_count FROM redemption_codes WHERE code = ?), 0) AS redeemed_slot_count
    `)
    .bind(code, userId, code, code);

  const grantBadgeStatement = client
    .prepare(`
      INSERT OR IGNORE INTO user_badges (user_id, badge_id, obtained_at)
      SELECT ?, ?, CURRENT_TIMESTAMP
      WHERE EXISTS (SELECT 1 FROM redemption_codes WHERE code = ?)
    `)
    .bind(userId, 'sponsor', code);

  const deleteCodeStatement = client
    .prepare(`
      DELETE FROM redemption_codes
      WHERE code = ?
      RETURNING slot_count AS slot_count
    `)
    .bind(code);

  const results = await client.batch([updateUserStatement, grantBadgeStatement, deleteCodeStatement]);
  const updatedRow = results[0]?.results?.[0] ?? null;
  const deletedRow = results[2]?.results?.[0] ?? null;

  if (!updatedRow || !deletedRow) {
    return { invalidCode: true, slotCount: 0 };
  }

  const updatedSlotCount = Math.max(0, toInt(updatedRow.redeemed_slot_count, 0));
  const deletedSlotCount = Math.max(0, toInt(deletedRow.slot_count, 0));

  if (updatedSlotCount !== deletedSlotCount) {
    throw new Error(`兑换结果不一致：updated=${updatedSlotCount}, deleted=${deletedSlotCount}`);
  }

  return {
    invalidCode: false,
    slotCount: deletedSlotCount,
  };
};

export const createRedeemHandler = (overrides: Partial<RedeemDeps> = {}): ((req: Request) => Promise<Response>) => {
  const deps: RedeemDeps = { ...defaultRedeemDeps, ...overrides };

  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const auth = await deps.requireAuthUser(req);
    if ('response' in auth) return auth.response;

    try {
      const payload = await req.json().catch(() => ({}));
      const normalizedCode = toNonEmptyString((payload as { code?: unknown })?.code);

      if (!normalizedCode) {
        return json({ error: '兑换码不能为空' }, 400);
      }

      const runtimeClient = deps.getRuntimeD1Client();
      if (!isD1BatchClient(runtimeClient)) {
        return json({ error: '数据库不可用，请稍后重试' }, 503);
      }

      const { invalidCode, slotCount } = await executeRedeemBatch(runtimeClient, auth.user.id, normalizedCode);
      if (invalidCode) {
        return json({ error: '兑换码无效或已被使用' }, 400);
      }

      return json({
        success: true,
        message: `兑换成功！获得 ${slotCount} 个槽位`,
        slotCount,
      });
    } catch (error) {
      console.error('Redeem code error:', error);
      return json({ error: '兑换失败，请稍后重试' }, 500);
    }
  };
};

export default createRedeemHandler();
