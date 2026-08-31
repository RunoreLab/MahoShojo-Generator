import { describe, expect, it, vi } from 'vitest';

import {
  createArenaGenerationService,
  type ArenaGenerationExecutor,
  type ArenaGenerationTerminalStore,
} from '@mahoshojo/hosted-api/arena-generation/service';
import {
  createMemoryGenerationReplayStore,
} from '@mahoshojo/hosted-api/arena-generation/memory-replay-store';
import {
  canonicalizeNodeArenaGenerationSemanticPayload,
  deriveArenaGenerationId,
  hashArenaGenerationPayload,
} from '@mahoshojo/hosted-runtime/arena-generation';

import { createArenaRoomGenerationPort } from '#/arena-generation/room-generation-port';
import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import {
  createArenaRoomGenerationMaterializer,
  type ArenaRoomGenerationCanonicalContent,
} from '#/arena-room/room-generation-materializer';
import { createArenaRoomGenerationService } from '#/arena-room/room-generation-service';
import { createArenaRoomMembershipService } from '#/arena-room/room-membership-service';
import { createArenaRoomProposalService } from '#/arena-room/room-proposal-service';
import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  diffArenaSharedConfig,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;

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
    return { kind: 'saved' as const };
  }

  async refresh() {
    return { kind: 'refreshed' as const };
  }
}

