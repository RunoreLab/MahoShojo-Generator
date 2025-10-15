import { queryFromD1 } from './core';

// 验证并使用兑换码（验证成功后立即删除）
export async function validateAndConsumeRedemptionCode(code: string): Promise<{ valid: boolean; slotCount: number }> {
  try {
    // 查询兑换码是否存在
    const result = await queryFromD1(
      'SELECT slot_count FROM redemption_codes WHERE code = ?',
      [code]
    ) as any;

    if (!result.success || !result.result || result.result[0]?.results?.length === 0) {
      return { valid: false, slotCount: 0 };
    }

    const slotCount = result.result[0].results[0].slot_count;

    // 删除兑换码（用完即删）
    await queryFromD1(
      'DELETE FROM redemption_codes WHERE code = ?',
      [code]
    );

    return { valid: true, slotCount };
  } catch (error) {
    console.error("验证并消费兑换码失败:", error);
    return { valid: false, slotCount: 0 };
  }
}

// 批量插入兑换码
export async function insertRedemptionCodes(codes: Array<{ code: string; slotCount: number }>): Promise<boolean> {
  try {
    // 构建批量插入的 SQL
    const values = codes.map(c => `('${c.code}', ${c.slotCount})`).join(', ');
    const sql = `INSERT INTO redemption_codes (code, slot_count) VALUES ${values}`;

    const result = await queryFromD1(sql, []) as any;
    return result.success;
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
