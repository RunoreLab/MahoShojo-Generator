import { describe, expect, it, vi } from 'vitest';

import type { HonoServerConfig } from '#/config';
import { createHonoApp } from '#/app';
import type { ArenaRoomHttpDependencies } from '#/arena-room/room-http';
import {
  ArenaRoomMembershipError,
  type ArenaRoomMembershipService,
} from '#/arena-room/room-membership-service';
import type { RedisService } from '#/redis/runtime';
import { createArenaRoomState } from './arena-room-fixtures';

const config: HonoServerConfig = {
  arenaMultiplayerEnabled: true,
  host: '127.0.0.1',
  port: 8787,
  nodeEnv: 'test',
  redisUrl: 'redis://127.0.0.1:6379',
  redisKeyPrefix: 'test',
  redisRequired: true,
  d1Required: false,
  corsOrigins: ['http://localhost:3000'],
  authMode: 'hybrid',
};

const allowRateLimit = () => ({
  allowed: true,
  limit: 30,
  remaining: 29,
  retryAfterSeconds: 1,
});

const createRedisStub = () => ({
  connect: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  getStatus: vi.fn(() => ({
    configured: true,
    connected: true,
    ready: true,
    lastError: null,
  })),
  ping: vi.fn(async () => true),
  consumeFixedWindow: vi.fn(async () => allowRateLimit()),
}) satisfies RedisService;

const authority = createArenaRoomState();
const self = authority.snapshot.members[0]!;
const session = {
  roomId: authority.snapshot.roomId,
  roomEpoch: authority.snapshot.roomEpoch,
  member: self,
  snapshot: authority.snapshot,
};

const createDependencies = (
  overrides: Partial<ArenaRoomHttpDependencies> = {},
): ArenaRoomHttpDependencies => ({
  resolveAuthentication: vi.fn(async () => ({
    status: 'authenticated' as const,
    userId: 101,
  })),
  memberships: {
    create: vi.fn(async () => ({
      roomId: session.roomId,
      roomEpoch: session.roomEpoch,
      member: session.member,
      snapshot: session.snapshot,
    })),
    join: vi.fn(async () => ({
      roomId: session.roomId,
      roomEpoch: session.roomEpoch,
      member: session.member,
      snapshot: session.snapshot,
    })),
    leave: vi.fn(async () => ({
      roomId: session.roomId,
      roomEpoch: session.roomEpoch,
      member: {
        ...session.member,
        userId: 'member-1',
        role: 'member' as const,
        membershipState: 'revoked' as const,
      },
    })),
    close: vi.fn(async () => ({
      roomId: session.roomId,
      roomEpoch: session.roomEpoch,
      member: session.member,
    })),
    getSession: vi.fn(async () => session),
  } as unknown as ArenaRoomMembershipService,
  directory: {
    discoverPublic: vi.fn(async () => ({ items: [], nextCursor: null })),
  },
  websocketAuthority: {
    issue: vi.fn(async () => 'signed-room-ticket'),
  },
  rateLimit: vi.fn(async () => allowRateLimit()),
  ...overrides,
});

const createRequest = (body: Record<string, unknown>) => ({
  method: 'POST',
  headers: {
    authorization: 'Bearer legacy-key',
    'content-type': 'application/json',
    origin: 'http://localhost:3000',
  },
  body: JSON.stringify(body),
});

