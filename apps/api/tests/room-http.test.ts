import { describe, expect, it, vi } from 'vitest';
import { ARENA_ROOM_ERROR_TAXONOMY_ACCEPT } from '@mahoshojo/contracts/arena-room';

import type { HonoServerConfig } from '#/config';
import { createHonoApp } from '#/app';
import type { ArenaRoomHttpDependencies } from '#/arena-room/room-http';
import {
  ArenaRoomMembershipError,
  type ArenaRoomMembershipService,
} from '#/arena-room/room-membership-service';
import {
  ArenaRoomProposalError,
  type ArenaRoomProposalService,
} from '#/arena-room/room-proposal-service';
import {
  ArenaRoomGenerationError,
  type ArenaRoomGenerationService,
} from '#/arena-room/room-generation-service';
import {
  ArenaRoomConfigError,
  type ArenaRoomConfigService,
} from '#/arena-room/room-config-service';
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
  arenaRoomAllowedOrigins: ['http://localhost:3000'],
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

const generationView = {
  protocolVersion: 1 as const,
  roomId: authority.snapshot.roomId,
  roomEpoch: authority.snapshot.roomEpoch,
  generation: {
    generationRequestId: 'request-1234',
    generationId: 'generation-1',
    attempt: 1,
    state: 'running' as const,
    configRevision: authority.snapshot.revision,
    snapshotDigest: `sha256:${'a'.repeat(64)}`,
    collaborativeInfluence: false,
    participantUserIds: [101],
    startedAt: '2026-08-28T00:00:00.000Z',
  },
  status: 'running' as const,
  markdown: '# 正文',
  nextChunkSeq: 2,
  finalAuthoritative: false,
};

const createDependencies = (
  overrides: Partial<ArenaRoomHttpDependencies> = {},
): ArenaRoomHttpDependencies => ({
  resolveAuthentication: vi.fn(async () => ({
    status: 'authenticated' as const,
    userId: 101,
  })),
  memberships: {
    hasCreationReceipt: vi.fn(async () => false),
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
    kick: vi.fn(async () => session),
    getSession: vi.fn(async () => session),
  } as unknown as ArenaRoomMembershipService,
  directory: {
    discoverPublic: vi.fn(async () => ({ items: [], nextCursor: null })),
  },
  websocketAuthority: {
    issue: vi.fn(async () => 'signed-room-ticket'),
  },
  proposals: {
    submit: vi.fn(async (input) => ({
      roomId: input.roomId,
      roomEpoch: session.roomEpoch,
      controlSeq: 8,
      revision: 0,
      proposalId: (input.request as { proposalId: string }).proposalId,
      status: 'submitted' as const,
      result: 'applied' as const,
    })),
    resolve: vi.fn(async (input) => ({
      roomId: input.roomId,
      roomEpoch: session.roomEpoch,
      controlSeq: 9,
      revision: 1,
      proposalId: input.proposalId,
      status: 'accepted' as const,
      result: 'applied' as const,
    })),
    withdraw: vi.fn(async (input) => ({
      roomId: input.roomId,
      roomEpoch: session.roomEpoch,
      controlSeq: 9,
      revision: 0,
      proposalId: input.proposalId,
      status: 'withdrawn' as const,
      result: 'applied' as const,
    })),
  } satisfies ArenaRoomProposalService,
  generations: {
    cancel: vi.fn(async () => ({
      ...generationView,
      generation: { ...generationView.generation, state: 'cancelled' as const },
      status: 'cancelled' as const,
      markdown: '',
      nextChunkSeq: 0,
    })),
    start: vi.fn(async () => generationView),
    read: vi.fn(async () => generationView),
  } satisfies ArenaRoomGenerationService,
  configs: {
    publish: vi.fn(async () => session),
  } satisfies ArenaRoomConfigService,
  rateLimit: vi.fn(async () => allowRateLimit()),
  ...overrides,
});

const createRequest = (body: Record<string, unknown>) => ({
  method: 'POST',
  headers: {
    authorization: 'Bearer legacy-key',
    'content-type': 'application/json',
    origin: 'http://localhost:3000',
    'x-mahoshojo-arena-error-taxonomy': '2',
  },
  body: JSON.stringify(body),
});

