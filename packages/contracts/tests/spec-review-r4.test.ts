import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expectTypeOf } from 'vitest';

import {
  ArenaContractError,
  ArenaErrorSchema,
  GenerationBridgeBatchSchema,
  isGenerationBridgeBatchSequenceMonotonic,
  parseControlMessage,
  parseControlMessageFrame,
} from '@mahoshojo/contracts/arena-room';
import type { ControlRoomEvent, GenerationBridgeBatch, RoomEvent } from '@mahoshojo/contracts/arena-room';

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

const fixture = async (name: string): Promise<unknown> => {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
};

describe('spec review R4: final public type and fixture invariants', () => {
  it('narrows control parser results to the non-story RoomEvent subset', () => {
    expectTypeOf<ReturnType<typeof parseControlMessage>>().toEqualTypeOf<ControlRoomEvent>();
    expectTypeOf<ReturnType<typeof parseControlMessageFrame>>().toEqualTypeOf<ControlRoomEvent>();
    expectTypeOf<ControlRoomEvent>().toMatchTypeOf<RoomEvent>();
    expectTypeOf<Extract<ControlRoomEvent, { type: 'story.delta' }>>().toBeNever();
  });

  it('makes the deprecated monotonic helper compare complete scope including expiry', () => {
    const first = GenerationBridgeBatchSchema.parse(bridgeBatch);
    const differentExpiry = GenerationBridgeBatchSchema.parse({ ...bridgeBatch, expiresAt: '2026-08-22T00:06:00.000Z' });
    expect(isGenerationBridgeBatchSequenceMonotonic(first, { ...first, batchSeq: 2 })).toBe(true);
    expect(isGenerationBridgeBatchSequenceMonotonic(first, { ...differentExpiry, batchSeq: 2 })).toBe(false);
    const scoped: Pick<GenerationBridgeBatch, 'bridgeVersion' | 'roomId' | 'generationRequestId' | 'generationId' | 'attempt' | 'expiresAt' | 'batchSeq'> = first;
    expect(scoped.expiresAt).toBe(first.expiresAt);
  });

  it('serializes ArenaContractError through only the public ArenaError shape', () => {
    const internal = { provider: 'secret-provider', zodInput: { apiKey: 'secret' } };
    const error = new ArenaContractError('validation-failed', 'invalid payload', 'request-1', internal);
    const serialized = JSON.stringify(error);
    expect(Object.keys(error)).not.toContain('cause');
    expect(serialized).not.toContain('secret-provider');
    expect(serialized).not.toContain('apiKey');
    expect(ArenaErrorSchema.parse(JSON.parse(serialized))).toEqual({
      code: 'validation-failed',
      message: 'invalid payload',
      requestId: 'request-1',
    });

    const withoutOptionalFields = JSON.stringify(new ArenaContractError('payload-too-large', undefined, undefined, internal));
    expect(JSON.parse(withoutOptionalFields)).toEqual({ code: 'payload-too-large' });
  });

  it('keeps unsupported room fixtures payload-identical to v1 after version normalization', async () => {
    const v1 = await fixture('arena-room-v1.json') as Record<string, unknown>;
    const v0 = await fixture('arena-room-v0-unsupported.json') as Record<string, unknown>;
    const v2 = await fixture('arena-room-v2-unsupported.json') as Record<string, unknown>;
    const normalizeVersion = (snapshot: Record<string, unknown>): Record<string, unknown> => ({
      ...snapshot,
      protocolVersion: v1.protocolVersion,
      schemaVersion: v1.schemaVersion,
    });
    expect(normalizeVersion(v0)).toEqual(v1);
    expect(normalizeVersion(v2)).toEqual(v1);
  });
});
