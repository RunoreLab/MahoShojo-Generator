import type {
  GenerationReplayStore,
  GenerationReplayStoreState,
  GenerationStreamEvent,
} from './service';

export type MemoryGenerationReplayStoreOptions = {
  maxEvents?: number;
};

const cloneState = (state: GenerationReplayStoreState): GenerationReplayStoreState => ({
  ...state,
  snapshot: state.snapshot ? { ...state.snapshot } : null,
  terminal: state.terminal ? { ...state.terminal } : null,
});

/**
 * Process-local replay backend for tests and the explicitly degraded Cloudflare DR adapter.
 * It never claims cross-process durability; process loss is reconciled through the terminal store.
 */
export const createMemoryGenerationReplayStore = (
  options: MemoryGenerationReplayStoreOptions = {},
): GenerationReplayStore => {
  const maxEvents = options.maxEvents ?? 1_000;
  if (!Number.isInteger(maxEvents) || maxEvents < 1) {
    throw new Error('maxEvents 必须是正整数');
  }
  const requests = new Map<string, { payloadHash: string; generationId: string }>();
  const states = new Map<string, GenerationReplayStoreState>();
  const events = new Map<string, GenerationStreamEvent[]>();
  const sequences = new Map<string, number>();

  const store: GenerationReplayStore = {
    async reserve(input) {
      const requestKey = `${input.actorKey}\u0000${input.generationRequestId}`;
      const previous = requests.get(requestKey);
      if (previous) {
        return previous.payloadHash === input.payloadHash
          ? { kind: 'reused', generationId: previous.generationId }
          : { kind: 'conflict' };
      }
      requests.set(requestKey, {
        payloadHash: input.payloadHash,
        generationId: input.generationId,
      });
      states.set(input.generationId, {
        actorKey: input.actorKey,
        generationId: input.generationId,
        generationRequestId: input.generationRequestId,
        payloadHash: input.payloadHash,
        status: 'reserved',
        lastEventId: null,
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
        snapshot: null,
        terminal: null,
        cancelRequested: false,
      });
      return { kind: 'created', generationId: input.generationId };
    },

    async markRunning(input) {
      const state = states.get(input.generationId);
      if (!state) throw new Error('GENERATION_NOT_FOUND');
      states.set(input.generationId, {
        ...state,
        status: 'running',
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
      });
    },

    async heartbeat(input) {
      const state = states.get(input.generationId);
      if (!state) throw new Error('GENERATION_NOT_FOUND');
      states.set(input.generationId, {
        ...state,
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
      });
      return { cancelRequested: state.cancelRequested };
    },

    async appendEvents(input) {
      const state = states.get(input.generationId);
      if (!state) throw new Error('GENERATION_NOT_FOUND');
      let sequence = sequences.get(input.generationId) ?? 0;
      const appended = input.events.map((event): GenerationStreamEvent => {
        sequence += 1;
        return { ...event, id: `${sequence}-0` };
      });
      sequences.set(input.generationId, sequence);
      const retained = [...(events.get(input.generationId) ?? []), ...appended].slice(-maxEvents);
      events.set(input.generationId, retained);
      states.set(input.generationId, {
        ...state,
        lastEventId: appended.at(-1)?.id ?? state.lastEventId,
        updatedAt: input.now,
      });
      return { events: appended };
    },

    async writeSnapshot(input) {
      const state = states.get(input.generationId);
      if (!state) throw new Error('GENERATION_NOT_FOUND');
      states.set(input.generationId, {
        ...state,
        snapshot: { ...input.snapshot },
        updatedAt: input.now,
      });
    },

    async readSnapshot(input) {
      const snapshot = states.get(input.generationId)?.snapshot;
      return snapshot ? { ...snapshot } : null;
    },

    async readAfter(input) {
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
      const state = states.get(input.generationId);
      if (!state) throw new Error('GENERATION_NOT_FOUND');
      if (state.terminal) return { applied: false };
      states.set(input.generationId, {
        ...state,
        status: input.terminal.status,
        terminal: { ...input.terminal },
        leaseExpiresAt: null,
        updatedAt: input.now,
      });
      return { applied: true };
    },

    async readState(input) {
      const state = states.get(input.generationId);
      if (!state || (input.actorKey && state.actorKey !== input.actorKey)) return null;
      return cloneState(state);
    },

    async requestCancel(input) {
      const state = states.get(input.generationId);
      if (!state) return { kind: 'not-found' };
      if (state.actorKey !== input.actorKey) return { kind: 'forbidden' };
      if (state.terminal) return { kind: 'terminal', status: state.terminal.status };
      states.set(input.generationId, {
        ...state,
        cancelRequested: true,
        updatedAt: input.now,
      });
      return { kind: 'accepted' };
    },
  };
  return Object.freeze(store);
};
