import { beforeEach, describe, expect, mock, test } from 'bun:test';

type AuthSuccess = {
  user: {
    id: number;
    username: string;
    is_admin: number;
    is_review_exempt: number;
  };
};

const state = {
  authResult: {
    user: {
      id: 7,
      username: 'alice',
      is_admin: 0,
      is_review_exempt: 0,
    },
  } as AuthSuccess,
  currentCard: null as any,
  createCalls: [] as Array<Record<string, unknown>>,
  updateCalls: [] as Array<Record<string, unknown>>,
  legacyContentCalls: [] as Array<Record<string, unknown>>,
  ormContentCalls: [] as Array<Record<string, unknown>>,
  upsertUpdateCalls: [] as Array<Record<string, unknown>>,
  deleteUpdateCalls: [] as string[],
  autoReviewCreateCalls: [] as number[],
  autoReviewUpdateCalls: [] as number[],
  resetStrictCalls: [] as string[],
};

mock.module('@/lib/auth/server', () => ({
  requireAuthUser: async () => state.authResult,
}));

mock.module('@/lib/database/data-cards', () => ({
  createDataCardWithAuthor: async (
    userId: number,
    username: string,
    type: string,
    name: string,
    description: string,
    data: string,
    isPublic: number,
    reviewStatus: string,
  ) => {
    state.createCalls.push({ userId, username, type, name, description, data, isPublic, reviewStatus });
    return { success: true, id: 'card-new' };
  },
  getUserDataCards: async () => [],
  updateDataCard: async (
    id: string,
    userId: number,
    name: string,
    description: string,
    isPublic?: number,
    reviewStatus?: string,
  ) => {
    state.updateCalls.push({ id, userId, name, description, isPublic, reviewStatus });
    return true;
  },
  deleteDataCard: async () => true,
  pruneUserRecycleBin: async () => [],
  upsertDataCardUpdate: async (dataCardId: string, userId: number, payload: unknown) => {
    state.upsertUpdateCalls.push({ dataCardId, userId, payload });
    return true;
  },
  deleteDataCardUpdate: async (dataCardId: string) => {
    state.deleteUpdateCalls.push(dataCardId);
    return true;
  },
  getDataCardById: async () => state.currentCard,
  getUserUsedSlots: async () => 0,
  updateDataCardContentByIdAndUser: async (id: string, userId: number, dataJsonString: string) => {
    state.legacyContentCalls.push({ id, userId, dataJsonString });
    return true;
  },
}));

mock.module('@/lib/database/users', () => ({
  getUserDataCardCapacity: async () => 32,
}));

mock.module('@/lib/config', () => ({
  config: {
    DEFAULT_DATA_CARD_CAPACITY: 32,
    DATA_CARD_AUTO_REVIEW: {
      enabled: true,
    },
    RECYCLE_BIN_LIMIT: 50,
  },
}));

mock.module('@/lib/sensitive-word-filter', () => ({
  quickCheck: async () => ({ hasSensitiveWords: false }),
}));

mock.module('@/lib/db/drizzle', () => ({
  getDrizzleDbFromRuntime: () => null,
}));

mock.module('@/lib/db/repositories/data-cards-write', () => ({
  getDataCardUpdatedAtById: async () => null,
  updateDataCardContentByIdAndUser: async (_db: unknown, dataCardId: string, userId: number, dataJsonString: string) => {
    state.ormContentCalls.push({ dataCardId, userId, dataJsonString });
  },
}));

mock.module('@/lib/metrics/techIndex', () => ({
  computeTechIndex: () => ({
    techScore: 0,
    techLevel: 'L0',
    raw: {},
    derived: {},
    components: {},
    notes: [],
  }),
}));

mock.module('@/lib/signature', () => ({
  verifySignature: async () => null,
}));

mock.module('@/lib/database/data-card-metrics', () => ({
  upsertDataCardMetrics: async () => undefined,
}));

mock.module('@/lib/database/arena-ratings', () => ({
  resetStrictArenaRatingForDataCard: async (dataCardId: string) => {
    state.resetStrictCalls.push(dataCardId);
    return { ok: true };
  },
}));

mock.module('@/lib/review/auto-data-card-review', () => ({
  autoReviewLatestPendingPublicDataCardsForUser: async (userId: number) => {
    state.autoReviewCreateCalls.push(userId);
    return { ok: true, reviewedCount: 0, approvedCount: 0, approvedIds: [], usedModel: null };
  },
  autoReviewLatestPendingPublicDataCardUpdatesForUser: async (userId: number) => {
    state.autoReviewUpdateCalls.push(userId);
    return { ok: true, reviewedCount: 0, approvedCount: 0, approvedIds: [], usedModel: null };
  },
}));

describe('pages/api/data-cards visual asset guard', () => {
  beforeEach(() => {
    state.authResult = {
      user: {
        id: 7,
        username: 'alice',
        is_admin: 0,
        is_review_exempt: 0,
      },
    };
    state.currentCard = null;
    state.createCalls = [];
    state.updateCalls = [];
    state.legacyContentCalls = [];
    state.ormContentCalls = [];
    state.upsertUpdateCalls = [];
    state.deleteUpdateCalls = [];
    state.autoReviewCreateCalls = [];
    state.autoReviewUpdateCalls = [];
    state.resetStrictCalls = [];
  });

  test('创建带视觉资产的数据卡时，应直接标记为 rejected 且跳过自动审核', async () => {
    state.authResult.user.is_review_exempt = 1;

    const { default: handler } = await import('@/pages/api/data-cards');
    const response = await handler(
      new Request('https://example.com/api/data-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'character',
          name: '带图角色',
          description: '测试',
          isPublic: 1,
          data: {
            templateId: '通用角色',
            name: '带图角色',
            content: '测试内容',
            portrait: 'data:image/png;base64,QUJDRA==',
          },
        }),
      }),
    );

    const json = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(state.createCalls).toHaveLength(1);
    expect(state.createCalls[0]?.reviewStatus).toBe('rejected');
    expect(state.autoReviewCreateCalls).toEqual([]);
    expect(json.reviewStatus).toBe('rejected');
    expect(json.visualAssetsRejected).toBe(true);
  });

  test('已审核数据卡替换为带视觉资产版本时，应直接写主表并标记为 rejected', async () => {
    state.currentCard = {
      id: 'card-1',
      user_id: 7,
      type: 'character',
      name: '旧角色',
      description: '旧描述',
      is_public: 1,
      review_status: 'approved',
      data: JSON.stringify({
        templateId: '通用角色',
        name: '旧角色',
        content: '旧内容',
      }),
    };

    const { default: handler } = await import('@/pages/api/data-cards');
    const response = await handler(
      new Request('https://example.com/api/data-cards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'card-1',
          name: '新角色',
          description: '新描述',
          isPublic: 1,
          data: {
            templateId: '通用角色',
            name: '新角色',
            content: '新内容',
            portrait: 'data:image/png;base64,QUJDRA==',
          },
        }),
      }),
    );

    const json = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0]?.reviewStatus).toBe('rejected');
    expect(state.legacyContentCalls).toHaveLength(1);
    expect(state.upsertUpdateCalls).toEqual([]);
    expect(state.deleteUpdateCalls).toEqual(['card-1']);
    expect(state.autoReviewUpdateCalls).toEqual([]);
    expect(state.resetStrictCalls).toEqual(['card-1']);
    expect(json.reviewStatus).toBe('rejected');
    expect(json.visualAssetsRejected).toBe(true);
  });
});
