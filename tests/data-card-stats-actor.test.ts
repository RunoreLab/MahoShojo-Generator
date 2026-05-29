import { describe, expect, test } from 'vitest';

import { resolveDataCardStatsActor } from '@/lib/data-card-stats/actor';

describe('data-card stats actor', () => {
  test('已登录用户优先作为计分 actor', async () => {
    const hashedInputs: string[] = [];
    const req = new Request('https://example.test/api/data-card-stats', {
      headers: {
        'x-mahoshojo-activity-token': 'activity-7',
        'cf-connecting-ip': '1.2.3.4',
        'user-agent': 'ua-a',
      },
    });

    const actor = await resolveDataCardStatsActor(req, {
      getAuthUser: async () => ({ user: { id: 42, username: 'user-42' }, source: 'legacy-bearer' }),
      verifyActivityToken: async () => ({ userId: 7, expiresAt: '2026-12-31T00:00:00.000Z' }),
      hashActorKey: async (value) => {
        hashedInputs.push(value);
        return `hash:${value}`;
      },
    });

    expect(actor).toEqual({
      actorScope: 'auth_user',
      actorKeyHash: 'hash:auth_user:42',
    });
    expect(hashedInputs).toEqual(['auth_user:42']);
  });

  test('未登录时使用已签名 activity token，忽略裸 user-id 头', async () => {
    const hashedInputs: string[] = [];
    const req = new Request('https://example.test/api/data-card-stats', {
      headers: {
        'x-mahoshojo-activity-token': 'activity-7',
        'x-mahoshojo-user-id': '999',
        'cf-connecting-ip': '1.2.3.4',
        'user-agent': 'ua-a',
      },
    });

    const actor = await resolveDataCardStatsActor(req, {
      getAuthUser: async () => null,
      verifyActivityToken: async (token) =>
        token === 'activity-7' ? { userId: 7, expiresAt: '2026-12-31T00:00:00.000Z' } : null,
      hashActorKey: async (value) => {
        hashedInputs.push(value);
        return `hash:${value}`;
      },
    });

    expect(actor).toEqual({
      actorScope: 'activity_user',
      actorKeyHash: 'hash:activity_user:7',
    });
    expect(hashedInputs).toEqual(['activity_user:7']);
  });

  test('匿名 actor 使用 IP 与 UA 组合，并进行归一化脱敏', async () => {
    const hashedInputs: string[] = [];
    const req = new Request('https://example.test/api/data-card-stats', {
      headers: {
        'cf-connecting-ip': '9.9.9.77',
        'user-agent': 'Browser/1.0',
        'x-mahoshojo-user-id': '123',
      },
    });

    const actor = await resolveDataCardStatsActor(req, {
      getAuthUser: async () => null,
      verifyActivityToken: async () => null,
      hashActorKey: async (value) => {
        hashedInputs.push(value);
        return `hash:${value}`;
      },
    });

    expect(actor).toEqual({
      actorScope: 'anonymous',
      actorKeyHash: 'hash:anonymous:9.9.9.0:Browser/1.0',
    });
    expect(hashedInputs).toEqual(['anonymous:9.9.9.0:Browser/1.0']);
  });
});
