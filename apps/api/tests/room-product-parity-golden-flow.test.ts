import { describe, expect, it, vi } from 'vitest';

import type { ArenaRoomGenerationPort } from '#/arena-generation/room-generation-port';
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
import type { RoomGenerationPublisher } from '#/arena-room/room-generation-publisher';
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
    const materializer = createArenaRoomGenerationMaterializer({
      content: {
        resolveOnline: vi.fn(async ({ ref }) => canonicalContent.get(ref.id)!),
        resolvePreset: vi.fn(async () => { throw new Error('golden flow 不使用 preset'); }),
      },
    });
    const providerStart = vi.fn<ArenaRoomGenerationPort['startFromHostRequest']>(async () => ({
      kind: 'subscribed' as const,
      subscription: {
        generationId: 'generation-golden',
        generationRequestId: 'request-golden',
        events: new ReadableStream({ start(controller) { controller.close(); } }),
      },
    }));
    const generation = {
      cancelOwned: vi.fn(async () => ({ kind: 'accepted' as const, cancelReason: 'user' as const })),
      deriveGenerationId: vi.fn(async () => 'generation-golden'),
      hashSemanticPayload: vi.fn(async () => `sha256:${'a'.repeat(64)}`),
      startFromHostRequest: providerStart,
      readOwnedProjection: vi.fn(async () => ({ kind: 'not-found' as const })),
      resumeOwnedSubscription: vi.fn(async () => ({ kind: 'not-found' as const })),
    } satisfies ArenaRoomGenerationPort;
    const publisher = {
      attach: vi.fn(() => new Promise<never>(() => undefined)),
      getProgress: vi.fn(() => ({ markdown: '', nextChunkSeq: 0 })),
    } satisfies RoomGenerationPublisher;
    const generations = createArenaRoomGenerationService({
      memberships,
      materializer,
      generation,
      createPublisher: () => publisher,
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
    await generations.start({
      roomId: host.roomId,
      accountUserId: 101,
      request,
      sourceRequest: new Request('https://api.example.test/arena-room-generation'),
    });

    expect(providerStart).toHaveBeenCalledTimes(1);
    expect(providerStart).toHaveBeenCalledWith(expect.objectContaining({
      roomId: host.roomId,
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
      }),
      multiplayerSnapshot: expect.objectContaining({
        configRevision: 1,
        sharedConfig: acceptedConfig(),
        participantUserIds: [101, 202],
      }),
    }));
    expect(store.state?.snapshot.activeGeneration).toMatchObject({
      generationId: 'generation-golden',
      configRevision: 1,
      state: 'starting',
    });
    expect(JSON.stringify(store.state)).not.toContain('provider-secret-golden-canary');
  });
});
