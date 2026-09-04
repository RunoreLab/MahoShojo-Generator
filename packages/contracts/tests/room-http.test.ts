import { describe, expect, it } from 'vitest';

import {
  ARENA_ROOM_HTTP_BASE_PATH,
  ARENA_ROOM_HTTP_ROUTES,
  ARENA_ROOM_WEBSOCKET_PATH,
  ArenaRoomCreateRequestSchema,
  ArenaRoomEpochMutationRequestSchema,
  ArenaRoomGenerationCancelRequestSchema,
  ArenaRoomGenerationHistoryResponseSchema,
  ArenaRoomGenerationHistoryViewResponseSchema,
  ArenaRoomHttpErrorResponseSchema,
  ArenaRoomJoinRequestSchema,
  ArenaRoomLeaveResponseSchema,
  ArenaRoomMemberKickRequestSchema,
  ArenaRoomGenerationStartRequestSchema,
  ArenaRoomGenerationViewResponseSchema,
  ArenaRoomProposalMutationResponseSchema,
  ArenaRoomProposalResolveRequestSchema,
  ArenaRoomProposalSubmitRequestSchema,
  ArenaRoomProposalWithdrawRequestSchema,
  ArenaRoomPublishConfigRequestSchema,
  ArenaRoomSessionResponseSchema,
  ArenaRoomTicketRequestSchema,
  ArenaRoomTicketResponseSchema,
} from '../src/arena-room';
import canonicalRoomSnapshot from './fixtures/arena-room-v1.json';

const session = {
  protocolVersion: 1,
  roomId: canonicalRoomSnapshot.roomId,
  roomEpoch: canonicalRoomSnapshot.roomEpoch,
  self: canonicalRoomSnapshot.members[0],
  snapshot: canonicalRoomSnapshot,
};

