import { describe, expect, it, vi } from 'vitest';

import { MAX_STORY_FRAME_BYTES } from '@mahoshojo/contracts/arena-room';
import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  issueArenaRoomGenerationPublisherAuthority,
  issueArenaRoomGenerationReservationAuthority,
  issueArenaRoomTrustedTime,
  type ArenaRoomAuthorityState,
  type ArenaRoomCheckpointCommitData,
} from '@mahoshojo/multiplayer-core';
import {
  createRoomActorRegistry,
  type RoomActor,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import {
  createRoomGenerationPublisher,
} from '#/arena-room/room-generation-publisher';
import type {
  ArenaRoomGenerationEvent,
  ArenaRoomGenerationSubscription,
} from '#/arena-generation/room-generation-port';
import { createArenaRoomState } from './arena-room-fixtures';

const ROOM_ID = 'room-1';
const ROOM_EPOCH = 'epoch-1';
const GENERATION_REQUEST_ID = 'generation-request-1';
const GENERATION_ID = 'generation-1';
const EXPIRES_AT = '2026-08-28T01:00:00.000Z';
const SNAPSHOT_DIGEST = `sha256:${'a'.repeat(64)}`;

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;
  saveCalls = 0;

  async load(roomId: string): Promise<ArenaRoomAuthorityState | null> {
    return this.state?.snapshot.roomId === roomId ? structuredClone(this.state) : null;
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
    const commit: ArenaRoomCheckpointCommitData = consumeArenaRoomCheckpointCommit(input.commit);
    this.saveCalls += 1;
    if (commit.predecessor === null) {
      if (this.state !== null) return { kind: 'conflict' as const };
    } else if (
      this.state === null
      || JSON.stringify(this.state) !== JSON.stringify(commit.predecessorState)
      || JSON.stringify(checkpointPredecessorOf(this.state)) !== JSON.stringify(commit.predecessor)
    ) {
      return { kind: 'conflict' as const };
    }
    this.state = structuredClone(commit.nextState);
    return { kind: 'saved' as const };
  }

  async refresh(input: { checkpoint: ArenaRoomAuthorityState }) {
    return JSON.stringify(this.state) === JSON.stringify(input.checkpoint)
      ? { kind: 'refreshed' as const }
      : { kind: 'conflict' as const };
  }
}

type StoryPublishingActor = RoomActor & {
  publishStory(input: {
    readonly authority: unknown;
    readonly event: unknown;
    readonly trustedTime: unknown;
  }): Promise<unknown>;
};

const createRunningActor = async (options: { running?: boolean } = {}) => {
  const store = new MemoryRoomStore();
  let now = Date.parse('2026-08-28T00:00:00.000Z');
  const actors = createRoomActorRegistry({
    store,
    createRoomIdentity: () => ({ roomId: ROOM_ID, roomEpoch: ROOM_EPOCH }),
    createTimestamp: () => new Date(now).toISOString(),
    now: () => now,
  });
  await actors.create({
    host: { userId: 'host-1', displayName: 'Host' },
    sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    authority: {
      kind: 'authenticated-user',
      actorUserId: 'host-1',
      accountUserId: 101,
    },
  });
  const actor = actors.get(ROOM_ID);
  if (!actor) throw new Error('expected RoomActor');

  now = Date.parse('2026-08-28T00:01:00.000Z');
  const reservation = await actor.execute({
    authority: issueArenaRoomGenerationReservationAuthority({
      actorUserId: 'host-1',
      accountUserId: 101,
      roomId: ROOM_ID,
      roomEpoch: ROOM_EPOCH,
      configRevision: 0,
      generationRequestId: GENERATION_REQUEST_ID,
      generationId: GENERATION_ID,
      attempt: 1,
      snapshotDigest: SNAPSHOT_DIGEST,
      generationPayloadDigest: `sha256:${'d'.repeat(64)}`,
      expiresAt: EXPIRES_AT,
    }),
    command: {
      type: 'reserve-generation',
      expectedRoomEpoch: ROOM_EPOCH,
      expectedRevision: 0,
      generationRequestId: GENERATION_REQUEST_ID,
      generationId: GENERATION_ID,
      attempt: 1,
      generationPayloadDigest: `sha256:${'d'.repeat(64)}`,
      timestamp: new Date(now).toISOString(),
    },
    trustedTime: issueArenaRoomTrustedTime({ now: new Date(now).toISOString() }),
  });
  expect(reservation).toMatchObject({ ok: true, kind: 'applied' });

  if (options.running !== false) {
    now = Date.parse('2026-08-28T00:02:00.000Z');
    const started = await actor.execute({
      authority: issueArenaRoomGenerationPublisherAuthority({
        roomId: ROOM_ID,
        roomEpoch: ROOM_EPOCH,
        generationRequestId: GENERATION_REQUEST_ID,
        generationId: GENERATION_ID,
        attempt: 1,
        expiresAt: EXPIRES_AT,
      }),
      command: {
        type: 'mirror-generation',
        expectedRoomEpoch: ROOM_EPOCH,
        generationRequestId: GENERATION_REQUEST_ID,
        generationId: GENERATION_ID,
        attempt: 1,
        state: 'running',
        timestamp: new Date(now).toISOString(),
      },
      trustedTime: issueArenaRoomTrustedTime({ now: new Date(now).toISOString() }),
    });
    expect(started).toMatchObject({ ok: true, kind: 'applied' });
  }

  return {
    actor: actor as StoryPublishingActor,
    setNow(value: string) {
      now = Date.parse(value);
    },
    store,
  };
};

