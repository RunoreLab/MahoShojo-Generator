import { describe, expect, test } from 'vitest';

import { createRedeemHandler } from '@/app/api/redeem-code/handler';

type FakeBatchStatement = {
  sqlText: string;
  params: unknown[];
};

const createFakeClient = (batchImpl: (statements: FakeBatchStatement[]) => Promise<unknown[]>) => ({
  prepare(sqlText: string) {
    return {
      bind(...params: unknown[]) {
        return { sqlText, params };
      },
    };
  },
  async batch(statements: unknown[]) {
    return (await batchImpl(statements as FakeBatchStatement[])) as Array<{ results?: Array<Record<string, unknown>> }>;
  },
});

describe('api/redeem-code handler', () => {
  test('兑换成功时应使用 batch 原子提交并返回槽位数', async () => {
    let receivedStatements: FakeBatchStatement[] = [];
    const post = createRedeemHandler({
      requireAuthUser: async () => ({
        user: { id: 7, username: 'hana' },
        source: 'better-auth-session',
      }),
      getRuntimeD1Client: () =>
        createFakeClient(async (statements) => {
          receivedStatements = statements;
          return [
            { results: [{ redeemed_slot_count: 3 }] },
            { results: [] },
            { results: [{ slot_count: 3 }] },
          ];
        }) as never,
    });

    const response = await post(
      new Request('https://example.com/api/redeem-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'A3F8-E9C2-1D4B' }),
      }),
    );

    const payload = (await response.json()) as { success?: boolean; slotCount?: number; message?: string };
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.slotCount).toBe(3);
    expect(payload.message).toContain('3');
    expect(receivedStatements).toHaveLength(3);
    expect(receivedStatements[0]?.sqlText).toContain('UPDATE users');
    expect(receivedStatements[1]?.sqlText).toContain('INSERT OR IGNORE INTO user_badges');
    expect(receivedStatements[2]?.sqlText).toContain('DELETE FROM redemption_codes');
    expect(receivedStatements[0]?.params).toEqual(['A3F8-E9C2-1D4B', 7, 'A3F8-E9C2-1D4B', 'A3F8-E9C2-1D4B']);
  });

  test('兑换码不存在时应返回 400，不消费其他写入', async () => {
    const post = createRedeemHandler({
      requireAuthUser: async () => ({
        user: { id: 7, username: 'hana' },
        source: 'better-auth-session',
      }),
      getRuntimeD1Client: () =>
        createFakeClient(async () => [
          { results: [] },
          { results: [] },
          { results: [] },
        ]) as never,
    });

    const response = await post(
      new Request('https://example.com/api/redeem-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'NOT-FOUND-CODE' }),
      }),
    );

    const payload = (await response.json()) as { error?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('兑换码无效或已被使用');
  });

  test('兑换码输入大小写不敏感', async () => {
    let receivedCode = '';
    const post = createRedeemHandler({
      requireAuthUser: async () => ({
        user: { id: 7, username: 'hana' },
        source: 'better-auth-session',
      }),
      getRuntimeD1Client: () =>
        createFakeClient(async (statements) => {
          receivedCode = String((statements[0] as FakeBatchStatement).params[0]);
          return [
            { results: [{ redeemed_slot_count: 3 }] },
            { results: [] },
            { results: [{ slot_count: 3 }] },
          ];
        }) as never,
    });

    const response = await post(
      new Request('https://example.com/api/redeem-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'a3f8-e9c2-1d4b' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(receivedCode).toBe('A3F8-E9C2-1D4B');
  });
});
