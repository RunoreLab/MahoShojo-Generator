import { describe, expect, it, vi } from 'vitest';

import type {
  ArenaGenerationApplicationService,
  GenerationStreamEvent,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { canonicalizeNodeArenaGenerationSemanticPayload } from '@mahoshojo/hosted-runtime/arena-generation';
import { createArenaRoomGenerationSnapshot } from '#/arena-room/room-generation-snapshot';
import {
  createArenaRoomGenerationPort,
  hashArenaRoomGenerationPayload,
} from '#/arena-generation/room-generation-port';
import { createArenaRoomState } from './arena-room-fixtures';

const eventStream = (events: readonly GenerationStreamEvent[]) => new ReadableStream({
  start(controller) {
    for (const event of events) controller.enqueue(event);
    controller.close();
  },
});

const readAll = async <T>(stream: ReadableStream<T>): Promise<T[]> => {
  const values: T[] = [];
  const reader = stream.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    values.push(next.value);
  }
  return values;
};

const canonicalizeSemanticPayload = (input: {
  payload: Readonly<Record<string, unknown>>;
  trustedInternalGuidance: string;
  trustedPvpContext: Readonly<{ roomId: string; matchId: string; roundId: string }>;
}) => canonicalizeNodeArenaGenerationSemanticPayload({
  payload: input.payload,
  signatures: {
    generateSignature: async () => null,
    verifySignature: async (value) => Boolean(
      value
      && typeof value === 'object'
      && (value as { signature?: unknown }).signature === 'valid'
    ),
  },
  trustedInternalGuidance: input.trustedInternalGuidance,
  trustedPvpContext: input.trustedPvpContext,
});

