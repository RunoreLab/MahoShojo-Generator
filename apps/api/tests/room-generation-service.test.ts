import { describe, expect, it, vi } from 'vitest';

import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import { createArenaRoomMembershipService } from '#/arena-room/room-membership-service';
import {
  ARENA_ROOM_INTERNAL_GUIDANCE,
  ArenaRoomGenerationError,
  createArenaRoomGenerationService,
} from '#/arena-room/room-generation-service';
import type { ArenaRoomGenerationPort } from '#/arena-generation/room-generation-port';
import {
  ArenaRoomGenerationMaterializationError,
  type ArenaRoomGenerationMaterializer,
} from '#/arena-room/room-generation-materializer';
import { ArenaRoomGenerationContentResolverError } from '#/arena-room/room-generation-content-resolver';
import type {
  RoomGenerationPublisher,
  RoomGenerationPublisherOptions,
  RoomGenerationPublishResult,
} from '#/arena-room/room-generation-publisher';
import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  issueArenaRoomGenerationPublisherAuthority,
  issueArenaRoomTrustedTime,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;
  readonly order: string[] = [];

  async load(roomId: string) {
    return this.state?.snapshot.roomId === roomId ? structuredClone(this.state) : null;
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
    const data = consumeArenaRoomCheckpointCommit(input.commit);
    if (data.predecessor === null) {
      if (this.state !== null) return { kind: 'conflict' as const };
    } else if (
      this.state === null
      || JSON.stringify(this.state) !== JSON.stringify(data.predecessorState)
      || JSON.stringify(checkpointPredecessorOf(this.state)) !== JSON.stringify(data.predecessor)
    ) return { kind: 'conflict' as const };
    this.state = structuredClone(data.nextState);
    this.order.push(`checkpoint:${data.nextState.snapshot.activeGeneration?.state ?? 'config'}`);
    return { kind: 'saved' as const };
  }

  async refresh() {
    return { kind: 'refreshed' as const };
  }
}

