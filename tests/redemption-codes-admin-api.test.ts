import { describe, expect, test } from 'vitest';

import { createAdminRedemptionCodesHandler } from '@/pages/api/admin/redemption-codes';

describe('api/admin/redemption-codes handler', () => {
  test('GET returns list and stats using canonical camelCase DTOs', async () => {
    const handler = createAdminRedemptionCodesHandler({
      getDb: () => ({ db: true }),
      listRedemptionCodesPage: async (_db, input) => ({
        items: [
          {
            code: 'AAAA-BBBB-0001',
            slotCount: 128,
            estimatedValueCny: 12,
            createdAt: '2026-05-01T10:00:00.000Z',
          },
        ],
        total: 1,
        page: input.page,
        limit: input.limit,
      }),
      getAdminRedemptionCodeStats: async () => ({
        unusedCodeTotal: 1,
        unusedSlotTotal: 128,
        unusedEstimatedValueCny: 12,
        inferredRedeemedSlotTotal: 256,
        inferredRedeemedEstimatedValueCny: 24,
        inferredRedeemedUserTotal: 1,
        inferredRedeemedAverageValueCny: 24,
        reporterRewardSlotTotal: 128,
        latestCreatedAt: '2026-05-01T10:00:00.000Z',
      }),
    });

    const response = await handler(new Request('https://example.test/api/admin/redemption-codes?page=2&limit=30'));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      items: [
        {
          code: 'AAAA-BBBB-0001',
          slotCount: 128,
          estimatedValueCny: 12,
          createdAt: '2026-05-01T10:00:00.000Z',
        },
      ],
      stats: {
        unusedCodeTotal: 1,
        inferredRedeemedSlotTotal: 256,
        inferredRedeemedUserTotal: 1,
        inferredRedeemedAverageValueCny: 24,
      },
      total: 1,
      page: 2,
      limit: 30,
    });
  });

  test('POST accepts arbitrary positive slotCount and returns generated codes', async () => {
    const insertedRows: Array<{ code: string; slotCount: number }> = [];
    let generatedIndex = 0;
    const handler = createAdminRedemptionCodesHandler({
      getDb: () => ({ db: true }),
      generateRandomCode: () => {
        generatedIndex += 1;
        return `TEST-CODE-${generatedIndex}`;
      },
      insertRedemptionCodesBatch: async (_db, rows) => {
        insertedRows.push(...rows);
      },
      hasRedemptionCode: async () => false,
      getAdminRedemptionCodeStats: async () => ({
        unusedCodeTotal: 2,
        unusedSlotTotal: 246,
        unusedEstimatedValueCny: 10,
        inferredRedeemedSlotTotal: 0,
        inferredRedeemedEstimatedValueCny: 0,
        inferredRedeemedUserTotal: 0,
        inferredRedeemedAverageValueCny: 0,
        reporterRewardSlotTotal: 0,
        latestCreatedAt: null,
      }),
    });

    const response = await handler(
      new Request('https://example.test/api/admin/redemption-codes', {
        method: 'POST',
        body: JSON.stringify({ slotCount: 123, count: 2 }),
      }),
    );
    const payload = (await response.json()) as { generated?: Array<{ code: string; slotCount: number; estimatedValueCny: number }> };

    expect(response.status).toBe(200);
    expect(insertedRows).toEqual([
      { code: 'TEST-CODE-1', slotCount: 123 },
      { code: 'TEST-CODE-2', slotCount: 123 },
    ]);
    expect(payload.generated).toEqual([
      { code: 'TEST-CODE-1', slotCount: 123, estimatedValueCny: 5 },
      { code: 'TEST-CODE-2', slotCount: 123, estimatedValueCny: 5 },
    ]);
  });

  test('DELETE deletes requested unused codes and reports actual deletion count', async () => {
    const handler = createAdminRedemptionCodesHandler({
      getDb: () => ({ db: true }),
      deleteRedemptionCodesBatch: async (_db, codes) => (codes.includes('AAAA-BBBB-0001') ? 1 : 0),
      getAdminRedemptionCodeStats: async () => ({
        unusedCodeTotal: 0,
        unusedSlotTotal: 0,
        unusedEstimatedValueCny: 0,
        inferredRedeemedSlotTotal: 0,
        inferredRedeemedEstimatedValueCny: 0,
        inferredRedeemedUserTotal: 0,
        inferredRedeemedAverageValueCny: 0,
        reporterRewardSlotTotal: 0,
        latestCreatedAt: null,
      }),
    });

    const response = await handler(
      new Request('https://example.test/api/admin/redemption-codes', {
        method: 'DELETE',
        body: JSON.stringify({ codes: ['AAAA-BBBB-0001', 'AAAA-BBBB-0001', ''] }),
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      deletedCount: 1,
    });
  });
});
