import { describe, expect, it } from 'vitest';

import { createMemoryGenerationReplayStore } from '../src/arena-generation/memory-replay-store';

const reserve = (store: ReturnType<typeof createMemoryGenerationReplayStore>) => store.reserve({
  actorKey: 'user:1',
  generationRequestId: 'request-1',
  generationId: 'generation-1',
  payloadHash: 'hash-1',
  now: '2026-08-25T00:00:00.000Z',
  leaseExpiresAt: '2026-08-25T00:01:00.000Z',
});

describe('memory generation replay store', () => {
  it('keeps reservation idempotent and owner-scoped', async () => {
    const store = createMemoryGenerationReplayStore();
    await expect(reserve(store)).resolves.toMatchObject({ kind: 'created' });
    await expect(reserve(store)).resolves.toEqual({
      kind: 'reused',
      generationId: 'generation-1',
    });
    await expect(store.readState({
      generationId: 'generation-1',
      actorKey: 'user:2',
    })).resolves.toBeNull();
  });

  it('reports trimmed cursors without silently appending from the wrong point', async () => {
    const store = createMemoryGenerationReplayStore({ maxEvents: 2 });
    await reserve(store);
    await store.appendEvents({
      generationId: 'generation-1',
      events: [
        { type: 'markdown', data: { chunk: 'a' } },
        { type: 'markdown', data: { chunk: 'b' } },
        { type: 'markdown', data: { chunk: 'c' } },
      ],
      now: '2026-08-25T00:00:01.000Z',
    });
    await expect(store.readAfter({
      generationId: 'generation-1',
      after: '1-0',
      blockMs: 0,
    })).resolves.toMatchObject({
      kind: 'window-lost',
      events: [{ id: '2-0' }, { id: '3-0' }],
    });
    await expect(store.readAfter({
      generationId: 'generation-1',
      after: '2-0',
      blockMs: 0,
    })).resolves.toMatchObject({ kind: 'events', events: [{ id: '3-0' }] });
  });
});