const guidanceChangeForHttp = () => ({
  changeId: 'guidance-1',
  type: 'setUserGuidance' as const,
  value: '成员建议',
  expectedBase: { kind: 'value' as const, value: '' },
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
      creationRequestId: 'create-request-1234',
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig: authority.snapshot.sharedConfig,
      role: 'host',
    }));
    expect(invalid.status).toBe(400);
    expect(dependencies.memberships.create).not.toHaveBeenCalled();

    const missingRequestId = await app.request('/api/arena/rooms/v1', createRequest({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig: authority.snapshot.sharedConfig,
    }));
    expect(missingRequestId.status).toBe(400);
    expect(dependencies.memberships.create).not.toHaveBeenCalled();

    const response = await app.request('/api/arena/rooms/v1', createRequest({
      creationRequestId: 'create-request-1234',
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' },
      sharedConfig: authority.snapshot.sharedConfig,
    }));
    expect(response.status).toBe(201);
    expect(dependencies.memberships.create).toHaveBeenCalledWith({
      accountUserId: 101,
      creationRequestId: 'create-request-1234',
      requireExistingCreationReceipt: false,
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
      creationRequestId: 'create-request-1234',
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

  it('多人 generation start 使用独立 12MiB 上限、strict intent 与 headers-only source context', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const secret = 'provider-secret-canary';
    const body = {
      expectedRoomEpoch: authority.snapshot.roomEpoch,
      expectedRevision: authority.snapshot.revision,
      generationRequestId: 'request-1234',
      sharedConfig: authority.snapshot.sharedConfig,
      hostLocalPayloads: [],
      generation: {
        customProvider: { apiKey: secret },
        narrativeHistory: [{ content: 'x'.repeat(70 * 1_024) }],
      },
    };
    const response = await app.request(
      `/api/arena/rooms/v1/${authority.snapshot.roomId}/generations`,
      createRequest(body),
    );
    expect(response.status).toBe(202);
    expect(dependencies.generations.start).toHaveBeenCalledTimes(1);
    const call = vi.mocked(dependencies.generations.start).mock.calls[0]![0];
    expect(call).toMatchObject({
      roomId: authority.snapshot.roomId,
      accountUserId: 101,
      request: body,
    });
    expect(call.sourceRequest.headers.get('authorization')).toBe('Bearer legacy-key');
    await expect(call.sourceRequest.text()).resolves.toBe('');
    expect(JSON.stringify(await response.json())).not.toContain(secret);

    const injected = await app.request(
      `/api/arena/rooms/v1/${authority.snapshot.roomId}/generations`,
      createRequest({ ...body, attempt: 2 }),
    );
    expect(injected.status).toBe(400);
    expect(dependencies.generations.start).toHaveBeenCalledTimes(1);

    const oversizedRequest = createRequest(body);
    const oversized = await app.request(
      `/api/arena/rooms/v1/${authority.snapshot.roomId}/generations`,
      {
        ...oversizedRequest,
        headers: {
          ...oversizedRequest.headers,
          'content-length': String(12 * 1_024 * 1_024 + 1),
        },
      },
    );
    expect(oversized.status).toBe(413);
  });

  it.each([
    [
      new ArenaRoomGenerationError('ROOM_GENERATION_COMBATANTS_EMPTY', {
        code: 'GENERATION_COMBATANTS_EMPTY',
        gate: 'generation-readiness',
        severity: 'blocking',
        target: { kind: 'combatant' },
        params: { current: 0, required: 1 },
        messageKey: 'arena.multiplayer.gate.generationCombatantsEmpty',
        userAction: '至少添加 1 位参战角色后再开始生成。',
      }),
      409,
      'ROOM_GENERATION_COMBATANTS_EMPTY',
      '当前有 0 位参战角色，至少需要 1 位',
    ],
    [
      new ArenaRoomGenerationError('ROOM_GENERATION_COMBATANTS_INSUFFICIENT', {
        code: 'GENERATION_COMBATANTS_INSUFFICIENT',
        gate: 'generation-readiness',
        severity: 'blocking',
        target: { kind: 'combatant' },
        params: { current: 1, required: 2, mode: 'classic' },
        messageKey: 'arena.multiplayer.gate.generationCombatantsInsufficient',
        userAction: '当前模式至少需要 2 位参战角色，请继续添加角色。',
      }),
      409,
      'ROOM_GENERATION_COMBATANTS_INSUFFICIENT',
      '经典模式当前有 1 位参战角色，至少需要 2 位',
    ],
    [
      new ArenaRoomGenerationError('ROOM_GENERATION_SCENARIO_REQUIRED'),
      409,
      'ROOM_GENERATION_SCENARIO_REQUIRED',
      '情景模式需要主情景',
    ],
    [
      new ArenaRoomGenerationError('ROOM_GENERATION_COMBATANT_LIMIT'),
      400,
      'ROOM_GENERATION_COMBATANT_LIMIT',
      '运行时上限 32 位',
    ],
    [
      new ArenaRoomGenerationError('ROOM_RUNTIME_BODY_LIMIT'),
      413,
      'ROOM_RUNTIME_BODY_LIMIT',
      '12 MiB',
    ],
    [
      new ArenaRoomGenerationError('ROOM_RUNTIME_REFERENCE_LIMIT'),
      400,
      'ROOM_RUNTIME_REFERENCE_LIMIT',
      '运行时上限 256 项',
    ],
    [
      new ArenaRoomGenerationError('ROOM_RUNTIME_ADJUDICATION_LIMIT'),
      400,
      'ROOM_RUNTIME_ADJUDICATION_LIMIT',
      '运行时上限 100 项',
    ],
    [
      new ArenaRoomGenerationError('ROOM_RUNTIME_PROMPT_BUDGET_EXCEEDED'),
      400,
      'ROOM_RUNTIME_PROMPT_BUDGET_EXCEEDED',
      '生成提示词超过当前渠道的安全预算',
    ],
    [
      new ArenaRoomGenerationError('ROOM_PROVIDER_CONFIG_INVALID'),
      400,
      'ROOM_PROVIDER_CONFIG_INVALID',
      '检查服务商、模型和 API Key',
    ],
    [
      new ArenaRoomGenerationError(
        'ROOM_HOST_LOCAL_PAYLOAD_MISSING',
        undefined,
        { kind: 'combatant', displayName: '星野' },
      ),
      400,
      'ROOM_HOST_LOCAL_PAYLOAD_MISSING',
      '角色「星野」',
    ],
    [
      new ArenaRoomGenerationError(
        'ROOM_HOST_LOCAL_PAYLOAD_INVALID',
        undefined,
        { kind: 'room' },
      ),
      400,
      'ROOM_HOST_LOCAL_PAYLOAD_INVALID',
      '本地内容列表',
    ],
    [
      new ArenaRoomGenerationError(
        'ROOM_HOST_LOCAL_KIND_MISMATCH',
        undefined,
        { kind: 'scenario', displayName: '雨夜' },
      ),
      400,
      'ROOM_HOST_LOCAL_KIND_MISMATCH',
      '情景「雨夜」',
    ],
    [
      new ArenaRoomGenerationError(
        'ROOM_HOST_LOCAL_DIGEST_MISMATCH',
        undefined,
        { kind: 'material', displayName: '银剑' },
      ),
      409,
      'ROOM_HOST_LOCAL_DIGEST_MISMATCH',
      '素材「银剑」',
    ],
    [
      new ArenaRoomGenerationError(
        'ROOM_HOST_LOCAL_TYPE_MISMATCH',
        undefined,
        { kind: 'combatant', displayName: '星野' },
      ),
      400,
      'ROOM_HOST_LOCAL_TYPE_MISMATCH',
      '角色「星野」',
    ],
    [
      new ArenaRoomGenerationError('ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING'),
      400,
      'ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING',
      '重新发布房间配置',
    ],
    [
      new ArenaRoomGenerationError('ROOM_REFERENCE_STALE'),
      409,
      'ROOM_REFERENCE_STALE',
      '数据卡加入房间后已更新',
    ],
  ] as const)('generation 门禁和 host-local 错误保持独立 wire code：%s', async (
    serviceError,
    status,
    wireCode,
    message,
  ) => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.generations.start).mockRejectedValueOnce(serviceError);
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const response = await app.request(
      `/api/arena/rooms/v1/${authority.snapshot.roomId}/generations`,
      {
        ...createRequest({
        expectedRoomEpoch: authority.snapshot.roomEpoch,
        expectedRevision: authority.snapshot.revision,
        generationRequestId: 'request-1234',
        sharedConfig: authority.snapshot.sharedConfig,
        hostLocalPayloads: [],
        generation: {},
        }),
        headers: {
          ...createRequest({}).headers,
          'x-mahoshojo-arena-error-taxonomy': '2',
        },
      },
    );

    expect(response.status).toBe(status);
    const errorBody = await response.json() as { code: string; error: string };
    expect(errorBody).toMatchObject({ code: wireCode });
    expect(errorBody.error).toContain(message);
  });

  it('granular error taxonomy 需显式协商，旧客户端与未知版本只收到 0bb6b883 基线 code', async () => {
    const serviceError = new ArenaRoomGenerationError('ROOM_GENERATION_COMBATANTS_EMPTY', {
      code: 'GENERATION_COMBATANTS_EMPTY',
      gate: 'generation-readiness',
      severity: 'blocking',
      target: { kind: 'combatant' },
      params: { current: 0, required: 1 },
      messageKey: 'arena.multiplayer.gate.generationCombatantsEmpty',
      userAction: '至少添加 1 位参战角色后再开始生成。',
    });
    const dependencies = createDependencies();
    vi.mocked(dependencies.generations.start).mockRejectedValue(serviceError);
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const body = {
      expectedRoomEpoch: authority.snapshot.roomEpoch,
      expectedRevision: authority.snapshot.revision,
      generationRequestId: 'request-1234',
      sharedConfig: authority.snapshot.sharedConfig,
      hostLocalPayloads: [],
      generation: {},
    };

    for (const taxonomyVersion of [undefined, '999'] as const) {
      const request = createRequest(body);
      const headers: Record<string, string> = { ...request.headers };
      if (taxonomyVersion === undefined) {
        delete headers['x-mahoshojo-arena-error-taxonomy'];
      } else {
        headers['x-mahoshojo-arena-error-taxonomy'] = taxonomyVersion;
      }
      const response = await app.request(
        `/api/arena/rooms/v1/${authority.snapshot.roomId}/generations`,
        {
          ...request,
          headers,
        },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'ROOM_CONFLICT',
        error: expect.stringContaining('至少需要 1 位'),
      });
    }

    const negotiatedRequest = createRequest(body);
    const acceptHeaders: Record<string, string> = { ...negotiatedRequest.headers };
    delete acceptHeaders['x-mahoshojo-arena-error-taxonomy'];
    acceptHeaders.accept = ARENA_ROOM_ERROR_TAXONOMY_ACCEPT;
    const negotiated = await app.request(
      `/api/arena/rooms/v1/${authority.snapshot.roomId}/generations`,
      {
        ...negotiatedRequest,
        headers: acceptHeaders,
      },
    );
    expect(negotiated.status).toBe(409);
    expect(await negotiated.json()).toMatchObject({
      code: 'ROOM_GENERATION_COMBATANTS_EMPTY',
    });
    expect(negotiated.headers.get('vary')).toContain('Accept');
    expect(negotiated.headers.get('vary')).toContain('x-mahoshojo-arena-error-taxonomy');
    expect(negotiated.headers.get('cache-control')).toBe('no-store');

    const customHeaderNegotiated = await app.request(
      `/api/arena/rooms/v1/${authority.snapshot.roomId}/generations`,
      createRequest(body),
    );
    expect(customHeaderNegotiated.status).toBe(409);
    expect(await customHeaderNegotiated.json()).toMatchObject({
      code: 'ROOM_GENERATION_COMBATANTS_EMPTY',
    });
  });

  it.each([
    [new ArenaRoomGenerationError('ROOM_HOST_LOCAL_PAYLOAD_MISSING'), 400, 'ROOM_REQUEST_INVALID'],
    [new ArenaRoomGenerationError('ROOM_HOST_LOCAL_DIGEST_MISMATCH'), 409, 'ROOM_CONFLICT'],
    [new ArenaRoomGenerationError('ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING'), 400, 'ROOM_REQUEST_INVALID'],
    [new ArenaRoomGenerationError('ROOM_REFERENCE_STALE'), 409, 'ROOM_CONFLICT'],
    [new ArenaRoomGenerationError('ROOM_CONFIG_FRAME_TOO_LARGE'), 413, 'ROOM_PAYLOAD_TOO_LARGE'],
  ] as const)('旧客户端只收到 0bb6b883 可解析的生成错误 code：%s', async (
    serviceError,
    status,
    legacyCode,
  ) => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.generations.start).mockRejectedValueOnce(serviceError);
    const app = createHonoApp(config, createRedisStub(), undefined, { arenaRoom: dependencies });
    const request = createRequest({
      expectedRoomEpoch: authority.snapshot.roomEpoch,
      expectedRevision: authority.snapshot.revision,
      generationRequestId: 'request-legacy-host-local',
      sharedConfig: authority.snapshot.sharedConfig,
      hostLocalPayloads: [],
      generation: {},
    });
    const headers: Record<string, string> = { ...request.headers };
    delete headers['x-mahoshojo-arena-error-taxonomy'];
    const response = await app.request(
      `/api/arena/rooms/v1/${authority.snapshot.roomId}/generations`,
      { ...request, headers },
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code: legacyCode });
  });

  it('v1 客户端保留 reference denied 的既有 code 与状态语义', async () => {
    const membershipDependencies = createDependencies();
    vi.mocked(membershipDependencies.memberships.getSession).mockRejectedValueOnce(
      new ArenaRoomMembershipError('ROOM_REFERENCE_DENIED'),
    );
    const membershipApp = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: membershipDependencies,
    });
    const membershipResponse = await membershipApp.request(
      `/api/arena/rooms/v1/${session.roomId}/session`,
      { headers: { authorization: 'Bearer legacy-key' } },
    );
    expect(membershipResponse.status).toBe(409);
    expect(await membershipResponse.json()).toMatchObject({ code: 'ROOM_CONFLICT' });

    const proposalDependencies = createDependencies();
    vi.mocked(proposalDependencies.proposals.submit).mockRejectedValueOnce(
      new ArenaRoomProposalError('ROOM_REFERENCE_DENIED'),
    );
    const proposalApp = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: proposalDependencies,
    });
    const proposalRequest = createRequest({
      proposalId: 'proposal-legacy-reference-denied',
      expectedRoomEpoch: session.roomEpoch,
      baseRevision: session.snapshot.revision,
      changes: [guidanceChangeForHttp()],
    });
    const proposalHeaders: Record<string, string> = { ...proposalRequest.headers };
    delete proposalHeaders['x-mahoshojo-arena-error-taxonomy'];
    const proposalResponse = await proposalApp.request(
      `/api/arena/rooms/v1/${session.roomId}/proposals`,
      { ...proposalRequest, headers: proposalHeaders },
    );
    expect(proposalResponse.status).toBe(409);
    expect(await proposalResponse.json()).toMatchObject({ code: 'ROOM_CONFLICT' });

    const configDependencies = createDependencies();
    vi.mocked(configDependencies.configs.publish).mockRejectedValueOnce(
      new ArenaRoomConfigError('ROOM_REFERENCE_DENIED'),
    );
    const configApp = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: configDependencies,
    });
    const configRequest = createRequest({
      expectedRoomEpoch: session.roomEpoch,
      expectedRevision: session.snapshot.revision,
      sharedConfig: session.snapshot.sharedConfig,
    });
    const configHeaders: Record<string, string> = { ...configRequest.headers };
    delete configHeaders['x-mahoshojo-arena-error-taxonomy'];
    const configResponse = await configApp.request(
      `/api/arena/rooms/v1/${session.roomId}/config`,
      { ...configRequest, headers: configHeaders },
    );
    expect(configResponse.status).toBe(409);
    expect(await configResponse.json()).toMatchObject({ code: 'ROOM_CONFLICT' });
  });

  it('schema preflight 保留角色、累计引用与版本缺失的可行动原因', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const combatants = Array.from({ length: 33 }, (_, index) => ({
      key: `data-card:character-${index}`,
      ref: { id: `character-${index}`, kind: 'character', versionToken: 'v1' },
    }));
    const generationRequest = {
      expectedRoomEpoch: authority.snapshot.roomEpoch,
      expectedRevision: authority.snapshot.revision,
      generationRequestId: 'request-1234',
      sharedConfig: { ...authority.snapshot.sharedConfig, combatants, teams: [] },
      hostLocalPayloads: [],
      generation: {},
    };
    const generationLimit = await app.request(
      `/api/arena/rooms/v1/${authority.snapshot.roomId}/generations`,
      createRequest(generationRequest),
    );
    expect(generationLimit.status).toBe(400);
    expect(await generationLimit.json()).toMatchObject({
      code: 'ROOM_GENERATION_COMBATANT_LIMIT',
      error: expect.stringMatching(/33.*32/u),
    });

    const configLimit = await app.request('/api/arena/rooms/v1', createRequest({
      creationRequestId: 'create-request-limits',
      displayName: '房主',
      directory: { title: '容量测试', visibility: 'public' },
      sharedConfig: generationRequest.sharedConfig,
    }));
    expect(configLimit.status).toBe(400);
    expect(await configLimit.json()).toMatchObject({
      code: 'ROOM_CONFIG_COMBATANT_LIMIT',
      error: expect.stringMatching(/33.*32/u),
    });

    const auxScenarios = Array.from({ length: 128 }, (_, index) => ({
      key: `data-card:scenario-${index}`,
      ref: { id: `scenario-${index}`, kind: 'scenario', versionToken: 'v1' },
    }));
    const materials = Array.from({ length: 129 }, (_, index) => ({
      key: `data-card:material-${index}`,
      ref: { id: `material-${index}`, kind: 'material', versionToken: 'v1' },
    }));
    const referenceLimit = await app.request('/api/arena/rooms/v1', createRequest({
      creationRequestId: 'create-request-refs',
      displayName: '房主',
      directory: { title: '引用容量测试', visibility: 'public' },
      sharedConfig: {
        ...authority.snapshot.sharedConfig,
        auxScenarios,
        materials,
      },
    }));
    expect(referenceLimit.status).toBe(400);
    expect(await referenceLimit.json()).toMatchObject({
      code: 'ROOM_CONFIG_REFERENCE_LIMIT',
      error: expect.stringMatching(/257.*256/u),
    });

    const missingVersionCombatant = {
      key: 'data-card:missing-version',
      ref: { id: 'missing-version', kind: 'character' },
    };
    const missingVersion = await app.request('/api/arena/rooms/v1', createRequest({
      creationRequestId: 'create-request-version',
      displayName: '房主',
      directory: { title: '版本测试', visibility: 'public' },
      sharedConfig: {
        ...authority.snapshot.sharedConfig,
        combatants: [missingVersionCombatant],
        teams: [],
      },
    }));
    expect(missingVersion.status).toBe(400);
    expect(await missingVersion.json()).toMatchObject({
      code: 'ROOM_REFERENCE_VERSION_MISSING',
      error: expect.stringContaining('角色 1'),
    });

    const invalidShareability = await app.request('/api/arena/rooms/v1', createRequest({
      creationRequestId: 'create-request-invalid-team',
      displayName: '房主',
      directory: { title: '引用关系测试', visibility: 'public' },
      sharedConfig: {
        ...authority.snapshot.sharedConfig,
        teams: [{ key: 'team-1', displayName: '一队', combatantKeys: ['missing-combatant'] }],
      },
    }));
    expect(invalidShareability.status).toBe(400);
    expect(await invalidShareability.json()).toMatchObject({
      code: 'ROOM_CONFIG_SHAREABILITY_INVALID',
      error: expect.stringContaining('房间配置'),
    });
    expect(dependencies.memberships.create).not.toHaveBeenCalled();
    expect(dependencies.generations.start).not.toHaveBeenCalled();
  });

  it('显式 config publish 只接收 strict intent，并返回 checkpoint 产生的安全 session', async () => {
    const published = {
      ...session,
      snapshot: {
        ...session.snapshot,
        revision: session.snapshot.revision + 1,
        sharedConfig: { ...session.snapshot.sharedConfig, userGuidance: '显式发布' },
      },
    };
    const dependencies = createDependencies({
      configs: { publish: vi.fn(async () => published) },
    });
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const request = {
      expectedRoomEpoch: session.roomEpoch,
      expectedRevision: session.snapshot.revision,
      sharedConfig: published.snapshot.sharedConfig,
    };

    const response = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/config`,
      createRequest(request),
    );

    expect(response.status).toBe(200);
    expect(dependencies.configs.publish).toHaveBeenCalledWith({
      roomId: session.roomId,
      accountUserId: 101,
      request,
    });
    expect(await response.json()).toMatchObject({
      roomId: session.roomId,
      roomEpoch: session.roomEpoch,
      self: { userId: self.userId, role: 'host' },
      snapshot: { revision: 1, sharedConfig: published.snapshot.sharedConfig },
    });

    const injected = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/config`,
      createRequest({ ...request, payload: { providerApiKey: 'secret-canary' } }),
    );
    expect(injected.status).toBe(400);
    expect(dependencies.configs.publish).toHaveBeenCalledTimes(1);
    expect(await injected.text()).not.toContain('secret-canary');
  });

  it.each([
    ['ROOM_CONFIG_FRAME_TOO_LARGE', 413, 'ROOM_CONFIG_FRAME_TOO_LARGE'],
    ['ROOM_PERMISSION_DENIED', 403, 'ROOM_FORBIDDEN'],
    ['ROOM_REFERENCE_DENIED', 403, 'ROOM_REFERENCE_DENIED'],
    ['ROOM_REFERENCE_STALE', 409, 'ROOM_REFERENCE_STALE'],
    ['ROOM_REFERENCE_UNAVAILABLE', 503, 'ROOM_UNAVAILABLE'],
    ['ROOM_EPOCH_STALE', 409, 'ROOM_CONFLICT'],
    ['ROOM_REVISION_STALE', 409, 'ROOM_CONFLICT'],
    ['ROOM_TRANSITION_DENIED', 409, 'ROOM_CONFLICT'],
  ] as const)('config publish fail closed: %s', async (serviceCode, status, wireCode) => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.configs.publish).mockRejectedValueOnce(
      new ArenaRoomConfigError(serviceCode),
    );
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });

    const response = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/config`,
      createRequest({
        expectedRoomEpoch: session.roomEpoch,
        expectedRevision: session.snapshot.revision,
        sharedConfig: session.snapshot.sharedConfig,
      }),
    );

    expect(response.status).toBe(status);
    const body = await response.json() as { code: string; error: string };
    expect(body).toMatchObject({ code: wireCode });
    if (serviceCode === 'ROOM_CONFIG_FRAME_TOO_LARGE') {
      expect(body.error).toContain('64 KiB');
    }
  });

  it('config publish 受独立 account/room limiter 保护，超额时不触发 authority', async () => {
    const dependencies = createDependencies({
      rateLimit: vi.fn(async () => ({
        allowed: false,
        limit: 10,
        remaining: 0,
        retryAfterSeconds: 9,
      })),
    });
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });

    const response = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/config`,
      createRequest({
        expectedRoomEpoch: session.roomEpoch,
        expectedRevision: session.snapshot.revision,
        sharedConfig: session.snapshot.sharedConfig,
      }),
    );

    expect(response.status).toBe(429);
    expect(dependencies.rateLimit).toHaveBeenCalledWith({
      operation: 'configPublish',
      accountUserId: 101,
      roomId: session.roomId,
      limit: 10,
      windowSeconds: 60,
    });
    expect(dependencies.configs.publish).not.toHaveBeenCalled();
  });

  it('多人 generation read 只传认证 account/room/generation，并稳定映射恢复错误', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const response = await app.request(
      `/api/arena/rooms/v1/${authority.snapshot.roomId}/generations/generation-1`,
      { headers: { authorization: 'Bearer legacy-key' } },
    );
    expect(response.status).toBe(200);
    expect(dependencies.generations.read).toHaveBeenCalledWith({
      roomId: authority.snapshot.roomId,
      generationId: 'generation-1',
      accountUserId: 101,
    });

    vi.mocked(dependencies.generations.read).mockRejectedValueOnce(
      new ArenaRoomGenerationError('ROOM_GENERATION_UNAVAILABLE'),
    );
    const unavailable = await app.request(
      `/api/arena/rooms/v1/${authority.snapshot.roomId}/generations/generation-1`,
      { headers: { authorization: 'Bearer legacy-key' } },
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: 'ROOM_UNAVAILABLE' });
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

  it('Proposal submit/resolve/withdraw 使用严格 intent DTO 与最小 versioned response', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const proposalId = 'proposal-http-1';
    const submitRequest = {
      proposalId,
      expectedRoomEpoch: session.roomEpoch,
      baseRevision: 0,
      changes: [{
        changeId: 'guidance-1',
        type: 'setUserGuidance',
        value: '成员建议',
        expectedBase: { kind: 'value', value: '' },
      }],
    };
    const submit = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/proposals`,
      createRequest(submitRequest),
    );
    expect(submit.status).toBe(200);
    expect(dependencies.proposals.submit).toHaveBeenCalledWith({
      roomId: session.roomId,
      accountUserId: 101,
      request: submitRequest,
    });
    expect(await submit.json()).toEqual({
      protocolVersion: 1,
      roomId: session.roomId,
      roomEpoch: session.roomEpoch,
      controlSeq: 8,
      revision: 0,
      proposalId,
      status: 'submitted',
      result: 'applied',
    });

    const resolveRequest = {
      expectedRoomEpoch: session.roomEpoch,
      expectedRevision: 0,
      resolution: 'accept-selected',
      selectedChangeIds: ['guidance-1'],
    };
    const resolve = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/proposals/${proposalId}/resolve`,
      createRequest(resolveRequest),
    );
    expect(resolve.status).toBe(200);
    expect(dependencies.proposals.resolve).toHaveBeenCalledWith({
      roomId: session.roomId,
      proposalId,
      accountUserId: 101,
      request: resolveRequest,
    });
    expect(await resolve.json()).toMatchObject({
      protocolVersion: 1,
      proposalId,
      status: 'accepted',
      revision: 1,
    });

    const withdrawRequest = { expectedRoomEpoch: session.roomEpoch };
    const withdraw = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/proposals/${proposalId}/withdraw`,
      createRequest(withdrawRequest),
    );
    expect(withdraw.status).toBe(200);
    expect(dependencies.proposals.withdraw).toHaveBeenCalledWith({
      roomId: session.roomId,
      proposalId,
      accountUserId: 101,
      request: withdrawRequest,
    });

    const untrustedAuthority = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/proposals`,
      createRequest({ ...submitRequest, authorUserId: 'forged-author' }),
    );
    expect(untrustedAuthority.status).toBe(400);
    expect(dependencies.proposals.submit).toHaveBeenCalledTimes(1);
  });

  it('Proposal stale/permission/unknown 使用稳定泛化错误，unknown 不自动重放', async () => {
    for (const [proposalCode, status, code] of [
      ['ROOM_PROPOSAL_PENDING_LIMIT_REACHED', 409, 'ROOM_PROPOSAL_PENDING_LIMIT_REACHED'],
      ['ROOM_REFERENCE_STALE', 409, 'ROOM_REFERENCE_STALE'],
      ['ROOM_REFERENCE_DENIED', 403, 'ROOM_REFERENCE_DENIED'],
      ['ROOM_PERMISSION_DENIED', 403, 'ROOM_FORBIDDEN'],
      ['ROOM_OPERATION_UNKNOWN', 503, 'ROOM_UNAVAILABLE'],
    ] as const) {
      const dependencies = createDependencies();
      vi.mocked(dependencies.proposals.submit).mockRejectedValueOnce(
        new ArenaRoomProposalError(proposalCode),
      );
      const app = createHonoApp(config, createRedisStub(), undefined, {
        arenaRoom: dependencies,
      });
      const response = await app.request(
        `/api/arena/rooms/v1/${session.roomId}/proposals`,
        createRequest({
          proposalId: 'proposal-error',
          expectedRoomEpoch: session.roomEpoch,
          baseRevision: 0,
          changes: [{
            changeId: 'guidance-1',
            type: 'setUserGuidance',
            value: '成员建议',
            expectedBase: { kind: 'value', value: '' },
          }],
        }),
      );
      expect(response.status).toBe(status);
      const body = await response.json() as { code: string; error: string };
      expect(body).toMatchObject({ code });
      if (proposalCode === 'ROOM_PROPOSAL_PENDING_LIMIT_REACHED') {
        expect(body.error).toContain('最多保留 8 个');
        expect(body.error).toContain('当前已有 8 个');
      }
      expect(dependencies.proposals.submit).toHaveBeenCalledOnce();
    }
  });

  it('Proposal route 拒绝 arbitrary patch、secret/full payload 与 host-local 新引用且不反射 canary', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const canary = 'proposal-private-canary';
    const base = {
      proposalId: 'proposal-negative',
      expectedRoomEpoch: session.roomEpoch,
      baseRevision: 0,
      changes: [guidanceChangeForHttp()],
    };
    const maliciousBodies = [
      { ...base, changes: [{ op: 'replace', path: '/sharedConfig/userGuidance', value: canary }] },
      {
        ...base,
        changes: [{
          changeId: 'material-ref-data',
          type: 'addMaterial',
          ref: { id: 'material-1', kind: 'material', versionToken: 'v1', payload: { credential: canary } },
          expectedBase: { kind: 'absent' },
        }],
      },
      {
        ...base,
        changes: [{
          changeId: 'host-local-full-base',
          type: 'removeMaterial',
          materialKey: 'host-local:material:1',
          expectedBase: {
            kind: 'present',
            ref: {
              key: 'host-local:material:1',
              displayName: '本地材料',
              type: 'material',
              source: 'host-local',
              fullPayload: { providerApiKey: canary },
            },
          },
        }],
      },
      {
        ...base,
        changes: [{
          changeId: 'host-local-new-ref',
          type: 'addMaterial',
          ref: {
            key: 'host-local:material:2',
            displayName: '本地材料',
            type: 'material',
            source: 'host-local',
          },
          expectedBase: { kind: 'absent' },
        }],
      },
      { ...base, providerApiKey: canary, userProviderConfig: { credential: canary } },
    ];

    for (const body of maliciousBodies) {
      const response = await app.request(
        `/api/arena/rooms/v1/${session.roomId}/proposals`,
        createRequest(body),
      );
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(canary);
    }
    expect(dependencies.proposals.submit).not.toHaveBeenCalled();
  });

  it('Proposal route 对 malformed JSON、bad UTF-8、change limit 与 byte limit 返回独立错误', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const path = `/api/arena/rooms/v1/${session.roomId}/proposals`;
    const headers = {
      authorization: 'Bearer legacy-key',
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      'x-mahoshojo-arena-error-taxonomy': '2',
    };
    const malformed = await app.request(path, {
      method: 'POST',
      headers,
      body: '{"proposalId":',
    });
    const invalidUtf8 = await app.request(path, {
      method: 'POST',
      headers,
      body: new Uint8Array([0xff, 0xfe]),
    });
    const oversized = await app.request(path, {
      method: 'POST',
      headers,
      body: JSON.stringify({ padding: 'x'.repeat(64 * 1_024) }),
    });
    const tooManyChanges = await app.request(path, createRequest({
      proposalId: 'proposal-too-many-changes',
      expectedRoomEpoch: session.roomEpoch,
      baseRevision: session.snapshot.revision,
      changes: Array.from({ length: 33 }, (_, index) => ({
        ...guidanceChangeForHttp(),
        changeId: `guidance-${index}`,
      })),
    }));

    expect(malformed.status).toBe(400);
    expect(invalidUtf8.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({
      code: 'ROOM_PROPOSAL_BYTE_LIMIT',
      error: expect.stringMatching(/64 KiB/u),
    });
    expect(tooManyChanges.status).toBe(400);
    expect(await tooManyChanges.json()).toMatchObject({
      code: 'ROOM_PROPOSAL_CHANGE_LIMIT',
      error: expect.stringMatching(/33.*32/u),
    });
    expect(dependencies.proposals.submit).not.toHaveBeenCalled();
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

  it('Room mutation 只接受 exact Origin，不继承 Hosted CORS wildcard', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp({
      ...config,
      corsOrigins: ['https://app.example.com', 'https://*.example.com', '*'],
      arenaRoomAllowedOrigins: ['https://app.example.com'],
    }, createRedisStub(), undefined, { arenaRoom: dependencies });
    const request = {
      proposalId: 'proposal-exact-origin',
      expectedRoomEpoch: session.roomEpoch,
      baseRevision: 0,
      changes: [guidanceChangeForHttp()],
    };

    for (const origin of [
      'https://preview.example.com',
      'https://evil.example.com',
      'https://app.example.com.evil.test',
    ]) {
      const response = await app.request(
        `/api/arena/rooms/v1/${session.roomId}/proposals`,
        { ...createRequest(request), headers: { ...createRequest(request).headers, origin } },
      );
      expect(response.status).toBe(403);
    }
    expect(dependencies.resolveAuthentication).not.toHaveBeenCalled();
    expect(dependencies.proposals.submit).not.toHaveBeenCalled();

    const exact = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/proposals`,
      {
        ...createRequest(request),
        headers: { ...createRequest(request).headers, origin: 'https://app.example.com' },
      },
    );
    expect(exact.status).toBe(200);
    expect(dependencies.proposals.submit).toHaveBeenCalledOnce();
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
        creationRequestId: 'create-request-1234',
        displayName: '房主',
        directory: { title: '测试房', visibility: 'public' },
        sharedConfig: authority.snapshot.sharedConfig,
      }));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
      expect(dependencies.memberships.create).not.toHaveBeenCalled();
    }
  });

  it('create 同时受分钟突发与账号日预算约束，长窗口耗尽时不创建 Room', async () => {
    const rateLimit = vi.fn()
      .mockResolvedValueOnce({
        allowed: true,
        limit: 5,
        remaining: 4,
        retryAfterSeconds: 1,
      })
      .mockResolvedValueOnce({
        allowed: false,
        limit: 32,
        remaining: 0,
        retryAfterSeconds: 3_600,
      });
    const dependencies = createDependencies({ rateLimit });
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });

    const response = await app.request('/api/arena/rooms/v1', createRequest({
      creationRequestId: 'create-request-1234',
      displayName: '房主',
      directory: { title: '测试房', visibility: 'unlisted' },
      sharedConfig: authority.snapshot.sharedConfig,
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get('x-ratelimit-limit')).toBe('32');
    expect(response.headers.get('retry-after')).toBe('3600');
    expect(rateLimit).toHaveBeenNthCalledWith(1, {
      operation: 'create',
      accountUserId: 101,
      limit: 5,
      windowSeconds: 60,
    });
    expect(rateLimit).toHaveBeenNthCalledWith(2, {
      operation: 'createBudget',
      accountUserId: 101,
      limit: 32,
      windowSeconds: 86_400,
    });
    expect(dependencies.memberships.create).not.toHaveBeenCalled();
  });

  it('已有 creation receipt 的结果确认只受突发限流，不重复消耗新 Room 日预算', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.memberships.hasCreationReceipt).mockResolvedValue(true);
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });

    const response = await app.request('/api/arena/rooms/v1', createRequest({
      creationRequestId: 'create-request-1234',
      displayName: '房主',
      directory: { title: '测试房', visibility: 'unlisted' },
      sharedConfig: authority.snapshot.sharedConfig,
    }));

    expect(response.status).toBe(201);
    expect(dependencies.rateLimit).toHaveBeenCalledTimes(1);
    expect(dependencies.rateLimit).toHaveBeenCalledWith({
      operation: 'create',
      accountUserId: 101,
      limit: 5,
      windowSeconds: 60,
    });
  });

  it('membership error 不泄漏 closed/not-found 差异，permission 与 conflict 可判别', async () => {
    for (const [membershipCode, status, code] of [
      ['ROOM_MEMBER_LIMIT_REACHED', 409, 'ROOM_MEMBER_LIMIT_REACHED'],
      ['ROOM_CLOSED', 404, 'ROOM_NOT_FOUND'],
      ['ROOM_NOT_FOUND', 404, 'ROOM_NOT_FOUND'],
      ['ROOM_MEMBERSHIP_NOT_ACTIVE', 404, 'ROOM_NOT_FOUND'],
      ['ROOM_MEMBERSHIP_REVOKED', 404, 'ROOM_NOT_FOUND'],
      ['ROOM_PERMISSION_DENIED', 403, 'ROOM_FORBIDDEN'],
      ['ROOM_REFERENCE_DENIED', 403, 'ROOM_REFERENCE_DENIED'],
      ['ROOM_REFERENCE_STALE', 409, 'ROOM_REFERENCE_STALE'],
      ['ROOM_REFERENCE_UNAVAILABLE', 503, 'ROOM_UNAVAILABLE'],
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
        headers: {
          authorization: 'Bearer legacy-key',
          'x-mahoshojo-arena-error-taxonomy': '2',
        },
      });
      expect(response.status).toBe(status);
      const body = await response.json() as { code: string; error: string };
      expect(body).toMatchObject({ code });
      if (membershipCode === 'ROOM_MEMBER_LIMIT_REACHED') {
        expect(body.error).toContain('最多容纳 8 人');
        expect(body.error).toContain('当前已有 8 人');
      }
    }
  });

  it('kick/cancel 路由重新认证账号，只接受 strict epoch fence 并返回权威视图', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const body = { expectedRoomEpoch: session.roomEpoch };
    const kick = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/members/member-2/kick`,
      createRequest(body),
    );
    const cancel = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/generations/generation-1/cancel`,
      createRequest(body),
    );

    expect(kick.status).toBe(200);
    await expect(kick.json()).resolves.toMatchObject({
      roomId: session.roomId,
      self: { role: 'host' },
    });
    expect(dependencies.memberships.kick).toHaveBeenCalledWith({
      roomId: session.roomId,
      accountUserId: 101,
      targetUserId: 'member-2',
      expectedRoomEpoch: session.roomEpoch,
    });
    expect(cancel.status).toBe(200);
    await expect(cancel.json()).resolves.toMatchObject({
      roomId: session.roomId,
      status: 'cancelled',
      generation: { generationId: 'generation-1', state: 'cancelled' },
    });
    expect(dependencies.generations.cancel).toHaveBeenCalledWith({
      roomId: session.roomId,
      generationId: 'generation-1',
      accountUserId: 101,
      request: body,
    });
    expect(dependencies.rateLimit).toHaveBeenCalledWith({
      operation: 'kick',
      accountUserId: 101,
      roomId: session.roomId,
      limit: 30,
      windowSeconds: 60,
    });
    expect(dependencies.rateLimit).toHaveBeenCalledWith({
      operation: 'generationCancel',
      accountUserId: 101,
      roomId: session.roomId,
      limit: 10,
      windowSeconds: 60,
    });

    vi.mocked(dependencies.generations.cancel).mockRejectedValueOnce(
      new Error('provider-internal-secret-canary'),
    );
    const unknown = await app.request(
      `/api/arena/rooms/v1/${session.roomId}/generations/generation-1/cancel`,
      createRequest(body),
    );
    expect(unknown.status).toBe(503);
    expect(await unknown.text()).not.toContain('provider-internal-secret-canary');
  });

  it('kick/cancel 拒绝 authority 镜像、越界 path 与伪造 host，不触发 mutation', async () => {
    const dependencies = createDependencies();
    const app = createHonoApp(config, createRedisStub(), undefined, {
      arenaRoom: dependencies,
    });
    const injected = {
      expectedRoomEpoch: session.roomEpoch,
      role: 'host',
      accountUserId: 999,
      actorKey: `pvp-room:${session.roomId}`,
      secret: 'secret-canary',
    };
    const [kick, cancel, longTarget, longGeneration] = await Promise.all([
      app.request(
        `/api/arena/rooms/v1/${session.roomId}/members/member-2/kick`,
        createRequest(injected),
      ),
      app.request(
        `/api/arena/rooms/v1/${session.roomId}/generations/generation-1/cancel`,
        createRequest(injected),
      ),
      app.request(
        `/api/arena/rooms/v1/${session.roomId}/members/${'x'.repeat(300)}/kick`,
        createRequest({ expectedRoomEpoch: session.roomEpoch }),
      ),
      app.request(
        `/api/arena/rooms/v1/${session.roomId}/generations/${'x'.repeat(300)}/cancel`,
        createRequest({ expectedRoomEpoch: session.roomEpoch }),
      ),
    ]);

    expect([kick.status, cancel.status, longTarget.status, longGeneration.status])
      .toEqual([400, 400, 400, 400]);
    expect(dependencies.memberships.kick).not.toHaveBeenCalled();
    expect(dependencies.generations.cancel).not.toHaveBeenCalled();
  });
});
