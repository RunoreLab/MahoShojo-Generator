import {
  isArenaPreparationSeed,
  isArenaPreparationVersion,
} from './service';
import type {
  GenerationReplayStore,
  GenerationReplayStoreState,
  GenerationStreamEvent,
} from './service';

export type MemoryGenerationReplayStoreOptions = {
  maxEvents?: number;
  maxGenerations?: number;
  activeTtlMs?: number;
  terminalTtlMs?: number;
  now?: () => number;
};

const cloneState = (state: GenerationReplayStoreState): GenerationReplayStoreState => ({
  ...state,
  snapshot: state.snapshot ? { ...state.snapshot } : null,
  terminal: state.terminal ? {
    ...state.terminal,
    ...(state.terminal.publicError
      ? { publicError: { ...state.terminal.publicError } }
      : {}),
  } : null,
});

/**
 * Process-local replay backend for deterministic unit/integration tests only.
 * Production and disaster-recovery adapters must use the shared Redis backend or fail closed.
 */
export const createMemoryGenerationReplayStore = (
  options: MemoryGenerationReplayStoreOptions = {},
): GenerationReplayStore => {
  const maxEvents = options.maxEvents ?? 1_000;
  const maxGenerations = options.maxGenerations ?? 100;
  const activeTtlMs = options.activeTtlMs ?? 60 * 60 * 1_000;
  const terminalTtlMs = options.terminalTtlMs ?? 45 * 60 * 1_000;
  const now = options.now ?? Date.now;
  if (!Number.isInteger(maxEvents) || maxEvents < 1) {
    throw new Error('maxEvents 必须是正整数');
  }
  if (!Number.isInteger(maxGenerations) || maxGenerations < 1) {
    throw new Error('maxGenerations 必须是正整数');
  }
  if (![activeTtlMs, terminalTtlMs].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('memory replay TTL 必须是正有限数字');
  }
  const requests = new Map<string, {
    payloadHash: string;
    generationId: string;
    preparationSeed: string | null;
    preparationVersion: string | null;
  }>();
  const states = new Map<string, GenerationReplayStoreState>();
  const events = new Map<string, GenerationStreamEvent[]>();
  const sequences = new Map<string, number>();
  const expirations = new Map<string, number>();

  const deleteGeneration = (generationId: string): void => {
    states.delete(generationId);
    events.delete(generationId);
    sequences.delete(generationId);
    expirations.delete(generationId);
    for (const [key, value] of requests) {
      if (value.generationId === generationId) requests.delete(key);
    }
  };
  const prune = (): void => {
    const timestamp = now();
    for (const [generationId, expiresAt] of expirations) {
      if (expiresAt <= timestamp) deleteGeneration(generationId);
    }
    if (states.size <= maxGenerations) return;
    const oldest = Array.from(states.values()).sort((left, right) => (
      Date.parse(left.updatedAt) - Date.parse(right.updatedAt)
    ));
    for (const state of oldest.slice(0, states.size - maxGenerations)) {
      deleteGeneration(state.generationId);
    }
  };
  const writeState = (state: GenerationReplayStoreState): void => {
    states.set(state.generationId, state);
    expirations.set(
      state.generationId,
      now() + (state.terminal ? terminalTtlMs : activeTtlMs),
    );
    prune();
  };
  const ownsUnexpiredLease = (
    state: GenerationReplayStoreState,
    operationTime: string,
  ): boolean => state.leaseExpiresAt !== null
    && Number.isFinite(Date.parse(state.leaseExpiresAt))
    && Date.parse(state.leaseExpiresAt) > Date.parse(operationTime);

  const store: GenerationReplayStore = {
    async reserve(input) {
      const preparationSeed = input.preparationSeed ?? null;
      const preparationVersion = input.preparationVersion ?? null;
      if (
        (preparationSeed === null) !== (preparationVersion === null)
        || (preparationSeed !== null && !isArenaPreparationSeed(preparationSeed))
        || (preparationVersion !== null && !isArenaPreparationVersion(preparationVersion))
      ) {
        throw new Error('MEMORY_GENERATION_PREPARATION_INVALID');
      }
      prune();
      const requestKey = `${input.actorKey}\u0000${input.generationRequestId}`;
      const previous = requests.get(requestKey);
      if (previous) {
        return previous.payloadHash === input.payloadHash
          ? {
            kind: 'reused',
            generationId: previous.generationId,
            preparationSeed: previous.preparationSeed,
            preparationVersion: previous.preparationVersion,
          }
          : { kind: 'conflict' };
      }
      requests.set(requestKey, {
        payloadHash: input.payloadHash,
        generationId: input.generationId,
        preparationSeed,
        preparationVersion,
      });
      writeState({
        actorKey: input.actorKey,
        generationId: input.generationId,
        generationRequestId: input.generationRequestId,
        payloadHash: input.payloadHash,
        mode: input.mode ?? null,
        producerToken: input.producerToken,
        status: 'reserved',
        lastEventId: null,
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
        snapshot: null,
        terminal: null,
        cancelRequested: false,
        cancelReason: null,
        preparationSeed,
        preparationVersion,
      });
      return {
        kind: 'created',
        generationId: input.generationId,
        preparationSeed,
        preparationVersion,
      };
    },

    async markRunning(input) {
      prune();
      const state = states.get(input.generationId);
      if (
        !state
        || state.producerToken !== input.producerToken
        || state.status !== 'reserved'
        || !ownsUnexpiredLease(state, input.now)
      ) {
        return { owned: false, cancelRequested: false };
      }
      if (state.cancelRequested) {
        writeState({
          ...state,
          status: 'finalizing',
          updatedAt: input.now,
          leaseExpiresAt: input.leaseExpiresAt,
        });
        return {
          owned: true,
          cancelRequested: true,
          cancelReason: state.cancelReason ?? 'user',
        };
      }
      writeState({
        ...state,
        status: 'running',
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
      });
      return { owned: true, cancelRequested: false };
    },

    async claimFinalization(input) {
      prune();
      const state = states.get(input.generationId);
      if (
        !state
        || state.producerToken !== input.producerToken
        || !ownsUnexpiredLease(state, input.now)
      ) return { kind: 'fenced' };
      if (state.cancelRequested) {
        writeState({
          ...state,
          status: 'finalizing',
          updatedAt: input.now,
          leaseExpiresAt: input.leaseExpiresAt,
        });
        return { kind: 'cancelled', cancelReason: state.cancelReason ?? 'user' };
      }
      if (state.status !== 'running' && state.status !== 'finalizing') return { kind: 'fenced' };
      writeState({
        ...state,
        status: 'finalizing',
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
      });
      return { kind: 'claimed' };
    },

    async claimLeaseExpiry(input) {
      prune();
      const state = states.get(input.generationId);
      if (!state) return { kind: 'not-found' };
      if (state.actorKey !== input.actorKey) return { kind: 'forbidden' };
      if (state.terminal) return { kind: 'terminal', status: state.terminal.status };
      if (!state.leaseExpiresAt || Date.parse(state.leaseExpiresAt) > Date.parse(input.now)) {
        return { kind: 'not-expired' };
      }
      if (state.status !== 'reserved' && state.status !== 'running' && state.status !== 'finalizing') {
        return { kind: 'not-expired' };
      }
      writeState({
        ...state,
        producerToken: input.reaperToken,
        status: 'finalizing',
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
      });
      return {
        kind: 'claimed',
        generationRequestId: state.generationRequestId,
        payloadHash: state.payloadHash,
        mode: state.mode ?? null,
      };
    },

    async releaseReservation(input) {
      prune();
      const state = states.get(input.generationId);
      if (
        !state
        || state.producerToken !== input.producerToken
        || state.status !== 'reserved'
      ) return { released: false };
      deleteGeneration(input.generationId);
      return { released: true };
    },

    async heartbeat(input) {
      prune();
      const state = states.get(input.generationId);
      if (
        !state
        || state.producerToken !== input.producerToken
        || (state.status !== 'running' && state.status !== 'finalizing')
        || !ownsUnexpiredLease(state, input.now)
      ) {
        return { owned: false, cancelRequested: false };
      }
      writeState({
        ...state,
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
      });
      return state.cancelRequested
        ? {
          owned: true,
          cancelRequested: true,
          cancelReason: state.cancelReason ?? 'user',
        }
        : { owned: true, cancelRequested: false };
    },

    async appendEvents(input) {
      prune();
      const state = states.get(input.generationId);
      if (
        !state
        || state.producerToken !== input.producerToken
        || (state.status !== 'running' && state.status !== 'finalizing')
        || !ownsUnexpiredLease(state, input.now)
      ) {
        return { owned: false, events: [] };
      }
      let sequence = sequences.get(input.generationId) ?? 0;
      const appended = input.events.map((event): GenerationStreamEvent => {
        sequence += 1;
        return { ...event, id: `${sequence}-0` };
      });
      sequences.set(input.generationId, sequence);
      const retained = [...(events.get(input.generationId) ?? []), ...appended].slice(-maxEvents);
      events.set(input.generationId, retained);
      writeState({
        ...state,
        lastEventId: appended.at(-1)?.id ?? state.lastEventId,
        updatedAt: input.now,
      });
      return { owned: true, events: appended };
    },

    async writeSnapshot(input) {
      prune();
      const state = states.get(input.generationId);
      const statusMatchesLifecycle = state?.status === 'running' || state?.status === 'finalizing'
        ? input.snapshot.status === 'running'
        : Boolean(state?.terminal) && input.snapshot.status === state?.status;
      if (
        !state
        || state.producerToken !== input.producerToken
        || !statusMatchesLifecycle
        || (!state.terminal && !ownsUnexpiredLease(state, input.now))
      ) return { owned: false };
      writeState({
        ...state,
        snapshot: { ...input.snapshot },
        updatedAt: input.now,
      });
      return { owned: true };
    },

    async readSnapshot(input) {
      prune();
      const snapshot = states.get(input.generationId)?.snapshot;
      return snapshot ? { ...snapshot } : null;
    },

    async readAfter(input) {
      prune();
      const retained = events.get(input.generationId) ?? [];
      if (!input.after) return { kind: 'events', events: retained.map((event) => ({ ...event })) };
      const index = retained.findIndex((event) => event.id === input.after);
      if (index >= 0) {
        return {
          kind: 'events',
          events: retained.slice(index + 1).map((event) => ({ ...event })),
        };
      }
      const numericCursor = Number(input.after.split('-', 1)[0]);
      const latestSequence = sequences.get(input.generationId) ?? 0;
      if (
        Number.isInteger(numericCursor)
        && numericCursor >= latestSequence
      ) return { kind: 'events', events: [] };
      return {
        kind: 'window-lost',
        events: retained.map((event) => ({ ...event })),
      };
    },

    async markTerminal(input) {
      prune();
      const state = states.get(input.generationId);
      if (
        !state
        || state.producerToken !== input.producerToken
        || (!state.terminal && !ownsUnexpiredLease(state, input.now))
      ) {
        return { owned: false, applied: false };
      }
      if (state.terminal) return { owned: true, applied: false };
      let terminalEvent: GenerationStreamEvent | undefined;
      if (input.terminalEvent) {
        let sequence = sequences.get(input.generationId) ?? 0;
        sequence += 1;
        terminalEvent = { ...input.terminalEvent, id: `${sequence}-0` };
        sequences.set(input.generationId, sequence);
        events.set(input.generationId, [
          ...(events.get(input.generationId) ?? []),
          terminalEvent,
        ].slice(-maxEvents));
      }
      writeState({
        ...state,
        status: input.terminal.status,
        terminal: {
          ...input.terminal,
          ...(input.terminal.publicError
            ? { publicError: { ...input.terminal.publicError } }
            : {}),
        },
        lastEventId: terminalEvent?.id ?? state.lastEventId,
        snapshot: input.terminalSnapshot ? {
          ...input.terminalSnapshot,
          lastEventId: terminalEvent?.id
            ?? input.terminalSnapshot.lastEventId
            ?? state.lastEventId,
        } : state.snapshot,
        leaseExpiresAt: null,
        updatedAt: input.now,
      });
      return {
        owned: true,
        applied: true,
        ...(terminalEvent ? { event: terminalEvent } : {}),
      };
    },

    async readState(input) {
      prune();
      const state = states.get(input.generationId);
      if (!state || (input.actorKey && state.actorKey !== input.actorKey)) return null;
      return cloneState(state);
    },

    async requestCancel(input) {
      prune();
      const state = states.get(input.generationId);
      if (!state) return { kind: 'not-found' };
      if (state.actorKey !== input.actorKey) return { kind: 'forbidden' };
      if (state.terminal) return { kind: 'terminal', status: state.terminal.status };
      if (state.status === 'finalizing') return { kind: 'finalizing' };
      const cancelReason = state.cancelRequested
        ? state.cancelReason ?? 'user'
        : input.reason;
      writeState({
        ...state,
        cancelRequested: true,
        cancelReason,
        updatedAt: input.now,
      });
      return { kind: 'accepted', cancelReason };
    },
  };
  return Object.freeze(store);
};
