import {
  ArenaContractError,
  ArenaErrorSchema,
  ArenaMultiplayerGenerationSnapshotSchema,
  ArenaProposalSchema,
  ArenaRoomSharedConfigSchema,
  ArenaRoomSnapshotSchema,
  CharacterDataCardRefSchema,
  GenerationBridgeBatchSchema,
  GenerationMirrorSchema,
  MAX_GENERATION_BRIDGE_BATCH_BYTES,
  MAX_PROPOSAL_BYTES,
  MAX_STORY_FRAME_BYTES,
  PresentExpectedBaseSchema,
  RemoveCombatantChangeSchema,
  RoomEventSchema,
  classifyGenerationBridgeBatchReplay,
  parseArenaProposal,
  parseGenerationBridgeBatch,
  parseRoomEvent,
} from '@mahoshojo/contracts/arena-room';
import { expectTypeOf } from 'vitest';
import { z } from 'zod';

const historySettings = {
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
} as const;

const onlineCharacter = {
  key: 'data-card:c1',
  ref: { id: 'c1', kind: 'character', versionToken: 'v1' },
  characterGuidance: 'protect',
} as const;

const hostCharacter = {
  key: 'host-local:host-c1',
  displayName: 'Local character',
  type: 'magical-girl',
  source: 'host-local',
  characterGuidance: 'local guidance',
} as const;

const sharedConfig = {
  battleMode: 'classic',
  combatants: [onlineCharacter],
  teams: [],
  scenario: {
    key: 'preset:scenario-1',
    ref: { id: 'scenario-1', kind: 'scenario', versionToken: 'v1' },
  },
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'standard',
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings,
} as const;

const proposal = (status: 'submitted' | 'stale' = 'submitted', proposalId = 'proposal-1') => ({
  proposalVersion: 1,
  proposalId,
  roomId: 'room-1',
  authorUserId: 'user-1',
  baseRevision: 1,
  status,
  changes: [{
    changeId: `${proposalId}-change`,
    type: 'setUserGuidance',
    value: 'guide',
    expectedBase: { kind: 'value', value: '' },
  }],
  createdAt: '2026-08-22T00:00:00.000Z',
} as const);

const controlEvent = {
  protocolVersion: 1,
  type: 'room.closing',
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  controlSeq: 1,
  timestamp: '2026-08-22T00:00:00.000Z',
  payload: { reason: 'closing' },
} as const;

const storyEvent = (delta: string) => ({
  protocolVersion: 1,
  type: 'story.delta',
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  generationId: 'generation-1',
  chunkSeq: 1,
  timestamp: '2026-08-22T00:00:00.000Z',
  payload: { delta },
} as const);

const bridgeBatch = (batchSeq = 1, delta = 'hello') => ({
  bridgeVersion: 1,
  roomId: 'room-1',
  generationRequestId: 'request-1',
  generationId: 'generation-1',
  attempt: 1,
  expiresAt: '2026-08-22T00:05:00.000Z',
  batchSeq,
  type: 'story.delta',
  payload: { delta },
} as const);

