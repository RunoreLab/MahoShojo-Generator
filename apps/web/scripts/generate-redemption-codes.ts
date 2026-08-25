/**
 * 生成随机兑换码的工具脚本
 *
 * 使用方法：
 * pnpm exec tsx scripts/generate-redemption-codes.ts <数量> <槽位数>
 *
 * 例如：
 * pnpm exec tsx scripts/generate-redemption-codes.ts 10 64
 * 生成 10 个兑换码，每个增加 64 个槽位
 */

import { queryD1Payload } from '../lib/database/core';

type RedemptionCodeInput = {
  code: string;
  slotCount: number;
};

type D1HttpApiError = {
  message?: unknown;
};

type D1HttpApiResult = {
  success?: boolean;
  results?: unknown;
  meta?: unknown;
  error?: unknown;
};

type D1HttpApiEnvelope = {
  success?: boolean;
  errors?: unknown;
  result?: unknown;
};

const MAX_BATCH_SIZE = 200;
const MAX_GENERATION_ATTEMPTS = 20;

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toErrorMessage = (value: unknown): string => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  return '';
};

const parseEnvelopeError = (envelope: D1HttpApiEnvelope): string => {
  return asArray(envelope.errors)
    .map((item) => {
      const obj = asObject(item) as D1HttpApiError | null;
      return toErrorMessage(obj?.message);
    })
    .filter(Boolean)
    .join('; ');
};

const parseStatementResult = (payload: unknown): D1HttpApiResult => {
  const envelope = asObject(payload) as D1HttpApiEnvelope | null;
  if (!envelope) {
    throw new Error('D1 返回格式异常：payload 不是对象');
  }

  if (envelope.success === false) {
    throw new Error(`D1 执行失败：${parseEnvelopeError(envelope) || 'unknown error'}`);
  }

  const statement = asObject(asArray(envelope.result)[0]) as D1HttpApiResult | null;
  if (!statement) {
    return { success: true, results: [], meta: {} };
  }

  if (statement.success === false) {
    throw new Error(`D1 SQL 执行失败：${toErrorMessage(statement.error) || 'unknown error'}`);
  }

  return statement;
};

const normalizeReturnedCodes = (payload: unknown): RedemptionCodeInput[] => {
  const statement = parseStatementResult(payload);
  const rows = asArray(statement.results);
  const inserted: RedemptionCodeInput[] = [];

  for (const row of rows) {
    const obj = asObject(row);
    const code = typeof obj?.code === 'string' ? obj.code.trim() : '';
    const slotCount = typeof obj?.slotCount === 'number'
      ? Math.trunc(obj.slotCount)
      : typeof obj?.slotCount === 'string'
        ? Math.trunc(Number(obj.slotCount))
        : Number.NaN;

    if (!code || !Number.isFinite(slotCount)) continue;
    inserted.push({ code, slotCount: Math.max(0, slotCount) });
  }

  return inserted;
};

const assertD1Env = (): void => {
  const missing: string[] = [];
  if (!process.env.CLOUDFLARE_API_TOKEN) missing.push('CLOUDFLARE_API_TOKEN');
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!process.env.D1_DATABASE_ID) missing.push('D1_DATABASE_ID');

  if (missing.length > 0) {
    throw new Error(`缺少 Cloudflare D1 配置：${missing.join(' / ')}`);
  }
};

// 生成随机兑换码（12位，包含大写字母和数字）
function generateRandomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

async function insertRedemptionCodesBatch(codes: RedemptionCodeInput[]): Promise<RedemptionCodeInput[]> {
  if (codes.length === 0) return [];

  const placeholders = codes.map(() => '(?, ?, CURRENT_TIMESTAMP)').join(', ');
  const params = codes.flatMap((item) => [item.code, item.slotCount]);
  const sql = `
    INSERT OR IGNORE INTO redemption_codes (code, slot_count, created_at)
    VALUES ${placeholders}
    RETURNING code, slot_count AS slotCount
  `;

  const payload = await queryD1Payload(sql, params);
  return normalizeReturnedCodes(payload);
}

async function generateAndInsertCodes(count: number, slotCount: number): Promise<RedemptionCodeInput[]> {
  const insertedCodes: RedemptionCodeInput[] = [];
  const generatedCodeSet = new Set<string>();

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS && insertedCodes.length < count; attempt++) {
    const remaining = count - insertedCodes.length;
    const currentBatchSize = Math.min(MAX_BATCH_SIZE, remaining);
    const pendingCodes: RedemptionCodeInput[] = [];

    while (pendingCodes.length < currentBatchSize) {
      const code = generateRandomCode();
      if (generatedCodeSet.has(code)) continue;
      generatedCodeSet.add(code);
      pendingCodes.push({ code, slotCount });
    }

    const insertedBatch = await insertRedemptionCodesBatch(pendingCodes);
    insertedCodes.push(...insertedBatch);
  }

  if (insertedCodes.length < count) {
    throw new Error(`写入后仅成功生成 ${insertedCodes.length}/${count} 个兑换码，请重试`);
  }

  return insertedCodes;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('❌ 使用方法: pnpm exec tsx scripts/generate-redemption-codes.ts <数量> <槽位数>');
    console.error('例如: pnpm exec tsx scripts/generate-redemption-codes.ts 10 64');
    process.exit(1);
  }

  const count = Number.parseInt(args[0], 10);
  const slotCount = Number.parseInt(args[1], 10);

  if (Number.isNaN(count) || count <= 0) {
    console.error('❌ 数量必须是大于 0 的整数');
    process.exit(1);
  }

  if (Number.isNaN(slotCount) || slotCount <= 0) {
    console.error('❌ 槽位数必须是大于 0 的整数');
    process.exit(1);
  }

  assertD1Env();

  console.log(`🎫 开始生成 ${count} 个兑换码，每个增加 ${slotCount} 个槽位...\n`);
  console.log('💾 正在写入数据库...\n');

  const insertedCodes = await generateAndInsertCodes(count, slotCount);

  console.log('✅ 兑换码生成成功！\n');
  console.log('生成的兑换码：');
  console.log('━'.repeat(50));
  insertedCodes.forEach((item) => {
    console.log(`谢谢金主大人支持！！以下是 ${item.slotCount} 个槽位的兑换码：【${item.code}】请在 魔事院档案馆 中登录账号后，点击兑换来使用~ 如果出现问题，可以在 QQ 群里联系 @Colanns 或者在这里直接私信哦~ 另外就是，赞助不少于 24 元的老板们可以留下自己的收货地址，之后说不定会有神秘小礼物包邮到家（？！`);
  });
  console.log('━'.repeat(50));
  console.log(`\n📊 总计: ${insertedCodes.length} 个兑换码`);
}

main().catch((error) => {
  console.error('❌ 发生错误:', error);
  process.exit(1);
});
