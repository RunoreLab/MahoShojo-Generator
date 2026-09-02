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
  ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';
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
import { createTestArenaDataCardRefVerifier } from './arena-room-fixtures';

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

const sharedConfig = (): ArenaRoomSharedConfig => ({
  battleMode: 'classic' as const,
  combatants: [
    {
      key: 'data-card:character-1',
      ref: { id: 'character-1', kind: 'character' as const, versionToken: 'v1' },
    },
    {
      key: 'data-card:character-2',
      ref: { id: 'character-2', kind: 'character' as const, versionToken: 'v1' },
    },
  ],
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

const createHarness = async (authorityConfig = sharedConfig()) => {
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
    references: createTestArenaDataCardRefVerifier(),
    createUserId: () => `user-${++user}`,
    now: () => '2026-08-28T00:00:30.000Z',
  });
  const session = await memberships.create({
    accountUserId: 101,
    displayName: 'Host',
    sharedConfig: authorityConfig,
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
    cancelOwned: vi.fn<ArenaRoomGenerationPort['cancelOwned']>(async () => ({
      kind: 'accepted' as const,
      cancelReason: 'user' as const,
    })),
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

const startRequest = (config = sharedConfig(), expectedControlSeq = 0) => ({
  expectedRoomEpoch: 'epoch-1',
  expectedRevision: 0,
  expectedControlSeq,
  generationRequestId: 'request-1234',
  sharedConfig: config,
  hostLocalPayloads: [],
  generation: {
    customProvider: { apiKey: 'provider-secret-canary' },
  },
});

const prepareHistoricalGeneration = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  reserveNextGeneration = true,
) => {
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
    { state: 'running' as const, timestamp: '2026-08-28T00:02:00.000Z' },
    {
      state: 'completed' as const,
      generationRecordId: 'generation-1',
      timestamp: '2026-08-28T00:03:00.000Z',
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

  if (!reserveNextGeneration) return;
  vi.mocked(harness.generation.deriveGenerationId).mockResolvedValueOnce('generation-2');
  vi.mocked(harness.generation.startFromHostRequest).mockResolvedValueOnce({
    kind: 'subscribed',
    subscription: {
      generationId: 'generation-2',
      generationRequestId: 'request-5678',
      events: new ReadableStream({ start(controller) { controller.close(); } }),
    },
  });
  await harness.service.start({
    roomId: 'room-1',
    accountUserId: 101,
    request: {
      ...startRequest(sharedConfig(), harness.store.state!.snapshot.controlSeq),
      generationRequestId: 'request-5678',
    },
    sourceRequest: sourceRequest(),
  });
};

describe('Arena Room generation coordinator', () => {
  it('当前 epoch 的 active member 可列出有界 ledger 摘要，不读取 durable 正文', async () => {
    const harness = await createHarness();
    await prepareHistoricalGeneration(harness);
    await harness.memberships.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });
    vi.mocked(harness.generation.readOwnedProjection).mockClear();

    const history = await harness.service.list({
      roomId: 'room-1',
      accountUserId: 202,
    });

    expect(history).toEqual({
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      items: [
        {
          generationId: 'generation-1',
          state: 'completed',
          configRevision: 0,
          collaborativeInfluence: false,
          startedAt: '2026-08-28T00:01:00.000Z',
          finishedAt: '2026-08-28T00:03:00.000Z',
        },
      ],
    });
    expect(harness.generation.readOwnedProjection).not.toHaveBeenCalled();
    expect(JSON.stringify(history)).not.toContain('sha256:');
    expect(JSON.stringify(history)).not.toContain('participantUserIds');
    expect(JSON.stringify(history)).not.toContain('provider-secret-canary');
  });

  it('active member 可读取当前 epoch ledger 中的历史终态，不 resume 或改写 current generation', async () => {
    const harness = await createHarness();
    await prepareHistoricalGeneration(harness);
    await harness.memberships.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });
    vi.mocked(harness.generation.readOwnedProjection).mockResolvedValueOnce({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-1234',
        status: 'completed',
        markdown: '# 历史权威战报',
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
          report: { headline: '历史标题' },
        },
      },
    });
    vi.mocked(harness.generation.resumeOwnedSubscription).mockClear();

    const detail = await harness.service.readHistory({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 202,
    });

    expect(detail).toMatchObject({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      status: 'completed',
      contentStatus: 'available',
      markdown: '# 历史权威战报',
      generation: {
        generationId: 'generation-1',
        state: 'completed',
      },
    });
    expect(JSON.stringify(detail)).not.toContain('generationRequestId');
    expect(JSON.stringify(detail)).not.toContain('snapshotDigest');
    expect(JSON.stringify(detail)).not.toContain('participantUserIds');
    expect(JSON.stringify(detail)).not.toContain('generationRecordId');
    expect(harness.generation.readOwnedProjection).toHaveBeenCalledWith({
      roomId: 'room-1',
      generationId: 'generation-1',
    });
    expect(harness.generation.resumeOwnedSubscription).not.toHaveBeenCalled();
    expect(harness.store.state?.snapshot.activeGeneration).toMatchObject({
      generationId: 'generation-2',
      state: 'starting',
    });
  });

  it.each([
    ['正文已过期', { contentRetention: 'expired' as const }, 'expired'],
    [
      '正文未归档',
      { persistenceWarning: 'OUTPUT_NOT_ARCHIVED' as const, replayUnavailable: true as const },
      'not-archived',
    ],
  ])('%s 时返回非重试的安全历史终态', async (_label, marker, contentStatus) => {
    const harness = await createHarness();
    await prepareHistoricalGeneration(harness);
    vi.mocked(harness.generation.readOwnedProjection).mockResolvedValueOnce({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-1234',
        status: 'completed',
        markdown: '',
        resumeCursor: null,
        updatedAt: '2026-08-28T00:03:00.000Z',
        finalAuthoritative: true,
        resultAvailable: false,
        generationRecordId: null,
        errorCode: null,
        ...marker,
      },
    });

    await expect(harness.service.readHistory({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 101,
    })).resolves.toMatchObject({
      status: 'completed',
      contentStatus,
      markdown: '',
    });
  });

  it('最新 completed 指针也进入历史列表并返回非重试 retention 终态', async () => {
    const harness = await createHarness();
    await prepareHistoricalGeneration(harness, false);
    vi.mocked(harness.generation.readOwnedProjection).mockResolvedValueOnce({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-1234',
        status: 'completed',
        markdown: '',
        resumeCursor: null,
        updatedAt: '2026-08-28T00:03:00.000Z',
        finalAuthoritative: true,
        resultAvailable: false,
        generationRecordId: null,
        errorCode: null,
        contentRetention: 'expired',
      },
    });

    await expect(harness.service.list({
      roomId: 'room-1',
      accountUserId: 101,
    })).resolves.toMatchObject({
      items: [{ generationId: 'generation-1', state: 'completed' }],
    });
    await expect(harness.service.readHistory({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 101,
    })).resolves.toMatchObject({
      contentStatus: 'expired',
      status: 'completed',
    });
  });

  it('durable 历史读取期间成员资格被撤销时在返回正文前 fail closed', async () => {
    const harness = await createHarness();
    await prepareHistoricalGeneration(harness);
    const joined = await harness.memberships.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });
    let releaseProjection!: (value: Awaited<ReturnType<
      ArenaRoomGenerationPort['readOwnedProjection']
    >>) => void;
    let projectionStarted!: () => void;
    const started = new Promise<void>((resolve) => { projectionStarted = resolve; });
    vi.mocked(harness.generation.readOwnedProjection).mockImplementationOnce(() => (
      new Promise((resolve) => {
        releaseProjection = resolve;
        projectionStarted();
      })
    ));

    const reading = harness.service.readHistory({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 202,
    });
    await started;
    const hostMembership = await harness.memberships.resolveActiveByAccount({
      roomId: 'room-1',
      accountUserId: 101,
    });
    const timestamp = '2026-08-28T00:05:00.000Z';
    const kicked = await hostMembership.actor.execute({
      authority: {
        kind: 'authenticated-user',
        actorUserId: hostMembership.member.userId,
        accountUserId: 101,
      },
      command: {
        type: 'kick-member',
        expectedRoomEpoch: 'epoch-1',
        targetUserId: joined.member.userId,
        timestamp,
      },
      trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
    });
    expect(kicked.ok).toBe(true);
    releaseProjection({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-1234',
        status: 'completed',
        markdown: '# 不应返回给已撤销成员',
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
        },
      },
    });

    await expect(reading).rejects.toMatchObject({ code: 'ROOM_MEMBERSHIP_REVOKED' });
  });

  it('无法分类的 completed 正文缺失仍 fail closed 为 unavailable', async () => {
    const harness = await createHarness();
    await prepareHistoricalGeneration(harness);
    vi.mocked(harness.generation.readOwnedProjection).mockResolvedValueOnce({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-1234',
        status: 'completed',
        markdown: '',
        resumeCursor: null,
        updatedAt: '2026-08-28T00:03:00.000Z',
        finalAuthoritative: true,
        resultAvailable: false,
        generationRecordId: null,
        errorCode: null,
      },
    });

    await expect(harness.service.readHistory({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 101,
    })).rejects.toMatchObject({ code: 'ROOM_GENERATION_UNAVAILABLE' });
  });

  it('durable completed 尚未成为权威终态时拒绝作为历史战报读取', async () => {
    const harness = await createHarness();
    await prepareHistoricalGeneration(harness);
    vi.mocked(harness.generation.readOwnedProjection).mockResolvedValueOnce({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-1234',
        status: 'completed',
        markdown: '# 尚未权威确认',
        resumeCursor: null,
        updatedAt: '2026-08-28T00:03:00.000Z',
        finalAuthoritative: false,
        resultAvailable: true,
        generationRecordId: 'generation-1',
        errorCode: null,
        roomSafeResult: {
          version: 1,
          format: 'stream-markdown',
          mode: 'classic',
        },
      },
    });

    await expect(harness.service.readHistory({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 101,
    })).rejects.toMatchObject({ code: 'ROOM_GENERATION_UNAVAILABLE' });
  });

  it('历史详情对 ledger 外 ID 与 durable identity mismatch fail closed', async () => {
    const harness = await createHarness();
    await prepareHistoricalGeneration(harness);
    vi.mocked(harness.generation.readOwnedProjection).mockClear();

    await expect(harness.service.readHistory({
      roomId: 'room-1',
      generationId: 'generation-from-old-epoch',
      accountUserId: 101,
    })).rejects.toMatchObject({ code: 'ROOM_GENERATION_NOT_FOUND' });
    expect(harness.generation.readOwnedProjection).not.toHaveBeenCalled();

    vi.mocked(harness.generation.readOwnedProjection).mockResolvedValueOnce({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-from-other-owner',
        status: 'completed',
        markdown: '# 不得暴露',
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
        },
      },
    });
    await expect(harness.service.readHistory({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 101,
    })).rejects.toMatchObject({ code: 'ROOM_GENERATION_NOT_FOUND' });
  });

  it('非 active member 不能列出房间历史', async () => {
    const harness = await createHarness();
    const joined = await harness.memberships.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });
    await harness.memberships.leave({
      roomId: 'room-1',
      accountUserId: 202,
      expectedRoomEpoch: joined.roomEpoch,
    });

    await expect(harness.service.list({
      roomId: 'room-1',
      accountUserId: 202,
    })).rejects.toMatchObject({ code: 'ROOM_MEMBERSHIP_REVOKED' });
  });

  it.each([
    [
      '空角色草稿',
      { ...sharedConfig(), battleMode: 'daily', combatants: [] } as ArenaRoomSharedConfig,
      'ROOM_GENERATION_COMBATANTS_EMPTY',
    ],
    [
      '经典模式人数不足',
      {
        ...sharedConfig(),
        combatants: sharedConfig().combatants.slice(0, 1),
      } as ArenaRoomSharedConfig,
      'ROOM_GENERATION_COMBATANTS_INSUFFICIENT',
    ],
    [
      '情景模式缺少主情景',
      {
        ...sharedConfig(),
        battleMode: 'scenario',
        combatants: sharedConfig().combatants.slice(0, 1),
        scenario: null,
      } as ArenaRoomSharedConfig,
      'ROOM_GENERATION_SCENARIO_REQUIRED',
    ],
  ] as const)('%s 可以作为房间草稿保存，但开始生成时在物化/预留/provider 前拒绝', async (
    _label,
    authorityConfig,
    code,
  ) => {
    const harness = await createHarness(authorityConfig);

    await expect(harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(authorityConfig),
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code });

    expect(harness.store.order).toEqual(['checkpoint:config']);
    expect(harness.materializer.materialize).not.toHaveBeenCalled();
    expect(harness.generation.hashSemanticPayload).not.toHaveBeenCalled();
    expect(harness.generation.startFromHostRequest).not.toHaveBeenCalled();
  });

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

  it('controlSeq 已变化时在 materialize 前拒绝生成，覆盖确认后的新 Proposal', async () => {
    const harness = await createHarness();
    await expect(harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: { ...startRequest(), expectedControlSeq: 99 },
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code: 'ROOM_GENERATION_CONFLICT' });
    expect(harness.materializer.materialize).not.toHaveBeenCalled();
    expect(harness.generation.startFromHostRequest).not.toHaveBeenCalled();
  });

  it.each([
    [
      new ArenaRoomGenerationContentResolverError('ARENA_ROOM_REFERENCE_VERSION_MISMATCH'),
      'ROOM_REFERENCE_STALE',
    ],
    [
      new ArenaRoomGenerationMaterializationError(
        'ARENA_ROOM_HOST_LOCAL_PAYLOAD_MISSING',
        { kind: 'combatant', displayName: '星野' },
      ),
      'ROOM_HOST_LOCAL_PAYLOAD_MISSING',
    ],
    [
      new ArenaRoomGenerationMaterializationError(
        'ARENA_ROOM_HOST_LOCAL_PAYLOAD_INVALID',
        { kind: 'room' },
      ),
      'ROOM_HOST_LOCAL_PAYLOAD_INVALID',
    ],
    [
      new ArenaRoomGenerationMaterializationError(
        'ARENA_ROOM_HOST_LOCAL_PAYLOAD_KIND_MISMATCH',
        { kind: 'scenario', displayName: '雨夜' },
      ),
      'ROOM_HOST_LOCAL_KIND_MISMATCH',
    ],
    [
      new ArenaRoomGenerationMaterializationError(
        'ARENA_ROOM_HOST_LOCAL_PAYLOAD_TYPE_MISMATCH',
        { kind: 'combatant', displayName: '星野' },
      ),
      'ROOM_HOST_LOCAL_TYPE_MISMATCH',
    ],
    [
      new ArenaRoomGenerationMaterializationError('ARENA_ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING'),
      'ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING',
    ],
    [
      new ArenaRoomGenerationMaterializationError('ARENA_ROOM_HOST_LOCAL_CONTENT_VERSION_MISMATCH'),
      'ROOM_HOST_LOCAL_DIGEST_MISMATCH',
    ],
  ])('materialization fail closed (%s) 且不 hash/reserve/start provider', async (error, code) => {
    const harness = await createHarness();
    harness.materializer.materialize.mockRejectedValueOnce(error);
    await expect(harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(),
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({
      code,
      target: error instanceof ArenaRoomGenerationMaterializationError
        ? error.target
        : undefined,
    });
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

  it.each([
    ['ARENA_CONTENT_POLICY_REJECTED', 400, 'ROOM_GENERATION_CONFLICT'],
    ['ARENA_REQUEST_TOO_LARGE', 413, 'ROOM_RUNTIME_BODY_LIMIT'],
    ['ARENA_PARTICIPANTS_LIMIT', 400, 'ROOM_GENERATION_COMBATANT_LIMIT'],
    ['ARENA_REFERENCE_ITEMS_LIMIT', 400, 'ROOM_RUNTIME_REFERENCE_LIMIT'],
    ['ARENA_ADJUDICATION_EVENTS_LIMIT', 400, 'ROOM_RUNTIME_ADJUDICATION_LIMIT'],
    ['ARENA_PROMPT_BUDGET_EXCEEDED', 400, 'ROOM_RUNTIME_PROMPT_BUDGET_EXCEEDED'],
    ['ARENA_SAFETY_PROMPT_BUDGET_EXCEEDED', 400, 'ROOM_RUNTIME_PROMPT_BUDGET_EXCEEDED'],
    ['ARENA_CUSTOM_PROVIDER_INVALID', 400, 'ROOM_PROVIDER_CONFIG_INVALID'],
    ['ARENA_PROVIDER_UNKNOWN', 400, 'ROOM_PROVIDER_CONFIG_INVALID'],
    ['ARENA_MODEL_UNKNOWN', 400, 'ROOM_PROVIDER_CONFIG_INVALID'],
    ['ARENA_PROVIDER_KEY_EMPTY', 400, 'ROOM_PROVIDER_CONFIG_INVALID'],
    ['ARENA_PARTICIPANTS_INVALID', 400, 'ROOM_GENERATION_INPUT_INVALID'],
    ['ARENA_PVP_CONTEXT_INVALID', 400, 'ROOM_GENERATION_INPUT_INVALID'],
    ['ARENA_MULTIPLAYER_SNAPSHOT_INVALID', 400, 'ROOM_GENERATION_INPUT_INVALID'],
    ['ARENA_MATERIALIZATION_VERSION_UNSUPPORTED', 400, 'ROOM_GENERATION_INPUT_INVALID'],
    ['GENERATION_REQUEST_CONFLICT', 409, 'ROOM_GENERATION_CONFLICT'],
  ] as const)('definitive downstream rejection %s 终结 Room attempt 并保留具体原因', async (
    downstreamCode,
    status,
    expectedCode,
  ) => {
    const rejected = await createHarness();
    vi.mocked(rejected.generation.startFromHostRequest).mockResolvedValueOnce({
      kind: 'rejected',
      status,
      code: downstreamCode,
    });
    await expect(rejected.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(),
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code: expectedCode });
    expect(rejected.store.state?.snapshot.activeGeneration?.state).toBe('cancelled');
    expect(rejected.publisher.attach).not.toHaveBeenCalled();
  });

  it.each([
    [503, 'GENERATION_RESERVATION_UNAVAILABLE'],
    [400, 'UNKNOWN_DETERMINISM'],
    [429, 'ARENA_PROVIDER_UNKNOWN'],
  ] as const)('%s / %s 不确定拒绝保留 starting 等待对账', async (status, code) => {
    const unknown = await createHarness();
    vi.mocked(unknown.generation.startFromHostRequest).mockResolvedValueOnce({
      kind: 'rejected',
      status,
      code,
    });
    await expect(unknown.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(),
      sourceRequest: sourceRequest(),
    })).rejects.toMatchObject({ code: 'ROOM_OPERATION_UNKNOWN' });
    expect(unknown.store.state?.snapshot.activeGeneration?.state).toBe('starting');
    expect(unknown.publisher.attach).not.toHaveBeenCalled();
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

  it('cancel 重新确认 host/epoch/current generation，并以 trusted owner cancel 后权威 reconcile', async () => {
    const harness = await createHarness();
    const member = await harness.memberships.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });
    await harness.service.start({
      roomId: 'room-1',
      accountUserId: 101,
      request: startRequest(
        sharedConfig(),
        harness.store.state!.snapshot.controlSeq,
      ),
      sourceRequest: sourceRequest(),
    });
    vi.mocked(harness.generation.readOwnedProjection).mockResolvedValue({
      kind: 'found',
      projection: {
        generationId: 'generation-1',
        generationRequestId: 'request-1234',
        status: 'cancelled',
        markdown: '# 不得作为终态正文',
        resumeCursor: null,
        updatedAt: '2026-08-28T00:03:00.000Z',
        finalAuthoritative: true,
        resultAvailable: false,
        generationRecordId: null,
        errorCode: null,
      },
    });

    await expect(harness.service.cancel({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 202,
      request: { expectedRoomEpoch: member.roomEpoch },
    })).rejects.toMatchObject({ code: 'ROOM_PERMISSION_DENIED' });
    await expect(harness.service.cancel({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 101,
      request: { expectedRoomEpoch: 'epoch-stale' },
    })).rejects.toMatchObject({ code: 'ROOM_EPOCH_STALE' });
    await expect(harness.service.cancel({
      roomId: 'room-1',
      generationId: 'generation-other',
      accountUserId: 101,
      request: { expectedRoomEpoch: 'epoch-1' },
    })).rejects.toMatchObject({ code: 'ROOM_GENERATION_NOT_FOUND' });

    const cancelled = await harness.service.cancel({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 101,
      request: { expectedRoomEpoch: 'epoch-1' },
    });
    const duplicate = await harness.service.cancel({
      roomId: 'room-1',
      generationId: 'generation-1',
      accountUserId: 101,
      request: { expectedRoomEpoch: 'epoch-1' },
    });

    expect(harness.generation.cancelOwned).toHaveBeenCalledTimes(1);
    expect(harness.generation.cancelOwned).toHaveBeenCalledWith({
      roomId: 'room-1',
      generationId: 'generation-1',
    });
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      markdown: '',
      generation: { generationId: 'generation-1', state: 'cancelled' },
    });
    expect(duplicate).toEqual(cancelled);
    harness.finishPublisher();
  });

  it('cancel 对 trusted owner mismatch/unavailable fail closed', async () => {
    for (const result of [
      { kind: 'forbidden' as const },
      { kind: 'not-found' as const },
      { kind: 'unavailable' as const, code: 'GENERATION_STATE_UNAVAILABLE' as const },
    ]) {
      const harness = await createHarness();
      await harness.service.start({
        roomId: 'room-1',
        accountUserId: 101,
        request: startRequest(),
        sourceRequest: sourceRequest(),
      });
      vi.mocked(harness.generation.cancelOwned).mockResolvedValueOnce(result);

      await expect(harness.service.cancel({
        roomId: 'room-1',
        generationId: 'generation-1',
        accountUserId: 101,
        request: { expectedRoomEpoch: 'epoch-1' },
      })).rejects.toMatchObject({
        code: result.kind === 'unavailable'
          ? 'ROOM_GENERATION_UNAVAILABLE'
          : 'ROOM_GENERATION_NOT_FOUND',
      });
      harness.finishPublisher();
    }
  });
});
