import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  ArenaMultiplayerGenerationSnapshotSchema,
  ArenaProposalSchema,
  ArenaRoomSnapshotSchema,
  CustomStoryLengthSchema,
  GenerationBridgeBatchSchema,
  GenerationMirrorSchema,
  MAX_PROPOSAL_BYTES,
  MAX_STORY_BATCH_BYTES,
  RoomEventSchema,
  WireErrorMessageSchema,
  WireReasonSchema,
  parseArenaProposal,
} from '@mahoshojo/contracts/arena-room';

const proposal = {
  proposalVersion: 1,
  proposalId: 'proposal-c1',
  roomId: 'room-1',
  authorUserId: 'user-1',
  baseRevision: 1,
  status: 'submitted',
  changes: [{
    changeId: 'change-1',
    type: 'setUserGuidance',
    value: 'guide',
    expectedBase: { kind: 'value', value: '' },
  }],
  createdAt: '2026-08-22T00:00:00.000Z',
} as const;

const fixture = async (name: string): Promise<unknown> => {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
};

describe('spec review C: wire byte limits, frozen generation metadata, and compatibility', () => {
  it('centralizes custom/history/display/error/reason/proposal wire limits', () => {
    expect(MAX_PROPOSAL_BYTES).toBeGreaterThan(0);
    expect(CustomStoryLengthSchema.safeParse('9'.repeat(40)).success).toBe(false);
    expect(WireReasonSchema.safeParse('x'.repeat(201)).success).toBe(false);
    expect(WireErrorMessageSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });

  it('enforces Proposal JSON UTF-8 bytes before parsing', () => {
    const oversized = {
      ...proposal,
      changes: Array.from({ length: 32 }, (_, index) => ({
        ...proposal.changes[0],
        changeId: `change-${index}`,
        dependsOn: Array.from({ length: 32 }, () => 'd'.repeat(256)),
      })),
    };
    expect(ArenaProposalSchema.safeParse(oversized).success).toBe(false);
    expect(() => parseArenaProposal(oversized)).toThrow('payload-too-large');
  });

  it('uses UTF-8 byte limits for room and bridge story deltas', () => {
    const delta = '你'.repeat(Math.ceil(MAX_STORY_BATCH_BYTES / 3));
    expect(new TextEncoder().encode(delta).byteLength).toBeGreaterThan(MAX_STORY_BATCH_BYTES);
    expect(RoomEventSchema.safeParse({
      protocolVersion: 1,
      type: 'story.delta',
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      timestamp: '2026-08-22T00:00:00.000Z',
      generationId: 'generation-1',
      chunkSeq: 1,
      payload: { delta },
    }).success).toBe(false);
    expect(GenerationBridgeBatchSchema.safeParse({
      bridgeVersion: 1,
      roomId: 'room-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      expiresAt: '2026-08-22T00:05:00.000Z',
      batchSeq: 1,
      type: 'story.delta',
      payload: { delta },
    }).success).toBe(false);
  });

  it('freezes SharedConfig and online versions in an Arena generation snapshot', async () => {
    const current = await fixture('arena-room-v1.json') as { sharedConfig: unknown };
    const snapshot = ArenaMultiplayerGenerationSnapshotSchema.parse({
      roomId: 'room-1',
      generationRequestId: 'request-1',
      configRevision: 7,
      snapshotDigest: 'sha256:abc',
      collaborativeInfluence: true,
      participantUserIds: [101, 202],
      sharedConfig: current.sharedConfig,
    });
    expect(snapshot.participantUserIds).toEqual([101, 202]);
    expect(() => ArenaMultiplayerGenerationSnapshotSchema.parse({
      ...snapshot,
      fullPayload: { secret: 'no' },
    })).toThrow();
    expect(() => ArenaMultiplayerGenerationSnapshotSchema.parse({
      ...snapshot,
      provider: 'openai',
    })).toThrow();
  });

  it('carries snapshot digest and participant ids through generation mirror and started event', () => {
    const mirror = GenerationMirrorSchema.parse({
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'starting',
      configRevision: 7,
      snapshotDigest: 'sha256:abc',
      collaborativeInfluence: true,
      participantUserIds: [101, 202],
      startedAt: '2026-08-22T00:00:00.000Z',
    });
    expect(mirror.participantUserIds).toEqual([101, 202]);
    expect(RoomEventSchema.parse({
      protocolVersion: 1,
      type: 'generation.started',
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      timestamp: '2026-08-22T00:00:00.000Z',
      controlSeq: 1,
      payload: {
        generationRequestId: 'request-1',
        generationId: 'generation-1',
        attempt: 1,
        configRevision: 7,
        snapshotDigest: 'sha256:abc',
        collaborativeInfluence: true,
        participantUserIds: [101, 202],
      },
    })).toMatchObject({ type: 'generation.started' });
  });

  it('accepts only current v1 JSON fixtures and explicitly rejects v0/v2 peers', async () => {
    const cases = [
      ['arena-room-v0-unsupported.json', ArenaRoomSnapshotSchema],
      ['arena-room-v1.json', ArenaRoomSnapshotSchema],
      ['arena-room-v2-unsupported.json', ArenaRoomSnapshotSchema],
    ] as const;
    const results = await Promise.all(cases.map(async ([name, schema]) => schema.safeParse(await fixture(name)).success));
    expect(results).toEqual([false, true, false]);

    const eventResults = await Promise.all([
      RoomEventSchema.safeParse(await fixture('room-event-v0-unsupported.json')).success,
      RoomEventSchema.safeParse(await fixture('room-event-v1.json')).success,
      RoomEventSchema.safeParse(await fixture('room-event-v2-unsupported.json')).success,
    ]);
    expect(eventResults).toEqual([false, true, false]);

    const bridgeResults = await Promise.all([
      GenerationBridgeBatchSchema.safeParse(await fixture('generation-bridge-v0-unsupported.json')).success,
      GenerationBridgeBatchSchema.safeParse(await fixture('generation-bridge-v1.json')).success,
      GenerationBridgeBatchSchema.safeParse(await fixture('generation-bridge-v2-unsupported.json')).success,
    ]);
    expect(bridgeResults).toEqual([false, true, false]);
  });
});