const subscriptionOf = (
  events: readonly unknown[],
  overrides: Partial<Pick<ArenaRoomGenerationSubscription, 'generationId' | 'generationRequestId'>> = {},
): ArenaRoomGenerationSubscription => ({
  generationId: GENERATION_ID,
  generationRequestId: GENERATION_REQUEST_ID,
  ...overrides,
  events: new ReadableStream<ArenaRoomGenerationEvent>({
    start(controller) {
      for (const event of events) controller.enqueue(event as ArenaRoomGenerationEvent);
      controller.close();
    },
  }),
});

describe('RoomGenerationPublisher RoomActor transient story seam', () => {
  it('只 transient fanout running generation 的首个 chunk，不写 checkpoint/control replay', async () => {
    const harness = await createRunningActor();
    const beforeState = harness.actor.getSnapshot();
    const beforeSaveCalls = harness.store.saveCalls;
    const subscriber = vi.fn();
    harness.actor.subscribe(subscriber);
    const timestamp = '2026-08-28T00:03:00.000Z';
    harness.setNow(timestamp);

    const result = await harness.actor.publishStory({
      authority: issueArenaRoomGenerationPublisherAuthority({
        roomId: ROOM_ID,
        roomEpoch: ROOM_EPOCH,
        generationRequestId: GENERATION_REQUEST_ID,
        generationId: GENERATION_ID,
        attempt: 1,
        expiresAt: EXPIRES_AT,
      }),
      event: {
        protocolVersion: 1,
        type: 'story.delta',
        roomId: ROOM_ID,
        roomEpoch: ROOM_EPOCH,
        generationId: GENERATION_ID,
        chunkSeq: 0,
        timestamp,
        payload: { delta: '# 第一幕\n' },
      },
      trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
    });

    expect(result).toEqual({ ok: true, kind: 'published' });
    expect(subscriber).toHaveBeenCalledOnce();
    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
      events: [],
      storyEvents: [expect.objectContaining({
        type: 'story.delta',
        chunkSeq: 0,
        payload: { delta: '# 第一幕\n' },
      })],
    }));
    expect(harness.store.saveCalls).toBe(beforeSaveCalls);
    expect(harness.actor.getSnapshot()).toEqual(beforeState);
    expect(harness.actor.resolveControlSync({
      roomEpoch: ROOM_EPOCH,
      controlSeq: beforeState!.snapshot.controlSeq,
    })).toEqual({ kind: 'current', events: [] });
  });

  it('让 story 与 terminal 共用队列，并保证末 delta 先于 generation.completed', async () => {
    const harness = await createRunningActor();
    const order: string[] = [];
    harness.actor.subscribe((fanout) => {
      order.push(...(fanout.storyEvents ?? []).map((event) => `${event.type}:${event.chunkSeq}`));
      order.push(...fanout.events.map((event) => event.type));
    });
    const timestamp = '2026-08-28T00:03:00.000Z';
    harness.setNow(timestamp);
    const authority = issueArenaRoomGenerationPublisherAuthority({
      roomId: ROOM_ID,
      roomEpoch: ROOM_EPOCH,
      generationRequestId: GENERATION_REQUEST_ID,
      generationId: GENERATION_ID,
      attempt: 1,
      expiresAt: EXPIRES_AT,
    });

    const story = harness.actor.publishStory({
      authority,
      event: {
        protocolVersion: 1,
        type: 'story.delta',
        roomId: ROOM_ID,
        roomEpoch: ROOM_EPOCH,
        generationId: GENERATION_ID,
        chunkSeq: 0,
        timestamp,
        payload: { delta: '终章' },
      },
      trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
    });
    const terminal = harness.actor.execute({
      authority,
      command: {
        type: 'mirror-generation',
        expectedRoomEpoch: ROOM_EPOCH,
        generationRequestId: GENERATION_REQUEST_ID,
        generationId: GENERATION_ID,
        attempt: 1,
        state: 'completed',
        generationRecordId: 'record-1',
        timestamp,
      },
      trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
    });

    await expect(Promise.all([story, terminal])).resolves.toEqual([
      { ok: true, kind: 'published' },
      expect.objectContaining({ ok: true, kind: 'applied' }),
    ]);
    expect(order).toEqual(['story.delta:0', 'generation.completed']);
  });

  it('以 0-based contiguous sequence 发布，并显式忽略 exact duplicate/stale、拒绝 conflict/gap', async () => {
    const harness = await createRunningActor();
    const subscriber = vi.fn();
    harness.actor.subscribe(subscriber);
    const timestamp = '2026-08-28T00:03:00.000Z';
    harness.setNow(timestamp);
    const publish = (chunkSeq: number, delta: string) => harness.actor.publishStory({
      authority: issueArenaRoomGenerationPublisherAuthority({
        roomId: ROOM_ID,
        roomEpoch: ROOM_EPOCH,
        generationRequestId: GENERATION_REQUEST_ID,
        generationId: GENERATION_ID,
        attempt: 1,
        expiresAt: EXPIRES_AT,
      }),
      event: {
        protocolVersion: 1,
        type: 'story.delta',
        roomId: ROOM_ID,
        roomEpoch: ROOM_EPOCH,
        generationId: GENERATION_ID,
        chunkSeq,
        timestamp,
        payload: { delta },
      },
      trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
    });

    await expect(publish(0, 'A')).resolves.toEqual({ ok: true, kind: 'published' });
    await expect(publish(0, 'A')).resolves.toEqual({ ok: true, kind: 'idempotent' });
    await expect(publish(0, '冲突')).resolves.toEqual({
      ok: false,
      code: 'conflict',
      reason: 'story-sequence-conflict',
    });
    await expect(publish(1, 'B')).resolves.toEqual({ ok: true, kind: 'published' });
    await expect(publish(0, 'A')).resolves.toEqual({ ok: true, kind: 'stale' });
    await expect(publish(3, 'gap')).resolves.toEqual({
      ok: false,
      code: 'conflict',
      reason: 'story-sequence-gap',
    });
    expect(subscriber).toHaveBeenCalledTimes(2);
  });

  it('拒绝非 running generation 与 oversized story frame，且不产生 fanout/checkpoint', async () => {
    const harness = await createRunningActor({ running: false });
    const subscriber = vi.fn();
    harness.actor.subscribe(subscriber);
    const beforeSaveCalls = harness.store.saveCalls;
    const timestamp = '2026-08-28T00:03:00.000Z';
    harness.setNow(timestamp);
    const input = (delta: string) => ({
      authority: issueArenaRoomGenerationPublisherAuthority({
        roomId: ROOM_ID,
        roomEpoch: ROOM_EPOCH,
        generationRequestId: GENERATION_REQUEST_ID,
        generationId: GENERATION_ID,
        attempt: 1,
        expiresAt: EXPIRES_AT,
      }),
      event: {
        protocolVersion: 1,
        type: 'story.delta',
        roomId: ROOM_ID,
        roomEpoch: ROOM_EPOCH,
        generationId: GENERATION_ID,
        chunkSeq: 0,
        timestamp,
        payload: { delta },
      },
      trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
    });

    await expect(harness.actor.publishStory(input('not-running'))).resolves.toEqual({
      ok: false,
      code: 'conflict',
      reason: 'generation-not-running',
    });
    await expect(harness.actor.publishStory(input('x'.repeat(MAX_STORY_FRAME_BYTES)))).resolves
      .toEqual({ ok: false, code: 'validation-failed', reason: 'invalid-story-event' });
    expect(subscriber).not.toHaveBeenCalled();
    expect(harness.store.saveCalls).toBe(beforeSaveCalls);
  });

  it('以 opaque publisher scope、trusted time、current epoch/generation/attempt/expiry fail closed', async () => {
    const harness = await createRunningActor();
    const subscriber = vi.fn();
    harness.actor.subscribe(subscriber);
    const timestamp = '2026-08-28T00:03:00.000Z';
    harness.setNow(timestamp);
    const event = {
      protocolVersion: 1,
      type: 'story.delta',
      roomId: ROOM_ID,
      roomEpoch: ROOM_EPOCH,
      generationId: GENERATION_ID,
      chunkSeq: 0,
      timestamp,
      payload: { delta: 'fenced' },
    };
    const authority = (overrides: Partial<{
      roomId: string;
      roomEpoch: string;
      generationRequestId: string;
      generationId: string;
      attempt: number;
      expiresAt: string;
    }> = {}) => issueArenaRoomGenerationPublisherAuthority({
      roomId: ROOM_ID,
      roomEpoch: ROOM_EPOCH,
      generationRequestId: GENERATION_REQUEST_ID,
      generationId: GENERATION_ID,
      attempt: 1,
      expiresAt: EXPIRES_AT,
      ...overrides,
    });

    await expect(harness.actor.publishStory({
      authority: JSON.parse(JSON.stringify(authority())),
      event,
      trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
    })).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      reason: 'invalid-authority-context',
    });
    await expect(harness.actor.publishStory({
      authority: authority({ attempt: 2 }),
      event,
      trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
    })).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      reason: 'authority-scope-mismatch',
    });
    await expect(harness.actor.publishStory({
      authority: authority({ roomEpoch: 'epoch-old' }),
      event,
      trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
    })).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      reason: 'authority-scope-mismatch',
    });
    await expect(harness.actor.publishStory({
      authority: authority({ generationId: 'generation-old' }),
      event,
      trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
    })).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      reason: 'authority-scope-mismatch',
    });
    await expect(harness.actor.publishStory({
      authority: authority({ expiresAt: timestamp }),
      event,
      trustedTime: issueArenaRoomTrustedTime({ now: timestamp }),
    })).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      reason: 'authority-scope-expired',
    });
    await expect(harness.actor.publishStory({
      authority: authority(),
      event,
      trustedTime: JSON.parse(JSON.stringify(issueArenaRoomTrustedTime({ now: timestamp }))),
    })).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      reason: 'invalid-trusted-time',
    });
    expect(subscriber).not.toHaveBeenCalled();
  });
});

