import type {
  ArenaRoomGenerationSubscription,
} from '../arena-generation/room-generation-port';
import {
  issueArenaRoomTrustedTime,
  parseArenaRoomAuthorityContext,
} from '@mahoshojo/multiplayer-core';

import type { RoomActor } from './room-actor-registry';
import {
  observeArenaRoomRuntime,
  type ArenaRoomRuntimeObserver,
} from './runtime-observer';

export type RoomGenerationPublisherProgress = Readonly<{
  markdown: string;
  nextChunkSeq: number;
}>;

export type RoomGenerationPublishResult =
  | Readonly<{ kind: 'completed'; generationRecordId: string }>
  | Readonly<{ kind: 'failed'; errorCode: 'generation-failed' }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'stream-ended' }>
  | Readonly<{ kind: 'rejected'; reason: string }>;

export type RoomGenerationPublisher = Readonly<{
  attach(subscription: ArenaRoomGenerationSubscription): Promise<RoomGenerationPublishResult>;
  getProgress(): RoomGenerationPublisherProgress;
}>;

export type RoomGenerationPublisherOptions = Readonly<{
  actor: Pick<RoomActor, 'execute' | 'getSnapshot' | 'getStoryCursor' | 'publishStory'>;
  authority: unknown;
  now?: () => number;
  initial?: RoomGenerationPublisherProgress;
  observer?: ArenaRoomRuntimeObserver;
  onInFlightChange?: (delta: 1 | -1) => void;
}>;

const rejected = (reason: string): RoomGenerationPublishResult => ({
  kind: 'rejected',
  reason,
});

