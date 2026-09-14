import { expect, test } from 'vitest';
import { AdminAiReviewRequestSchema, AdminAiReviewResultSchema } from '../src/admin';

const card = { kind: 'card', id: 'card', expectedVersion: 'a'.repeat(64) };
const request = { targets: [card], selection: { providerId: 'system', modelId: 'default' }, reason: '辅助审核', idempotencyKey: 'one' };
test('AI 审核选择与凭据互斥，新更新目标必须同时绑定父卡版本', () => {
  expect(AdminAiReviewRequestSchema.safeParse(request).success).toBe(true);
  expect(AdminAiReviewRequestSchema.safeParse({ ...request, apiKey: 'secret' }).success).toBe(false);
  const byok = { ...request, selection: { providerId: 'deepseek', modelId: 'custom-model' } };
  expect(AdminAiReviewRequestSchema.safeParse(byok).success).toBe(false);
  expect(AdminAiReviewRequestSchema.safeParse({ ...byok, apiKey: 'secret' }).success).toBe(true);
  expect(AdminAiReviewRequestSchema.safeParse({ ...request, targets: [{ ...card, kind: 'update' }] }).success).toBe(false);
  expect(AdminAiReviewRequestSchema.safeParse({ ...request, targets: [{ ...card, kind: 'update', cardId: 'parent', cardVersion: 'b'.repeat(64) }] }).success).toBe(true);
});
test('AI 审核拒绝重复目标、超过十项及调用者指定端点', () => {
  for (const targets of [[card, card], Array.from({ length: 11 }, (_, id) => ({ ...card, id: String(id) }))]) {
    expect(AdminAiReviewRequestSchema.safeParse({ ...request, targets }).success).toBe(false);
  }
  expect(AdminAiReviewRequestSchema.safeParse({ ...request, baseUrl: 'https://arbitrary.invalid' }).success).toBe(false);
});
test('旧结果没有上下文仍能读取，明确表示未记录上下文和供应商', () => {
  expect(AdminAiReviewResultSchema.parse({ reviews: [{ id: 'card:one', suggestion: 'approved', reason: '通过' }], model: 'old', usage: null }))
    .toMatchObject({ provider: null, contexts: [] });
});
