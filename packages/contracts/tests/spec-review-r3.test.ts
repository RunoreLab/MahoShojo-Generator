import { expectTypeOf } from 'vitest';
import { z } from 'zod';

import {
  AbsentExpectedBaseSchema,
  ArenaContractError,
  ArenaRoomSnapshotSchema,
  CharacterDataCardRefSchema,
  MAX_CONTROL_FRAME_BYTES,
  MAX_GENERATION_BRIDGE_BATCH_BYTES,
  MAX_STORY_FRAME_BYTES,
  PresentExpectedBaseSchema,
  RemoveAuxScenarioChangeSchema,
  RemoveCombatantChangeSchema,
  RemoveMaterialChangeSchema,
  SetScenarioChangeSchema,
  classifyGenerationBridgeBatchReplay,
  parseControlMessage,
  parseControlMessageFrame,
  parseGenerationBridgeBatchFrame,
  parseRoomEventFrame,
  parseStoryEvent,
  parseStoryEventFrame,
  rawUtf8ByteLength,
} from '@mahoshojo/contracts/arena-room';

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

const sharedConfig = {
  battleMode: 'classic',
  combatants: [{
    key: 'data-card:c1',
    ref: { id: 'c1', kind: 'character', versionToken: 'v1' },
    characterGuidance: 'guide',
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'standard',
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings,
} as const;

const makeProposal = (proposalId: string, roomId = 'room-1', authorUserId = 'host-1') => ({
  proposalVersion: 1,
  proposalId,
  roomId,
  authorUserId,
  baseRevision: 1,
  status: 'submitted',
  changes: [{
    changeId: `${proposalId}-change`,
    type: 'setUserGuidance',
    value: 'guide',
    expectedBase: { kind: 'value', value: '' },
  }],
  createdAt: '2026-08-22T00:00:00.000Z',
} as const);

const makeSnapshot = (overrides: Record<string, unknown> = {}) => ({
  protocolVersion: 1,
  schemaVersion: 1,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  controlSeq: 1,
  revision: 1,
  sharedConfig,
  members: [
    { userId: 'host-1', role: 'host', displayName: 'Host', membershipState: 'active' },
    { userId: 'member-1', role: 'member', displayName: 'Member', membershipState: 'active' },
  ],
  proposals: [],
  activeGeneration: null,
  ...overrides,
});

const storyEvent = (delta = 'chunk') => ({
  protocolVersion: 1,
  type: 'story.delta',
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  generationId: 'generation-1',
  chunkSeq: 1,
  timestamp: '2026-08-22T00:00:00.000Z',
  payload: { delta },
} as const);

const controlEvent = {
  protocolVersion: 1,
  type: 'room.closing',
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  controlSeq: 1,
  timestamp: '2026-08-22T00:00:00.000Z',
  payload: { reason: 'done' },
} as const;

const bridgeBatch = {
  bridgeVersion: 1,
  roomId: 'room-1',
  generationRequestId: 'request-1',
  generationId: 'generation-1',
  attempt: 1,
  expiresAt: '2026-08-22T00:05:00.000Z',
  batchSeq: 1,
  type: 'story.delta',
  payload: { delta: 'chunk' },
} as const;

const hostCombatant = {
  key: 'host-local:combatant-1',
  displayName: 'Local fighter',
  type: 'magical-girl',
  source: 'host-local',
  characterGuidance: 'guide',
} as const;
const hostScenario = {
  key: 'host-local:scenario-1',
  displayName: 'Local scenario',
  type: 'scenario',
  source: 'host-local',
  guidance: 'guide',
} as const;
const hostMaterial = {
  key: 'host-local:material-1',
  displayName: 'Local material',
  type: 'material',
  source: 'host-local',
  guidance: 'guide',
} as const;

describe('spec review R3: proposal identity, snapshot membership, and raw frames', () => {
  it('allows only an online or null proposed scenario while preserving host-local expectedBase', () => {
    const proposedHostLocal = {
      changeId: 'set-scenario-host',
      type: 'setScenario',
      ref: hostScenario,
      expectedBase: { kind: 'ref', ref: hostScenario },
    } as const;
    expect(SetScenarioChangeSchema.safeParse(proposedHostLocal).success).toBe(false);

    const expectedHostLocal = {
      ...proposedHostLocal,
      ref: null,
      expectedBase: { kind: 'ref', ref: hostScenario },
    } as const;
    expect(SetScenarioChangeSchema.safeParse(expectedHostLocal).success).toBe(true);
    expect(SetScenarioChangeSchema.safeParse({
      ...expectedHostLocal,
      ref: { id: 'scenario-1', kind: 'scenario', versionToken: 'v1' },
      expectedBase: { kind: 'ref', ref: null },
    }).success).toBe(true);
  });

  it('requires proposal room, unique id, known author, and exactly one active host', () => {
    const valid = makeSnapshot({ proposals: [makeProposal('proposal-1')] });
    expect(ArenaRoomSnapshotSchema.safeParse(valid).success).toBe(true);
    expect(ArenaRoomSnapshotSchema.safeParse({ ...valid, proposals: [makeProposal('proposal-1', 'other-room')] }).success).toBe(false);
    expect(ArenaRoomSnapshotSchema.safeParse({ ...valid, proposals: [makeProposal('proposal-1'), makeProposal('proposal-1')] }).success).toBe(false);
    expect(ArenaRoomSnapshotSchema.safeParse({ ...valid, proposals: [makeProposal('proposal-1', 'room-1', 'unknown-user')] }).success).toBe(false);
    expect(ArenaRoomSnapshotSchema.safeParse({
      ...valid,
      members: [{ userId: 'member-1', role: 'member', displayName: 'Member', membershipState: 'active' }],
    }).success).toBe(false);
    expect(ArenaRoomSnapshotSchema.safeParse({
      ...valid,
      members: [
        { userId: 'host-1', role: 'host', displayName: 'Host', membershipState: 'active' },
        { userId: 'host-2', role: 'host', displayName: 'Host 2', membershipState: 'active' },
      ],
    }).success).toBe(false);
    expect(ArenaRoomSnapshotSchema.safeParse({
      ...valid,
      members: [
        { userId: 'host-1', role: 'host', displayName: 'Host', membershipState: 'revoked' },
        { userId: 'host-2', role: 'host', displayName: 'Host 2', membershipState: 'active' },
      ],
    }).success).toBe(true);
  });

  it('uses explicit absent preconditions and matches remove targets to expected refs', () => {
    expect(AbsentExpectedBaseSchema.safeParse({ kind: 'absent', key: 'data-card:c1' }).success).toBe(false);

    const removeCases = [
      {
        schema: RemoveCombatantChangeSchema,
        valid: { changeId: 'remove-c', type: 'removeCombatant', combatantKey: 'data-card:c1', expectedBase: { kind: 'present', ref: { id: 'c1', kind: 'character', versionToken: 'v1' } } },
        mismatch: { changeId: 'remove-c', type: 'removeCombatant', combatantKey: 'data-card:other', expectedBase: { kind: 'present', ref: { id: 'c1', kind: 'character', versionToken: 'v1' } } },
        hostValid: { changeId: 'remove-c-host', type: 'removeCombatant', combatantKey: hostCombatant.key, expectedBase: { kind: 'present', ref: hostCombatant } },
        hostMismatch: { changeId: 'remove-c-host', type: 'removeCombatant', combatantKey: 'host-local:other', expectedBase: { kind: 'present', ref: hostCombatant } },
      },
      {
        schema: RemoveAuxScenarioChangeSchema,
        valid: { changeId: 'remove-s', type: 'removeAuxScenario', scenarioKey: 'data-card:s1', expectedBase: { kind: 'present', ref: { id: 's1', kind: 'scenario', versionToken: 'v1' } } },
        mismatch: { changeId: 'remove-s', type: 'removeAuxScenario', scenarioKey: 'preset:other', expectedBase: { kind: 'present', ref: { id: 's1', kind: 'scenario', versionToken: 'v1' } } },
        hostValid: { changeId: 'remove-s-host', type: 'removeAuxScenario', scenarioKey: hostScenario.key, expectedBase: { kind: 'present', ref: hostScenario } },
        hostMismatch: { changeId: 'remove-s-host', type: 'removeAuxScenario', scenarioKey: 'host-local:other', expectedBase: { kind: 'present', ref: hostScenario } },
      },
      {
        schema: RemoveMaterialChangeSchema,
        valid: { changeId: 'remove-m', type: 'removeMaterial', materialKey: 'preset:m1', expectedBase: { kind: 'present', ref: { id: 'm1', kind: 'material', versionToken: 'v1' } } },
        mismatch: { changeId: 'remove-m', type: 'removeMaterial', materialKey: 'data-card:other', expectedBase: { kind: 'present', ref: { id: 'm1', kind: 'material', versionToken: 'v1' } } },
        hostValid: { changeId: 'remove-m-host', type: 'removeMaterial', materialKey: hostMaterial.key, expectedBase: { kind: 'present', ref: hostMaterial } },
        hostMismatch: { changeId: 'remove-m-host', type: 'removeMaterial', materialKey: 'host-local:other', expectedBase: { kind: 'present', ref: hostMaterial } },
      },
    ] as const;
    for (const removeCase of removeCases) {
      expect(removeCase.schema.safeParse(removeCase.valid).success).toBe(true);
      expect(removeCase.schema.safeParse(removeCase.mismatch).success).toBe(false);
      expect(removeCase.schema.safeParse(removeCase.hostValid).success).toBe(true);
      expect(removeCase.schema.safeParse(removeCase.hostMismatch).success).toBe(false);
    }
  });

  it('separates control and story object parsers with stable invalid-message errors', () => {
    expect(() => parseControlMessage(storyEvent())).toThrow(ArenaContractError);
    try {
      parseControlMessage(storyEvent());
    } catch (error) {
      expect((error as ArenaContractError).code).toBe('invalid-message');
    }
    expect(parseStoryEvent(storyEvent()).type).toBe('story.delta');
    expect(() => parseStoryEvent(controlEvent)).toThrow(ArenaContractError);
    try {
      parseStoryEvent(controlEvent);
    } catch (error) {
      expect((error as ArenaContractError).code).toBe('invalid-message');
    }
  });

  it('counts raw UTF-8 bytes before decoding JSON, including whitespace, escapes, and multibyte text', () => {
    const controlJson = JSON.stringify(controlEvent);
    const oversizedWhitespace = `${' '.repeat(MAX_CONTROL_FRAME_BYTES + 1)}${controlJson}`;
    expect(rawUtf8ByteLength(oversizedWhitespace)).toBeGreaterThan(MAX_CONTROL_FRAME_BYTES);
    expect(() => parseRoomEventFrame(oversizedWhitespace)).toThrow(ArenaContractError);
    try {
      parseRoomEventFrame(oversizedWhitespace);
    } catch (error) {
      expect((error as ArenaContractError).code).toBe('payload-too-large');
    }

    const escapedDelta = '\\u0061'.repeat(12000);
    const escapedFrame = JSON.stringify(storyEvent('')).replace('"delta":""', `"delta":"${escapedDelta}"`);
    expect(rawUtf8ByteLength(escapedFrame)).toBeGreaterThan(MAX_STORY_FRAME_BYTES);
    expect(() => parseStoryEventFrame(escapedFrame)).toThrow(ArenaContractError);

    const multibyteFrame = new TextEncoder().encode(JSON.stringify(storyEvent('你'.repeat(Math.floor(MAX_STORY_FRAME_BYTES / 3)))));
    expect(multibyteFrame.byteLength).toBeGreaterThan(MAX_STORY_FRAME_BYTES);
    expect(() => parseStoryEventFrame(multibyteFrame)).toThrow(ArenaContractError);

    expect(parseRoomEventFrame(JSON.stringify(storyEvent()))).toMatchObject({ type: 'story.delta' });
    expect(parseControlMessageFrame(new TextEncoder().encode(controlJson))).toMatchObject({ type: 'room.closing' });
    expect(() => parseControlMessageFrame(JSON.stringify(storyEvent()))).toThrow(ArenaContractError);
    expect(parseGenerationBridgeBatchFrame(JSON.stringify(bridgeBatch))).toMatchObject({ type: 'story.delta' });
    const oversizedBridgeWhitespace = `${' '.repeat(MAX_GENERATION_BRIDGE_BATCH_BYTES + 1)}${JSON.stringify(bridgeBatch)}`;
    expect(() => parseGenerationBridgeBatchFrame(oversizedBridgeWhitespace)).toThrow(ArenaContractError);
    const multibyteBridgeFrame = new TextEncoder().encode(JSON.stringify({ ...bridgeBatch, payload: { delta: '你'.repeat(Math.floor(MAX_GENERATION_BRIDGE_BATCH_BYTES / 3)) } }));
    expect(multibyteBridgeFrame.byteLength).toBeGreaterThan(MAX_GENERATION_BRIDGE_BATCH_BYTES);
    expect(() => parseGenerationBridgeBatchFrame(multibyteBridgeFrame)).toThrow(ArenaContractError);
    expect(() => parseRoomEventFrame('{"broken"')).toThrow(ArenaContractError);
  });

  it('includes expiry in bridge scope replay classification', async () => {
    const { GenerationBridgeBatchSchema } = await import('@mahoshojo/contracts/arena-room');
    const first = GenerationBridgeBatchSchema.parse(bridgeBatch);
    const differentExpiry = GenerationBridgeBatchSchema.parse({ ...bridgeBatch, expiresAt: '2026-08-22T00:06:00.000Z' });
    expect(classifyGenerationBridgeBatchReplay(first, differentExpiry)).toBe('scope-mismatch');
  });

  it('keeps inferred refs concrete rather than any or unknown', () => {
    const schema = PresentExpectedBaseSchema(CharacterDataCardRefSchema);
    type RefOutput = z.output<typeof schema>['ref'];
    expectTypeOf<RefOutput>().not.toBeAny();
    expectTypeOf<RefOutput>().not.toBeUnknown();
    // @ts-expect-error A wire ref cannot be a number.
    const invalidRef: RefOutput = 123;
    void invalidRef;
  });
});
