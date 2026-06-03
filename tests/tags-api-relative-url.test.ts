import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/database/tags', () => ({
  getTags: vi.fn(async () => [
    {
      id: 'rating',
      name: '评分',
      description: null,
      category: null,
      scope: 'data_card',
      is_active: 1,
    },
  ]),
}));

import handler from '@/pages/api/tags';

describe('pages/api/tags Worker URL compatibility', () => {
  test('OpenNext Worker 传入相对 req.url 时仍能读取 query 并返回标签', async () => {
    const req = { method: 'GET', url: '/api/tags?includeInactive=1' } as Parameters<typeof handler>[0];

    const response = await handler(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      tags: [
        {
          id: 'rating',
          name: '评分',
          description: null,
          category: null,
          scope: 'data_card',
          isActive: true,
        },
      ],
    });
  });
});
