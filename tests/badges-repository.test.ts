import { describe, expect, test } from 'bun:test';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { runBadgeOpsTransaction } from '@/lib/db/repositories/badges';

describe('badges repository', () => {
  test('runBadgeOpsTransaction: 直接复用当前 db，不触发 drizzle transaction', async () => {
    let transactionCalled = false;
    const db = {
      transaction: async () => {
        transactionCalled = true;
        throw new Error('不应调用 drizzle transaction');
      },
      marker: 'db',
    } as unknown as AppDrizzleDb;

    let receivedDb: AppDrizzleDb | null = null;

    await runBadgeOpsTransaction(db, async (tx) => {
      receivedDb = tx;
    });

    expect(transactionCalled).toBe(false);
    expect(receivedDb).toBe(db);
  });
});