export const createRoomGenerationPublisher = (
  options: RoomGenerationPublisherOptions,
): RoomGenerationPublisher => {
  const authority = parseArenaRoomAuthorityContext(options.authority);
  if (authority?.kind !== 'generation-publisher') {
    throw new TypeError('RoomGenerationPublisher requires an opaque generation-publisher authority');
  }
  const scope = Object.freeze({ ...authority.scope });
  const now = options.now ?? Date.now;
  const initial = options.initial ?? { markdown: '', nextChunkSeq: 0 };
  if (
    typeof initial.markdown !== 'string'
    || !Number.isSafeInteger(initial.nextChunkSeq)
    || initial.nextChunkSeq < 0
  ) {
    throw new TypeError('RoomGenerationPublisher initial progress is invalid');
  }
  const actorCursor = options.actor.getStoryCursor({
    roomEpoch: scope.roomEpoch,
    generationId: scope.generationId,
    attempt: scope.attempt,
  });
  let markdown = initial.markdown;
  let nextChunkSeq = actorCursor?.nextChunkSeq ?? initial.nextChunkSeq;
  let attached = false;

  const changeInFlight = (delta: 1 | -1): void => {
    try {
      options.onInFlightChange?.(delta);
    } catch {
      // Telemetry failures never alter publisher ownership or story delivery.
    }
  };

  const timestamp = (): string => {
    const state = options.actor.getSnapshot();
    const stateTimestamp = state === null ? 0 : Date.parse(state.lifecycle.updatedAt);
    return new Date(Math.max(now(), stateTimestamp)).toISOString();
  };

  const mirror = async (
    state: 'cancelled' | 'completed' | 'failed' | 'running',
    terminal?: { readonly generationRecordId?: string; readonly errorCode?: 'generation-failed' },
  ): Promise<RoomGenerationPublishResult | null> => {
    const issuedAt = timestamp();
    const result = await options.actor.execute({
      authority: options.authority,
      command: {
        type: 'mirror-generation',
        expectedRoomEpoch: scope.roomEpoch,
        generationRequestId: scope.generationRequestId,
        generationId: scope.generationId,
        attempt: scope.attempt,
        state,
        ...(terminal?.generationRecordId === undefined
          ? {}
          : { generationRecordId: terminal.generationRecordId }),
        ...(terminal?.errorCode === undefined ? {} : { errorCode: terminal.errorCode }),
        timestamp: issuedAt,
      },
      trustedTime: issueArenaRoomTrustedTime({ now: issuedAt }),
    });
    return result.ok
      ? null
      : rejected(`mirror-${state}:${result.reason}`);
  };

  const publishMarkdown = async (delta: string): Promise<RoomGenerationPublishResult | null> => {
    const issuedAt = timestamp();
    changeInFlight(1);
    try {
      const result = await options.actor.publishStory({
        authority: options.authority,
        event: {
          protocolVersion: 1,
          type: 'story.delta',
          roomId: scope.roomId,
          roomEpoch: scope.roomEpoch,
          generationId: scope.generationId,
          chunkSeq: nextChunkSeq,
          timestamp: issuedAt,
          payload: { delta },
        },
        trustedTime: issueArenaRoomTrustedTime({ now: issuedAt }),
      });
      if (!result.ok) {
        observeArenaRoomRuntime(options.observer, {
          event: 'publisher_outcome',
          outcome: 'rejected',
        });
        return rejected(`story:${result.reason}`);
      }
      if (result.kind === 'published' || result.kind === 'idempotent') {
        markdown += delta;
        nextChunkSeq += 1;
        observeArenaRoomRuntime(options.observer, {
          event: 'publisher_outcome',
          outcome: 'published',
        });
      } else {
        observeArenaRoomRuntime(options.observer, {
          event: 'publisher_outcome',
          outcome: 'dropped',
        });
      }
      return null;
    } catch (error) {
      observeArenaRoomRuntime(options.observer, {
        event: 'publisher_outcome',
        outcome: 'error',
      });
      throw error;
    } finally {
      changeInFlight(-1);
    }
  };

  const attach = async (
    subscription: ArenaRoomGenerationSubscription,
  ): Promise<RoomGenerationPublishResult> => {
    if (attached) return rejected('publisher-already-attached');
    if (
      subscription.generationId !== scope.generationId
      || subscription.generationRequestId !== scope.generationRequestId
    ) {
      return rejected('subscription-identity-mismatch');
    }
    attached = true;
    try {
      const runningFailure = await mirror('running');
      if (runningFailure !== null) return runningFailure;
      const reader = subscription.events.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) return { kind: 'stream-ended' };
          const event = next.value as unknown as Record<string, unknown>;
          if (event.type === 'snapshot') {
            if (typeof event.markdown === 'string') markdown = event.markdown;
            continue;
          }
          if (event.type === 'markdown') {
            if (typeof event.chunk !== 'string') continue;
            const storyFailure = await publishMarkdown(event.chunk);
            if (storyFailure !== null) return storyFailure;
            continue;
          }
          if (event.type === 'error') {
            const terminalFailure = await mirror('failed', { errorCode: 'generation-failed' });
            return terminalFailure ?? { kind: 'failed', errorCode: 'generation-failed' };
          }
          if (event.type !== 'done') continue;
          if (
            event.status === 'completed'
            && event.resultAvailable === true
            && typeof event.generationRecordId === 'string'
            && event.generationRecordId.length > 0
          ) {
            const terminalFailure = await mirror('completed', {
              generationRecordId: event.generationRecordId,
            });
            return terminalFailure ?? {
              kind: 'completed',
              generationRecordId: event.generationRecordId,
            };
          }
          if (event.status === 'cancelled') {
            const terminalFailure = await mirror('cancelled');
            return terminalFailure ?? { kind: 'cancelled' };
          }
          const terminalFailure = await mirror('failed', { errorCode: 'generation-failed' });
          return terminalFailure ?? { kind: 'failed', errorCode: 'generation-failed' };
        }
      } finally {
        await reader.cancel('room-generation-publisher-stopped').catch(() => undefined);
        reader.releaseLock();
      }
    } finally {
      attached = false;
    }
  };

  return Object.freeze({
    attach,
    getProgress: () => Object.freeze({ markdown, nextChunkSeq }),
  });
};
