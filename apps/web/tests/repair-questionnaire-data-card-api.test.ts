import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDataCardById: vi.fn(),
  repairQuestionnaireDataCardType: vi.fn(async () => true),
  removeStrictArenaRatingForDataCard: vi.fn(async () => undefined),
}));

vi.mock('@/lib/auth/server', () => ({
  requireAuthUser: async () => ({
    user: {
      id: 7,
      username: 'alice',
      is_admin: 0,
      is_review_exempt: 0,
    },
    source: 'better-auth-session',
  }),
}));

vi.mock('@/lib/database/data-cards', () => ({
  getDataCardById: mocks.getDataCardById,
  repairQuestionnaireDataCardType: mocks.repairQuestionnaireDataCardType,
}));

vi.mock('@/lib/database/arena-ratings', () => ({
  removeStrictArenaRatingForDataCard: mocks.removeStrictArenaRatingForDataCard,
}));

import handler from '@/app/api/data-cards/repair-questionnaire-type/handler';

const questionnaireData = {
  kind: 'magical-girl',
  title: '测试问卷',
  questions: [{ id: 'q1', question: '代号是什么？' }],
};

const request = (body: unknown) => new Request('https://example.test/api/data-cards/repair-questionnaire-type', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('repair questionnaire data-card type API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDataCardById.mockResolvedValue({
      id: 'legacy-questionnaire',
      user_id: 7,
      type: 'character',
      data: JSON.stringify(questionnaireData),
    });
  });

  test('只修复本人拥有且内容明确为问卷的 character 卡', async () => {
    const response = await handler(request({ id: 'legacy-questionnaire' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, repaired: true });
    expect(mocks.repairQuestionnaireDataCardType).toHaveBeenCalledWith('legacy-questionnaire', 7);
    expect(mocks.removeStrictArenaRatingForDataCard).toHaveBeenCalledWith('legacy-questionnaire');
  });

  test('已是 questionnaire 时幂等返回且不执行写入', async () => {
    mocks.getDataCardById.mockResolvedValue({
      id: 'questionnaire-card',
      user_id: 7,
      type: 'questionnaire',
      data: JSON.stringify(questionnaireData),
    });

    const response = await handler(request({ id: 'questionnaire-card' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, repaired: false });
    expect(mocks.repairQuestionnaireDataCardType).not.toHaveBeenCalled();
    expect(mocks.removeStrictArenaRatingForDataCard).not.toHaveBeenCalled();
  });

  test('拒绝非本人卡片', async () => {
    mocks.getDataCardById.mockResolvedValue({
      id: 'other-card',
      user_id: 8,
      type: 'character',
      data: JSON.stringify(questionnaireData),
    });

    const response = await handler(request({ id: 'other-card' }));

    expect(response.status).toBe(404);
    expect(mocks.repairQuestionnaireDataCardType).not.toHaveBeenCalled();
  });

  test('拒绝非 character 类型和非问卷内容', async () => {
    mocks.getDataCardById.mockResolvedValue({
      id: 'scenario-card',
      user_id: 7,
      type: 'scenario',
      data: JSON.stringify(questionnaireData),
    });
    const typeResponse = await handler(request({ id: 'scenario-card' }));
    expect(typeResponse.status).toBe(409);

    mocks.getDataCardById.mockResolvedValue({
      id: 'invalid-card',
      user_id: 7,
      type: 'character',
      data: JSON.stringify({ name: '普通角色' }),
    });
    const contentResponse = await handler(request({ id: 'invalid-card' }));
    expect(contentResponse.status).toBe(400);
    expect(mocks.repairQuestionnaireDataCardType).not.toHaveBeenCalled();
  });

  test('拒绝缺少数据卡 ID 的请求', async () => {
    const response = await handler(request({ id: '   ' }));

    expect(response.status).toBe(400);
    expect(mocks.getDataCardById).not.toHaveBeenCalled();
  });
});
