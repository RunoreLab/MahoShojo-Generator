import { queryFromD1 } from './core';

// 验证并使用兑换码（验证成功后立即删除）
export async function validateAndConsumeRedemptionCode(code: string): Promise<{ valid: boolean; slotCount: number }> {
  try {
    const trimmed = typeof code === 'string' ? code.trim() : '';
    if (!trimmed) {
      return { valid: false, slotCount: 0 };
    }

    const result = await queryFromD1(
      'DELETE FROM redemption_codes WHERE code = ? RETURNING slot_count',
      [trimmed]
    ) as any;

    const rows = result?.result?.[0]?.results;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { valid: false, slotCount: 0 };
    }

    const slotCountRaw = rows[0]?.slot_count;
    const slotCount = typeof slotCountRaw === 'number' ? slotCountRaw : Number(slotCountRaw || 0);
    return { valid: true, slotCount: Number.isFinite(slotCount) ? slotCount : 0 };
  } catch (error) {
    console.error("验证并消费兑换码失败:", error);
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

    const entries = Array.from(normalized.entries());
    const maxBatchSize = 200;
    for (let i = 0; i < entries.length; i += maxBatchSize) {
      const chunk = entries.slice(i, i + maxBatchSize);
      const placeholders = chunk.map(() => '(?, ?)').join(', ');
      const params = chunk.flatMap(([code, slotCount]) => [code, slotCount]);
      const sql = `INSERT INTO redemption_codes (code, slot_count) VALUES ${placeholders}`;
      const result = await queryFromD1(sql, params) as any;
      if (!result?.success) return false;
    }

    return true;
  } catch (error) {
    console.error("批量插入兑换码失败:", error);
    return false;
  }
}

// 插入单个兑换码
export async function insertRedemptionCode(code: string, slotCount: number): Promise<boolean> {
  try {
    const result = await queryFromD1(
      'INSERT INTO redemption_codes (code, slot_count) VALUES (?, ?)',
      [code, slotCount]
    ) as any;
    return result.success;
  } catch (error) {
    console.error("插入兑换码失败:", error);
    return false;
  }
}

// 检查兑换码是否存在（不删除）
export async function checkRedemptionCodeExists(code: string): Promise<boolean> {
  try {
    const result = await queryFromD1(
      'SELECT 1 FROM redemption_codes WHERE code = ?',
      [code]
    ) as any;

    return result.success && result.result && result.result[0]?.results?.length > 0;
  } catch (error) {
    console.error("检查兑换码是否存在失败:", error);
    return false;
  }
}

// 获取所有未使用的兑换码（用于管理）
export async function getAllRedemptionCodes(): Promise<Array<{ code: string; slotCount: number; createdAt: string }>> {
  try {
    const result = await queryFromD1(
      'SELECT code, slot_count, created_at FROM redemption_codes ORDER BY created_at DESC',
      []
    ) as any;

    if (result.success && result.result && result.result[0]?.results) {
      return result.result[0].results.map((row: any) => ({
        code: row.code,
        slotCount: row.slot_count,
        createdAt: row.created_at
      }));
    }
    return [];
  } catch (error) {
    console.error("获取所有兑换码失败:", error);
    return [];
  }
}