describe('RoomGenerationPublisher typed generation consumer', () => {
  it('同一 actor 重挂 publisher 时从 transient story cursor 继续而不重置 seq', async () => {
    const harness = await createRunningActor({ running: false });
    harness.setNow('2026-08-28T00:03:00.000Z');
    const authority = issueArenaRoomGenerationPublisherAuthority({
      roomId: ROOM_ID,
      roomEpoch: ROOM_EPOCH,
      generationRequestId: GENERATION_REQUEST_ID,
      generationId: GENERATION_ID,
      attempt: 1,
      expiresAt: EXPIRES_AT,
    });
    const first = createRoomGenerationPublisher({
      actor: harness.actor,
      authority,
      now: () => Date.parse('2026-08-28T00:03:00.000Z'),
    });
    await expect(first.attach(subscriptionOf([
      { id: '1', type: 'markdown', chunk: 'A' },
    ]))).resolves.toEqual({ kind: 'stream-ended' });

    const second = createRoomGenerationPublisher({
      actor: harness.actor,
      authority,
      now: () => Date.parse('2026-08-28T00:04:00.000Z'),
      initial: { markdown: 'A', nextChunkSeq: 0 },
    });
    await expect(second.attach(subscriptionOf([
      { id: '2', type: 'markdown', chunk: 'B' },
    ]))).resolves.toEqual({ kind: 'stream-ended' });
    expect(second.getProgress()).toEqual({ markdown: 'AB', nextChunkSeq: 2 });
  });

  it('publisher 早退会 cancel 未结束的 subscription，停止底层 replay pump', async () => {
    const harness = await createRunningActor({ running: false });
    harness.setNow('2026-08-28T00:03:00.000Z');
    const cancelled = vi.fn();
    const events = new ReadableStream<ArenaRoomGenerationEvent>({
      start(controller) {
        controller.enqueue({ id: '1', type: 'markdown', chunk: 'gap' });
      },
      cancel: cancelled,
    });
    const publisher = createRoomGenerationPublisher({
      actor: harness.actor,
      authority: issueArenaRoomGenerationPublisherAuthority({
        roomId: ROOM_ID,
        roomEpoch: ROOM_EPOCH,
        generationRequestId: GENERATION_REQUEST_ID,
        generationId: GENERATION_ID,
        attempt: 1,
        expiresAt: EXPIRES_AT,
      }),
      initial: { markdown: '', nextChunkSeq: 2 },
      now: () => Date.parse('2026-08-28T00:03:00.000Z'),
    });

    await expect(publisher.attach({
      generationId: GENERATION_ID,
      generationRequestId: GENERATION_REQUEST_ID,
      events,
    })).resolves.toEqual({ kind: 'rejected', reason: 'story:story-sequence-gap' });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('先幂等 mirror running，只广播 markdown，snapshot 仅作 baseline，末 delta 后再 terminal', async () => {
    const harness = await createRunningActor({ running: false });
    const fanoutTypes: string[] = [];
    harness.actor.subscribe((fanout) => {
      fanoutTypes.push(...(fanout.storyEvents ?? []).map((event) => `${event.type}:${event.chunkSeq}`));
      fanoutTypes.push(...fanout.events.map((event) => event.type));
    });
    harness.setNow('2026-08-28T00:03:00.000Z');
    const publisher = createRoomGenerationPublisher({
      actor: harness.actor,
      authority: issueArenaRoomGenerationPublisherAuthority({
        roomId: ROOM_ID,
        roomEpoch: ROOM_EPOCH,
        generationRequestId: GENERATION_REQUEST_ID,
        generationId: GENERATION_ID,
        attempt: 1,
        expiresAt: EXPIRES_AT,
      }),
      now: () => Date.parse('2026-08-28T00:03:00.000Z'),
    });

    const result = await publisher.attach(subscriptionOf([
      {
        id: '0',
        type: 'snapshot',
        status: 'running',
        markdown: '# baseline\n',
        updatedAt: '2026-08-28T00:02:00.000Z',
        lastEventId: null,
      },
      { id: 'unsafe-1', type: 'reasoning', chunk: 'secret chain of thought' },
      { id: '1', type: 'markdown', chunk: '第一段' },
      { id: 'unsafe-2', type: 'telemetry', provider: 'secret-provider' },
      { id: '2', type: 'markdown', chunk: '第二段' },
      {
        id: '3',
        type: 'done',
        status: 'completed',
        generationRecordId: 'record-1',
        resultAvailable: true,
      },
    ]));

    expect(result).toEqual({
      kind: 'completed',
      generationRecordId: 'record-1',
    });
    expect(publisher.getProgress()).toEqual({
      markdown: '# baseline\n第一段第二段',
      nextChunkSeq: 2,
    });
    expect(fanoutTypes).toEqual([
      'generation.started',
      'story.delta:0',
      'story.delta:1',
      'generation.completed',
    ]);
    expect(JSON.stringify(fanoutTypes)).not.toContain('reasoning');
    expect(JSON.stringify(fanoutTypes)).not.toContain('telemetry');
  });

  it('把 typed error/无 result identity 的 completed 映射为稳定 generation-failed', async () => {
    for (const terminal of [
      { id: '1', type: 'error', status: 'producer_lost', code: 'PRODUCER_OWNERSHIP_LOST' },
      {
        id: '1',
        type: 'done',
        status: 'completed',
        generationRecordId: null,
        resultAvailable: false,
      },
    ] as const) {
      const harness = await createRunningActor({ running: false });
      harness.setNow('2026-08-28T00:03:00.000Z');
      const publisher = createRoomGenerationPublisher({
        actor: harness.actor,
        authority: issueArenaRoomGenerationPublisherAuthority({
          roomId: ROOM_ID,
          roomEpoch: ROOM_EPOCH,
          generationRequestId: GENERATION_REQUEST_ID,
          generationId: GENERATION_ID,
          attempt: 1,
          expiresAt: EXPIRES_AT,
        }),
        now: () => Date.parse('2026-08-28T00:03:00.000Z'),
      });

      await expect(publisher.attach(subscriptionOf([terminal]))).resolves.toEqual({
        kind: 'failed',
        errorCode: 'generation-failed',
      });
      expect(harness.actor.getSnapshot()?.snapshot.activeGeneration?.state).toBe('failed');
    }
  });

  it('subscription identity mismatch 在消费或 mirror 前 fail closed', async () => {
    const harness = await createRunningActor({ running: false });
    const before = harness.actor.getSnapshot();
    const publisher = createRoomGenerationPublisher({
      actor: harness.actor,
      authority: issueArenaRoomGenerationPublisherAuthority({
        roomId: ROOM_ID,
        roomEpoch: ROOM_EPOCH,
        generationRequestId: GENERATION_REQUEST_ID,
        generationId: GENERATION_ID,
        attempt: 1,
        expiresAt: EXPIRES_AT,
      }),
    });

    await expect(publisher.attach(subscriptionOf([], { generationId: 'other-generation' })))
      .resolves.toEqual({ kind: 'rejected', reason: 'subscription-identity-mismatch' });
    expect(harness.actor.getSnapshot()).toEqual(before);
  });
});
