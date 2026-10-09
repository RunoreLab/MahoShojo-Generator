import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthUser: vi.fn(),
  quickCheck: vi.fn(async () => ({ hasSensitiveWords: false })),
  getUserUsedSlots: vi.fn(async () => 0),
  getUserDataCardCapacity: vi.fn(async () => 20),
  getUserDataCards: vi.fn(async () => [] as Array<{ id: string }>),
  createDataCardWithAuthor: vi.fn(async (..._args: unknown[]) => ({ success: true, id: 'card-created' })),
  getDataCardById: vi.fn(async () => ({
    id: 'card-existing',
    user_id: 7,
    type: 'character',
    name: '旧名称',
    description: '',
    data: '{}',
    is_public: 0,
    review_status: 'pending',
  })),
  updateDataCard: vi.fn(async () => true),
}));

vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth/server')>(),
  requireAuthUser: mocks.requireAuthUser,
}));

vi.mock('@/lib/db/drizzle', () => ({
  getDrizzleDbFromRuntime: () => null,
}));

vi.mock('@/lib/database/data-cards', () => ({
  createDataCardWithAuthor: mocks.createDataCardWithAuthor,
  getUserDataCards: mocks.getUserDataCards,
  updateDataCard: mocks.updateDataCard,
  deleteDataCard: vi.fn(async () => true),
  pruneUserRecycleBin: vi.fn(async () => undefined),
  upsertDataCardUpdate: vi.fn(async () => true),
  getDataCardById: mocks.getDataCardById,
  getUserUsedSlots: mocks.getUserUsedSlots,
  updateDataCardContentByIdAndUser: vi.fn(async () => true),
}));

vi.mock('@/lib/database/users', () => ({
  getUserByAuthKey: vi.fn(async () => null),
  getUserDataCardCapacity: mocks.getUserDataCardCapacity,
}));

vi.mock('@/lib/sensitive-word-filter', () => ({
  quickCheck: mocks.quickCheck,
}));

import handler from '@/app/api/data-cards/handler';
import { appRouteHandler as ownedHandler } from '@/app/api/data-cards/create-owned/handler';
import { createAuthServer } from '@/lib/auth/server';