describe('spec review R2: public type, canonical identity, and graph invariants', () => {
  it('preserves the concrete output type of PresentExpectedBaseSchema', () => {
    const schema = PresentExpectedBaseSchema(CharacterDataCardRefSchema);
    expectTypeOf<z.output<typeof schema>['ref']>().not.toBeAny();
    expectTypeOf<z.output<typeof schema>['ref']>().not.toBeUnknown();
    type RemovalExpectedRef = z.output<typeof RemoveCombatantChangeSchema>['expectedBase']['ref'];
    expectTypeOf<RemovalExpectedRef>().not.toBeAny();
    expectTypeOf<RemovalExpectedRef>().not.toBeUnknown();
    // @ts-expect-error A removal expected ref cannot be a number.
    const invalidRemovalRef: RemovalExpectedRef = 123;
    void invalidRemovalRef;
  });

  it('uses exact online keys and direct host-local stubs', () => {
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...sharedConfig,
      combatants: [{ ...onlineCharacter, key: 'data-card:other-id' }],
    }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...sharedConfig,
      combatants: [hostCharacter],
    }).success).toBe(true);
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...sharedConfig,
      combatants: [{ key: hostCharacter.key, stub: hostCharacter }],
    }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...sharedConfig,
      combatants: [{ ...hostCharacter, characterGuidance: undefined, guidance: 'duplicate' }],
    }).success).toBe(false);
  });

  it('rejects wrong-kind refs in each ref-or-host primitive', async () => {
    const { CombatantRefOrHostStubSchema, MaterialRefOrHostStubSchema, ScenarioRefOrHostStubSchema } = await import('@mahoshojo/contracts/arena-room');
    expect(CombatantRefOrHostStubSchema.safeParse({ id: 's1', kind: 'scenario', versionToken: 'v1' }).success).toBe(false);
    expect(ScenarioRefOrHostStubSchema.safeParse({ id: 'm1', kind: 'material', versionToken: 'v1' }).success).toBe(false);
    expect(MaterialRefOrHostStubSchema.safeParse({ id: 'c1', kind: 'character', versionToken: 'v1' }).success).toBe(false);
  });

  it('uses flat control and story cursors and checks mirrored room identity', () => {
    const snapshot = {
      protocolVersion: 1,
      schemaVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 4,
      revision: 1,
      sharedConfig,
      members: [{ userId: 'user-1', role: 'host', displayName: 'Host', membershipState: 'active' }],
      proposals: [],
      activeGeneration: null,
    } as const;
    expect(ArenaRoomSnapshotSchema.safeParse({ ...snapshot, controlCursor: { roomEpoch: 'epoch-1', controlSeq: 4 } }).success).toBe(false);
    expect(ArenaRoomSnapshotSchema.safeParse(snapshot).success).toBe(true);

    expect(RoomEventSchema.safeParse(controlEvent).success).toBe(true);
    expect(RoomEventSchema.safeParse({ ...controlEvent, controlCursor: { roomEpoch: 'epoch-1', controlSeq: 1 } }).success).toBe(false);
    expect(RoomEventSchema.safeParse(storyEvent('chunk')).success).toBe(true);
    expect(RoomEventSchema.safeParse({ ...storyEvent('chunk'), storyCursor: { generationId: 'generation-1', chunkSeq: 1 } }).success).toBe(false);

    expect(RoomEventSchema.safeParse({
      ...controlEvent,
      type: 'room.snapshot',
      payload: { ...snapshot, roomId: 'other-room' },
    }).success).toBe(false);
    expect(RoomEventSchema.safeParse({
      ...controlEvent,
      type: 'proposal.submitted',
      payload: { proposal: { ...proposal(), roomId: 'other-room' } },
    }).success).toBe(false);
  });

  it('exposes a strict machine-readable error and wraps parser failures', () => {
    expect(ArenaErrorSchema.safeParse({ code: 'generation-failed', message: 'failed', requestId: 'request-1' }).success).toBe(true);
    expect(ArenaErrorSchema.safeParse({ code: 'generation-failed', provider: 'secret-provider' }).success).toBe(false);
    try {
      parseArenaProposal({});
      throw new Error('expected parser failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ArenaContractError);
      expect((error as ArenaContractError).code).toBe('validation-failed');
    }
  });

  it('applies complete UTF-8 frame limits, including envelope overhead', () => {
    const storyDelta = 'x'.repeat(MAX_STORY_FRAME_BYTES - 1);
    expect(new TextEncoder().encode(storyDelta).byteLength).toBeLessThanOrEqual(MAX_STORY_FRAME_BYTES);
    expect(RoomEventSchema.safeParse(storyEvent(storyDelta)).success).toBe(false);
    const bridgeDelta = 'x'.repeat(MAX_GENERATION_BRIDGE_BATCH_BYTES - 1);
    expect(new TextEncoder().encode(bridgeDelta).byteLength).toBeLessThanOrEqual(MAX_GENERATION_BRIDGE_BATCH_BYTES);
    expect(GenerationBridgeBatchSchema.safeParse(bridgeBatch(1, bridgeDelta)).success).toBe(false);
    expect(RoomEventSchema.safeParse(storyEvent('你'.repeat(Math.floor(MAX_STORY_FRAME_BYTES / 3)))).success).toBe(false);
  });

  it('rejects duplicate dependencies and dependency cycles', () => {
    const duplicate = {
      ...proposal(),
      changes: [{
        changeId: 'a',
        type: 'setUserGuidance',
        value: 'x',
        expectedBase: { kind: 'value', value: '' },
        dependsOn: ['b', 'b'],
      }],
    } as const;
    expect(ArenaProposalSchema.safeParse(duplicate).success).toBe(false);
    const cycle = {
      ...proposal(),
      changes: [
        { changeId: 'a', type: 'setUserGuidance', value: 'x', expectedBase: { kind: 'value', value: '' }, dependsOn: ['b'] },
        { changeId: 'b', type: 'setUserGuidance', value: 'y', expectedBase: { kind: 'value', value: '' }, dependsOn: ['a'] },
      ],
    } as const;
    expect(ArenaProposalSchema.safeParse(cycle).success).toBe(false);
  });

  it('does not count stale proposals against pending quota', () => {
    const snapshot = {
      protocolVersion: 1,
      schemaVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 4,
      revision: 1,
      sharedConfig,
      members: [{ userId: 'user-1', role: 'host', displayName: 'Host', membershipState: 'active' }],
      proposals: Array.from({ length: 9 }, (_, index) => proposal('stale', `proposal-${index}`)),
      activeGeneration: null,
    } as const;
    expect(ArenaRoomSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('uses configRevision and keeps generation snapshots derived from sharedConfig', () => {
    const snapshot = {
      roomId: 'room-1',
      generationRequestId: 'request-1',
      configRevision: 1,
      snapshotDigest: 'sha256:abc',
      collaborativeInfluence: true,
      participantUserIds: [101, 202],
      sharedConfig,
    } as const;
    expect(ArenaMultiplayerGenerationSnapshotSchema.safeParse({ ...snapshot, onlineRefs: [] }).success).toBe(false);
    expect(ArenaMultiplayerGenerationSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(GenerationMirrorSchema.safeParse({
      generationRequestId: 'request-1', generationId: 'generation-1', attempt: 1, state: 'starting',
      configRevision: 1, snapshotDigest: 'sha256:abc', collaborativeInfluence: true,
      participantUserIds: [101, 202], startedAt: '2026-08-22T00:00:00.000Z',
    }).success).toBe(true);
    expect(RoomEventSchema.safeParse(storyEvent('chunk')).success).toBe(true);
  });

  it('classifies bridge replay by scope, sequence, and canonical full batch', () => {
    const first = GenerationBridgeBatchSchema.parse(bridgeBatch());
    expect(classifyGenerationBridgeBatchReplay(first, GenerationBridgeBatchSchema.parse(bridgeBatch(2, 'next')))).toBe('next');
    expect(classifyGenerationBridgeBatchReplay(first, first)).toBe('idempotent-replay');
    expect(classifyGenerationBridgeBatchReplay(first, GenerationBridgeBatchSchema.parse(bridgeBatch(1, 'different')))).toBe('conflicting-replay');
    expect(classifyGenerationBridgeBatchReplay(first, GenerationBridgeBatchSchema.parse(bridgeBatch(0, 'old')))).toBe('stale');
    expect(classifyGenerationBridgeBatchReplay(first, GenerationBridgeBatchSchema.parse(bridgeBatch(3, 'gap')))).toBe('out-of-order');
    expect(classifyGenerationBridgeBatchReplay(first, GenerationBridgeBatchSchema.parse({ ...bridgeBatch(), roomId: 'other-room' }))).toBe('scope-mismatch');
  });

  it('uses generation-failed as a typed terminal error code', () => {
    expect(RoomEventSchema.safeParse({
      protocolVersion: 1,
      type: 'generation.failed',
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 2,
      timestamp: '2026-08-22T00:00:00.000Z',
      payload: {
        generationRequestId: 'request-1', generationId: 'generation-1', attempt: 1,
        configRevision: 1, snapshotDigest: 'sha256:abc', collaborativeInfluence: true,
        participantUserIds: [101], errorCode: 'generation-failed',
      },
    }).success).toBe(true);
    expect(GenerationBridgeBatchSchema.safeParse({ ...bridgeBatch(), type: 'generation.failed', payload: { errorCode: 'generation-failed' } }).success).toBe(true);
  });

  it('keeps parser byte constants observable for contract consumers', () => {
    expect(MAX_PROPOSAL_BYTES).toBeGreaterThan(0);
    expect(parseGenerationBridgeBatch(bridgeBatch()).batchSeq).toBe(1);
    expect(parseRoomEvent(controlEvent).type).toBe('room.closing');
  });
});
