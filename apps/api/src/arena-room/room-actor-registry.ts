import { randomUUID } from 'node:crypto';

import {
  RoomEventSchema,
  type ControlRoomEvent,
  type RoomControlCursor,
} from '@mahoshojo/contracts/arena-room';
import {
  ArenaRoomCommandSchema,
  createArenaRoomCheckpointCommit,
  issueArenaRoomDeadlineCloseAuthority,
  issueArenaRoomQuotaCloseAuthority,
  issueArenaRoomRecoveryAuthority,
  parseArenaRoomAuthorityState,
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
  type ArenaRoomCommand,
  type ArenaRoomTransitionResult,
  type ArenaRoomTransitionSuccess,
} from '@mahoshojo/multiplayer-core';

import type { RedisRoomStore } from './redis-room-store';

const DEFAULT_MAX_QUEUED_COMMANDS = 64;
const DEFAULT_MAX_SUBSCRIBERS_PER_ROOM = 128;
const DEFAULT_MAX_ACTORS = 1_024;
const DEFAULT_MAX_FENCED_ROOMS = 1_024;
const DEFAULT_IDLE_ACTOR_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_HOST_OFFLINE_GRACE_MS = 45 * 60 * 1_000;
const DEFAULT_ROOM_IDLE_TTL_MS = 12 * 60 * 60 * 1_000;
const DEFAULT_MAX_REPLAY_EVENTS = 128;
const DEFAULT_CHECKPOINT_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1_000;

export type RoomActorCheckpointStore = Pick<RedisRoomStore, 'load' | 'refresh' | 'save'>;

export type RoomActorErrorCode =
  | 'ROOM_ACTOR_CHECKPOINT_CONFLICT'
  | 'ROOM_ACTOR_CREATE_IDENTITY_CONFLICT'
  | 'ROOM_ACTOR_CREATE_REQUIRES_SERVER_IDENTITY'
  | 'ROOM_ACTOR_EPOCH_INVALID'
  | 'ROOM_ACTOR_FENCED'
  | 'ROOM_ACTOR_NOT_FOUND'
  | 'ROOM_ACTOR_QUOTA_CLOSE_INVALID'
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