const baseConfig = () => ({
  battleMode: 'classic' as const,
  combatants: [{
    key: 'data-card:character-1',
    ref: { id: 'character-1', kind: 'character' as const, versionToken: 'character-v1' },
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

const acceptedConfig = () => {
  const base = baseConfig();
  return {
    ...base,
    battleMode: 'scenario' as const,
    combatants: [
      { ...base.combatants[0]!, characterGuidance: '守住北门' },
      {
        key: 'data-card:character-2',
        ref: { id: 'character-2', kind: 'character' as const, versionToken: 'character-v2' },
        characterGuidance: '支援前线',
      },
    ],
    teams: [{
      key: 'team:guardians',
      displayName: '守护队',
      combatantKeys: ['data-card:character-1', 'data-card:character-2'],
    }],
    scenario: {
      key: 'data-card:scenario-1',
      ref: { id: 'scenario-1', kind: 'scenario' as const, versionToken: 'scenario-v1' },
    },
    materials: [{
      key: 'data-card:material-1',
      ref: { id: 'material-1', kind: 'material' as const, versionToken: 'material-v1' },
    }],
    userGuidance: '以协作守城为主线',
    selectedLanguage: 'ja-JP',
    historySettings: {
      ...base.historySettings,
      readArenaHistoryLimit: 5,
    },
  };
};

const canonical = (
  id: string,
  kind: 'character' | 'scenario' | 'material',
  versionToken: string,
  displayName: string,
  payload: Record<string, unknown>,
): ArenaRoomGenerationCanonicalContent => ({
  ref: { id, kind, versionToken },
  displayName,
  payload,
});

describe('GMR-10P-G product parity golden flow', () => {
  it('accepted Proposal 进入 frozen authority 与 exact materialization，duplicate start 只执行一次 Provider', async () => {
    const store = new MemoryRoomStore();
    let userIndex = 0;
    let timestampIndex = 0;
    const timestamps = [
      '2026-08-31T00:00:00.000Z',
      '2026-08-31T00:01:00.000Z',
      '2026-08-31T00:02:00.000Z',
      '2026-08-31T00:03:00.000Z',
      '2026-08-31T00:04:00.000Z',
    ];
    const actors = createRoomActorRegistry({
      store,
      createRoomIdentity: () => ({ roomId: 'room-golden', roomEpoch: 'epoch-golden' }),
      createTimestamp: () => timestamps[0]!,
      now: () => Date.parse(timestamps[Math.min(timestampIndex, timestamps.length - 1)]!),
    });
    const memberships = createArenaRoomMembershipService({
      actors,
      createUserId: () => `user-${++userIndex}`,
      now: () => timestamps[Math.min(++timestampIndex, timestamps.length - 1)]!,
    });
    const host = await memberships.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: baseConfig(),
    });
    await memberships.join({
      roomId: host.roomId,
      accountUserId: 202,
      displayName: 'Member',
    });

    const references = {
      verify: vi.fn(async (input) => input.refs),
    };
    const proposals = createArenaRoomProposalService({
      memberships,
      references,
      now: () => timestamps[Math.min(++timestampIndex, timestamps.length - 1)]!,
    });
    const changes = diffArenaSharedConfig(baseConfig(), acceptedConfig());
    expect(new Set(changes.map((change) => change.type))).toEqual(new Set([
      'addCombatant',
      'setCharacterGuidance',
      'addTeam',
      'assignTeam',
      'setBattleMode',
      'setSelectedLanguage',
      'setScenario',
      'addMaterial',
      'setUserGuidance',
      'setHistorySettings',
    ]));

    await proposals.submit({
      roomId: host.roomId,
      accountUserId: 202,
      request: {
        proposalId: 'proposal-golden',
        expectedRoomEpoch: host.roomEpoch,
        baseRevision: 0,
        changes,
      },
    });
    await proposals.resolve({
      roomId: host.roomId,
      proposalId: 'proposal-golden',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: host.roomEpoch,
        expectedRevision: 0,
        resolution: 'accept-selected',
        selectedChangeIds: changes.map((change) => change.changeId),
      },
    });

    expect(store.state?.snapshot).toMatchObject({
      revision: 1,
      sharedConfig: acceptedConfig(),
      proposals: [],
    });
    expect(references.verify).toHaveBeenLastCalledWith({
      hostAccountUserId: 101,
      refs: expect.arrayContaining([
        { id: 'character-2', kind: 'character', versionToken: 'character-v2' },
        { id: 'scenario-1', kind: 'scenario', versionToken: 'scenario-v1' },
        { id: 'material-1', kind: 'material', versionToken: 'material-v1' },
      ]),
    });

    const canonicalContent = new Map<string, ArenaRoomGenerationCanonicalContent>([
      ['character-1', canonical(
        'character-1', 'character', 'character-v1', '角色一', { name: '角色一', content: '角色一正文' },
      )],
      ['character-2', canonical(
        'character-2', 'character', 'character-v2', '角色二', { name: '角色二', content: '角色二正文' },
      )],
      ['scenario-1', canonical(
        'scenario-1', 'scenario', 'scenario-v1', '守城战', { title: '守城战', content: '情景正文' },
      )],
      ['material-1', canonical(
        'material-1', 'material', 'material-v1', '城防图', { title: '城防图', content: '素材正文' },
      )],
    ]);
    const resolveOnline = vi.fn(async ({ ref }: {
      ref: { id: string; kind: 'character' | 'scenario' | 'material'; versionToken: string };
    }) => canonicalContent.get(ref.id)!);
    const materializer = createArenaRoomGenerationMaterializer({
      content: {
        resolveOnline,
        resolvePreset: vi.fn(async () => { throw new Error('golden flow 不使用 preset'); }),
      },
    });
    const replayStore = createMemoryGenerationReplayStore({
      now: () => Date.parse(timestamps[4]!),
    });
    const roomSafeResult = {
      version: 1 as const,
      format: 'stream-markdown' as const,
      mode: 'scenario' as const,
      scenarioDisplayName: '守城战',
      sharedGuidance: '以协作守城为主线',
      characterGuidances: [
        {
          combatantKey: 'data-card:character-1',
          displayName: '角色一',
          guidance: '守住北门',
        },
        {
          combatantKey: 'data-card:character-2',
          displayName: '角色二',
          guidance: '支援前线',
        },
      ],
      language: 'ja-JP',
      storyLength: 'standard',
      report: { headline: '守护队守住北门', winner: '守护队' },
      combatantUpdates: [{
        combatantKey: 'data-card:character-1',
        displayName: '角色一',
        impact: '守住北门并保护队友',
      }],
    };
    let releaseProvider!: () => void;
    let markProviderStarted!: () => void;
    const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const providerStarted = new Promise<void>((resolve) => { markProviderStarted = resolve; });
    const hostedExecute = vi.fn<ArenaGenerationExecutor['execute']>(async (input) => {
      markProviderStarted();
      await input.emit({ type: 'markdown', data: { chunk: '# 守护队守住北门\n' } });
      await providerGate;
      return { status: 'completed', resultRef: 'r2:generation-golden' };
    });
    const terminalStore = {
      async readOwnedTerminal({ generationId, actorKey }) {
        const state = await replayStore.readState({ generationId, actorKey });
        if (state?.status !== 'completed' || state.terminal?.status !== 'completed') return null;
        return {
          generationId: state.generationId,
          generationRequestId: state.generationRequestId,
          status: 'completed' as const,
          updatedAt: state.updatedAt,
          resultRef: state.terminal.resultRef ?? null,
          markdown: state.snapshot?.markdown ?? '',
          reasoning: state.snapshot?.reasoning ?? '',
          payloadHash: state.payloadHash,
          contentAvailable: true,
          roomSafeResult,
        };
      },
    } satisfies ArenaGenerationTerminalStore;
    const hostedGeneration = createArenaGenerationService({
      store: replayStore,
      terminalStore,
      executor: { execute: hostedExecute },
      resolveActor: async () => ({ actorKey: `pvp-room:${host.roomId}` }),
      deriveGenerationId: deriveArenaGenerationId,
      hashPayload: hashArenaGenerationPayload,
      now: () => new Date(timestamps[4]!),
      replayPollMs: 1,
      deltaFlushIntervalMs: 1,
      deltaFlushBytes: 1,
    });
    const generation = createArenaRoomGenerationPort({
      generationService: hostedGeneration,
      pvpAuthority: { sign: async () => 'golden-pvp-signature' },
      internalGuidanceAuthority: { sign: async () => 'golden-guidance-signature' },
      deriveGenerationId: deriveArenaGenerationId,
      canonicalizeSemanticPayload: (input) => canonicalizeNodeArenaGenerationSemanticPayload({
        payload: input.payload,
        signatures: {
          generateSignature: async () => null,
          verifySignature: async () => false,
        },
        trustedInternalGuidance: input.trustedInternalGuidance,
        trustedPvpContext: input.trustedPvpContext,
      }),
    });
    const generations = createArenaRoomGenerationService({
      memberships,
      materializer,
      generation,
      now: () => timestamps[4]!,
    });
    const request = {
      expectedRoomEpoch: host.roomEpoch,
      expectedRevision: 1,
      generationRequestId: 'request-golden',
      sharedConfig: acceptedConfig(),
      hostLocalPayloads: [],
      generation: {
        customProvider: { apiKey: 'provider-secret-golden-canary' },
      },
    };

    await generations.start({
      roomId: host.roomId,
      accountUserId: 101,
      request,
      sourceRequest: new Request('https://api.example.test/arena-room-generation'),
    });
    await providerStarted;
    await generations.start({
      roomId: host.roomId,
      accountUserId: 101,
      request,
      sourceRequest: new Request('https://api.example.test/arena-room-generation'),
    });

    expect(hostedExecute).toHaveBeenCalledTimes(1);
    expect(resolveOnline.mock.calls.map(([input]) => input.ref)).toEqual([
      { id: 'character-1', kind: 'character', versionToken: 'character-v1' },
      { id: 'character-2', kind: 'character', versionToken: 'character-v2' },
      { id: 'scenario-1', kind: 'scenario', versionToken: 'scenario-v1' },
      { id: 'material-1', kind: 'material', versionToken: 'material-v1' },
    ]);
    expect(hostedExecute).toHaveBeenCalledWith(expect.objectContaining({
      actorKey: `pvp-room:${host.roomId}`,
      generationRequestId: 'request-golden',
      payload: expect.objectContaining({
        mode: 'scenario',
        userGuidance: '以协作守城为主线',
        language: 'ja-JP',
        arenaHistoryReadLimit: 5,
        scenario: { title: '守城战', content: '情景正文' },
        materials: [expect.objectContaining({ name: '城防图' })],
        combatants: [
          expect.objectContaining({ characterGuidance: '守住北门', teamId: 1 }),
          expect.objectContaining({ characterGuidance: '支援前线', teamId: 1 }),
        ],
        teamNames: { 1: '守护队' },
        customProvider: { apiKey: 'provider-secret-golden-canary' },
        multiplayerGenerationSnapshot: expect.objectContaining({
          configRevision: 1,
          sharedConfig: acceptedConfig(),
          participantUserIds: [101, 202],
        }),
      }),
    }));
    releaseProvider();
    const generationId = await generation.deriveGenerationId({
      roomId: host.roomId,
      generationRequestId: 'request-golden',
    });
    const completedProjection = await vi.waitFor(async () => {
      const result = await generation.readOwnedProjection({ roomId: host.roomId, generationId });
      expect(result).toMatchObject({
        kind: 'found',
        projection: {
          status: 'completed',
          markdown: '# 守护队守住北门\n',
          finalAuthoritative: true,
          resultAvailable: true,
          generationRecordId: generationId,
          roomSafeResult,
        },
      });
      return result;
    });
    expect(completedProjection).toMatchObject({ kind: 'found' });

    const hostView = await generations.read({
      roomId: host.roomId,
      generationId,
      accountUserId: 101,
    });
    const memberView = await generations.read({
      roomId: host.roomId,
      generationId,
      accountUserId: 202,
    });
    expect(hostView).toMatchObject({
      status: 'completed',
      markdown: '# 守护队守住北门\n',
      finalAuthoritative: true,
      generationRecordId: generationId,
      result: roomSafeResult,
    });
    expect(memberView).toEqual(hostView);
    expect(store.state?.snapshot.activeGeneration).toMatchObject({
      generationId,
      configRevision: 1,
      state: 'completed',
    });
    expect(store.state?.generationLedger).toContainEqual(expect.objectContaining({
      generationRecordId: generationId,
      mirror: expect.objectContaining({ generationId, state: 'completed' }),
    }));
    expect(JSON.stringify(store.state)).not.toContain('provider-secret-golden-canary');
  });
});