const sharedConfig = () => ({
  battleMode: 'classic' as const,
  combatants: [{
    key: 'data-card:character-1',
    ref: { id: 'character-1', kind: 'character' as const, versionToken: 'v1' },
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'standard' as const,
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings: {
    readArenaHistory: true,
    readArenaHistoryLimit: 3,
    isArenaHistoryUnlimited: false,
    writeArenaHistory: true,
    readCurrentState: true,
    writeCurrentState: true,
    readNarrativeHistory: false,
    readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false,
    writeNarrativeHistory: false,
  },
});

const sourceRequest = () => new Request('https://api.example.test/room-generation', {
  method: 'POST',
  headers: { authorization: 'Bearer verified-user' },
});

const subscription = () => ({
  generationId: 'generation-1',
  generationRequestId: 'request-1234',
  events: new ReadableStream({ start(controller) { controller.close(); } }),
});

const createHarness = async () => {
  const store = new MemoryRoomStore();
  let user = 0;
  const actors = createRoomActorRegistry({
    store,
    createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
    createTimestamp: () => '2026-08-28T00:00:00.000Z',
    now: () => Date.parse('2026-08-28T00:01:00.000Z'),
  });
  const memberships = createArenaRoomMembershipService({
    actors,
    createUserId: () => `user-${++user}`,
    now: () => '2026-08-28T00:00:30.000Z',
  });
  const session = await memberships.create({
    accountUserId: 101,
    displayName: 'Host',
    sharedConfig: sharedConfig(),
  });
  const materializer = {
    materialize: vi.fn<ArenaRoomGenerationMaterializer['materialize']>(async (input) => ({
      mode: input.sharedConfig.battleMode,
      combatants: input.sharedConfig.combatants,
      userGuidance: input.sharedConfig.userGuidance,
      ...input.hostRuntime,
    })),
  } satisfies ArenaRoomGenerationMaterializer;
  const generation = {
    deriveGenerationId: vi.fn<ArenaRoomGenerationPort['deriveGenerationId']>(
      async () => 'generation-1',
    ),
    hashSemanticPayload: vi.fn<ArenaRoomGenerationPort['hashSemanticPayload']>(
      async (input) => `sha256:${
        (input.payload.customProvider as { apiKey?: string } | undefined)?.apiKey === 'changed-secret'
          ? 'b'.repeat(64)
          : 'a'.repeat(64)
      }`,
    ),
    startFromHostRequest: vi.fn<ArenaRoomGenerationPort['startFromHostRequest']>(async () => ({
      kind: 'subscribed' as const,
      subscription: subscription(),
    })),
    readOwnedProjection: vi.fn<ArenaRoomGenerationPort['readOwnedProjection']>(
      async () => ({ kind: 'not-found' as const }),
    ),
    resumeOwnedSubscription: vi.fn<ArenaRoomGenerationPort['resumeOwnedSubscription']>(
      async () => ({ kind: 'not-found' as const }),
    ),
  } satisfies ArenaRoomGenerationPort;
  let attachResolve: ((result: RoomGenerationPublishResult) => void) | null = null;
  const publisher = {
    attach: vi.fn<RoomGenerationPublisher['attach']>(() => new Promise((resolve) => {
      attachResolve = resolve;
    })),
    getProgress: vi.fn(() => ({ markdown: '', nextChunkSeq: 0 })),
  } satisfies RoomGenerationPublisher;
  const createPublisher = vi.fn<(
    options: RoomGenerationPublisherOptions,
  ) => RoomGenerationPublisher>(() => publisher);
  const observeArenaRoomRuntime = vi.fn();
  const onBackgroundError = vi.fn();
  const service = createArenaRoomGenerationService({
    memberships,
    materializer,
    generation,
    createPublisher,
    observer: { observeArenaRoomRuntime },
    now: () => '2026-08-28T00:01:00.000Z',
    onBackgroundError,
  });
  return {
    store,
    memberships,
    session,
    materializer,
    generation,
    publisher,
    observeArenaRoomRuntime,
    createPublisher,
    onBackgroundError,
    service,
    finishPublisher: () => attachResolve?.({ kind: 'stream-ended' }),
  };
};

const startRequest = (config = sharedConfig()) => ({
  expectedRoomEpoch: 'epoch-1',
  expectedRevision: 0,
  generationRequestId: 'request-1234',
  sharedConfig: config,
  hostLocalPayloads: [],
  generation: {
    customProvider: { apiKey: 'provider-secret-canary' },
  },
});

describe('Arena Room generation coordinator', () => {
  it('从当前 Room authority 物化，先 hash/reservation checkpoint 再调用 existing generation，duplicate 不二次启动', async () => {
    const harness = await createHarness();
    const request = startRequest();
    const view = await harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request,
      sourceRequest: sourceRequest(),
    });

    expect(harness.store.order).toEqual([
      'checkpoint:config',
      'checkpoint:starting',
    ]);
    expect(harness.materializer.materialize).toHaveBeenCalledWith({
      sharedConfig: request.sharedConfig,
      hostAccountUserId: 101,
      hostLocalPayloads: [],
      hostRuntime: request.generation,
    });
    expect(harness.generation.startFromHostRequest).toHaveBeenCalledTimes(1);
    const start = vi.mocked(harness.generation.startFromHostRequest).mock.calls[0]![0];
    expect(start).toMatchObject({
      roomId: 'room-1',
      generationRequestId: 'request-1234',
      payload: expect.objectContaining({
        mode: 'classic',
        userGuidance: '',
        customProvider: request.generation.customProvider,
      }),
      internalGuidance: ARENA_ROOM_INTERNAL_GUIDANCE,
      pvpContext: { matchId: 'generation-1', roundId: 'attempt-1' },
      multiplayerSnapshot: {
        configRevision: 0,
        sharedConfig: request.sharedConfig,
        participantUserIds: [101],
      },
    });
    expect(view).toMatchObject({
      roomId: 'room-1',
      status: 'reserved',
      generation: { generationId: 'generation-1', state: 'starting', configRevision: 0 },
    });
    expect(JSON.stringify(harness.store.state)).not.toContain('provider-secret-canary');
    expect(harness.createPublisher).toHaveBeenCalledTimes(1);
    expect(harness.publisher.attach).toHaveBeenCalledTimes(1);
    expect(harness.observeArenaRoomRuntime).toHaveBeenCalledWith({
      event: 'publisher',
      action: 'started',
    });

    await harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request,
      sourceRequest: sourceRequest(),
    });
    expect(harness.generation.startFromHostRequest).toHaveBeenCalledTimes(1);
    expect(harness.publisher.attach).toHaveBeenCalledTimes(1);
    harness.finishPublisher();
    await vi.waitFor(() => expect(harness.observeArenaRoomRuntime).toHaveBeenCalledWith({
      event: 'publisher',
      action: 'finished',
    }));
  });

  it('请求 sharedConfig 与 Room authority 不同时拒绝，不再隐式 publish', async () => {
    const harness = await createHarness();
    const stale = sharedConfig();
    stale.userGuidance = '尚未发布的 host 本地修改';
    await expect(harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(stale),
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code: 'ROOM_GENERATION_CONFLICT' });
    expect(harness.store.order).toEqual(['checkpoint:config']);
    expect(harness.materializer.materialize).not.toHaveBeenCalled();
    expect(harness.generation.hashSemanticPayload).not.toHaveBeenCalled();
    expect(harness.generation.startFromHostRequest).not.toHaveBeenCalled();
  });

  it.each([
    [
      new ArenaRoomGenerationContentResolverError('ARENA_ROOM_REFERENCE_VERSION_MISMATCH'),
      'ROOM_REFERENCE_STALE',
    ],
    [
      new ArenaRoomGenerationMaterializationError('ARENA_ROOM_HOST_LOCAL_PAYLOAD_MISMATCH'),
      'ROOM_GENERATION_INPUT_INVALID',
    ],
  ])('materialization fail closed (%s) 且不 hash/reserve/start provider', async (error, code) => {
    const harness = await createHarness();
    harness.materializer.materialize.mockRejectedValueOnce(error);
    await expect(harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(),
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code });
    expect(harness.store.order).toEqual(['checkpoint:config']);
    expect(harness.generation.hashSemanticPayload).not.toHaveBeenCalled();
    expect(harness.generation.startFromHostRequest).not.toHaveBeenCalled();
  });

  it('注入 publisher 同步抛错仍关闭 lifecycle gauge 并只走 background error', async () => {
    const harness = await createHarness();
    const error = new Error('publisher-sync-throw');
    harness.publisher.attach.mockImplementationOnce(() => { throw error; });

    await expect(harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(),
      sourceRequest: sourceRequest(),
    })).resolves.toMatchObject({ status: 'reserved' });
    await vi.waitFor(() => expect(harness.onBackgroundError).toHaveBeenCalledWith(error));
    expect(harness.observeArenaRoomRuntime).toHaveBeenCalledWith({
      event: 'publisher', action: 'started',
    });
    expect(harness.observeArenaRoomRuntime).toHaveBeenCalledWith({
      event: 'publisher', action: 'finished',
    });
  });

  it('历史 reservation 先对账：unavailable 不 POST；明确 not-found 才用同一 ID 补启动', async () => {
    const harness = await createHarness();
    const request = startRequest();
    await harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request,
      sourceRequest: sourceRequest(),
    });
    harness.finishPublisher();

    const unavailablePort = {
      ...harness.generation,
      startFromHostRequest: vi.fn(async () => ({
        kind: 'subscribed' as const,
        subscription: subscription(),
      })),
      readOwnedProjection: vi.fn(async () => ({
        kind: 'unavailable' as const,
        code: 'GENERATION_STATE_UNAVAILABLE',
      })),
    };
    const unavailable = createArenaRoomGenerationService({
      memberships: harness.memberships,
      materializer: harness.materializer,
      generation: unavailablePort,
      createPublisher: harness.createPublisher,
      now: () => '2026-08-28T00:02:00.000Z',
    });
    await expect(unavailable.start({
      roomId: 'room-1',
      accountUserId: 101,
      request,
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code: 'ROOM_OPERATION_UNKNOWN' });
    expect(unavailablePort.startFromHostRequest).not.toHaveBeenCalled();

    const notFoundPort = {
      ...harness.generation,
      startFromHostRequest: vi.fn(async () => ({
        kind: 'subscribed' as const,
        subscription: subscription(),
      })),
      readOwnedProjection: vi.fn(async () => ({ kind: 'not-found' as const })),
    };
    const recovered = createArenaRoomGenerationService({
      memberships: harness.memberships,
      materializer: harness.materializer,
      generation: notFoundPort,
      createPublisher: harness.createPublisher,
      now: () => '2026-08-28T00:02:00.000Z',
    });
    await recovered.start({
      roomId: 'room-1',
      accountUserId: 101,
      request,
      sourceRequest: sourceRequest(),
    });
    expect(notFoundPort.readOwnedProjection).toHaveBeenCalledTimes(1);
    expect(notFoundPort.startFromHostRequest).toHaveBeenCalledTimes(1);
  });

  it('历史 durable terminal 先返回权威结果，不被后续 ref stale 遮蔽', async () => {
    const harness = await createHarness();
    const request = startRequest();
    await harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request,
      sourceRequest: sourceRequest(),
    });
    harness.finishPublisher();
    await Promise.resolve();

    harness.materializer.materialize.mockClear();
    harness.materializer.materialize.mockRejectedValue(
      new ArenaRoomGenerationMaterializationError('ARENA_ROOM_REFERENCE_STALE'),
    );
    vi.mocked(harness.generation.readOwnedProjection).mockResolvedValue({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-1234',
        status: 'completed',
        markdown: '# 已存在的权威终态',
        resumeCursor: null,
        updatedAt: '2026-08-28T00:02:00.000Z',
        finalAuthoritative: true,
        resultAvailable: true,
        generationRecordId: 'generation-1',
        errorCode: null,
        roomSafeResult: {
          version: 1,
          format: 'stream-markdown',
          mode: 'classic',
          report: { headline: '权威标题' },
        },
      },
    });
    const restarted = createArenaRoomGenerationService({
      memberships: harness.memberships,
      materializer: harness.materializer,
      generation: harness.generation,
      createPublisher: harness.createPublisher,
      now: () => '2026-08-28T00:02:00.000Z',
    });

    await expect(restarted.start({
      roomId: 'room-1',
      accountUserId: 101,
      request,
      sourceRequest: sourceRequest(),
    })).resolves.toMatchObject({
      status: 'completed',
      markdown: '# 已存在的权威终态',
      finalAuthoritative: true,
    });
    expect(harness.materializer.materialize).not.toHaveBeenCalled();
    expect(harness.generation.startFromHostRequest).toHaveBeenCalledTimes(1);
  });

  it('历史 not-found 只允许 exact semantic payload；terminal ledger 永不再次 POST', async () => {
    const harness = await createHarness();
    const request = startRequest();
    await harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request,
      sourceRequest: sourceRequest(),
    });
    harness.finishPublisher();
    await Promise.resolve();

    const historicalPort = {
      ...harness.generation,
      startFromHostRequest: vi.fn(async () => ({
        kind: 'subscribed' as const,
        subscription: subscription(),
      })),
      readOwnedProjection: vi.fn(async () => ({ kind: 'not-found' as const })),
    };
    const restarted = createArenaRoomGenerationService({
      memberships: harness.memberships,
      materializer: harness.materializer,
      generation: historicalPort,
      createPublisher: harness.createPublisher,
      now: () => '2026-08-28T00:02:00.000Z',
    });
    await expect(restarted.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: {
        ...request,
        generation: {
          ...request.generation,
          customProvider: { apiKey: 'changed-secret' },
        },
      },
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code: 'ROOM_GENERATION_CONFLICT' });
    expect(historicalPort.startFromHostRequest).not.toHaveBeenCalled();

    const membership = await harness.memberships.resolveActiveByAccount({
      roomId: 'room-1',
      accountUserId: 101,
    });
    const authority = issueArenaRoomGenerationPublisherAuthority({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      generationRequestId: 'request-1234',
      generationId: 'generation-1',
      attempt: 1,
      expiresAt: '2026-08-29T00:00:00.000Z',
    });
    for (const command of [
      { state: 'running' as const, timestamp: '2026-08-28T00:03:00.000Z' },
      {
        state: 'completed' as const,
        generationRecordId: 'generation-1',
        timestamp: '2026-08-28T00:04:00.000Z',
      },
    ]) {
      const result = await membership.actor.execute({
        authority,
        command: {
          type: 'mirror-generation',
          expectedRoomEpoch: 'epoch-1',
          generationRequestId: 'request-1234',
          generationId: 'generation-1',
          attempt: 1,
          ...command,
        },
        trustedTime: issueArenaRoomTrustedTime({ now: command.timestamp }),
      });
      expect(result.ok).toBe(true);
    }
    await expect(restarted.start({
      roomId: 'room-1',
      accountUserId: 101,
      request,
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code: 'ROOM_GENERATION_CONFLICT' });
    expect(historicalPort.startFromHostRequest).not.toHaveBeenCalled();
  });

  it('definitive preflight rejection 终结 Room attempt；5xx unknown 保留 starting 等待对账', async () => {
    const rejected = await createHarness();
    vi.mocked(rejected.generation.startFromHostRequest).mockResolvedValueOnce({
      kind: 'rejected',
      status: 400,
      code: 'ARENA_CONTENT_POLICY_REJECTED',
    });
    await expect(rejected.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(),
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code: 'ROOM_GENERATION_CONFLICT' });
    expect(rejected.store.state?.snapshot.activeGeneration?.state).toBe('cancelled');
    expect(rejected.publisher.attach).not.toHaveBeenCalled();

    const unknown = await createHarness();
    vi.mocked(unknown.generation.startFromHostRequest).mockResolvedValueOnce({
      kind: 'rejected',
      status: 503,
      code: 'GENERATION_RESERVATION_UNAVAILABLE',
    });
    await expect(unknown.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(),
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code: 'ROOM_OPERATION_UNKNOWN' });
    expect(unknown.store.state?.snapshot.activeGeneration?.state).toBe('starting');
    expect(unknown.publisher.attach).not.toHaveBeenCalled();

    const conflict = await createHarness();
    vi.mocked(conflict.generation.startFromHostRequest).mockResolvedValueOnce({
      kind: 'rejected',
      status: 409,
      code: 'GENERATION_REQUEST_CONFLICT',
    });
    await expect(conflict.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(),
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code: 'ROOM_GENERATION_CONFLICT' });
    expect(conflict.store.state?.snapshot.activeGeneration?.state).toBe('starting');
  });

  it('active member 只能读取 current generation；running projection 先 reconcile Room 再只读 resume attach', async () => {
    const harness = await createHarness();
    const request = startRequest();
    await harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request,
      sourceRequest: sourceRequest(),
    });
    harness.finishPublisher();
    await harness.memberships.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });

    const projection = {
      generationId: 'generation-1',
      generationRequestId: 'request-1234',
      status: 'running' as const,
      markdown: '# 权威恢复正文',
      resumeCursor: '10-2',
      updatedAt: '2026-08-28T00:02:00.000Z',
      finalAuthoritative: false,
      resultAvailable: false,
      generationRecordId: null,
      errorCode: null,
    };
    vi.mocked(harness.generation.readOwnedProjection).mockResolvedValueOnce({ kind: 'found', projection });
    vi.mocked(harness.generation.resumeOwnedSubscription).mockResolvedValueOnce({
      kind: 'subscribed',
      subscription: subscription(),
    });
    const restarted = createArenaRoomGenerationService({
      memberships: harness.memberships,
      materializer: harness.materializer,
      generation: harness.generation,
      createPublisher: harness.createPublisher,
      now: () => '2026-08-28T00:02:00.000Z',
    });
    const view = await restarted.read({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 202,
    });
    expect(view).toMatchObject({
      status: 'running',
      markdown: '# 权威恢复正文',
      nextChunkSeq: 0,
      generation: { state: 'running' },
    });
    expect(harness.generation.resumeOwnedSubscription).toHaveBeenCalledWith({
      roomId: 'room-1',
      generationId: 'generation-1',
      after: '10-2',
    });
    await expect(restarted.read({
      roomId: 'room-1',
      generationId: 'other-generation',
      accountUserId: 202,
    })).rejects.toBeInstanceOf(ArenaRoomGenerationError);
  });

  it('completed view 只从 owned authoritative projection 取得完整正文与 generation record', async () => {
    const harness = await createHarness();
    await harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(),
      sourceRequest: sourceRequest(),
    });
    harness.finishPublisher();
    vi.mocked(harness.generation.readOwnedProjection).mockResolvedValueOnce({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-1234',
        status: 'completed',
        markdown: '# 来自 R2/D1 terminal fallback 的完整战报',
        resumeCursor: null,
        updatedAt: '2026-08-28T00:03:00.000Z',
        finalAuthoritative: true,
        resultAvailable: true,
        generationRecordId: 'generation-1',
        errorCode: null,
        roomSafeResult: {
          version: 1,
          format: 'stream-markdown',
          mode: 'classic',
          report: { headline: '权威标题' },
        },
      },
    });
    const restarted = createArenaRoomGenerationService({
      memberships: harness.memberships,
      materializer: harness.materializer,
      generation: harness.generation,
      createPublisher: harness.createPublisher,
      now: () => '2026-08-28T00:03:00.000Z',
    });
    await expect(restarted.read({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 101,
    })).resolves.toMatchObject({
      status: 'completed',
      markdown: '# 来自 R2/D1 terminal fallback 的完整战报',
      finalAuthoritative: true,
      generationRecordId: 'generation-1',
      result: {
        version: 1,
        format: 'stream-markdown',
        mode: 'classic',
        report: { headline: '权威标题' },
      },
      generation: { state: 'completed' },
    });
    expect(harness.generation.resumeOwnedSubscription).not.toHaveBeenCalled();
  });

  it.each([
    {
      status: 'completed' as const,
      projectionMarkdown: '# authoritative completed body',
      resultAvailable: true,
      generationRecordId: 'generation-1',
      errorCode: null,
      expectedMarkdown: '# authoritative completed body',
    },
    {
      status: 'failed' as const,
      projectionMarkdown: '',
      resultAvailable: false,
      generationRecordId: null,
      errorCode: 'GENERATION_FAILED',
      expectedMarkdown: '',
    },
    {
      status: 'cancelled' as const,
      projectionMarkdown: '',
      resultAvailable: false,
      generationRecordId: null,
      errorCode: null,
      expectedMarkdown: '',
    },
    {
      status: 'producer_lost' as const,
      projectionMarkdown: '',
      resultAvailable: false,
      generationRecordId: null,
      errorCode: 'GENERATION_PRODUCER_LOST',
      expectedMarkdown: '',
    },
  ])('$status terminal view 不被存活 publisher partial 覆盖', async (scenario) => {
    const harness = await createHarness();
    await harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(),
      sourceRequest: sourceRequest(),
    });
    vi.mocked(harness.publisher.getProgress).mockReturnValue({
      markdown: '# stale in-memory partial',
      nextChunkSeq: 9,
    });
    vi.mocked(harness.generation.readOwnedProjection).mockResolvedValueOnce({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-1234',
        status: scenario.status,
        markdown: scenario.projectionMarkdown,
        resumeCursor: null,
        updatedAt: '2026-08-28T00:03:00.000Z',
        finalAuthoritative: scenario.status === 'completed',
        resultAvailable: scenario.resultAvailable,
        generationRecordId: scenario.generationRecordId,
        errorCode: scenario.errorCode,
        ...(scenario.status === 'completed' ? {
          roomSafeResult: {
            version: 1 as const,
            format: 'stream-markdown' as const,
            mode: 'classic' as const,
          },
        } : {}),
      },
    });

    await expect(harness.service.read({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 101,
    })).resolves.toMatchObject({
      status: scenario.status,
      markdown: scenario.expectedMarkdown,
      nextChunkSeq: 0,
    });
    harness.finishPublisher();
  });

  it('Room terminal 先可见时重读 owned projection，不生成 mirror/status 不一致的 503', async () => {
    const harness = await createHarness();
    await harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(),
      sourceRequest: sourceRequest(),
    });
    harness.finishPublisher();
    await Promise.resolve();
    const membership = await harness.memberships.resolveActiveByAccount({
      roomId: 'room-1',
      accountUserId: 101,
    });
    const authority = issueArenaRoomGenerationPublisherAuthority({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      generationRequestId: 'request-1234',
      generationId: 'generation-1',
      attempt: 1,
      expiresAt: '2026-08-29T00:00:00.000Z',
    });
    for (const command of [
      { state: 'running' as const, timestamp: '2026-08-28T00:03:00.000Z' },
      {
        state: 'completed' as const,
        generationRecordId: 'generation-1',
        timestamp: '2026-08-28T00:04:00.000Z',
      },
    ]) {
      await membership.actor.execute({
        authority,
        command: {
          type: 'mirror-generation',
          expectedRoomEpoch: 'epoch-1',
          generationRequestId: 'request-1234',
          generationId: 'generation-1',
          attempt: 1,
          ...command,
        },
        trustedTime: issueArenaRoomTrustedTime({ now: command.timestamp }),
      });
    }
    const runningProjection = {
      generationId: 'generation-1',
      generationRequestId: 'request-1234',
      status: 'running' as const,
      markdown: '# 完整但 marker 尚不可见',
      resumeCursor: '4-0',
      updatedAt: '2026-08-28T00:04:00.000Z',
      finalAuthoritative: false,
      resultAvailable: false,
      generationRecordId: null,
      errorCode: null,
    };
    vi.mocked(harness.generation.readOwnedProjection)
      .mockResolvedValueOnce({ kind: 'found', projection: runningProjection })
      .mockResolvedValueOnce({
        kind: 'found',
        projection: {
          ...runningProjection,
          status: 'completed',
          finalAuthoritative: true,
          resultAvailable: true,
          generationRecordId: 'generation-1',
          roomSafeResult: {
            version: 1,
            format: 'stream-markdown',
            mode: 'classic',
          },
        },
      });
    const restarted = createArenaRoomGenerationService({
      memberships: harness.memberships,
      materializer: harness.materializer,
      generation: harness.generation,
      createPublisher: harness.createPublisher,
      now: () => '2026-08-28T00:05:00.000Z',
    });

    await expect(restarted.read({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 101,
    })).resolves.toMatchObject({
      status: 'completed',
      generation: { state: 'completed' },
      finalAuthoritative: true,
    });
    expect(harness.generation.readOwnedProjection).toHaveBeenCalledTimes(2);
  });
});