describe('Arena Room HTTP product routes', () => {
  it('flag off 时不注册任何 Room 产品入口，也不调用 Room dependency', async () => {
    const redis = createRedisStub();
    const dependencies = createDependencies();
    const app = createHonoApp(
      { ...config, arenaMultiplayerEnabled: false },
      redis,
      undefined,
      { arenaRoom: dependencies },
    );

    const response = await app.request('/api/arena/rooms/v1');

    expect(response.status).toBe(404);
    expect(dependencies.resolveAuthentication).not.toHaveBeenCalled();
    expect(dependencies.directory.discoverPublic).not.toHaveBeenCalled();
  });

  it('flag on 缺少完整 dependency 时启动即 fail closed', () => {
    expect(() => createHonoApp(config, createRedisStub())).toThrow(
      /Arena Room HTTP dependencies/,
    );
  });

  it('所有入口先认证，anonymous/denied 分别稳定返回 401/403', async () => {
    for (const [resolution, status, code] of [
      [{ status: 'anonymous' as const }, 401, 'ROOM_AUTHENTICATION_REQUIRED'],
      [{ status: 'denied' as const }, 403, 'ROOM_AUTHENTICATION_DENIED'],
    ] as const) {
      const dependencies = createDependencies({
        resolveAuthentication: vi.fn(async () => resolution),
      });
      const app = createHonoApp(config, createRedisStub(), undefined, {
        arenaRoom: dependencies,
      });
      const response = await app.request('/api/arena/rooms/v1');
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
      expect(dependencies.rateLimit).not.toHaveBeenCalled();
      expect(dependencies.directory.discoverPublic).not.toHaveBeenCalled();
    }
  });

  it('create 拒绝客户端 authority 字段，并只注入认证 account identity', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const invalid = await app.request('/api/arena/rooms/v1', createRequest({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig: authority.snapshot.sharedConfig,
      role: 'host',
    }));
    expect(invalid.status).toBe(400);
    expect(dependencies.memberships.create).not.toHaveBeenCalled();

    const response = await app.request('/api/arena/rooms/v1', createRequest({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig: authority.snapshot.sharedConfig,
    }));
    expect(response.status).toBe(201);
    expect(dependencies.memberships.create).toHaveBeenCalledWith({
      accountUserId: 101,
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig: authority.snapshot.sharedConfig,
    });
    expect(dependencies.memberships.getSession).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      protocolVersion: 1,
      roomId: session.roomId,
      self: { userId: self.userId, role: 'host' },
    });
  });

  it('create/join 使用同一次 checkpoint 结果返回 session，不做可制造 unknown result 的二次读取', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.memberships.getSession).mockRejectedValue(
      new Error('late read unavailable'),
    );
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });

    const created = await app.request('/api/arena/rooms/v1', createRequest({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig: authority.snapshot.sharedConfig,
    }));
    const joined = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/join`,
      createRequest({ displayName: '成员' }),
    );

    expect(created.status).toBe(201);
    expect(joined.status).toBe(200);
    expect(dependencies.memberships.getSession).not.toHaveBeenCalled();
  });

  it('discover/join/session/ticket/leave/close 使用窄 service 且返回 versioned wire', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });

    const discovery = await app.request('/api/arena/rooms/v1?limit=10', {
      headers: { authorization: 'Bearer legacy-key' },
    });
    expect(discovery.status).toBe(200);
    expect(discovery.headers.get('cache-control')).toBe('no-store');
    expect(dependencies.directory.discoverPublic).toHaveBeenCalledWith({ limit: 10 });

    const join = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/join`,
      createRequest({ displayName: '成员' }),
    );
    expect(join.status).toBe(200);
    expect(dependencies.memberships.join).toHaveBeenCalledWith({
      roomId: session.roomId,
      accountUserId: 101,
      displayName: '成员',
    });

    const status = await app.request(`/api/arena/rooms/v1/${session.roomId}/session`, {
      headers: { authorization: 'Bearer legacy-key' },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ snapshot: { members: authority.snapshot.members } });

    const ticket = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/ticket`,
      createRequest({ reconnect: { control: { roomEpoch: session.roomEpoch, controlSeq: 7 } } }),
    );
    expect(ticket.status).toBe(200);
    expect(ticket.headers.get('cache-control')).toBe('no-store');
    expect(dependencies.websocketAuthority.issue).toHaveBeenCalledWith({
      roomId: session.roomId,
      accountUserId: 101,
      reconnect: { control: { roomEpoch: session.roomEpoch, controlSeq: 7 } },
    });
    expect(await ticket.json()).toMatchObject({
      protocolVersion: 1,
      ticket: 'signed-room-ticket',
      expiresInSeconds: 45,
      websocket: {
        path: '/api/arena/rooms/v1/ws',
        protocol: 'mahoshojo.arena-room.v1',
      },
    });

    const leave = await app.request(`/api/arena/rooms/v1/${session.roomId}/leave`,
      createRequest({ expectedRoomEpoch: session.roomEpoch }));
    expect(leave.status).toBe(200);
    expect(dependencies.memberships.leave).toHaveBeenCalledWith({
      roomId: session.roomId,
      accountUserId: 101,
      expectedRoomEpoch: session.roomEpoch,
    });
    expect(await leave.json()).toMatchObject({ outcome: 'left' });

    const close = await app.request(`/api/arena/rooms/v1/${session.roomId}/close`,
      createRequest({ expectedRoomEpoch: session.roomEpoch }));
    expect(close.status).toBe(200);
    expect(dependencies.memberships.close).toHaveBeenCalledWith({
      roomId: session.roomId,
      accountUserId: 101,
      expectedRoomEpoch: session.roomEpoch,
    });
    expect(await close.json()).toMatchObject({ outcome: 'closed' });
  });

  it('leave/close 拒绝缺失或过期 epoch，旧 incarnation 请求不能作用于当前 Room', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.memberships.close).mockRejectedValue(
      new ArenaRoomMembershipError('ROOM_EPOCH_STALE'),
    );
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });

    const missing = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/leave`,
      createRequest({}),
    );
    const stale = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/close`,
      createRequest({ expectedRoomEpoch: 'epoch-stale' }),
    );

    expect(missing.status).toBe(400);
    expect(dependencies.memberships.leave).not.toHaveBeenCalled();
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'ROOM_CONFLICT' });
  });

  it('拒绝不受信任 Origin、cookie mutation 缺失 Origin、未知 query 与 oversized body', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });

    const evilOrigin = await app.request('/api/arena/rooms/v1', {
      headers: {
        authorization: 'Bearer legacy-key',
        origin: 'https://localhost.evil.example',
      },
    });
    expect(evilOrigin.status).toBe(403);
    expect(dependencies.resolveAuthentication).not.toHaveBeenCalled();

    const cookieWithoutOrigin = await app.request('/api/arena/rooms/v1', {
      method: 'POST',
      headers: {
        cookie: 'better-auth.session_token=opaque',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(cookieWithoutOrigin.status).toBe(403);

    const unknownQuery = await app.request('/api/arena/rooms/v1?visibility=public', {
      headers: { authorization: 'Bearer legacy-key' },
    });
    expect(unknownQuery.status).toBe(400);

    const oversized = await app.request('/api/arena/rooms/v1', createRequest({
      padding: 'x'.repeat(64 * 1_024),
    }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ code: 'ROOM_PAYLOAD_TOO_LARGE' });
    expect(dependencies.memberships.create).not.toHaveBeenCalled();
  });

  it('account/operation limiter 不可用或超额时 fail closed，不触发 authority mutation', async () => {
    for (const [result, status, code] of [
      [null, 503, 'ROOM_UNAVAILABLE'],
      [{ allowed: false, limit: 5, remaining: 0, retryAfterSeconds: 9 }, 429, 'ROOM_RATE_LIMITED'],
    ] as const) {
      const dependencies = createDependencies({
        rateLimit: vi.fn(async () => result),
      });
      const app = createHonoApp(config, createRedisStub(), undefined, {
        arenaRoom: dependencies,
      });
      const response = await app.request('/api/arena/rooms/v1', createRequest({
        displayName: '房主',
        directory: { title: '测试房', visibility: 'public' },
        sharedConfig: authority.snapshot.sharedConfig,
      }));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
      expect(dependencies.memberships.create).not.toHaveBeenCalled();
    }
  });

  it('membership error 不泄漏 closed/not-found 差异，permission 与 conflict 可判别', async () => {
    for (const [membershipCode, status, code] of [
      ['ROOM_CLOSED', 404, 'ROOM_NOT_FOUND'],
      ['ROOM_NOT_FOUND', 404, 'ROOM_NOT_FOUND'],
      ['ROOM_PERMISSION_DENIED', 403, 'ROOM_FORBIDDEN'],
      ['ROOM_MEMBERSHIP_TRANSITION_DENIED', 409, 'ROOM_CONFLICT'],
    ] as const) {
      const dependencies = createDependencies();
      vi.mocked(dependencies.memberships.getSession).mockRejectedValueOnce(
        new ArenaRoomMembershipError(membershipCode),
      );
      const app = createHonoApp(config, createRedisStub(), undefined, {
        arenaRoom: dependencies,
      });
      const response = await app.request(`/api/arena/rooms/v1/${session.roomId}/session`, {
        headers: { authorization: 'Bearer legacy-key' },
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
    }
  });
});
