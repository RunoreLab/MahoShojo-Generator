import { randomUUID } from 'node:crypto';

import {
  ArenaRoomCommandSchema,
  createArenaRoomCheckpointCommit,
  issueArenaRoomRecoveryAuthority,
  parseArenaRoomAuthorityState,
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
  type ArenaRoomTransitionResult,
  type ArenaRoomTransitionSuccess,
} from '@mahoshojo/multiplayer-core';

import type { RedisRoomStore } from './redis-room-store';

const DEFAULT_MAX_QUEUED_COMMANDS = 64;
const DEFAULT_MAX_SUBSCRIBERS_PER_ROOM = 128;
const DEFAULT_MAX_ACTORS = 1_024;
const DEFAULT_IDLE_ACTOR_TTL_MS = 5 * 60 * 1_000;

export type RoomActorCheckpointStore = Pick<RedisRoomStore, 'load' | 'save'>;

export type RoomActorErrorCode =
  | 'ROOM_ACTOR_CHECKPOINT_CONFLICT'
  | 'ROOM_ACTOR_EPOCH_INVALID'
  | 'ROOM_ACTOR_FENCED'
  | 'ROOM_ACTOR_NOT_FOUND'
  | 'ROOM_ACTOR_QUEUE_OVERLOADED'
  | 'ROOM_ACTOR_REGISTRY_CAPACITY'
  | 'ROOM_ACTOR_RECOVERY_CONFLICT'
  | 'ROOM_ACTOR_RECOVERY_INVALID'
  | 'ROOM_ACTOR_REGISTRY_SHUTTING_DOWN'
  | 'ROOM_ACTOR_ROOM_ID_MISMATCH'
  | 'ROOM_ACTOR_SHUTTING_DOWN'
  | 'ROOM_ACTOR_SUBSCRIBER_LIMIT';

export class RoomActorError extends Error {
  constructor(readonly code: RoomActorErrorCode) {
    super(code);
    this.name = 'RoomActorError';
  }
}

