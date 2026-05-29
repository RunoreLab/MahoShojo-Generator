import { describe, expect, test } from 'vitest';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { updateNativeFlagsByDataCardIds } from '@/lib/db/repositories/data-card-tech-index';

type FakeBatchStatement = {
  sqlText: string;
  params: unknown[];
};

const createMockDb = () => {
  const batchCalls: FakeBatchStatement[][] = [];
  let transactionCalled = false;

  const db = {
    transaction: async () => {
      transactionCalled = true;
      throw new Error('不应调用 drizzle transaction');
    },
    $client: {
      prepare: (sqlText: string) => ({
        bind: (...params: unknown[]) => ({ sqlText, params }),
      }),
      batch: async (statements: unknown[]) => {
        batchCalls.push(statements as FakeBatchStatement[]);
        return [];
      },
    },
  } as unknown as AppDrizzleDb;

  return {
    db,
    batchCalls,
    wasTransactionCalled: () => transactionCalled,
  };
};

describe('data-card-tech-index repository', () => {
  test('updateNativeFlagsByDataCardIds: 使用 batch 更新并规范化参数', async () => {
    const { db, batchCalls, wasTransactionCalled } = createMockDb();
    const nowIso = '2026-03-07T12:34:56.000Z';

    await updateNativeFlagsByDataCardIds(
      db,
      [
        { id: ' card_1 ', isNative: true },
        { id: '', isNative: false },
        { id: 'card_2', isNative: false },
      ],
      nowIso,
    );

    expect(wasTransactionCalled()).toBe(false);
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]).toHaveLength(2);
    expect(batchCalls[0]?.[0]?.sqlText.includes('UPDATE data_card_metrics')).toBe(true);
    expect(batchCalls[0]?.[0]?.params).toEqual([1, nowIso, 'card_1']);
    expect(batchCalls[0]?.[1]?.params).toEqual([0, nowIso, 'card_2']);
  });

  test('updateNativeFlagsByDataCardIds: 无有效 ID 时跳过 batch', async () => {
    const { db, batchCalls, wasTransactionCalled } = createMockDb();

    await updateNativeFlagsByDataCardIds(
      db,
      [
        { id: '   ', isNative: true },
        { id: '', isNative: false },
      ],
      '2026-03-07T12:34:56.000Z',
    );

    expect(wasTransactionCalled()).toBe(false);
    expect(batchCalls).toHaveLength(0);
  });
});