describe('Arena Room HTTP product contract', () => {
  it('使用单一 v1 namespace，并与 WSS endpoint 分离', () => {
    expect(ARENA_ROOM_HTTP_BASE_PATH).toBe('/api/arena/rooms/v1');
    expect(ARENA_ROOM_WEBSOCKET_PATH).toBe('/api/arena/rooms/v1/ws');
    expect(ARENA_ROOM_HTTP_ROUTES).toEqual({
      collection: '/api/arena/rooms/v1',
      join: '/api/arena/rooms/v1/:roomId/join',
      session: '/api/arena/rooms/v1/:roomId/session',
      ticket: '/api/arena/rooms/v1/:roomId/ticket',
      leave: '/api/arena/rooms/v1/:roomId/leave',
      close: '/api/arena/rooms/v1/:roomId/close',
      proposals: '/api/arena/rooms/v1/:roomId/proposals',
      proposalResolve: '/api/arena/rooms/v1/:roomId/proposals/:proposalId/resolve',
      proposalWithdraw: '/api/arena/rooms/v1/:roomId/proposals/:proposalId/withdraw',
      config: '/api/arena/rooms/v1/:roomId/config',
      generations: '/api/arena/rooms/v1/:roomId/generations',
      generation: '/api/arena/rooms/v1/:roomId/generations/:generationId',
      generationCancel: '/api/arena/rooms/v1/:roomId/generations/:generationId/cancel',
      memberKick: '/api/arena/rooms/v1/:roomId/members/:targetUserId/kick',
    });
  });

  it('kick/cancel DTO 只接受 room epoch fence，不接受客户端 authority 镜像', () => {
    const request = { expectedRoomEpoch: 'epoch-1' };
    expect(ArenaRoomMemberKickRequestSchema.parse(request)).toEqual(request);
    expect(ArenaRoomGenerationCancelRequestSchema.parse(request)).toEqual(request);
    for (const injected of [
      { role: 'host' },
      { accountUserId: 101 },
      { actorUserId: 'host-1' },
      { targetMembershipState: 'active' },
      { generationState: 'running' },
      { actorKey: 'pvp-room:room-1' },
      { secret: 'secret-canary' },
    ]) {
      expect(ArenaRoomMemberKickRequestSchema.safeParse({ ...request, ...injected }).success)
        .toBe(false);
      expect(ArenaRoomGenerationCancelRequestSchema.safeParse({ ...request, ...injected }).success)
        .toBe(false);
    }
  });

  it('配置发布 DTO 只接受 exact authority fence 与 Shared Config', () => {
    const request = {
      expectedRoomEpoch: canonicalRoomSnapshot.roomEpoch,
      expectedRevision: canonicalRoomSnapshot.revision,
      expectedControlSeq: canonicalRoomSnapshot.controlSeq,
      sharedConfig: canonicalRoomSnapshot.sharedConfig,
    };
    expect(ArenaRoomPublishConfigRequestSchema.parse(request)).toEqual(request);
    expect(ArenaRoomPublishConfigRequestSchema.safeParse({
      ...request,
      expectedControlSeq: undefined,
    }).success).toBe(false);
    for (const injected of [
      { roomId: canonicalRoomSnapshot.roomId },
      { accountUserId: 7 },
      { actorUserId: canonicalRoomSnapshot.members[0]?.userId },
      { payload: { providerApiKey: 'secret-canary' } },
      { secret: 'secret-canary' },
    ]) {
      expect(ArenaRoomPublishConfigRequestSchema.safeParse({ ...request, ...injected }).success)
        .toBe(false);
    }
  });

  it('多人生成 DTO 严格分离 client intent、完整临时 payload 与安全成员投影', () => {
    const request = {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 3,
      expectedControlSeq: 7,
      generationRequestId: 'request-1234',
      sharedConfig: canonicalRoomSnapshot.sharedConfig,
      hostLocalPayloads: [{
        key: 'host-local:character:0:test',
        kind: 'character' as const,
        payload: { name: '本地角色' },
      }],
      generation: {
        customProvider: { apiKey: 'request-only-secret' },
        narrativeHistory: [{ content: '只在本次请求内' }],
        arenaFreeRankingEnabled: true,
      },
    };
    expect(ArenaRoomGenerationStartRequestSchema.parse(request)).toEqual(request);
    expect(ArenaRoomGenerationStartRequestSchema.safeParse({
      ...request,
      expectedControlSeq: undefined,
    }).success).toBe(false);
    for (const injected of [
      { roomId: 'spoofed' },
      { generationId: 'spoofed' },
      { attempt: 7 },
      { actorKey: 'pvp-room:spoofed' },
      { snapshotDigest: 'sha256:spoofed' },
      { participantUserIds: [99] },
    ]) {
      expect(ArenaRoomGenerationStartRequestSchema.safeParse({ ...request, ...injected }).success)
        .toBe(false);
    }
    expect(ArenaRoomGenerationStartRequestSchema.safeParse({
      ...request,
      generationRequestId: 'short',
    }).success).toBe(false);
    expect(ArenaRoomGenerationStartRequestSchema.safeParse({
      ...request,
      generation: [],
    }).success).toBe(false);
    for (const forbiddenSharedSemantic of [
      { mode: 'scenario' },
      { combatants: [{ data: { name: '伪造角色' } }] },
      { scenario: { title: '伪造情景' } },
      { materials: [{ content: '伪造素材' }] },
      { language: 'en-US' },
      { readArenaHistory: false },
    ]) {
      expect(ArenaRoomGenerationStartRequestSchema.safeParse({
        ...request,
        generation: { ...request.generation, ...forbiddenSharedSemantic },
      }).success).toBe(false);
    }
    expect(ArenaRoomGenerationStartRequestSchema.safeParse({
      ...request,
      hostLocalPayloads: [{
        key: 'host-local:character:0:test',
        kind: 'character',
        payload: { constructor: { polluted: true } },
      }],
    }).success).toBe(false);
    expect(ArenaRoomGenerationStartRequestSchema.safeParse({
      ...request,
      hostLocalPayloads: [{
        key: 'host-local:character:0:test',
        kind: 'character',
        payload: ['not-an-object'],
      }],
    }).success).toBe(false);

    const response = {
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      generation: {
        generationRequestId: 'request-1234',
        generationId: 'generation-1',
        attempt: 1,
        state: 'running',
        configRevision: 3,
        snapshotDigest: `sha256:${'a'.repeat(64)}`,
        collaborativeInfluence: true,
        participantUserIds: [7, 9],
        startedAt: '2026-08-28T00:00:00.000Z',
      },
      status: 'running',
      markdown: '# 当前正文',
      nextChunkSeq: 4,
      finalAuthoritative: false,
    };
    expect(ArenaRoomGenerationViewResponseSchema.parse(response)).toEqual(response);
    for (const leaked of [
      { reasoning: 'private' },
      { telemetry: { provider: 'secret' } },
      { actorToken: 'secret' },
      { pvpSignature: 'secret' },
      { updatedCombatants: [{ private: true }] },
    ]) {
      expect(ArenaRoomGenerationViewResponseSchema.safeParse({ ...response, ...leaked }).success)
        .toBe(false);
    }
    expect(ArenaRoomGenerationViewResponseSchema.safeParse({
      ...response,
      generationRecordId: 'must-not-appear-while-running',
    }).success).toBe(false);
    expect(ArenaRoomGenerationViewResponseSchema.safeParse({
      ...response,
      status: 'completed',
      generation: { ...response.generation, state: 'completed' },
      finalAuthoritative: false,
      generationRecordId: 'r2:record',
    }).success).toBe(false);

    const completed = {
      ...response,
      status: 'completed' as const,
      generation: { ...response.generation, state: 'completed' as const },
      markdown: '# 权威终态正文',
      nextChunkSeq: 0,
      finalAuthoritative: true,
      generationRecordId: 'generation-1',
      result: {
        version: 1 as const,
        format: 'stream-markdown' as const,
        reporterInfo: { name: '测试记者', publication: 'A.R.E.N.A.' },
        mode: 'classic',
        scenarioDisplayName: '雨夜车站',
        sharedGuidance: '保持克制',
        characterGuidances: [{ combatantKey: 'data-card:1', displayName: '角色甲', guidance: '保护队友' }],
        language: 'zh-CN',
        storyLength: 'standard',
        adjudicationResults: [{
          depth: 0,
          description: '攻击是否命中？',
          type: 'binary' as const,
          roll: 42,
          outcome: '成功',
          details: '掷骰(42) vs 成功率(65%)',
        }],
        narrativeHistoryReadCount: 3,
        report: { headline: '雨夜决战', winner: '角色甲' },
        ai: {
          model: 'gpt-safe',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
        combatantUpdates: [{
          combatantKey: 'data-card:1',
          displayName: '角色甲',
          impact: '受轻伤',
          currentStateSummary: '仍可行动',
        }],
      },
    };
    expect(ArenaRoomGenerationViewResponseSchema.parse(completed)).toEqual(completed);
    expect(ArenaRoomGenerationViewResponseSchema.safeParse({
      ...response,
      result: completed.result,
    }).success).toBe(false);
    for (const leakedResultField of [
      { extra_json: { providerApiKey: 'secret' } },
      { reasoning: 'hidden chain of thought' },
      { providerDiagnostic: { requestId: 'upstream-secret' } },
      { ai: { ...completed.result.ai, providerName: 'must-not-pass' } },
      { ai: { ...completed.result.ai, providerType: 'must-not-pass' } },
      { updatedCombatants: [{ data: { private: true } }] },
    ]) {
      expect(ArenaRoomGenerationViewResponseSchema.safeParse({
        ...completed,
        result: { ...completed.result, ...leakedResultField },
      }).success).toBe(false);
    }
  });

  it('生成历史只暴露有界的房间安全摘要', () => {
    const response = {
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      items: [{
        generationId: 'generation-1',
        state: 'completed' as const,
        configRevision: 3,
        collaborativeInfluence: true,
        startedAt: '2026-08-28T00:00:00.000Z',
        finishedAt: '2026-08-28T00:03:00.000Z',
      }],
    };

    expect(ArenaRoomGenerationHistoryResponseSchema.parse(response)).toEqual(response);
    for (const leaked of [
      { generationRequestId: 'request-1234' },
      { snapshotDigest: `sha256:${'a'.repeat(64)}` },
      { participantUserIds: [101, 202] },
      { generationPayloadDigest: `sha256:${'b'.repeat(64)}` },
      { generationRecordId: 'record-1' },
      { provider: 'private-provider' },
      { prompt: 'private-prompt' },
      { secret: 'secret-canary' },
    ]) {
      expect(ArenaRoomGenerationHistoryResponseSchema.safeParse({
        ...response,
        items: [{ ...response.items[0], ...leaked }],
      }).success).toBe(false);
    }
    expect(ArenaRoomGenerationHistoryResponseSchema.safeParse({
      ...response,
      items: Array.from({ length: 65 }, (_, index) => ({
        ...response.items[0],
        generationId: `generation-${index}`,
      })),
    }).success).toBe(false);
  });

  it('历史详情只暴露终态安全摘要，并显式表示正文过期', () => {
    const completed = {
      protocolVersion: 1 as const,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      generation: {
        generationId: 'generation-1',
        state: 'completed' as const,
        configRevision: 3,
        collaborativeInfluence: true,
        startedAt: '2026-08-28T00:00:00.000Z',
        finishedAt: '2026-08-28T00:03:00.000Z',
      },
      status: 'completed' as const,
      contentStatus: 'available' as const,
      markdown: '# 安全战报',
      result: { version: 1 as const, format: 'stream-markdown' as const, mode: 'classic' as const },
    };
    expect(ArenaRoomGenerationHistoryViewResponseSchema.parse(completed)).toEqual(completed);
    expect(ArenaRoomGenerationHistoryViewResponseSchema.parse({
      ...completed,
      contentStatus: 'expired',
      markdown: '',
      result: undefined,
    })).toMatchObject({ contentStatus: 'expired' });

    for (const leakedGenerationField of [
      { generationRequestId: 'request-1234' },
      { snapshotDigest: `sha256:${'a'.repeat(64)}` },
      { participantUserIds: [101, 202] },
      { generationRecordId: 'record-1' },
    ]) {
      expect(ArenaRoomGenerationHistoryViewResponseSchema.safeParse({
        ...completed,
        generation: { ...completed.generation, ...leakedGenerationField },
      }).success).toBe(false);
    }
  });

  it('Proposal mutation DTO 只接受 client intent 与 typed changes，并保持 strict', () => {
    const change = {
      changeId: 'guidance-1',
      type: 'setUserGuidance' as const,
      value: '建议',
      expectedBase: { kind: 'value' as const, value: '' },
    };
    const submit = {
      proposalId: 'proposal-1',
      expectedRoomEpoch: 'epoch-1',
      baseRevision: 3,
      changes: [change],
    };
    expect(ArenaRoomProposalSubmitRequestSchema.parse(submit)).toEqual(submit);
    for (const proposalId of ['.', '..']) {
      expect(ArenaRoomProposalSubmitRequestSchema.safeParse({ ...submit, proposalId }).success)
        .toBe(false);
    }
    for (const injected of [
      { roomId: 'room-1' },
      { authorUserId: 'spoofed' },
      { proposalVersion: 1 },
      { status: 'submitted' },
      { createdAt: '2026-08-28T00:00:00.000Z' },
      { accountUserId: 7 },
      { role: 'member' },
    ]) {
      expect(ArenaRoomProposalSubmitRequestSchema.safeParse({ ...submit, ...injected }).success)
        .toBe(false);
    }
    expect(ArenaRoomProposalSubmitRequestSchema.safeParse({
      ...submit,
      changes: [{ ...change, unexpected: true }],
    }).success).toBe(false);
    expect(ArenaRoomProposalSubmitRequestSchema.safeParse({
      ...submit,
      changes: [{ ...change, dependsOn: ['missing-change'] }],
    }).success).toBe(false);
    expect(ArenaRoomProposalSubmitRequestSchema.safeParse({
      ...submit,
      changes: [
        { ...change, changeId: 'a', dependsOn: ['b'] },
        { ...change, changeId: 'b', dependsOn: ['a'] },
      ],
    }).success).toBe(false);

    const canary = 'proposal-private-canary';
    for (const malicious of [
      { ...submit, changes: [{ op: 'replace', path: '/sharedConfig/userGuidance', value: canary }] },
      {
        ...submit,
        changes: [{
          changeId: 'material-ref-data',
          type: 'addMaterial',
          ref: { id: 'material-1', kind: 'material', versionToken: 'v1', data: { credential: canary } },
          expectedBase: { kind: 'absent' },
        }],
      },
      {
        ...submit,
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
        ...submit,
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
      { ...submit, provider: { apiKey: canary }, userProviderConfig: { credential: canary } },
    ]) {
      expect(ArenaRoomProposalSubmitRequestSchema.safeParse(malicious).success).toBe(false);
    }

    const resolve = {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 3,
      resolution: 'accept-selected' as const,
      selectedChangeIds: ['guidance-1'],
    };
    expect(ArenaRoomProposalResolveRequestSchema.parse(resolve)).toEqual(resolve);
    expect(ArenaRoomProposalResolveRequestSchema.safeParse({
      ...resolve,
      expectedRevision: -1,
    }).success).toBe(false);
    expect(ArenaRoomProposalResolveRequestSchema.safeParse({
      ...resolve,
      resolution: 'reject',
      selectedChangeIds: [],
    }).success).toBe(false);
    expect(ArenaRoomProposalResolveRequestSchema.safeParse({
      ...resolve,
      accountUserId: 7,
    }).success).toBe(false);

    const withdraw = { expectedRoomEpoch: 'epoch-1' };
    expect(ArenaRoomProposalWithdrawRequestSchema.parse(withdraw)).toEqual(withdraw);
    expect(ArenaRoomProposalWithdrawRequestSchema.safeParse({ ...withdraw, proposalId: 'p' }).success)
      .toBe(false);
  });

  it('Proposal mutation response 只暴露公共 cursor、proposal status 与 result', () => {
    const response = {
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 4,
      revision: 3,
      proposalId: 'proposal-1',
      status: 'partially_accepted' as const,
      result: 'applied' as const,
    };
    expect(ArenaRoomProposalMutationResponseSchema.parse(response)).toEqual(response);
    // resolve 响应可以携带 mutation 后的权威 sharedConfig 与完整权威 snapshot；
    // 不改变配置的 mutation 省略这两个字段。
    const authoritativeSnapshot = {
      ...canonicalRoomSnapshot,
      roomId: response.roomId,
      roomEpoch: response.roomEpoch,
      controlSeq: response.controlSeq,
      revision: response.revision,
    };
    const withAuthority = {
      ...response,
      sharedConfig: canonicalRoomSnapshot.sharedConfig,
      snapshot: authoritativeSnapshot,
    };
    expect(ArenaRoomProposalMutationResponseSchema.parse(withAuthority)).toEqual(withAuthority);
    for (const internal of [
      { accountUserId: 7 },
      { deadlines: { hostOfflineDeadline: null } },
      { terminalProposalIds: ['proposal-1'] },
      { receipt: 'checkpoint-receipt' },
      { authorityState: {} },
    ]) {
      expect(ArenaRoomProposalMutationResponseSchema.safeParse({ ...response, ...internal }).success)
        .toBe(false);
    }
    // snapshot 与响应公共身份/游标字段矛盾时必须拒绝。
    for (const mismatch of [
      { roomId: 'room-other' },
      { roomEpoch: 'epoch-other' },
      { controlSeq: response.controlSeq + 1 },
      { revision: response.revision + 1 },
    ]) {
      expect(ArenaRoomProposalMutationResponseSchema.safeParse({
        ...withAuthority,
        snapshot: { ...authoritativeSnapshot, ...mismatch },
      }).success).toBe(false);
    }
  });

  it('create 只接受幂等请求 ID、展示信息、directory 与 shared config', () => {
    const request = {
      creationRequestId: 'create-request-1234',
      displayName: '房主',
      directory: { title: '周末竞技场', visibility: 'public' },
      sharedConfig: canonicalRoomSnapshot.sharedConfig,
    };
    expect(ArenaRoomCreateRequestSchema.parse(request)).toEqual(request);
    const missingRequestId = Object.fromEntries(
      Object.entries(request).filter(([key]) => key !== 'creationRequestId'),
    );
    expect(ArenaRoomCreateRequestSchema.safeParse(missingRequestId).success).toBe(false);
    for (const authority of [
      { roomId: 'client-room' },
      { roomEpoch: 'client-epoch' },
      { userId: 'client-user' },
      { accountUserId: 7 },
      { role: 'host' },
      { apiKey: 'secret' },
    ]) {
      expect(ArenaRoomCreateRequestSchema.safeParse({ ...request, ...authority }).success)
        .toBe(false);
    }
  });

  it('join 与 ticket 不允许客户端提交 identity、role 或 epoch', () => {
    expect(ArenaRoomJoinRequestSchema.parse({ displayName: '成员' })).toEqual({
      displayName: '成员',
    });
    expect(ArenaRoomJoinRequestSchema.safeParse({
      displayName: '成员',
      userId: 'spoofed',
    }).success).toBe(false);

    expect(ArenaRoomTicketRequestSchema.parse({
      reconnect: { control: { roomEpoch: 'epoch-1', controlSeq: 3 } },
    })).toEqual({ reconnect: { control: { roomEpoch: 'epoch-1', controlSeq: 3 } } });
    expect(ArenaRoomTicketRequestSchema.safeParse({ roleHint: 'host' }).success).toBe(false);
    expect(ArenaRoomTicketRequestSchema.safeParse({ roomEpoch: 'epoch-1' }).success).toBe(false);
  });

  it('leave/close 只接受 session epoch fence，不接受 identity 或 role', () => {
    expect(ArenaRoomEpochMutationRequestSchema.parse({
      expectedRoomEpoch: 'epoch-1',
    })).toEqual({ expectedRoomEpoch: 'epoch-1' });
    for (const authority of [
      { userId: 'spoofed' },
      { accountUserId: 7 },
      { role: 'host' },
      { roomEpoch: 'epoch-1' },
      { apiKey: 'secret' },
    ]) {
      expect(ArenaRoomEpochMutationRequestSchema.safeParse({
        expectedRoomEpoch: 'epoch-1',
        ...authority,
      }).success).toBe(false);
    }
  });

  it('session 仅返回 public snapshot 与当前成员，不接受 authority state', () => {
    expect(ArenaRoomSessionResponseSchema.parse(session)).toEqual(session);
    for (const authority of [
      { memberAuthority: [] },
      { accountUserId: 7 },
      { deadlines: { hostOfflineDeadline: null, roomIdleDeadline: null } },
    ]) {
      expect(ArenaRoomSessionResponseSchema.safeParse({ ...session, ...authority }).success)
        .toBe(false);
    }
    expect(ArenaRoomSessionResponseSchema.safeParse({
      ...session,
      roomEpoch: 'other-epoch',
    }).success).toBe(false);
    expect(ArenaRoomSessionResponseSchema.safeParse({
      ...session,
      self: { ...session.self, userId: 'not-a-member' },
    }).success).toBe(false);
  });

  it('ticket/leave/error response 维持有界且可判别的 wire', () => {
    expect(ArenaRoomTicketResponseSchema.parse({
      protocolVersion: 1,
      ticket: 'opaque-ticket',
      expiresInSeconds: 45,
      websocket: {
        path: ARENA_ROOM_WEBSOCKET_PATH,
        protocol: 'mahoshojo.arena-room.v1',
      },
    })).toMatchObject({ ticket: 'opaque-ticket', expiresInSeconds: 45 });
    expect(ArenaRoomTicketResponseSchema.safeParse({
      protocolVersion: 1,
      ticket: 'x'.repeat(4_097),
      expiresInSeconds: 45,
      websocket: {
        path: ARENA_ROOM_WEBSOCKET_PATH,
        protocol: 'mahoshojo.arena-room.v1',
      },
    }).success).toBe(false);
    expect(ArenaRoomLeaveResponseSchema.parse({
      protocolVersion: 1,
      roomId: 'room-1',
      outcome: 'left',
    })).toMatchObject({ outcome: 'left' });
    expect(ArenaRoomHttpErrorResponseSchema.safeParse({
      code: 'ROOM_AUTHENTICATION_REQUIRED',
      error: '请先登录',
      accountUserId: 7,
    }).success).toBe(false);
  });
});