describe('Arena Room generation internal port', () => {
  it('binds the Room retry digest to server-normalized semantic payload without hashing secrets', async () => {
    const generationRequestId = 'request-room-digest-1';
    const multiplayerSnapshot = createArenaRoomGenerationSnapshot(
      createArenaRoomState(),
      generationRequestId,
    );
    const input = {
      roomId: multiplayerSnapshot.roomId,
      generationRequestId,
      payload: {
        combatants: [{
          type: 'magical-girl',
          isNative: false,
          data: { name: 'A', signature: 'valid' },
        }],
        internalGuidance: 'client-forged-guidance',
        pvpContext: { roomId: 'forged-room', matchId: 'forged', roundId: 'forged' },
        customProvider: { apiKey: 'provider-secret-one' },
      },
      internalGuidance: 'server-owned-guidance',
      pvpContext: { matchId: 'match-1', roundId: 'round-1' },
      multiplayerSnapshot,
    } as const;

    const digest = await hashArenaRoomGenerationPayload(input, canonicalizeSemanticPayload);
    await expect(hashArenaRoomGenerationPayload({
      ...input,
      payload: {
        ...input.payload,
        customProvider: { apiKey: 'provider-secret-two' },
      },
    }, canonicalizeSemanticPayload)).resolves.toBe(digest);
    await expect(hashArenaRoomGenerationPayload({
      ...input,
      payload: { ...input.payload, mode: 'scenario' },
    }, canonicalizeSemanticPayload)).resolves.not.toBe(digest);
    await expect(hashArenaRoomGenerationPayload({
      ...input,
      payload: {
        ...input.payload,
        combatants: [{
          type: 'magical-girl',
          isNative: true,
          data: { name: 'A', signature: 'valid' },
        }],
      },
    }, canonicalizeSemanticPayload)).resolves.toBe(digest);
    await expect(hashArenaRoomGenerationPayload({
      ...input,
      payload: {
        ...input.payload,
        combatants: [{
          type: 'magical-girl',
          isNative: true,
          data: { name: 'A', signature: 'forged' },
        }],
      },
    }, canonicalizeSemanticPayload)).resolves.not.toBe(digest);
    await expect(hashArenaRoomGenerationPayload({
      ...input,
      payload: {
        ...input.payload,
        mode: 'classic',
        language: 'zh-CN',
        readArenaHistory: true,
        writeArenaHistory: true,
        readCurrentState: true,
        writeCurrentState: true,
        readNarrativeHistory: false,
        arenaFreeRankingEnabled: false,
      },
    }, canonicalizeSemanticPayload)).resolves.toBe(digest);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(digest).not.toContain('provider-secret');
  });

  it('starts a direct body-bound PVP subscription with original auth/signal and owned snapshot', async () => {
    const generationRequestId = 'request-room-start-1';
    const multiplayerSnapshot = createArenaRoomGenerationSnapshot(
      createArenaRoomState(),
      generationRequestId,
    );
    const controller = new AbortController();
    let receivedRequest: Request | null = null;
    const generationService = {
      createSubscription: vi.fn(async (request: Request) => {
        receivedRequest = request;
        return {
          generationId: 'arena_generation_1',
          generationRequestId,
          headers: { 'x-private-provider-diagnostic': 'must-not-escape' },
          events: eventStream([
            { id: '1-0', type: 'markdown', data: { chunk: '安全正文' } },
            { id: '1-1', type: 'reasoning', data: { chunk: 'private reasoning' } },
            {
              id: '1-2',
              type: 'snapshot',
              data: {
                status: 'running',
                markdown: '安全正文',
                reasoning: 'private snapshot reasoning',
                telemetry: { providerRequestId: 'private-provider-request' },
                lastEventId: '1-1',
                updatedAt: '2026-08-28T11:00:00.000Z',
              },
            },
            {
              id: '1-3',
              type: 'done',
              data: { status: 'completed', ok: true, resultRef: 'r2:private/key' },
            },
          ]),
        };
      }),
    } as unknown as ArenaGenerationApplicationService;
    const pvpSign = vi.fn(async (_input: {
      generationRequestId: string;
      payload: Readonly<Record<string, unknown>>;
    }) => 'pvp-body-signature');
    const guidanceSign = vi.fn(async () => 'guidance-signature');
    const port = createArenaRoomGenerationPort({
      generationService,
      pvpAuthority: { sign: pvpSign },
      internalGuidanceAuthority: { sign: guidanceSign },
      deriveGenerationId: vi.fn(async () => 'arena_generation_1'),
      canonicalizeSemanticPayload,
    });
    const hostRequest = new Request('https://example.test/api/arena/rooms/room-1/generation', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer host-token',
        'x-mahoshojo-user-activity': 'activity-proof',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ client: 'body must not be forwarded' }),
      signal: controller.signal,
    });

    const result = await port.startFromHostRequest({
      request: hostRequest,
      roomId: multiplayerSnapshot.roomId,
      generationRequestId,
      payload: {
        mode: 'classic',
        generationRequestId: 'request-client-forged',
        internalGuidance: 'client-forged-guidance',
        pvpContext: { roomId: 'forged-room', matchId: 'forged', roundId: 'forged' },
        multiplayerGenerationSnapshot: { roomId: 'forged-room' },
      },
      internalGuidance: 'server-owned-guidance',
      pvpContext: { matchId: 'match-1', roundId: 'round-1' },
      multiplayerSnapshot,
    });

    expect(result.kind).toBe('subscribed');
    expect(receivedRequest).not.toBeNull();
    expect(receivedRequest!.headers.get('authorization')).toBe('Bearer host-token');
    expect(receivedRequest!.headers.get('x-mahoshojo-user-activity')).toBe('activity-proof');
    expect(receivedRequest!.headers.get('x-mahoshojo-arena-pvp-generation-signature'))
      .toBe('pvp-body-signature');
    expect(receivedRequest!.headers.get('x-mahoshojo-arena-internal-guidance-signature'))
      .toBe('guidance-signature');
    const body = await receivedRequest!.clone().json();
    expect(body).toMatchObject({
      generationRequestId,
      mode: 'classic',
      internalGuidance: 'server-owned-guidance',
      pvpContext: { roomId: multiplayerSnapshot.roomId, matchId: 'match-1', roundId: 'round-1' },
      multiplayerGenerationSnapshot: multiplayerSnapshot,
    });
    expect(pvpSign).toHaveBeenCalledWith({
      generationRequestId,
      payload: expect.objectContaining({
        internalGuidance: 'server-owned-guidance',
        multiplayerGenerationSnapshot: multiplayerSnapshot,
      }),
    });
    expect(pvpSign.mock.calls[0]?.[0].payload).not.toHaveProperty('generationRequestId');
    controller.abort('host disconnected');
    expect(receivedRequest!.signal.aborted).toBe(true);

    if (result.kind !== 'subscribed') throw new Error('expected subscription');
    const events = await readAll(result.subscription.events);
    expect(events).toEqual([
      { id: '1-0', type: 'markdown', chunk: '安全正文' },
      {
        id: '1-2',
        type: 'snapshot',
        status: 'running',
        markdown: '安全正文',
        updatedAt: '2026-08-28T11:00:00.000Z',
        lastEventId: '1-1',
      },
      {
        id: '1-3',
        type: 'done',
        status: 'completed',
        generationRecordId: 'arena_generation_1',
        resultAvailable: true,
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/reasoning|telemetry|provider|r2:/u);
  });

  it('fixes actor ownership for deterministic id, read, and resume without exposing diagnostics', async () => {
    const generationService = {
      readOwnedProjection: vi.fn(async () => ({
        kind: 'found' as const,
        projection: {
          generationId: 'arena_generation_1',
          generationRequestId: 'request-room-resume-1',
          status: 'running' as const,
          markdown: 'baseline',
          resumeCursor: '4-0',
          updatedAt: '2026-08-28T11:00:00.000Z',
          finalAuthoritative: false,
          resultAvailable: false,
          generationRecordId: null,
          errorCode: null,
          reasoning: 'hidden reasoning despite an unsound adapter',
          providerDiagnostic: { requestId: 'hidden-provider-request' },
        },
      })),
      resumeOwnedSubscription: vi.fn(async () => ({
        kind: 'subscribed' as const,
        subscription: {
          generationId: 'arena_generation_1',
          generationRequestId: 'request-room-resume-1',
          headers: { 'x-private-provider-diagnostic': 'hidden' },
          events: eventStream([
            { id: '5-0', type: 'telemetry', data: { providerRequestId: 'hidden' } },
            { id: '5-1', type: 'markdown', data: { chunk: 'resumed' } },
          ]),
        },
      })),
    } as unknown as ArenaGenerationApplicationService;
    const deriveGenerationId = vi.fn(async () => 'arena_generation_1');
    const port = createArenaRoomGenerationPort({
      generationService,
      pvpAuthority: { sign: vi.fn() },
      internalGuidanceAuthority: { sign: vi.fn() },
      deriveGenerationId,
      canonicalizeSemanticPayload,
    });

    await expect(port.deriveGenerationId({
      roomId: 'room-1',
      generationRequestId: 'request-room-resume-1',
    })).resolves.toBe('arena_generation_1');
    const projection = await port.readOwnedProjection({
      roomId: 'room-1',
      generationId: 'arena_generation_1',
    });
    expect(projection).toMatchObject({ kind: 'found', projection: { markdown: 'baseline' } });
    expect(JSON.stringify(projection)).not.toMatch(/reasoning|provider/u);
    const resumed = await port.resumeOwnedSubscription({
      roomId: 'room-1',
      generationId: 'arena_generation_1',
      after: '4-0',
    });

    expect(deriveGenerationId).toHaveBeenCalledWith({
      actorKey: 'pvp-room:room-1',
      generationRequestId: 'request-room-resume-1',
    });
    expect(generationService.readOwnedProjection).toHaveBeenCalledWith({
      actorKey: 'pvp-room:room-1',
      generationId: 'arena_generation_1',
    });
    expect(generationService.resumeOwnedSubscription).toHaveBeenCalledWith({
      actorKey: 'pvp-room:room-1',
      generationId: 'arena_generation_1',
      after: '4-0',
    });
    if (resumed.kind !== 'subscribed') throw new Error('expected subscription');
    await expect(readAll(resumed.subscription.events)).resolves.toEqual([
      { id: '5-1', type: 'markdown', chunk: 'resumed' },
    ]);
  });
});
