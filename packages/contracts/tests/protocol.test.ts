import {
  ArenaErrorCode,
  GenerationBridgeBatchSchema,
  RoomControlCursorSchema,
  RoomEventSchema,
  StoryStreamCursorSchema,
  isGenerationBridgeBatchSequenceMonotonic,
  isPeerVersionCompatible,
} from '@mahoshojo/contracts/arena-room';

const cursor = { roomEpoch: 'epoch-1', controlSeq: 12 } as const;

describe('versioned room protocol', () => {
  it('keeps control and story cursors separate', () => {
    expect(RoomControlCursorSchema.parse(cursor)).toEqual(cursor);
    expect(StoryStreamCursorSchema.parse({ generationId: 'generation-1', chunkSeq: 3 })).toEqual({ generationId: 'generation-1', chunkSeq: 3 });

    expect(() => RoomEventSchema.parse({
      protocolVersion: 1,
      type: 'story.delta',
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      timestamp: '2026-08-22T00:00:00.000Z',
      controlCursor: cursor,
      storyCursor: { generationId: 'generation-1', chunkSeq: 3 },
      payload: { generationId: 'generation-1', delta: 'chunk' },
    })).toThrow();

    expect(RoomEventSchema.parse({
      protocolVersion: 1,
      type: 'story.delta',
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      timestamp: '2026-08-22T00:00:00.000Z',
      generationId: 'generation-1',
      chunkSeq: 3,
      payload: { delta: 'chunk' },
    })).toMatchObject({ type: 'story.delta' });
  });

  it('rejects unsupported old/new peers explicitly', async () => {
    const oldPeer = (await import('./fixtures/peer-v0-unsupported.json')).default;
    const newPeer = (await import('./fixtures/peer-v2-unsupported.json')).default;
    const currentPeer = (await import('./fixtures/peer-v1-compatible.json')).default;
    expect(isPeerVersionCompatible(currentPeer)).toBe(true);
    expect(isPeerVersionCompatible(oldPeer)).toBe(false);
    expect(isPeerVersionCompatible(newPeer)).toBe(false);
  });

  it('validates bridge scope, expiry, attempt and monotonic batch sequence without secrets', () => {
    const first = GenerationBridgeBatchSchema.parse({
      bridgeVersion: 1,
      roomId: 'room-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      expiresAt: '2026-08-22T00:05:00.000Z',
      batchSeq: 1,
      type: 'story.delta',
      payload: { delta: 'hello' },
    });
    const second = { ...first, batchSeq: 2 };
    expect(isGenerationBridgeBatchSequenceMonotonic(first, second)).toBe(true);
    expect(isGenerationBridgeBatchSequenceMonotonic(second, { ...second, batchSeq: 2 })).toBe(false);
    expect(() => GenerationBridgeBatchSchema.parse({ ...first, attempt: 0 })).toThrow();
    expect(() => GenerationBridgeBatchSchema.parse({ ...first, apiKey: 'secret' })).toThrow();
  });

  it('exports stable semantic error codes', () => {
    expect(Object.values(ArenaErrorCode.enum)).toEqual(expect.arrayContaining([
      'unauthorized',
      'forbidden',
      'capability-denied',
      'stale',
      'precondition-failed',
      'reference-changed',
      'protocol-incompatible',
      'payload-too-large',
      'rate-limited',
      'duplicate',
      'not-found',
      'room-closed',
    ]));
  });
});