describe('api/data-cards metadata contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthUser.mockResolvedValue({ user: { id: 7, username: 'alice', is_admin: 0, is_review_exempt: 0 }, source: 'better-auth-session' });
    mocks.quickCheck.mockResolvedValue({ hasSensitiveWords: false });
    mocks.getUserUsedSlots.mockResolvedValue(0);
    mocks.getUserDataCardCapacity.mockResolvedValue(20);
    mocks.createDataCardWithAuthor.mockResolvedValue({ success: true, id: 'card-created' });
    mocks.getUserDataCards.mockResolvedValue([]);
  });

  test('GET 限制单页正文数量并返回下一页，不公开缓存私有卡片', async () => {
    mocks.getUserDataCards.mockResolvedValueOnce(Array.from({ length: 9 }, (_, i) => ({ id: String(i) })));
    const response = await handler(new Request('https://example.test/api/data-cards?limit=999&offset=8'));
    expect(mocks.getUserDataCards).toHaveBeenCalledWith(7, undefined, undefined, { limit: 9, offset: 8 });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const payload = await response.json();
    expect(payload.cards).toHaveLength(8);
    expect(payload.nextOffset).toBe(16);
  });

  test.each(['limit=0', 'offset=-1', 'limit=no', 'offset=1.5'])('GET 拒绝非法分页 %s', async (query) => {
    const response = await handler(new Request(`https://example.test/api/data-cards?${query}`));
    expect(response.status).toBe(400);
    expect(mocks.getUserDataCards).not.toHaveBeenCalled();
  });

  test.each([2, -2, 0.5, 1.5, '1'])('POST 拒绝契约外可见性值 %j', async (isPublic) => {
    const response = await handler(new Request('https://example.test/api/data-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'character',
        name: '测试卡',
        data: {},
        isPublic,
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '无效的数据卡可见性' });
    expect(mocks.createDataCardWithAuthor).not.toHaveBeenCalled();
  });

  test.each([2, -2, 0.5, 1.5, '0'])('PUT 拒绝契约外可见性值 %j', async (isPublic) => {
    const response = await handler(new Request('https://example.test/api/data-cards', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'card-existing', isPublic }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '无效的数据卡可见性' });
    expect(mocks.updateDataCard).not.toHaveBeenCalled();
  });
  const createRequest = (extra: Record<string, unknown> = {}) => new Request('https://example.test/api/data-cards/create-owned', {
    method: 'POST', headers: { authorization: 'Bearer fixture-account-a', cookie: 'fixture-session=b' },
    body: JSON.stringify({ type: 'character', name: 'fixture', data: {}, expectedUserId: 7, ...extra }),
  });
  const expectNoEffects = () => {
    expect(mocks.quickCheck).not.toHaveBeenCalled();
    expect(mocks.getUserUsedSlots).not.toHaveBeenCalled();
    expect(mocks.getUserDataCardCapacity).not.toHaveBeenCalled();
    expect(mocks.createDataCardWithAuthor).not.toHaveBeenCalled();
  };
  test.each([undefined, null, '7', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('owned 拒绝非法 owner %j', async (expectedUserId) => {
    expect((await ownedHandler(createRequest({ expectedUserId }))).status).toBe(400);
    expectNoEffects();
  });
  test('真实鉴权链 cookie B 优先于 bearer A，但在业务之前拒绝不符账号', async () => {
    const getSessionAuthUserImpl = vi.fn(async () => ({ id: 8, username: 'fixture-b' }));
    const getUserByAuthKeyImpl = vi.fn(async () => ({ id: 7, username: 'fixture-a' }));
    const auth = createAuthServer({ hasBetterAuthSessionCookieImpl: () => true, getSessionAuthUserImpl, getUserByAuthKeyImpl });
    mocks.requireAuthUser.mockImplementation(auth.requireAuthUser);
    const response = await ownedHandler(createRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'ACCOUNT_MISMATCH' });
    expect(mocks.requireAuthUser).toHaveBeenCalledTimes(1);
    expect(getSessionAuthUserImpl).toHaveBeenCalledTimes(1);
    expect(getUserByAuthKeyImpl).not.toHaveBeenCalled();
    expectNoEffects();
  });
  test('鉴权一次且异步业务期间冻结 owner 和作者', async () => {
    const user = { id: 7, username: 'fixture-a', is_admin: 0 };
    mocks.requireAuthUser.mockResolvedValueOnce({ user }).mockResolvedValue({ user: { id: 8, username: 'fixture-b' } });
    mocks.quickCheck.mockImplementationOnce(async () => { user.id = 8; user.username = 'changed'; return { hasSensitiveWords: false }; });
    const response = await ownedHandler(createRequest());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, id: 'card-created', accountFenceVersion: 1, ownerUserId: 7 });
    expect(mocks.requireAuthUser).toHaveBeenCalledTimes(1);
    expect(mocks.createDataCardWithAuthor.mock.calls[0].slice(0, 2)).toEqual([7, 'fixture-a']);
  });
  test.each([handler, ownedHandler])('两个入口保留同一业务检查及 questionnaire 清理', async (route) => {
    const success = await route(createRequest({ type: 'questionnaire', data: { nativeAllowed: true }, isPublic: true }));
    expect(success.status).toBe(201);
    const call = mocks.createDataCardWithAuthor.mock.calls[0];
    expect(call[2]).toBe('questionnaire');
    expect(JSON.parse(call[5] as string)).toMatchObject({ nativeAllowed: false, _authorId: 7 });
    expect(call[6]).toBe(1);
    expect(call[7]).toBe('pending');
    expect((await success.json()).accountFenceVersion).toBe(route === ownedHandler ? 1 : undefined);
    mocks.createDataCardWithAuthor.mockClear();
    mocks.quickCheck.mockResolvedValueOnce({ hasSensitiveWords: true });
    expect((await route(createRequest())).status).toBe(403);
    mocks.getUserUsedSlots.mockResolvedValueOnce(20);
    expect((await route(createRequest())).status).toBe(429);
    expect((await route(createRequest({ data: { text: 'x'.repeat(4 * 1024 * 1024) } }))).status).toBe(413);
    expect(mocks.createDataCardWithAuthor).not.toHaveBeenCalled();
  });

  test.each([401, 403])('owned 保留鉴权拒绝 %s 且零业务副作用', async (status) => {
    mocks.requireAuthUser.mockResolvedValueOnce({ response: Response.json({ error: 'denied' }, { status }) });
    expect((await ownedHandler(createRequest())).status).toBe(status);
    expect(mocks.requireAuthUser).toHaveBeenCalledTimes(1);
    expectNoEffects();
  });
  test('owned 只开放 POST', async () => {
    expect((await ownedHandler(new Request('https://example.test/api/data-cards/create-owned'))).status).toBe(405);
    expect(mocks.requireAuthUser).not.toHaveBeenCalled();
    expectNoEffects();
  });

  test.each([handler, ownedHandler])('两个入口保留管理员 questionnaire 权限及用户审查豁免', async (route) => {
    mocks.requireAuthUser.mockResolvedValueOnce({ user: { id: 7, username: 'fixture-admin', is_admin: 1, is_review_exempt: 1 } });
    expect((await route(createRequest({ type: 'questionnaire', data: { nativeAllowed: true } }))).status).toBe(201);
    const call = mocks.createDataCardWithAuthor.mock.calls[0];
    expect(JSON.parse(call[5] as string).nativeAllowed).toBe(true);
    expect(call[7]).toBe('approved');
  });

});