const sameState = (
  left: ArenaRoomAuthorityState | null,
  right: ArenaRoomAuthorityState | null,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const snapshotInputCapability = (input: unknown): unknown => {
  if (typeof input === 'object' && input !== null && 'kind' in input) {
    const kind = input.kind;
    if (
      kind === 'generation-reserver'
      || kind === 'generation-publisher'
      || kind === 'room-deadline-closer'
      || kind === 'room-presence'
      || kind === 'room-quota-closer'
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

export type RoomActorControlSync = {
  readonly kind: 'current' | 'replay' | 'snapshot';
  readonly events: readonly ControlRoomEvent[];
};

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

type ExactFenceQuotaReason =
  | 'collaborative-history-limit-reached'
  | 'generation-history-limit-reached'
  | 'member-history-limit-reached'
  | 'proposal-history-limit-reached';

const EXACT_FENCE_QUOTA_REASONS = new Set<ExactFenceQuotaReason>([
  'collaborative-history-limit-reached',
  'generation-history-limit-reached',
  'member-history-limit-reached',
  'proposal-history-limit-reached',
]);

const isExactFenceQuotaReason = (reason: string): reason is ExactFenceQuotaReason => (
  EXACT_FENCE_QUOTA_REASONS.has(reason as ExactFenceQuotaReason)
);

type ExpiredRoomDeadline = {
  readonly kind: 'host-offline' | 'room-idle';
  readonly deadline: string;
};

const expiredDeadline = (
  state: ArenaRoomAuthorityState,
  now: number,
): ExpiredRoomDeadline | null => {
  if (state.lifecycle.status === 'closed') return null;
  const candidates: ExpiredRoomDeadline[] = [];
  if (
    state.deadlines.hostOfflineDeadline !== null
    && Date.parse(state.deadlines.hostOfflineDeadline) <= now
  ) {
    candidates.push({ kind: 'host-offline', deadline: state.deadlines.hostOfflineDeadline });
  }
  if (
    state.deadlines.roomIdleDeadline !== null
    && Date.parse(state.deadlines.roomIdleDeadline) <= now
  ) {
    candidates.push({ kind: 'room-idle', deadline: state.deadlines.roomIdleDeadline });
  }
  candidates.sort((left, right) => Date.parse(left.deadline) - Date.parse(right.deadline)
    || left.kind.localeCompare(right.kind));
  return candidates[0] ?? null;
};

export class RoomActor {
  private phase: ActorPhase = 'accepting';
  private readonly queue: QueueEntry[] = [];
  private readonly subscribers = new Set<RoomActorSubscriber>();
  private readonly drainWaiters = new Set<() => void>();
  private running = false;
  private maintenance = false;
  private lastActivityAt: number;
  private lastCheckpointRefreshAt: number;
  private readonly controlReplay: ControlRoomEvent[] = [];

  constructor(
    readonly roomId: string,
    initialState: ArenaRoomAuthorityState | null,
    private readonly options: {
      readonly maxQueuedCommands: number;
      readonly maxSubscribers: number;
      readonly maxReplayEvents: number;
      readonly initialReplay: readonly ControlRoomEvent[];
      readonly now: () => number;
      readonly onAbandoned: (actor: RoomActor) => void;
      readonly onFenced: (actor: RoomActor) => void;
      readonly onSubscriberError: (error: unknown) => void;
      readonly onBackgroundError: (error: unknown) => void;
      readonly quotaCloseTimestamp: () => string;
      readonly store: RoomActorCheckpointStore;
    },
  ) {
    this.lastActivityAt = options.now();
    this.lastCheckpointRefreshAt = this.lastActivityAt;
    this.state = initialState === null ? null : cloneState(initialState);
    if (this.state !== null && this.state.snapshot.roomId !== roomId) {
      return fail('ROOM_ACTOR_ROOM_ID_MISMATCH');
    }
    this.rememberReplay(options.initialReplay);
  }

  private state: ArenaRoomAuthorityState | null;
  private quotaExhausted = false;
  private quotaExhaustedReason: ExactFenceQuotaReason | null = null;

  getSnapshot(): ArenaRoomAuthorityState | null {
    return this.state === null ? null : cloneState(this.state);
  }

  get isIdle(): boolean {
    return !this.running && !this.maintenance && this.queue.length === 0;
  }

  isIdleExpired(now: number, idleTtlMs: number): boolean {
    if (!this.isIdle || this.subscribers.size > 0) return false;
    if (this.state?.lifecycle.status === 'closed') return true;
    if (
      this.state?.deadlines.hostOfflineDeadline !== null
      || this.state?.deadlines.roomIdleDeadline !== null
    ) return false;
    return now - this.lastActivityAt >= idleTtlMs;
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

  resolveControlSync(cursor?: RoomControlCursor): RoomActorControlSync {
    if (this.state === null) return fail('ROOM_ACTOR_NOT_FOUND');
    const snapshot = this.state.snapshot;
    if (cursor === undefined || cursor.roomEpoch !== snapshot.roomEpoch) {
      return { kind: 'snapshot', events: [this.createSnapshotEvent()] };
    }
    if (cursor.controlSeq === snapshot.controlSeq) {
      return { kind: 'current', events: [] };
    }
    if (cursor.controlSeq > snapshot.controlSeq) {
      return { kind: 'snapshot', events: [this.createSnapshotEvent()] };
    }
    const events = this.controlReplay.filter((event) => (
      event.roomEpoch === snapshot.roomEpoch && event.controlSeq > cursor.controlSeq
    ));
    const contiguous = events.length > 0
      && events[0]?.controlSeq === cursor.controlSeq + 1
      && events.at(-1)?.controlSeq === snapshot.controlSeq
      && events.every((event, index) => (
        index === 0 || event.controlSeq === events[index - 1]!.controlSeq + 1
      ));
    return contiguous
      ? { kind: 'replay', events: structuredClone(events) }
      : { kind: 'snapshot', events: [this.createSnapshotEvent()] };
  }

  subscribeWithControlSync(
    cursor: RoomControlCursor | undefined,
    subscriber: RoomActorSubscriber,
  ): { readonly sync: RoomActorControlSync; readonly unsubscribe: () => void } {
    const unsubscribe = this.subscribe(subscriber);
    try {
      return { sync: this.resolveControlSync(cursor), unsubscribe };
    } catch (error) {
      unsubscribe();
      throw error;
    }
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

  async closeForExpiredDeadline(now: number): Promise<boolean> {
    if (this.phase !== 'accepting' || this.state === null || this.state.lifecycle.status === 'closed') {
      return false;
    }
    const due = expiredDeadline(this.state, now);
    if (!due) return false;
    const timestamp = new Date(now).toISOString();
    const result = await this.execute({
      authority: issueArenaRoomDeadlineCloseAuthority({
        roomId: this.roomId,
        roomEpoch: this.state.snapshot.roomEpoch,
        deadlineKind: due.kind,
        deadline: due.deadline,
      }),
      command: {
        type: 'close',
        expectedRoomEpoch: this.state.snapshot.roomEpoch,
        reason: due.kind === 'host-offline' ? 'host-offline-timeout' : 'room-idle-timeout',
        timestamp,
      },
    });
    return result.ok && result.kind === 'applied';
  }

  isCheckpointRefreshDue(now: number, intervalMs: number): boolean {
    return this.phase === 'accepting'
      && this.state?.lifecycle.status === 'open'
      && now - this.lastCheckpointRefreshAt >= intervalMs;
  }

  async refreshCheckpoint(now: number): Promise<boolean> {
    if (!this.isIdle || this.phase !== 'accepting' || this.state?.lifecycle.status !== 'open') {
      return false;
    }
    this.maintenance = true;
    const checkpoint = cloneState(this.state);
    try {
      const result = await this.options.store.refresh({ checkpoint });
      if (this.phase !== 'accepting') return false;
      if (result.kind !== 'refreshed') {
        this.fence();
        return false;
      }
      this.lastCheckpointRefreshAt = now;
      return true;
    } finally {
      this.maintenance = false;
      this.lastActivityAt = this.options.now();
      this.pump();
      this.resolveDrainWaitersIfIdle();
    }
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
    if (this.running || this.maintenance) return;
    const entry = this.queue.shift();
    if (!entry) {
      this.resolveDrainWaitersIfIdle();
      if (this.state === null && this.phase === 'accepting') this.options.onAbandoned(this);
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
    if (
      this.quotaExhausted
      && typeof input.command === 'object'
      && input.command !== null
      && 'type' in input.command
      && input.command.type !== 'close'
    ) {
      const failureReason = this.quotaExhaustedReason;
      if (failureReason === null) return fail('ROOM_ACTOR_QUOTA_CLOSE_INVALID');
      await this.enforceQuotaClose();
      return {
        ok: false,
        code: 'capability-denied',
        reason: failureReason,
      };
    }
    const transition = transitionArenaRoom(
      this.state,
      input.command,
      input.authority,
      input.trustedTime,
    );
    if (!transition.ok) {
      if (
        transition.code === 'capability-denied'
        && isExactFenceQuotaReason(transition.reason)
      ) {
        this.quotaExhausted = true;
        this.quotaExhaustedReason = transition.reason;
        await this.enforceQuotaClose();
      }
      return transition;
    }
    if (transition.kind === 'idempotent') {
      const current = await this.options.store.load(this.roomId);
      if (!sameState(current, this.state)) {
        this.fence();
        return fail('ROOM_ACTOR_CHECKPOINT_CONFLICT');
      }
      return transition;
    }
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
    this.lastCheckpointRefreshAt = this.options.now();
    this.rememberReplay(transition.events);
    this.fanout(transition);
    return transition;
  }

  async closeForQuota(): Promise<void> {
    this.quotaExhausted = true;
    await this.enforceQuotaClose();
  }

  private async enforceQuotaClose(): Promise<void> {
    if (this.state === null || this.state.lifecycle.status === 'closed') {
      this.quotaExhausted = false;
      this.quotaExhaustedReason = null;
      return;
    }
    const suppliedTimestamp = this.options.quotaCloseTimestamp();
    const timestamp = Date.parse(suppliedTimestamp) < Date.parse(this.state.lifecycle.updatedAt)
      ? this.state.lifecycle.updatedAt
      : suppliedTimestamp;
    const reason = 'room-incarnation-limit' as const;
    const transition = transitionArenaRoom(this.state, {
      type: 'close',
      expectedRoomEpoch: this.state.snapshot.roomEpoch,
      reason,
      timestamp,
    }, issueArenaRoomQuotaCloseAuthority({
      roomId: this.roomId,
      roomEpoch: this.state.snapshot.roomEpoch,
      reason,
      timestamp,
    }));
    if (!transition.ok || transition.kind !== 'applied') {
      return fail('ROOM_ACTOR_QUOTA_CLOSE_INVALID');
    }
    let saved: { readonly kind: 'conflict' | 'saved' };
    try {
      saved = await this.options.store.save({
        commit: createArenaRoomCheckpointCommit(transition),
      });
    } catch (error) {
      try {
        this.options.onBackgroundError(error);
      } catch {
        // Diagnostic hooks never weaken the local close-only fence.
      }
      return;
    }
    if (saved.kind === 'conflict') {
      this.fence();
      return fail('ROOM_ACTOR_CHECKPOINT_CONFLICT');
    }
    this.requireInstallable();
    this.state = cloneState(transition.nextState);
    this.lastCheckpointRefreshAt = this.options.now();
    this.quotaExhausted = false;
    this.quotaExhaustedReason = null;
    this.rememberReplay(transition.events);
    this.fanout(transition);
  }

  private createSnapshotEvent(): ControlRoomEvent {
    if (this.state === null) return fail('ROOM_ACTOR_NOT_FOUND');
    const event = RoomEventSchema.parse({
      protocolVersion: this.state.snapshot.protocolVersion,
      roomId: this.roomId,
      roomEpoch: this.state.snapshot.roomEpoch,
      type: 'room.snapshot',
      controlSeq: this.state.snapshot.controlSeq,
      timestamp: this.state.lifecycle.updatedAt,
      payload: structuredClone(this.state.snapshot),
    });
    if (event.type === 'story.delta') return fail('ROOM_ACTOR_ROOM_ID_MISMATCH');
    return event;
  }

  private rememberReplay(events: readonly ControlRoomEvent[]): void {
    for (const event of events) {
      if (event.roomEpoch !== this.state?.snapshot.roomEpoch) continue;
      this.controlReplay.push(structuredClone(event));
    }
    if (this.controlReplay.length > this.options.maxReplayEvents) {
      this.controlReplay.splice(0, this.controlReplay.length - this.options.maxReplayEvents);
    }
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
        if (
          (typeof completion === 'object' && completion !== null)
          || typeof completion === 'function'
        ) {
          if ('then' in completion) {
            this.subscribers.delete(subscriber);
            void Promise.resolve(completion)
              .catch((error: unknown) => this.reportSubscriberError(error));
          }
        }
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
  readonly maxFencedRooms?: number;
  readonly idleActorTtlMs?: number;
  readonly hostOfflineGraceMs?: number;
  readonly roomIdleTtlMs?: number;
  readonly maxReplayEvents?: number;
  readonly checkpointRefreshIntervalMs?: number;
  readonly now?: () => number;
  readonly createRoomIdentity?: () => {
    readonly roomId: string;
    readonly roomEpoch: string;
  };
  readonly createTimestamp?: () => string;
  readonly createRoomEpoch?: (roomId: string, previousRoomEpoch: string) => string;
  readonly recoveryTimestamp?: () => string;
  readonly quotaCloseTimestamp?: () => string;
  readonly onSubscriberError?: (error: unknown) => void;
  readonly onBackgroundError?: (error: unknown) => void;
};

export type RoomActorRegistryExecuteInput = RoomActorExecuteInput & {
  readonly roomId: string;
};

type ArenaRoomCreateCommand = Extract<ArenaRoomCommand, { readonly type: 'create' }>;

export type RoomActorRegistryCreateInput = {
  readonly host: Pick<ArenaRoomCreateCommand['host'], 'displayName' | 'userId'>;
  readonly sharedConfig: ArenaRoomCreateCommand['sharedConfig'];
  readonly authority: unknown;
};

export type RoomActorRegistryCreateResult = {
  readonly roomId: string;
  readonly roomEpoch: string;
  readonly result: ArenaRoomTransitionResult;
};

export class RoomActorRegistry {
  private readonly actors = new Map<string, RoomActor>();
  private readonly hydrations = new Map<string, Promise<RoomActor | null>>();
  private readonly fencedRoomIds = new Map<string, true>();
  private readonly maxQueuedCommands: number;
  private readonly maxSubscribers: number;
  private readonly idleTtlMs: number;
  private readonly maxActors: number;
  private readonly maxFencedRooms: number;
  private readonly maxReplayEvents: number;
  private readonly hostOfflineGraceMs: number;
  private readonly roomIdleTtlMs: number;
  private readonly checkpointRefreshIntervalMs: number;
  private readonly now: () => number;
  private accepting = true;
  private shutdownPromise: Promise<void> | null = null;
  private idleSweepTimer: ReturnType<typeof setInterval> | null = null;
  private runtimeSweepPromise: Promise<void> | null = null;

  constructor(private readonly options: RoomActorRegistryOptions) {
    this.maxQueuedCommands = positiveInteger(
      options.maxQueuedCommands ?? DEFAULT_MAX_QUEUED_COMMANDS,
      'maxQueuedCommands',
    );
    this.maxActors = positiveInteger(options.maxActors ?? DEFAULT_MAX_ACTORS, 'maxActors');
    this.maxFencedRooms = positiveInteger(
      options.maxFencedRooms ?? DEFAULT_MAX_FENCED_ROOMS,
      'maxFencedRooms',
    );
    this.maxSubscribers = positiveInteger(
      options.maxSubscribersPerRoom ?? DEFAULT_MAX_SUBSCRIBERS_PER_ROOM,
      'maxSubscribersPerRoom',
    );
    this.maxReplayEvents = positiveInteger(
      options.maxReplayEvents ?? DEFAULT_MAX_REPLAY_EVENTS,
      'maxReplayEvents',
    );
    this.hostOfflineGraceMs = positiveFinite(
      options.hostOfflineGraceMs ?? DEFAULT_HOST_OFFLINE_GRACE_MS,
      'hostOfflineGraceMs',
    );
    this.roomIdleTtlMs = positiveFinite(
      options.roomIdleTtlMs ?? DEFAULT_ROOM_IDLE_TTL_MS,
      'roomIdleTtlMs',
    );
    this.checkpointRefreshIntervalMs = positiveFinite(
      options.checkpointRefreshIntervalMs ?? DEFAULT_CHECKPOINT_REFRESH_INTERVAL_MS,
      'checkpointRefreshIntervalMs',
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

  get(roomId: string): RoomActor | null {
    this.requireAccepting();
    if (this.fencedRoomIds.has(roomId)) return fail('ROOM_ACTOR_FENCED');
    return this.actors.get(roomId) ?? null;
  }

  async recover(roomId: string): Promise<RoomActor | null> {
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

  async create(input: RoomActorRegistryCreateInput): Promise<RoomActorRegistryCreateResult> {
    this.requireAccepting();
    const identity = (this.options.createRoomIdentity ?? (() => ({
      roomId: randomUUID(),
      roomEpoch: randomUUID(),
    })))();
    const timestamp = (this.options.createTimestamp ?? (() => new Date().toISOString()))();
    const timestampMs = Date.parse(timestamp);
    const deadlines = {
      hostOfflineDeadline: new Date(timestampMs + this.hostOfflineGraceMs).toISOString(),
      roomIdleDeadline: new Date(timestampMs + this.roomIdleTtlMs).toISOString(),
    };
    const command = ArenaRoomCommandSchema.safeParse({
      type: 'create',
      roomId: identity.roomId,
      roomEpoch: identity.roomEpoch,
      host: {
        ...input.host,
        role: 'host',
        membershipState: 'active',
        joinedAt: timestamp,
      },
      sharedConfig: input.sharedConfig,
      deadlines,
      timestamp,
    });
    if (!command.success || command.data.type !== 'create') {
      return {
        ...identity,
        result: {
          ok: false,
          code: 'validation-failed',
          reason: 'invalid-command',
        },
      };
    }
    if (
      this.actors.has(identity.roomId)
      || this.hydrations.has(identity.roomId)
      || this.fencedRoomIds.has(identity.roomId)
    ) return fail('ROOM_ACTOR_CREATE_IDENTITY_CONFLICT');
    this.requireCapacity();
    const actor = this.createActor(identity.roomId, null);
    this.actors.set(identity.roomId, actor);
    const result = await actor.execute({
      authority: snapshotInputCapability(input.authority),
      command: command.data,
    });
    return { ...identity, result };
  }

  async execute(input: RoomActorRegistryExecuteInput): Promise<ArenaRoomTransitionResult> {
    this.requireAccepting();
    const command = ArenaRoomCommandSchema.safeParse(input.command);
    if (!command.success) {
      return {
        ok: false,
        code: 'validation-failed',
        reason: 'invalid-command',
      };
    }
    if (command.data.type === 'create') {
      return fail('ROOM_ACTOR_CREATE_REQUIRES_SERVER_IDENTITY');
    }
    const stableInput: RoomActorRegistryExecuteInput = {
      ...input,
      authority: snapshotInputCapability(input.authority),
      command: command.data,
      trustedTime: snapshotInputCapability(input.trustedTime),
    };
    if (this.fencedRoomIds.has(stableInput.roomId)) return fail('ROOM_ACTOR_FENCED');
    let actor = this.actors.get(stableInput.roomId) ?? null;
    const hydration = this.hydrations.get(stableInput.roomId);
    if (!actor && hydration) actor = await hydration;
    this.requireAccepting();
    if (!actor) return fail('ROOM_ACTOR_NOT_FOUND');
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
      if (this.runtimeSweepPromise) return;
      this.runtimeSweepPromise = this.sweepRuntime().catch((error: unknown) => {
        try {
          this.options.onBackgroundError?.(error);
        } catch {
          // A diagnostic hook cannot escape the bounded background sweep.
        }
      }).finally(() => {
        this.runtimeSweepPromise = null;
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

  async expireDeadlines(): Promise<number> {
    this.requireAccepting();
    const now = this.now();
    const results = await Promise.all([...this.actors.values()].map((actor) => (
      actor.closeForExpiredDeadline(now)
    )));
    return results.filter(Boolean).length;
  }

  async refreshActiveCheckpoints(): Promise<number> {
    this.requireAccepting();
    const now = this.now();
    let refreshed = 0;
    for (const actor of [...this.actors.values()]) {
      if (!actor.isCheckpointRefreshDue(now, this.checkpointRefreshIntervalMs)) continue;
      if (await actor.refreshCheckpoint(now)) refreshed += 1;
    }
    return refreshed;
  }

  async sweepRuntime(): Promise<void> {
    await this.expireDeadlines();
    await this.refreshActiveCheckpoints();
    await this.evictIdle();
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
    if (checkpoint === null) return null;
    if (checkpoint.lifecycle.status === 'closed') {
      const actor = this.createActor(roomId, checkpoint);
      this.actors.set(roomId, actor);
      return actor;
    }
    const now = this.now();
    const due = expiredDeadline(checkpoint, now);
    if (due) {
      const timestamp = new Date(now).toISOString();
      const transition = transitionArenaRoom(checkpoint, {
        type: 'close',
        expectedRoomEpoch: checkpoint.snapshot.roomEpoch,
        reason: due.kind === 'host-offline' ? 'host-offline-timeout' : 'room-idle-timeout',
        timestamp,
      }, issueArenaRoomDeadlineCloseAuthority({
        roomId,
        roomEpoch: checkpoint.snapshot.roomEpoch,
        deadlineKind: due.kind,
        deadline: due.deadline,
      }));
      if (!transition.ok || transition.kind !== 'applied') {
        return fail('ROOM_ACTOR_RECOVERY_INVALID');
      }
      const saved = await this.options.store.save({
        commit: createArenaRoomCheckpointCommit(transition),
      });
      if (saved.kind === 'conflict') {
        this.rememberFenced(roomId);
        return fail('ROOM_ACTOR_RECOVERY_CONFLICT');
      }
      this.requireAccepting();
      const actor = this.createActor(roomId, transition.nextState, transition.events);
      this.actors.set(roomId, actor);
      return actor;
    }
    const previousRoomEpoch = checkpoint.snapshot.roomEpoch;
    const nextRoomEpoch = (this.options.createRoomEpoch ?? (() => randomUUID()))(
      roomId,
      previousRoomEpoch,
    );
    if (!nextRoomEpoch || nextRoomEpoch === previousRoomEpoch) {
      return fail('ROOM_ACTOR_EPOCH_INVALID');
    }
    const timestamp = (this.options.recoveryTimestamp ?? (() => new Date().toISOString()))();
    const timestampMs = Date.parse(timestamp);
    const absentPresenceDeadlines = {
      hostOfflineDeadline: new Date(timestampMs + this.hostOfflineGraceMs).toISOString(),
      roomIdleDeadline: new Date(timestampMs + this.roomIdleTtlMs).toISOString(),
    };
    const transition = transitionArenaRoom(checkpoint, {
      type: 'recover',
      expectedRoomEpoch: previousRoomEpoch,
      nextRoomEpoch,
      absentPresenceDeadlines,
      timestamp,
    }, issueArenaRoomRecoveryAuthority({
      roomId,
      previousRoomEpoch,
      nextRoomEpoch,
      absentPresenceDeadlines,
      timestamp,
    }));
    if (!transition.ok || transition.kind !== 'applied') {
      return fail('ROOM_ACTOR_RECOVERY_INVALID');
    }
    let saved;
    try {
      saved = await this.options.store.save({
        commit: createArenaRoomCheckpointCommit(transition),
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'REDIS_ROOM_INCARNATION_LIMIT') throw error;
      const actor = this.createActor(roomId, checkpoint);
      this.actors.set(roomId, actor);
      await actor.closeForQuota();
      return actor;
    }
    if (saved.kind === 'conflict') {
      this.rememberFenced(roomId);
      return fail('ROOM_ACTOR_RECOVERY_CONFLICT');
    }
    this.requireAccepting();
    const actor = this.createActor(roomId, transition.nextState, transition.events);
    this.actors.set(roomId, actor);
    return actor;
  }

  private createActor(
    roomId: string,
    state: ArenaRoomAuthorityState | null,
    initialReplay: readonly ControlRoomEvent[] = [],
  ): RoomActor {
    let actor!: RoomActor;
    actor = new RoomActor(roomId, state, {
      maxQueuedCommands: this.maxQueuedCommands,
      maxSubscribers: this.maxSubscribers,
      maxReplayEvents: this.maxReplayEvents,
      initialReplay,
      now: this.now,
      onAbandoned: (abandonedActor) => {
        if (this.actors.get(roomId) === abandonedActor) this.actors.delete(roomId);
        abandonedActor.forceClose();
      },
      onFenced: (fencedActor) => {
        if (this.actors.get(roomId) === fencedActor) this.actors.delete(roomId);
        this.rememberFenced(roomId);
      },
      onSubscriberError: this.options.onSubscriberError ?? (() => undefined),
      onBackgroundError: this.options.onBackgroundError ?? (() => undefined),
      quotaCloseTimestamp: this.options.quotaCloseTimestamp ?? (() => new Date().toISOString()),
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
    if (this.actors.size + this.hydrations.size >= this.maxActors) {
      return fail('ROOM_ACTOR_REGISTRY_CAPACITY');
    }
  }

  private rememberFenced(roomId: string): void {
    this.fencedRoomIds.delete(roomId);
    this.fencedRoomIds.set(roomId, true);
    while (this.fencedRoomIds.size > this.maxFencedRooms) {
      const oldest = this.fencedRoomIds.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.fencedRoomIds.delete(oldest);
    }
  }
}

export const createRoomActorRegistry = (
  options: RoomActorRegistryOptions,
): RoomActorRegistry => new RoomActorRegistry(options);
