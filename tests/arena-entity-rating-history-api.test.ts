import { describe, expect, vi, test } from 'vitest';

vi.mock('@/lib/db/drizzle', () => ({
  getDrizzleDbFromRuntime: () => null,
}));

describe('api/arena/entity-rating-history', () => {
  test('返回 strict 实体历史并限制为公开摘要字段', async () => {
    const { createEntityRatingHistoryHandler } = await import('@/pages/api/arena/entity-rating-history');

    const handler = createEntityRatingHistoryHandler({
      getDb: () => ({ db: true }),
      listArenaEntityRatingHistory: async (_db, input) => {
        expect(input).toEqual({
          entityType: 'data_card',
          entityId: 'card-target',
          queue: 'strict',
          limit: 10,
        });
        return [
          {
            generationId: 'gen-a',
            createdAt: '2026-04-25T10:00:00.000Z',
            appliedAt: '2026-04-25T10:00:01.000Z',
            opponent: { entityType: 'preset', entityId: 'M01.json', displayName: '矢车菊' },
            result: 'win',
            delta: 18,
            afterRating: 1018,
            initiator: { userId: 7, username: '发起者七号' },
          },
        ];
      },
    });

    const response = await handler(
      new Request('https://example.test/api/arena/entity-rating-history?entityType=data_card&entityId=card-target'),
    );
    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      entityType: 'data_card',
      entityId: 'card-target',
      queue: 'strict',
      items: [
        {
          generationId: 'gen-a',
          createdAt: '2026-04-25T10:00:00.000Z',
          appliedAt: '2026-04-25T10:00:01.000Z',
          opponent: { entityType: 'preset', entityId: 'M01.json', displayName: '矢车菊' },
          result: 'win',
          delta: 18,
          afterRating: 1018,
          initiator: { userId: 7, username: '发起者七号' },
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain('ip');
    expect(JSON.stringify(payload)).not.toContain('email');
  });
});
