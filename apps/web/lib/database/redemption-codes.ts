type RedemptionCodeRow = {
  code: string;
  slot_count: number;
  created_at: string | null;
};

type RedemptionCodesRepoBundle = {
  db: unknown;
  consumeRedemptionCode: (db: unknown, code: string) => Promise<{ slot_count: number } | null>;
  insertRedemptionCodesBatch: (db: unknown, rows: Array<{ code: string; slotCount: number }>) => Promise<void>;
  insertRedemptionCode: (db: unknown, code: string, slotCount: number) => Promise<void>;
  hasRedemptionCode: (db: unknown, code: string) => Promise<boolean>;
  listRedemptionCodes: (db: unknown) => Promise<RedemptionCodeRow[]>;
};

const readRedemptionCodesRepoBundle = async (): Promise<RedemptionCodesRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/redemption-codes'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      consumeRedemptionCode: repo.consumeRedemptionCode as RedemptionCodesRepoBundle['consumeRedemptionCode'],
      insertRedemptionCodesBatch: repo.insertRedemptionCodesBatch as RedemptionCodesRepoBundle['insertRedemptionCodesBatch'],
      insertRedemptionCode: repo.insertRedemptionCode as RedemptionCodesRepoBundle['insertRedemptionCode'],
      hasRedemptionCode: repo.hasRedemptionCode as RedemptionCodesRepoBundle['hasRedemptionCode'],
      listRedemptionCodes: repo.listRedemptionCodes as RedemptionCodesRepoBundle['listRedemptionCodes'],
    };
  } catch {
    return null;
  }
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

// 验证并使用兑换码（验证成功后立即删除）
export async function validateAndConsumeRedemptionCode(code: string): Promise<{ valid: boolean; slotCount: number }> {
  try {
    const trimmed = typeof code === 'string' ? code.trim() : '';
    if (!trimmed) {
      return { valid: false, slotCount: 0 };
    }

    const bundle = await readRedemptionCodesRepoBundle();
    if (!bundle) {
      return { valid: false, slotCount: 0 };
    }

    const row = await bundle.consumeRedemptionCode(bundle.db, trimmed);
    if (!row) {
      return { valid: false, slotCount: 0 };
    }

    const slotCount = toInt(row.slot_count, 0);
    return { valid: true, slotCount: Number.isFinite(slotCount) ? slotCount : 0 };
  } catch (error) {
    console.error('验证并消费兑换码失败:', error);
    return { valid: false, slotCount: 0 };
  }
}

// 批量插入兑换码
export async function insertRedemptionCodes(codes: Array<{ code: string; slotCount: number }>): Promise<boolean> {
  try {
    const normalized = new Map<string, number>();
    for (const item of codes) {
      const trimmed = typeof item?.code === 'string' ? item.code.trim() : '';
      if (!trimmed) continue;
      const slotCount = Number.isFinite(item?.slotCount) ? Math.max(0, Math.floor(item.slotCount)) : 0;
      normalized.set(trimmed, slotCount);
    }

    if (normalized.size === 0) return true;

    const bundle = await readRedemptionCodesRepoBundle();
    if (!bundle) return false;

    const entries = Array.from(normalized.entries());
    const maxBatchSize = 200;
    for (let i = 0; i < entries.length; i += maxBatchSize) {
      const chunk = entries.slice(i, i + maxBatchSize).map(([code, slotCount]) => ({ code, slotCount }));
      await bundle.insertRedemptionCodesBatch(bundle.db, chunk);
    }

    return true;
  } catch (error) {
    console.error('批量插入兑换码失败:', error);
    return false;
  }
}

// 插入单个兑换码
export async function insertRedemptionCode(code: string, slotCount: number): Promise<boolean> {
  try {
    const bundle = await readRedemptionCodesRepoBundle();
    if (!bundle) return false;

    await bundle.insertRedemptionCode(bundle.db, code, slotCount);
    return true;
  } catch (error) {
    console.error('插入兑换码失败:', error);
    return false;
  }
}

// 检查兑换码是否存在（不删除）
export async function checkRedemptionCodeExists(code: string): Promise<boolean> {
  try {
    const bundle = await readRedemptionCodesRepoBundle();
    if (!bundle) return false;

    return await bundle.hasRedemptionCode(bundle.db, code);
  } catch (error) {
    console.error('检查兑换码是否存在失败:', error);
    return false;
  }
}

// 获取所有未使用的兑换码（用于管理）
export async function getAllRedemptionCodes(): Promise<Array<{ code: string; slotCount: number; createdAt: string }>> {
  try {
    const bundle = await readRedemptionCodesRepoBundle();
    if (!bundle) return [];

    const rows = await bundle.listRedemptionCodes(bundle.db);
    return rows.map((row) => ({
      code: row.code,
      slotCount: toInt(row.slot_count, 0),
      createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    }));
  } catch (error) {
    console.error('获取所有兑换码失败:', error);
    return [];
  }
}
