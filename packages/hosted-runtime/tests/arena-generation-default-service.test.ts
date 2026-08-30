import { describe, expect, it, vi } from 'vitest';
import { createMemoryGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/memory-replay-store';
import { createUnavailableGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/unavailable-replay-store';

import {
  canonicalizeArenaGenerationPayload,
  createNodeArenaGenerationService,
  deriveArenaGenerationId,
  hashArenaGenerationPayload,
} from '../src/arena-generation/default-service';

describe('Arena generation default service primitives', () => {
  it('canonicalizes nested object keys without reordering arrays', async () => {
    const left = { z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }, 3] };
    const right = { list: [{ x: 1, y: 2 }, 3], nested: { a: 1, b: 2 }, z: 1 };

    expect(canonicalizeArenaGenerationPayload(left)).toBe(
      canonicalizeArenaGenerationPayload(right),
    );
    await expect(hashArenaGenerationPayload(left)).resolves.toBe(
      await hashArenaGenerationPayload(right),
    );
  });

  it('derives a stable actor-scoped generation identity', async () => {
    const input = { actorKey: 'user:42', generationRequestId: 'request-1234' };
    const generationId = await deriveArenaGenerationId(input);

    expect(generationId).toMatch(/^arena_[a-f0-9]{64}$/u);
    await expect(deriveArenaGenerationId(input)).resolves.toBe(generationId);
    await expect(deriveArenaGenerationId({ ...input, actorKey: 'user:43' }))
      .resolves.not.toBe(generationId);
  });

  it('passes the rejected-terminal recorder into the shared generation service', async () => {
    const record = vi.fn(async () => ({ kind: 'recorded' as const }));
    const memoryStore = createMemoryGenerationReplayStore();
    const reserve = vi.fn(memoryStore.reserve.bind(memoryStore));
    const markTerminal = vi.fn(memoryStore.markTerminal.bind(memoryStore));
    const store = { ...memoryStore, reserve, markTerminal };
    const service = createNodeArenaGenerationService({
      store,
      executor: {
        materializationVersion: 'test-v1',
        preflight: vi.fn(async () => ({
          kind: 'auditable-rejection' as const,
          response: Response.json({ error: 'rejected' }, { status: 400 }),
          actorKey: 'user:42',
          generationRequestId: 'pvp_request_1234',
          code: 'ARENA_CONTENT_POLICY_REJECTED',
          stage: 'safety-policy',
          fingerprintPayload: { mode: 'classic' },
          audit: {
            endpoint: 'api/generate-battle-story',
            generationMode: 'non-stream' as const,
            startedAt: '2026-08-25T04:00:00.000Z',
            mode: 'classic',
            pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
          },
        })),
        materialize: vi.fn(),
        execute: vi.fn(async () => ({ status: 'completed' as const })),
      },
      rejectedTerminalRecorder: { record },
      resolveActor: vi.fn(async () => ({ actorKey: 'user:42' })),
      getD1Client: () => null,
    });
    const response = await service.create(new Request(
      'https://example.test/api/generate-battle-story',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationRequestId: 'pvp_request_1234' }),
      },
    ));

    expect(response.status).toBe(400);
    expect(response.headers.get('x-mahoshojo-generation-id')).toMatch(/^arena_[a-f0-9]{64}$/u);
    expect(response.headers.get('x-mahoshojo-generation-terminal-status')).toBe('failed');
    expect(record).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(markTerminal).toHaveBeenCalledWith(expect.objectContaining({
      terminal: {
        status: 'failed',
        code: 'ARENA_CONTENT_POLICY_REJECTED',
      },
      terminalEvent: expect.objectContaining({ type: 'error' }),
      terminalSnapshot: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('fails soft without auditing when the shared terminal identity fence is unavailable', async () => {
    const record = vi.fn(async () => ({ kind: 'recorded' as const }));
    const service = createNodeArenaGenerationService({
      store: createUnavailableGenerationReplayStore(),
      executor: {
        materializationVersion: 'test-v1',
        preflight: vi.fn(async () => ({
          kind: 'auditable-rejection' as const,
          response: Response.json({ error: 'rejected' }, { status: 400 }),
          actorKey: 'user:42',
          generationRequestId: 'pvp_request_1234',
          code: 'ARENA_CONTENT_POLICY_REJECTED',
          stage: 'safety-policy',
          fingerprintPayload: { mode: 'classic' },
          audit: {
            endpoint: 'api/generate-battle-story',
            generationMode: 'non-stream' as const,
            startedAt: '2026-08-25T04:00:00.000Z',
            mode: 'classic',
            pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
          },
        })),
        materialize: vi.fn(),
        execute: vi.fn(async () => ({ status: 'completed' as const })),
      },
      rejectedTerminalRecorder: { record },
      resolveActor: vi.fn(async () => ({ actorKey: 'user:42' })),
      getD1Client: () => null,
    });

    const response = await service.create(new Request(
      'https://example.test/api/generate-battle-story',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationRequestId: 'pvp_request_1234' }),
      },
    ));

    expect(response.status).toBe(400);
    expect(response.headers.get('x-mahoshojo-generation-id')).toBeNull();
    expect(response.headers.get('x-mahoshojo-generation-terminal-status')).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });
});