const fail = (code: RoomActorErrorCode): never => {
  throw new RoomActorError(code);
};

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} 必须是正安全整数`);
  return value;
};

const positiveFinite = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 1) throw new Error(`${name} 必须是正有限数字`);
  return value;
};

const cloneState = (state: ArenaRoomAuthorityState): ArenaRoomAuthorityState => (
  parseArenaRoomAuthorityState(state)
);

const snapshotInputCapability = (input: unknown): unknown => {
  if (typeof input === 'object' && input !== null && 'kind' in input) {
    const kind = input.kind;
    if (
      kind === 'generation-reserver'
      || kind === 'generation-publisher'
      || kind === 'room-recovery'
      || kind === 'trusted-server-time'
    ) return input;
  }
  try {
    return structuredClone(input);
  } catch {
    return null;
  }
};

export type RoomActorFanout = {
  readonly roomId: string;
  readonly roomEpoch: string;
  readonly snapshot: ArenaRoomAuthorityState['snapshot'];
  readonly events: ArenaRoomTransitionSuccess['events'];
};

export type RoomActorSubscriber = (fanout: RoomActorFanout) => unknown;

export type RoomActorExecuteInput = {
  readonly command: unknown;
  readonly authority: unknown;
  readonly trustedTime?: unknown;
};

type QueueEntry = {
  readonly input: RoomActorExecuteInput;
  readonly reject: (error: unknown) => void;
  readonly resolve: (result: ArenaRoomTransitionResult) => void;
};

type ActorPhase = 'accepting' | 'draining' | 'closed' | 'fenced';

export class RoomActor {
  private phase: ActorPhase = 'accepting';
  private readonly queue: QueueEntry[] = [];
  private readonly subscribers = new Set<RoomActorSubscriber>();
  private readonly drainWaiters = new Set<() => void>();
  private running = false;
  private lastActivityAt: number;

  constructor(
    readonly roomId: string,
    initialState: ArenaRoomAuthorityState | null,
    private readonly options: {
      readonly maxQueuedCommands: number;
      readonly maxSubscribers: number;
      readonly now: () => number;
      readonly onFenced: (actor: RoomActor) => void;
      readonly onSubscriberError: (error: unknown) => void;
      readonly store: RoomActorCheckpointStore;
    },
  ) {
    this.lastActivityAt = options.now();
    this.state = initialState === null ? null : cloneState(initialState);
    if (this.state !== null && this.state.snapshot.roomId !== roomId) {
      return fail('ROOM_ACTOR_ROOM_ID_MISMATCH');
    }
  }

  private state: ArenaRoomAuthorityState | null;

  getSnapshot(): ArenaRoomAuthorityState | null {
    return this.state === null ? null : cloneState(this.state);
  }

  get isIdle(): boolean {
    return !this.running && this.queue.length === 0;
  }

  isIdleExpired(now: number, idleTtlMs: number): boolean {
    return this.isIdle && this.subscribers.size === 0 && now - this.lastActivityAt >= idleTtlMs;
  }

  subscribe(subscriber: RoomActorSubscriber): () => void {
    if (this.phase !== 'accepting') return fail('ROOM_ACTOR_SHUTTING_DOWN');
    if (this.subscribers.size >= this.options.maxSubscribers) {
      return fail('ROOM_ACTOR_SUBSCRIBER_LIMIT');
    }
    this.subscribers.add(subscriber);
    this.lastActivityAt = this.options.now();
    return () => this.subscribers.delete(subscriber);
  }

  execute(input: RoomActorExecuteInput): Promise<ArenaRoomTransitionResult> {
    if (this.phase === 'fenced') return Promise.reject(new RoomActorError('ROOM_ACTOR_FENCED'));
    if (this.phase !== 'accepting') {
      return Promise.reject(new RoomActorError('ROOM_ACTOR_SHUTTING_DOWN'));
    }
    if (this.queue.length >= this.options.maxQueuedCommands) {
      return Promise.reject(new RoomActorError('ROOM_ACTOR_QUEUE_OVERLOADED'));
    }
    const command = ArenaRoomCommandSchema.safeParse(input.command);
    if (!command.success) {
      return Promise.resolve({
        ok: false,
        code: 'validation-failed',
        reason: 'invalid-command',
      });
    }
    return new Promise<ArenaRoomTransitionResult>((resolve, reject) => {
      this.queue.push({
        input: {
          ...input,
          authority: snapshotInputCapability(input.authority),
          command: command.data,
          trustedTime: snapshotInputCapability(input.trustedTime),
        },
        reject,
        resolve,
      });
      this.pump();
    });
  }

  stopAccepting(): void {
    if (this.phase === 'accepting') this.phase = 'draining';
  }

  async drain(): Promise<void> {
    if (this.isIdle) return;
    await new Promise<void>((resolve) => this.drainWaiters.add(resolve));
  }

  async close(): Promise<void> {
    this.stopAccepting();
    await this.drain();
    if (this.phase !== 'fenced') this.phase = 'closed';
    this.subscribers.clear();
  }

  forceClose(): void {
    if (this.phase === 'closed' || this.phase === 'fenced') return;
    this.phase = 'closed';
    const error = new RoomActorError('ROOM_ACTOR_SHUTTING_DOWN');
    for (const entry of this.queue.splice(0)) entry.reject(error);
    this.subscribers.clear();
    this.resolveDrainWaitersIfIdle();
  }

  private fence(): void {
    if (this.phase === 'fenced') return;
    this.phase = 'fenced';
    const error = new RoomActorError('ROOM_ACTOR_FENCED');
    for (const entry of this.queue.splice(0)) entry.reject(error);
    this.subscribers.clear();
    this.options.onFenced(this);
  }

  private pump(): void {
    if (this.running) return;
    const entry = this.queue.shift();
    if (!entry) {
      this.resolveDrainWaitersIfIdle();
      return;
    }
    this.running = true;
    void this.apply(entry.input)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.running = false;
        this.lastActivityAt = this.options.now();
        this.pump();
      });
  }

  private async apply(input: RoomActorExecuteInput): Promise<ArenaRoomTransitionResult> {
    if (this.phase === 'closed') return fail('ROOM_ACTOR_SHUTTING_DOWN');
    if (this.phase === 'fenced') return fail('ROOM_ACTOR_FENCED');
    const transition = transitionArenaRoom(
      this.state,
      input.command,
      input.authority,
      input.trustedTime,
    );
    if (!transition.ok || transition.kind === 'idempotent') return transition;
    if (transition.nextState.snapshot.roomId !== this.roomId) {
      return fail('ROOM_ACTOR_ROOM_ID_MISMATCH');
    }
    const receipt = createArenaRoomCheckpointCommit(transition);
    const saved = await this.options.store.save({ commit: receipt });
    if (saved.kind === 'conflict') {
      this.fence();
      return fail('ROOM_ACTOR_CHECKPOINT_CONFLICT');
    }
    this.requireInstallable();
    this.state = cloneState(transition.nextState);
    this.fanout(transition);
    return transition;
  }

  private fanout(transition: ArenaRoomTransitionSuccess): void {
    if (transition.events.length === 0 || this.state === null) return;
    for (const subscriber of this.subscribers) {
      try {
        const completion = subscriber({
          roomId: this.roomId,
          roomEpoch: this.state.snapshot.roomEpoch,
          snapshot: structuredClone(this.state.snapshot),
          events: structuredClone(transition.events),
        });
        void Promise.resolve(completion)
          .catch((error: unknown) => this.reportSubscriberError(error));
      } catch (error) {
        this.reportSubscriberError(error);
      }
    }
  }

  private reportSubscriberError(error: unknown): void {
    try {
      this.options.onSubscriberError(error);
    } catch {
      // Fan-out observers cannot turn an acknowledged checkpoint into a failed command.
    }
  }

  private requireInstallable(): void {
    if (this.phase === 'closed') return fail('ROOM_ACTOR_SHUTTING_DOWN');
    if (this.phase === 'fenced') return fail('ROOM_ACTOR_FENCED');
  }

  private resolveDrainWaitersIfIdle(): void {
    if (!this.isIdle) return;
    for (const resolve of this.drainWaiters) resolve();
    this.drainWaiters.clear();
  }
}

export type RoomActorRegistryOptions = {
  readonly store: RoomActorCheckpointStore;
  readonly maxQueuedCommands?: number;
  readonly maxSubscribersPerRoom?: number;
  readonly maxActors?: number;
  readonly idleActorTtlMs?: number;
  readonly now?: () => number;
  readonly createRoomEpoch?: (roomId: string, previousRoomEpoch: string) => string;
  readonly recoveryTimestamp?: () => string;
  readonly onSubscriberError?: (error: unknown) => void;
  readonly onBackgroundError?: (error: unknown) => void;
};

export type RoomActorRegistryExecuteInput = RoomActorExecuteInput & {
  readonly roomId: string;
};

export class RoomActorRegistry {
  private readonly actors = new Map<string, RoomActor>();
  private readonly hydrations = new Map<string, Promise<RoomActor | null>>();
  private readonly fencedRoomIds = new Set<string>();
  private readonly maxQueuedCommands: number;
  private readonly maxSubscribers: number;
  private readonly idleTtlMs: number;
  private readonly maxActors: number;
  private readonly now: () => number;
  private accepting = true;
  private shutdownPromise: Promise<void> | null = null;
  private idleSweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: RoomActorRegistryOptions) {
    this.maxQueuedCommands = positiveInteger(
      options.maxQueuedCommands ?? DEFAULT_MAX_QUEUED_COMMANDS,
      'maxQueuedCommands',
    );
    this.maxActors = positiveInteger(options.maxActors ?? DEFAULT_MAX_ACTORS, 'maxActors');
    this.maxSubscribers = positiveInteger(
      options.maxSubscribersPerRoom ?? DEFAULT_MAX_SUBSCRIBERS_PER_ROOM,
      'maxSubscribersPerRoom',
    );
    this.idleTtlMs = positiveFinite(
      options.idleActorTtlMs ?? DEFAULT_IDLE_ACTOR_TTL_MS,
      'idleActorTtlMs',
    );
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.actors.size;
  }

  async get(roomId: string): Promise<RoomActor | null> {
    this.requireAccepting();
    if (this.fencedRoomIds.has(roomId)) return fail('ROOM_ACTOR_FENCED');
    const current = this.actors.get(roomId);
    if (current) return current;
    const existingHydration = this.hydrations.get(roomId);
    if (existingHydration) return existingHydration;
    this.requireCapacity();
    const hydration = this.hydrate(roomId).finally(() => {
      if (this.hydrations.get(roomId) === hydration) this.hydrations.delete(roomId);
    });
    this.hydrations.set(roomId, hydration);
    return hydration;
  }

  async execute(input: RoomActorRegistryExecuteInput): Promise<ArenaRoomTransitionResult> {
    this.requireAccepting();
    const command = ArenaRoomCommandSchema.safeParse(input.command);
    const stableInput: RoomActorRegistryExecuteInput = {
      ...input,
      authority: snapshotInputCapability(input.authority),
      command: command.success ? command.data : null,
      trustedTime: snapshotInputCapability(input.trustedTime),
    };
    let actor = await this.get(stableInput.roomId);
    this.requireAccepting();
    if (!actor) {
      actor = this.actors.get(stableInput.roomId) ?? null;
    }
    if (!actor) {
      this.requireCapacity();
      if (
        typeof stableInput.command !== 'object'
        || stableInput.command === null
        || !('type' in stableInput.command)
        || stableInput.command.type !== 'create'
      ) {
        return fail('ROOM_ACTOR_NOT_FOUND');
      }
      actor = this.createActor(stableInput.roomId, null);
      this.actors.set(stableInput.roomId, actor);
    }
    return actor.execute(stableInput);
  }

  stopAccepting(): void {
    if (!this.accepting) return;
    this.accepting = false;
    this.stopIdleSweeper();
    for (const actor of this.actors.values()) actor.stopAccepting();
  }

  startIdleSweeper(intervalMs = 60_000): () => void {
    this.requireAccepting();
    positiveFinite(intervalMs, 'idleSweepIntervalMs');
    if (this.idleSweepTimer !== null) return () => this.stopIdleSweeper();
    this.idleSweepTimer = setInterval(() => {
      void this.evictIdle().catch((error: unknown) => {
        try {
          this.options.onBackgroundError?.(error);
        } catch {
          // A diagnostic hook cannot escape the bounded background sweep.
        }
      });
    }, intervalMs);
    this.idleSweepTimer.unref?.();
    return () => this.stopIdleSweeper();
  }

  async evictIdle(): Promise<number> {
    this.requireAccepting();
    const now = this.now();
    const evictions: Promise<void>[] = [];
    for (const [roomId, actor] of this.actors) {
      if (!actor.isIdleExpired(now, this.idleTtlMs)) continue;
      actor.stopAccepting();
      this.actors.delete(roomId);
      evictions.push(actor.close());
    }
    await Promise.all(evictions);
    return evictions.length;
  }

  shutdown(): Promise<void> {
    this.stopAccepting();
    const pendingHydrations = [...this.hydrations.values()];
    this.shutdownPromise ??= Promise.allSettled(pendingHydrations)
      .then(() => Promise.all([...this.actors.values()].map((actor) => actor.close())))
      .then(() => {
        this.actors.clear();
        this.fencedRoomIds.clear();
        this.hydrations.clear();
      });
    return this.shutdownPromise;
  }

  forceClose(): void {
    this.stopAccepting();
    for (const actor of this.actors.values()) actor.forceClose();
    this.actors.clear();
    this.fencedRoomIds.clear();
    this.hydrations.clear();
  }

  private async hydrate(roomId: string): Promise<RoomActor | null> {
    const checkpoint = await this.options.store.load(roomId);
    this.requireAccepting();
    if (checkpoint === null || checkpoint.lifecycle.status === 'closed') return null;
    const previousRoomEpoch = checkpoint.snapshot.roomEpoch;
    const nextRoomEpoch = (this.options.createRoomEpoch ?? (() => randomUUID()))(
      roomId,
      previousRoomEpoch,
    );
    if (!nextRoomEpoch || nextRoomEpoch === previousRoomEpoch) {
      return fail('ROOM_ACTOR_EPOCH_INVALID');
    }
    const timestamp = (this.options.recoveryTimestamp ?? (() => new Date().toISOString()))();
    const transition = transitionArenaRoom(checkpoint, {
      type: 'recover',
      expectedRoomEpoch: previousRoomEpoch,
      nextRoomEpoch,
      timestamp,
    }, issueArenaRoomRecoveryAuthority({
      roomId,
      previousRoomEpoch,
      nextRoomEpoch,
      timestamp,
    }));
    if (!transition.ok || transition.kind !== 'applied') {
      return fail('ROOM_ACTOR_RECOVERY_INVALID');
    }
    const saved = await this.options.store.save({
      commit: createArenaRoomCheckpointCommit(transition),
    });
    if (saved.kind === 'conflict') {
      this.fencedRoomIds.add(roomId);
      return fail('ROOM_ACTOR_RECOVERY_CONFLICT');
    }
    this.requireAccepting();
    const actor = this.createActor(roomId, transition.nextState);
    this.actors.set(roomId, actor);
    return actor;
  }

  private createActor(roomId: string, state: ArenaRoomAuthorityState | null): RoomActor {
    let actor!: RoomActor;
    actor = new RoomActor(roomId, state, {
      maxQueuedCommands: this.maxQueuedCommands,
      maxSubscribers: this.maxSubscribers,
      now: this.now,
      onFenced: (fencedActor) => {
        if (this.actors.get(roomId) === fencedActor) this.actors.delete(roomId);
        this.fencedRoomIds.add(roomId);
      },
      onSubscriberError: this.options.onSubscriberError ?? (() => undefined),
      store: this.options.store,
    });
    return actor;
  }

  private stopIdleSweeper(): void {
    if (this.idleSweepTimer === null) return;
    clearInterval(this.idleSweepTimer);
    this.idleSweepTimer = null;
  }

  private requireAccepting(): void {
    if (!this.accepting) return fail('ROOM_ACTOR_REGISTRY_SHUTTING_DOWN');
  }

  private requireCapacity(): void {
    if (this.actors.size + this.hydrations.size + this.fencedRoomIds.size >= this.maxActors) {
      return fail('ROOM_ACTOR_REGISTRY_CAPACITY');
    }
  }
}

export const createRoomActorRegistry = (
  options: RoomActorRegistryOptions,
): RoomActorRegistry => new RoomActorRegistry(options);
