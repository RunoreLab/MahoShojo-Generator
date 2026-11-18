import {
  ROOM_GENERATION_START_GATE_VERSION,
  hashRoomProducerToken,
  readRoomStartContext,
  readRoomCancelContext,
  roomGenerationLegacyPayloadHash,
  sameRoomGenerationAdmission,
  type RoomGenerationAdmission,
  type RoomStartContextData,
  type ArenaGenerationRoomStartContext,
  type ArenaGenerationRoomCancelContext,
} from './room-start';
export {
  ROOM_GENERATION_START_GATE_VERSION, ROOM_GENERATION_LEGACY_START_VERSION,
  issueArenaGenerationRoomStartContext, issueArenaGenerationRoomCancelContext,
  hashRoomProducerToken, roomGenerationLegacyPayloadHash, isRoomGenerationAdmission, sameRoomGenerationAdmission,
  type RoomGenerationAdmission, type ArenaGenerationRoomStartContext, type ArenaGenerationRoomCancelContext,
} from './room-start';

import { subscriptionToSseResponse } from './sse-response';
import {
  compareGenerationSseIds,
  encodeGenerationSseEvent,
  resolveResumeCursor,
} from './sse';
import type { SafePublicAiErrorProjection } from '../regular-generation';
import { getPublicAiErrorMessage } from '../regular-generation';
import { ARENA_RESOURCE_BUDGET } from './resource-budget';
import { extractArenaMultiplayerParticipation, type ArenaMultiplayerParticipation } from '@mahoshojo/contracts/arena-room';
import { WebPackageArtifactSchema, type WebPackageArtifact } from '@mahoshojo/contracts/web-package';
import { ARENA_STORY_PROTOCOL_VERSION, ArenaStoryIdentitySchema, type ArenaStoryIdentity } from '@mahoshojo/contracts/arena-story';
import { ARENA_GENERATION_DISPATCHED_HEADER } from '../hosted-dr';

export const MAX_ARENA_CREATE_BODY_BYTES = ARENA_RESOURCE_BUDGET.hardBodyBytes;
export const MAX_ARENA_CANCEL_BODY_BYTES = ARENA_RESOURCE_BUDGET.cancelBodyBytes;
export const ARENA_PREPARATION_SEED_BYTES = 32;
export const ARENA_SEEDED_RESERVATION_HASH_VERSION = 'arena-seeded-reservation-v1';
const ARENA_PREPARATION_SEED_PATTERN = new RegExp(
  `^[a-f0-9]{${ARENA_PREPARATION_SEED_BYTES * 2}}$`,
  'u',
);

export const isArenaPreparationSeed = (value: unknown): value is string => (
  typeof value === 'string'
  && ARENA_PREPARATION_SEED_PATTERN.test(value)
);

export const isArenaPreparationVersion = (value: unknown): value is string => (
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(value)
);

export class ArenaGenerationFinalizationPendingError extends Error {
  readonly originalError: unknown;

  constructor(originalError?: unknown) {
    super('ARENA_GENERATION_FINALIZATION_PENDING');
    this.name = 'ArenaGenerationFinalizationPendingError';
    this.originalError = originalError;
  }
}

const addSmallDecimal = (value: string, increment: 1 | 2): string => {
  const digits = value.split('');
  let carry: number = increment;
  for (let index = digits.length - 1; index >= 0 && carry > 0; index -= 1) {
    const sum = Number(digits[index]) + carry;
    digits[index] = String(sum % 10);
    carry = Math.floor(sum / 10);
  }
  return carry > 0 ? `${carry}${digits.join('')}` : digits.join('');
};

export type GenerationStatus =
  | 'reserved'
  | 'running'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'producer_lost';

export type GenerationEventInput = {
  type: string;
  data: unknown;
};

export type GenerationStreamEvent = GenerationEventInput & {
  id: string;
};

export const ARENA_OUTPUT_NOT_ARCHIVED_WARNING = 'OUTPUT_NOT_ARCHIVED' as const;
export const ARENA_PERSISTENCE_UNAVAILABLE_WARNING = 'PERSISTENCE_UNAVAILABLE' as const;
export type ArenaGenerationPersistenceWarning =
  | typeof ARENA_OUTPUT_NOT_ARCHIVED_WARNING
  | typeof ARENA_PERSISTENCE_UNAVAILABLE_WARNING;

export const isArenaGenerationPersistenceWarning = (
  value: unknown,
): value is ArenaGenerationPersistenceWarning => (
  value === ARENA_OUTPUT_NOT_ARCHIVED_WARNING
  || value === ARENA_PERSISTENCE_UNAVAILABLE_WARNING
);

export type GenerationSnapshot = {
  status: GenerationStatus;
  markdown: string;
  reasoning: string;
  lastEventId: string | null;
  updatedAt: string;
  telemetry?: Record<string, unknown> | null;
  terminalResultRef?: string | null;
  persistenceWarning?: ArenaGenerationPersistenceWarning | null;
};

export type GenerationTerminal = {
  status: Extract<GenerationStatus, 'completed' | 'failed' | 'cancelled' | 'producer_lost'>;
  /** Internal replay evidence only. Absence is legacy/unknown, never proof of complete deltas. */
  replayUncertain?: boolean;
  code?: string;
  resultRef?: string | null;
  persistenceWarning?: ArenaGenerationPersistenceWarning;
  publicError?: SafePublicAiErrorProjection;
  webPackage?: WebPackageArtifact;
};

export type GenerationCancelReason = 'user' | 'content_policy';

export const isGenerationCancelReason = (value: unknown): value is GenerationCancelReason =>
  value === 'user' || value === 'content_policy';

export const generationCancelCode = (reason: GenerationCancelReason): string =>
  reason === 'content_policy' ? 'CONTENT_POLICY_CANCELLED' : 'USER_CANCELLED';

export const isArenaGenerationDispatchReady = (input: Readonly<{
  d1Available: boolean;
  signatureSecret: string;
  finalizationBridgeReady: boolean;
}>): boolean => (
  input.d1Available
  && input.signatureSecret.trim().length >= 32
  && input.finalizationBridgeReady
);

export type GenerationReplayStoreState = {
  multiplayerParticipation?: ArenaMultiplayerParticipation;
  roomAdmission?: RoomGenerationAdmission;
  producerTokenDigest?: string;
  actorKey: string;
  generationId: string;
  generationRequestId: string;
  payloadHash: string;
  mode?: string | null;
  producerToken: string;
  status: GenerationStatus;
  lastEventId: string | null;
  updatedAt: string;
  leaseExpiresAt: string | null;
  snapshot: GenerationSnapshot | null;
  terminal: GenerationTerminal | null;
  /** Terminal selected after complete Provider output, before auxiliary persistence settles. */
  intendedTerminal?: GenerationTerminal | null;
  cancelRequested: boolean;
  cancelReason?: GenerationCancelReason | null;
  preparationSeed?: string | null;
  preparationVersion?: string | null;
};

export interface GenerationReplayStore {
  reserve(_input: {
    roomAdmission?: RoomGenerationAdmission;
    producerTokenDigest?: string;
    multiplayerParticipation?: ArenaMultiplayerParticipation;
    actorKey: string;
    generationRequestId: string;
    generationId: string;
    payloadHash: string;
    preparationSeed?: string;
    preparationVersion?: string;
    producerToken: string;
    now: string;
    leaseExpiresAt: string;
    mode?: string;
  }): Promise<
    | {
      kind: 'created';
      generationId: string;
      preparationSeed?: string | null;
      preparationVersion?: string | null;
    }
    | {
      kind: 'reused';
      generationId: string;
      preparationSeed?: string | null;
      preparationVersion?: string | null;
    }
    | { kind: 'conflict' }
  >;
  markRunning(_input: {
    roomAdmission?: RoomGenerationAdmission;
    generationId: string;
    producerToken: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<{
    owned: boolean;
    cancelRequested: boolean;
    cancelReason?: GenerationCancelReason | null;
  }>;
  claimFinalization(_input: {
    generationId: string;
    producerToken: string;
    now: string;
    leaseExpiresAt: string;
    terminal?: GenerationTerminal;
  }): Promise<ArenaGenerationFinalizationClaim>;
  claimLeaseExpiry(_input: {
    generationId: string;
    actorKey: string;
    reaperToken: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<
    | {
      kind: 'claimed';
      generationRequestId: string;
      payloadHash: string;
      mode: string | null;
      intendedTerminal?: GenerationTerminal | null;
    }
    | { kind: 'terminal'; status: GenerationTerminal['status'] }
    | { kind: 'not-expired' }
    | { kind: 'forbidden' }
    | { kind: 'not-found' }
  >;
  releaseReservation(_input: {
    generationId: string;
    producerToken: string;
  }): Promise<{ released: boolean }>;
  heartbeat(_input: {
    generationId: string;
    producerToken: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<{
    owned: boolean;
    cancelRequested: boolean;
    cancelReason?: GenerationCancelReason | null;
  }>;
  appendEvents(_input: {
    generationId: string;
    producerToken: string;
    events: GenerationEventInput[];
    now: string;
  }): Promise<{ owned: boolean; events: GenerationStreamEvent[] }>;
  writeSnapshot(_input: {
    generationId: string;
    producerToken: string;
    snapshot: GenerationSnapshot;
    now: string;
  }): Promise<{ owned: boolean }>;
  readSnapshot(_input: { generationId: string }): Promise<GenerationSnapshot | null>;
  /** Reads one exact retained event without applying the bounded subscriber batch limit. */
  readEvent(_input: {
    generationId: string;
    eventId: string;
  }): Promise<GenerationStreamEvent | null>;
  readAfter(_input: {
    generationId: string;
    after: string | null;
    blockMs: number;
  }): Promise<
    | { kind: 'events'; events: GenerationStreamEvent[] }
    | { kind: 'window-lost'; events: GenerationStreamEvent[] }
    | { kind: 'stream-missing'; events: GenerationStreamEvent[] }
  >;
  markTerminal(_input: {
    generationId: string;
    producerToken: string;
    terminal: GenerationTerminal;
    /** Written in the same store transaction as the terminal marker. */
    terminalEvent: GenerationEventInput;
    now: string;
  } & (
    | {
      /** Terminal snapshot committed atomically with marker/event. */
      terminalSnapshot: GenerationSnapshot;
      clearTerminalSnapshot?: false;
    }
    | {
      terminalSnapshot?: never;
      /** Atomically removes an older running snapshot when no bounded terminal snapshot fits. */
      clearTerminalSnapshot: true;
    }
  )): Promise<{
    owned: boolean;
    applied: boolean;
    status?: GenerationTerminal['status'];
    event?: GenerationStreamEvent;
  }>;
  readState(_input: {
    generationId: string;
    actorKey?: string;
  }): Promise<GenerationReplayStoreState | null>;
  requestCancel(_input: {
    generationId: string;
    actorKey: string;
    reason: GenerationCancelReason;
    now: string;
    preCancelRequestId?: string;
    roomAdmission?: RoomGenerationAdmission;
    producerTokenDigest?: string | null;
  }): Promise<
    | { kind: 'accepted'; cancelReason: GenerationCancelReason; previousStatus?: 'reserved' | 'running' }
    | { kind: 'finalizing' }
    | { kind: 'terminal'; status: GenerationTerminal['status'] }
    | { kind: 'forbidden' }
    | { kind: 'not-found' }
  >;
}

export type ArenaGenerationExecutionInput = {
  generationId: string;
  generationRequestId: string;
  actorKey: string;
  producerToken: string;
  payloadHash: string;
  payload: Record<string, unknown>;
  signal: AbortSignal;
  emit: (_event: GenerationEventInput) => Promise<void>;
  claimFinalization(_terminal: GenerationTerminal): Promise<ArenaGenerationFinalizationClaim>;
};

export type ArenaGenerationFinalizationClaim =
  | { kind: 'claimed' }
  | { kind: 'cancelled'; cancelReason?: GenerationCancelReason }
  | { kind: 'fenced' };

export type PreparedArenaGeneration = {
  executionPayload: Record<string, unknown>;
  semanticPayload: Record<string, unknown>;
  responseHeaders?: Readonly<Record<string, string>>;
};

export type PreflightedArenaGeneration = {
  materializationPayload: Record<string, unknown>;
  semanticPayload: Record<string, unknown>;
};

export type ArenaTrustedPvpContext = Readonly<{
  roomId: string;
  matchId: string;
  roundId: string;
}>;

export const ARENA_GENERATION_TERMINAL_STATUS_HEADER =
  'x-mahoshojo-generation-terminal-status';

export type ArenaGenerationAuditableRejection = Readonly<{
  kind: 'auditable-rejection';
  response: Response;
  actorKey: string;
  generationRequestId: string;
  code: string;
  stage: string;
  fingerprintPayload: Record<string, unknown>;
  audit: Readonly<{
    endpoint: string;
    generationMode: 'stream' | 'non-stream';
    startedAt: string;
    mode: string;
    pvpContext: ArenaTrustedPvpContext;
  }>;
}>;

export const isArenaGenerationAuditableRejection = (
  value: unknown,
): value is ArenaGenerationAuditableRejection => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && (value as { kind?: unknown }).kind === 'auditable-rejection'
  && (value as { response?: unknown }).response instanceof Response,
);

export type MaterializedArenaGeneration = Omit<
  PreparedArenaGeneration,
  'semanticPayload'
>;

export interface ArenaGenerationExecutor {
  materializationVersion?: string;
  preflight?(_input: {
    request: Request;
    actorKey: string;
    generationRequestId: string;
    payload: Record<string, unknown>;
  }): Promise<PreflightedArenaGeneration | ArenaGenerationAuditableRejection | Response>;
  materialize?(_input: {
    request: Request;
    actorKey: string;
    generationRequestId: string;
    payload: Record<string, unknown>;
    preparationSeed: string;
    preparationVersion: string;
  }): Promise<MaterializedArenaGeneration | ArenaGenerationAuditableRejection | Response>;
  prepare?(_input: {
    request: Request;
    actorKey: string;
    generationRequestId: string;
    payload: Record<string, unknown>;
  }): Promise<PreparedArenaGeneration | ArenaGenerationAuditableRejection | Response>;
  execute(_input: ArenaGenerationExecutionInput): Promise<GenerationTerminal>;
}

export type ArenaGenerationTerminalRecord = {
  /** Only canonical usage and display model; never provider diagnostics or reasoning text. */
  telemetry?: Record<string, unknown>;
  generationId: string;
  generationRequestId: string;
  status: GenerationTerminal['status'];
  updatedAt: string;
  resultRef: string | null;
  markdown: string;
  reasoning: string;
  errorCode?: string | null;
  payloadHash?: string | null;
  persistenceWarning?: ArenaGenerationPersistenceWarning | null;
  contentAvailable?: boolean;
  contentUnavailableReason?: 'not-archived' | 'not-found' | 'temporary' | null;
  /** Strictly sanitized by the durable terminal adapter; callers must parse again at wire boundary. */
  roomSafeResult?: Readonly<Record<string, unknown>> | null;
  webPackage?: WebPackageArtifact;
};

export interface ArenaGenerationTerminalStore {
  readOwnedTerminal(_input: {
    generationId: string;
    actorKey: string;
  }): Promise<ArenaGenerationTerminalRecord | null>;
  inspectOwnedFinalization?(_input: {
    generationId: string;
    actorKey: string;
  }): Promise<
    | { kind: 'not-found' }
    | { kind: 'pending'; payloadHash: string | null }
    | { kind: 'terminal'; terminal: ArenaGenerationTerminalRecord }
  >;
  reconcileExpiredLease?(_input: {
    multiplayerParticipation?: ArenaMultiplayerParticipation;
    generationId: string;
    generationRequestId: string;
    actorKey: string;
    payloadHash: string;
    mode: string | null;
    updatedAt: string;
    code: string;
  }): Promise<ArenaGenerationTerminalRecord>;
}

export type ArenaGenerationRejectedTerminalRecordInput = Readonly<{
  generationId: string;
  generationRequestId: string;
  actorKey: string;
  payloadHash: string;
  code: string;
  stage: string;
  endpoint: string;
  generationMode: 'stream' | 'non-stream';
  startedAt: string;
  mode: string;
  pvpContext: ArenaTrustedPvpContext;
}>;

export type ArenaGenerationNoProviderCancellationInput = Readonly<{
  admission: RoomGenerationAdmission;
  /** A seeded hash is allowed only when proved by the exact current core record. */
  acceptedPayloadHashes?: readonly string[];
}>;
export interface ArenaGenerationNoProviderCancellationRecorder {
  record(_input: ArenaGenerationNoProviderCancellationInput): Promise<
    | { kind: 'recorded' }
    | { kind: 'already-terminal' }
    | { kind: 'pending' | 'conflict' | 'unavailable' | 'unknown' }
  >;
}

export interface ArenaGenerationRejectedTerminalRecorder {
  record(_input: ArenaGenerationRejectedTerminalRecordInput): Promise<
    | { kind: 'recorded' }
    | { kind: 'conflict' }
  >;
}

export type ArenaGenerationObservation =
  | {
    event: 'companion';
    operation: 'arena/generate'
      | 'generate-battle-story'
      | 'arena/session/generate-next'
      | 'arena/repair-combatant-meta';
    placement: 'hono-primary' | 'next-dr';
    outcome: 'success' | 'rejected' | 'failure' | 'cancelled';
    durationMs: number;
  }
  | {
    event: 'request';
    generationId: string;
    outcome: 'created' | 'reused' | 'conflict' | 'unavailable';
    inputBytes: number;
  }
  | { event: 'client_disconnect'; generationId: string }
  | {
    event: 'resume';
    generationId: string;
    outcome: 'attempt' | 'success' | 'failure';
    latencyMs?: number;
    reason?: 'unauthorized' | 'not_found' | 'state_unavailable' | 'cursor_conflict' | 'unknown';
  }
  | {
    event: 'replay';
    generationId: string;
    events: number;
    bytes: number;
    snapshotBootstrap: boolean;
  }
  | {
    event: 'provider';
    generationId: string;
    outcome: 'started' | 'success' | 'failure' | 'cancelled';
    durationMs?: number;
  }
  | {
    event: 'reasoning';
    generationId: string;
    status: 'done' | 'unavailable';
    eventCount: number;
    chars: number;
  }
  | {
    event: 'phase';
    generationId?: string;
    phase: 'safety' | 'prompt' | 'finalization';
    outcome: 'success' | 'failure';
    durationMs: number;
  }
  | {
    event: 'storage';
    generationId: string;
    storage: 'r2';
    outcome: 'success' | 'failure';
    durationMs: number;
    bytes?: number;
  }
  | {
    event: 'cancel';
    generationId: string;
    reason: GenerationCancelReason;
    outcome: 'accepted' | 'terminal';
  }
  | { event: 'producer_lost'; generationId: string; reason: string }
  | { event: 'redis_degraded'; generationId: string; operation: string }
  | {
    event: 'terminal';
    generationId: string;
    status: GenerationTerminal['status'];
    code: string | null;
  };

export interface ArenaGenerationObserver {
  observeArenaGeneration(_observation: ArenaGenerationObservation): void;
}

export type ArenaGenerationActor = {
  actorKey: string;
  responseHeaders?: Readonly<Record<string, string>>;
};

export type ArenaGenerationCreateCommand = Readonly<{
  generationRequestId: string;
  payload: Record<string, unknown>;
  bodyBytes: number;
  /** In-process authority only, supplied after strict story DTO validation. Never read from HTTP payload/headers. */
  trustedStoryIdentity?: ArenaStoryIdentity;
  trustedRoomContext?: ArenaGenerationRoomStartContext;
}>;

export type ArenaGenerationServiceDependencies = {
  store: GenerationReplayStore;
  executor: ArenaGenerationExecutor;
  resolveActor(_request: Request): Promise<ArenaGenerationActor | null>;
  resolveCreateActor?(_input: {
    request: Request;
    actor: ArenaGenerationActor;
    generationRequestId: string;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<ArenaGenerationActor | null>;
  deriveGenerationId(_input: {
    actorKey: string;
    generationRequestId: string;
  }): Promise<string>;
  createProducerToken?(): string;
  createPreparationSeed?(): string;
  hashPayload(_payload: Record<string, unknown>): Promise<string>;
  now(): Date;
  heartbeatIntervalMs?: number;
  leaseDurationMs?: number;
  replayPollMs?: number;
  deltaFlushIntervalMs?: number;
  deltaFlushBytes?: number;
  snapshotFlushIntervalMs?: number;
  snapshotFlushBytes?: number;
  snapshotMaxBytes?: number;
  terminalStore?: ArenaGenerationTerminalStore;
  rejectedTerminalRecorder?: ArenaGenerationRejectedTerminalRecorder;
  noProviderCancellationRecorder?: ArenaGenerationNoProviderCancellationRecorder;
  observer?: ArenaGenerationObserver;
};

export type ArenaGenerationRouteParams = {
  generationId: string;
};

export type ArenaGenerationRequestRouteParams = {
  generationRequestId: string;
};

export type ArenaGenerationSubscription = Readonly<{
  generationId: string;
  generationRequestId: string;
  headers: Readonly<Record<string, string>>;
  events: ReadableStream<GenerationStreamEvent>;
}>;

export type ArenaGenerationOwnedProjection = Readonly<{
  generationId: string;
  generationRequestId: string;
  status: GenerationStatus;
  markdown: string;
  resumeCursor: string | null;
  updatedAt: string;
  finalAuthoritative: boolean;
  resultAvailable: boolean;
  generationRecordId: string | null;
  errorCode: string | null;
  persistenceWarning?: ArenaGenerationPersistenceWarning;
  replayUnavailable?: boolean;
  contentRetention?: 'expired';
  roomSafeResult?: Readonly<Record<string, unknown>>;
}>;

export type ArenaGenerationOwnedProjectionResult =
  | Readonly<{ kind: 'found'; projection: ArenaGenerationOwnedProjection }>
  | Readonly<{ kind: 'not-found' }>
  | Readonly<{ kind: 'unavailable'; code: string }>;

export type ArenaGenerationOwnedSubscriptionResult =
  | Readonly<{ kind: 'subscribed'; subscription: ArenaGenerationSubscription }>
  | Readonly<{ kind: 'not-found' }>
  | Readonly<{ kind: 'unavailable'; code: string }>;

export type ArenaGenerationOwnedCancelResult =
  | Readonly<{ kind: 'accepted'; cancelReason: GenerationCancelReason }>
  | Readonly<{ kind: 'finalizing' }>
  | Readonly<{ kind: 'terminal'; status: GenerationTerminal['status'] }>
  | Readonly<{ kind: 'forbidden' }>
  | Readonly<{ kind: 'not-found' }>;

export interface ArenaGenerationTrustedOwnedService {
  cancelRoomOwned(_input: { context: ArenaGenerationRoomCancelContext }): Promise<
    ArenaGenerationOwnedCancelResult | { kind: 'unavailable'; code: 'GENERATION_STATE_UNAVAILABLE' }
  >;
  cancelOwned(_input: {
    actorKey: string;
    generationId: string;
    reason: GenerationCancelReason;
  }): Promise<ArenaGenerationOwnedCancelResult>;
  readOwnedProjection(_input: {
    actorKey: string;
    generationId: string;
  }): Promise<ArenaGenerationOwnedProjectionResult>;
  resumeOwnedSubscription(_input: {
    actorKey: string;
    generationId: string;
    after: string | null;
  }): Promise<ArenaGenerationOwnedSubscriptionResult>;
}

export interface ArenaGenerationService {
  readonly storyProtocolVersion?: typeof ARENA_STORY_PROTOCOL_VERSION;
  createSubscription(
    _request: Request,
  ): Promise<ArenaGenerationSubscription | Response>;
  createParsedSubscription?(
    _request: Request,
    _command: ArenaGenerationCreateCommand,
  ): Promise<ArenaGenerationSubscription | Response>;
  create(_request: Request): Promise<Response>;
  cancelRequest(_request: Request): Promise<Response>;
  lookup(
    _request: Request,
    _params: ArenaGenerationRequestRouteParams,
  ): Promise<Response>;
  resume(_request: Request, _params: ArenaGenerationRouteParams): Promise<Response>;
  status(_request: Request, _params: ArenaGenerationRouteParams): Promise<Response>;
  cancel(_request: Request, _params: ArenaGenerationRouteParams): Promise<Response>;
}

export interface ArenaGenerationParsedPayloadService {
  createParsedSubscription(
    _request: Request,
    _command: ArenaGenerationCreateCommand,
  ): Promise<ArenaGenerationSubscription | Response>;
}

export type ArenaGenerationApplicationService = ArenaGenerationService
  & ArenaGenerationTrustedOwnedService
  & ArenaGenerationParsedPayloadService;

type ActiveProducer = {
  controller: AbortController;
  promise: Promise<void>;
};

const jsonResponse = (payload: unknown, status: number): Response => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  },
);

const withNotDispatchedHeader = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set(ARENA_GENERATION_DISPATCHED_HEADER, 'false');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

type RejectedResponseSnapshot = Readonly<{
  body: ArrayBuffer;
  headers: Headers;
  status: number;
  statusText: string;
}>;

const snapshotRejectedResponse = async (
  response: Response,
): Promise<RejectedResponseSnapshot> => {
  if (response.bodyUsed) throw new Error('ARENA_REJECTED_RESPONSE_ALREADY_USED');
  return {
    body: await response.clone().arrayBuffer(),
    headers: new Headers(response.headers),
    status: response.status,
    statusText: response.statusText,
  };
};

const withRejectedGenerationIdentity = (
  snapshot: RejectedResponseSnapshot,
  generationId: string,
  generationRequestId: string,
): Response => {
  const headers = new Headers(snapshot.headers);
  headers.set('X-Mahoshojo-Generation-Id', generationId);
  headers.set('X-Mahoshojo-Generation-Request-Id', generationRequestId);
  headers.set(ARENA_GENERATION_TERMINAL_STATUS_HEADER, 'failed');
  const contentType = headers.get('content-type')?.toLowerCase() ?? '';
  let projectedBody: ArrayBuffer | string = snapshot.body;
  if (contentType.includes('json')) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(snapshot.body)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        projectedBody = JSON.stringify({
          ...(parsed as Record<string, unknown>),
          generationId,
        });
      }
    } catch {
      // Explicitly typed non-JSON rejection bodies retain their original bytes and use headers only.
    }
  }
  headers.delete('content-length');
  return new Response(projectedBody, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers,
  });
};

const withActorHeaders = (
  response: Response,
  actor: ArenaGenerationActor,
): Response => {
  if (!actor.responseHeaders || Object.keys(actor.responseHeaders).length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(actor.responseHeaders)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const withActorSubscriptionHeaders = (
  subscription: ArenaGenerationSubscription,
  actor: ArenaGenerationActor,
): ArenaGenerationSubscription => {
  if (!actor.responseHeaders || Object.keys(actor.responseHeaders).length === 0) {
    return subscription;
  }
  return Object.freeze({
    ...subscription,
    headers: Object.freeze({
      ...subscription.headers,
      ...actor.responseHeaders,
    }),
  });
};

const isGenerationRequestId = (value: string): boolean => (
  /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value)
);

const createSecurePreparationSeed = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(ARENA_PREPARATION_SEED_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const invalidCancelReasonResponse = (): Response => jsonResponse({
  code: 'GENERATION_CANCEL_REASON_INVALID',
  error: 'reason must be user or content_policy',
}, 400);

const cancelReasonFromPayload = (
  payload: unknown,
): GenerationCancelReason | Response => {
  if (payload === null || payload === undefined) return 'user';
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalidCancelReasonResponse();
  }
  const reason = (payload as Record<string, unknown>).reason;
  if (reason === undefined) return 'user';
  return isGenerationCancelReason(reason) ? reason : invalidCancelReasonResponse();
};

const readOptionalCancelPayload = async (
  request: Request,
): Promise<unknown | Response> => {
  const tooLarge = (): Response => jsonResponse({
    code: 'GENERATION_CANCEL_REQUEST_TOO_LARGE',
    error: 'Cancel request body exceeds the allowed size',
  }, 413);
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARENA_CANCEL_BODY_BYTES) {
    return tooLarge();
  }
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bodyBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bodyBytes += next.value.byteLength;
      if (bodyBytes > MAX_ARENA_CANCEL_BODY_BYTES) {
        await reader.cancel('arena cancel body exceeds byte limit').catch(() => undefined);
        return tooLarge();
      }
      chunks.push(next.value);
    }
  } catch {
    return jsonResponse({ code: 'INVALID_JSON', error: 'Invalid JSON body' }, 400);
  } finally {
    reader.releaseLock();
  }
  if (bodyBytes === 0) return null;
  const body = new Uint8Array(bodyBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return jsonResponse({ code: 'INVALID_JSON', error: 'Invalid JSON body' }, 400);
  }
};

const parseCreatePayload = async (
  request: Request,
): Promise<ArenaGenerationCreateCommand | Response> => {
  if (request.method !== 'POST') {
    return jsonResponse({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }, 405);
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARENA_CREATE_BODY_BYTES) {
    return jsonResponse({
      code: 'ARENA_REQUEST_TOO_LARGE',
      error: '请求体超过允许的大小',
    }, 413);
  }

  let body: unknown;
  let bodyBytes = 0;
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    if (reader) {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bodyBytes += next.value.byteLength;
          if (bodyBytes > MAX_ARENA_CREATE_BODY_BYTES) {
            await reader.cancel('arena create body exceeds byte limit').catch(() => undefined);
            return jsonResponse({
              code: 'ARENA_REQUEST_TOO_LARGE',
              error: '请求体超过允许的大小',
            }, 413);
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const bodyBuffer = new Uint8Array(bodyBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder().decode(bodyBuffer));
  } catch {
    return jsonResponse({ code: 'INVALID_JSON', error: '请求体必须是 JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse({ code: 'INVALID_REQUEST', error: '请求体必须是对象' }, 400);
  }

  const payload = { ...(body as Record<string, unknown>) };
  const generationRequestId = typeof payload.generationRequestId === 'string'
    ? payload.generationRequestId.trim()
    : '';
  if (!isGenerationRequestId(generationRequestId)) {
    return jsonResponse({
      code: 'INVALID_GENERATION_REQUEST_ID',
      error: 'generationRequestId 无效',
    }, 400);
  }
  delete payload.generationRequestId;
  return { generationRequestId, payload, bodyBytes };
};

const addLeaseDuration = (now: Date, durationMs: number): string => new Date(
  now.getTime() + durationMs,
).toISOString();

export const createArenaGenerationService = (
  dependencies: ArenaGenerationServiceDependencies,
): ArenaGenerationApplicationService => {
  const heartbeatIntervalMs = dependencies.heartbeatIntervalMs ?? 15_000;
  const leaseDurationMs = dependencies.leaseDurationMs ?? 45_000;
  const replayPollMs = dependencies.replayPollMs ?? 1_000;
  const replayIdleDelayMs = Math.min(replayPollMs, 50);
  const deltaFlushIntervalMs = dependencies.deltaFlushIntervalMs ?? 40;
  const deltaFlushBytes = dependencies.deltaFlushBytes ?? 512;
  const snapshotFlushIntervalMs = dependencies.snapshotFlushIntervalMs ?? 250;
  const snapshotFlushBytes = dependencies.snapshotFlushBytes ?? 4_096;
  const snapshotMaxBytes = dependencies.snapshotMaxBytes ?? 2 * 1_024 * 1_024;
  const hasPreflight = typeof dependencies.executor.preflight === 'function';
  const hasMaterialize = typeof dependencies.executor.materialize === 'function';
  const splitMaterialization = hasPreflight && hasMaterialize;
  const materializationVersion = dependencies.executor.materializationVersion;
  const activeProducers = new Map<string, ActiveProducer>();
  const parsedCreateCommands = new WeakMap<Request, ArenaGenerationCreateCommand>();
  const observe = (observation: ArenaGenerationObservation): void => {
    try {
      dependencies.observer?.observeArenaGeneration(observation);
    } catch {
      // Telemetry must never change generation behavior.
    }
  };
  const encodedBytes = (value: unknown): number => {
    try {
      return new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength;
    } catch {
      return 0;
    }
  };
  const selectTerminalSnapshotWithinBudget = (
    fullSnapshot: GenerationSnapshot,
    contentAvailable = true,
    allowCompact = true,
  ): { snapshot: GenerationSnapshot | null; overBudget: boolean } => {
    if (!contentAvailable) return { snapshot: null, overBudget: false };
    if (encodedBytes(fullSnapshot) <= snapshotMaxBytes) {
      return { snapshot: fullSnapshot, overBudget: false };
    }
    if (!allowCompact) return { snapshot: null, overBudget: true };
    const compactSnapshot: GenerationSnapshot = {
      ...fullSnapshot,
      ...(fullSnapshot.status === 'completed' ? {} : { markdown: '' }),
      reasoning: '',
      telemetry: null,
    };
    return {
      snapshot: encodedBytes(compactSnapshot) <= snapshotMaxBytes ? compactSnapshot : null,
      overBudget: true,
    };
  };

  if (!Number.isFinite(deltaFlushIntervalMs) || deltaFlushIntervalMs < 1) {
    throw new Error('deltaFlushIntervalMs 必须是正有限数字');
  }
  if (!Number.isFinite(deltaFlushBytes) || deltaFlushBytes < 1) {
    throw new Error('deltaFlushBytes 必须是正有限数字');
  }
  if (!Number.isFinite(snapshotFlushIntervalMs) || snapshotFlushIntervalMs < 1) {
    throw new Error('snapshotFlushIntervalMs 必须是正有限数字');
  }
  if (!Number.isFinite(snapshotFlushBytes) || snapshotFlushBytes < 1) {
    throw new Error('snapshotFlushBytes 必须是正有限数字');
  }
  if (!Number.isFinite(snapshotMaxBytes) || snapshotMaxBytes < 1) {
    throw new Error('snapshotMaxBytes 必须是正有限数字');
  }
  if (hasPreflight !== hasMaterialize) {
    throw new Error('Arena generation preflight/materialize 必须成对配置');
  }
  if (splitMaterialization && !isArenaPreparationVersion(materializationVersion)) {
    throw new Error('Arena generation materializationVersion 无效');
  }

  const createReplayWriter = (
    generationId: string,
    producerToken: string,
    onOwnershipLost: () => void,
  ) => {
    const textEncoder = new TextEncoder();
    let markdown = '';
    let reasoning = '';
    let telemetry: Record<string, unknown> | null = null;
    let lastEventId: string | null = null;
    let pendingType: 'markdown' | 'reasoning' | null = null;
    let pendingChunks: string[] = [];
    let pendingBytes = 0;
    let pendingSnapshotBytes = 0;
    let lastSnapshotAtMs: number | null = null;
    let runningSnapshotBudgetExceeded = false;
    let replayUncertain = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let operation = Promise.resolve();

    const snapshot = (
      status: GenerationStatus,
      updatedAt: string,
      terminalResultRef: string | null = null,
      persistenceWarning: ArenaGenerationPersistenceWarning | null = null,
    ): GenerationSnapshot => ({
      status,
      markdown,
      reasoning,
      lastEventId,
      updatedAt,
      telemetry,
      terminalResultRef,
      ...(persistenceWarning ? { persistenceWarning } : {}),
    });

    const writeSnapshot = async (
      status: GenerationStatus,
      now: string,
      terminalResultRef: string | null = null,
    ): Promise<boolean> => {
      const nextSnapshot = snapshot(status, now, terminalResultRef);
      if (encodedBytes(nextSnapshot) > snapshotMaxBytes) {
        if (status === 'running') runningSnapshotBudgetExceeded = true;
        observe({ event: 'redis_degraded', generationId, operation: 'snapshot_budget' });
        return false;
      }
      try {
        const result = await dependencies.store.writeSnapshot({
          generationId,
          producerToken,
          snapshot: nextSnapshot,
          now,
        });
        if (!result.owned) {
          onOwnershipLost();
          throw new Error('GENERATION_PRODUCER_FENCED');
        }
        return true;
      } catch {
        observe({ event: 'redis_degraded', generationId, operation: 'write_snapshot' });
        return false;
      }
    };

    const append = async (
      events: GenerationEventInput[],
      now: string,
      snapshotDeltaBytes = 0,
      forceSnapshot = false,
    ): Promise<void> => {
      let result: Awaited<ReturnType<GenerationReplayStore['appendEvents']>> | null = null;
      try {
        result = await dependencies.store.appendEvents({
          generationId,
          producerToken,
          events,
          now,
        });
        if (!result.owned) {
          onOwnershipLost();
          throw new Error('GENERATION_PRODUCER_FENCED');
        }
      } catch {
        // A rejected command may already have committed, or may commit later.
        // Neither another append nor a checkpoint can prove the missing cursor.
        replayUncertain = true;
        observe({ event: 'redis_degraded', generationId, operation: 'append_events' });
      }
      lastEventId = result?.events.at(-1)?.id ?? lastEventId;
      pendingSnapshotBytes += snapshotDeltaBytes;
      const nowMs = Date.parse(now);
      const snapshotDue = lastSnapshotAtMs === null
        || forceSnapshot
        || nowMs - lastSnapshotAtMs >= snapshotFlushIntervalMs
        || pendingSnapshotBytes >= snapshotFlushBytes;
      if (
        !replayUncertain
        && !runningSnapshotBudgetExceeded
        && snapshotDue
        && await writeSnapshot('running', now)
      ) {
        lastSnapshotAtMs = nowMs;
        pendingSnapshotBytes = 0;
      }
    };

    const flushPending = async (): Promise<void> => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!pendingType || pendingChunks.length === 0) return;
      const type = pendingType;
      const chunk = pendingChunks.join('');
      const chunkBytes = pendingBytes;
      pendingType = null;
      pendingChunks = [];
      pendingBytes = 0;
      if (type === 'markdown') markdown += chunk;
      else reasoning += chunk;
      await append(
        [{ type, data: { chunk } }],
        dependencies.now().toISOString(),
        chunkBytes,
      );
    };

    const enqueue = (task: () => Promise<void>): Promise<void> => {
      operation = operation.then(task, task);
      return operation;
    };

    const scheduleFlush = (): void => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void enqueue(flushPending);
      }, deltaFlushIntervalMs);
      flushTimer.unref?.();
    };

    return Object.freeze({
      emit(event: GenerationEventInput): Promise<void> {
        return enqueue(async () => {
          const isDelta = event.type === 'markdown' || event.type === 'reasoning';
          const chunk = isDelta
            && event.data
            && typeof event.data === 'object'
            && typeof (event.data as { chunk?: unknown }).chunk === 'string'
            ? (event.data as { chunk: string }).chunk
            : null;
          if (!isDelta || chunk === null) {
            await flushPending();
            if (
              event.type === 'telemetry'
              && event.data
              && typeof event.data === 'object'
              && !Array.isArray(event.data)
            ) {
              telemetry = { ...(event.data as Record<string, unknown>) };
            }
            await append([event], dependencies.now().toISOString(), 0, true);
            return;
          }

          if (pendingType && pendingType !== event.type) await flushPending();
          pendingType = event.type as 'markdown' | 'reasoning';
          pendingChunks.push(chunk);
          pendingBytes += textEncoder.encode(chunk).byteLength;
          if (pendingBytes >= deltaFlushBytes) await flushPending();
          else scheduleFlush();
        });
      },

      finish(terminal: GenerationTerminal): Promise<void> {
        return enqueue(async () => {
          await flushPending();
          const now = dependencies.now().toISOString();
          const publicError = terminal.status === 'failed' ? terminal.publicError : undefined;
          const terminalEvent: GenerationEventInput = {
            type: terminal.status === 'failed' || terminal.status === 'producer_lost'
              ? 'error'
              : 'done',
            data: {
              ok: terminal.status === 'completed',
              status: terminal.status,
              ...(terminal.code ? { code: terminal.code } : {}),
              ...(terminal.resultRef ? { resultRef: terminal.resultRef } : {}),
              ...(terminal.status === 'completed' && terminal.webPackage ? { webPackage: terminal.webPackage } : {}),
              ...(terminal.persistenceWarning ? {
                persistenceWarning: terminal.persistenceWarning,
                replayUnavailable: true,
                resultAvailable: false,
              } : {}),
              ...(publicError ? {
                error: publicError.message,
                message: publicError.message,
                ...(publicError.upstreamStatus === undefined
                  ? {}
                  : { upstreamStatus: publicError.upstreamStatus }),
                ...(publicError.upstreamRequestId === undefined
                  ? {}
                  : { upstreamRequestId: publicError.upstreamRequestId }),
              } : {}),
            },
          };
          const fullTerminalSnapshot = snapshot(
            terminal.status,
            now,
            terminal.resultRef ?? null,
            terminal.persistenceWarning ?? null,
          );
          const selectedTerminalSnapshot = selectTerminalSnapshotWithinBudget(
            fullTerminalSnapshot,
            true,
            !replayUncertain,
          );
          if (selectedTerminalSnapshot.overBudget) {
            observe({ event: 'redis_degraded', generationId, operation: 'snapshot_budget' });
          }
          let result: Awaited<ReturnType<GenerationReplayStore['markTerminal']>>;
          try {
            result = await dependencies.store.markTerminal({
              generationId,
              producerToken,
              terminal: { ...terminal, replayUncertain },
              terminalEvent,
              ...(selectedTerminalSnapshot.snapshot
                ? { terminalSnapshot: selectedTerminalSnapshot.snapshot }
                : { clearTerminalSnapshot: true }),
              now,
            });
          } catch (error) {
            observe({ event: 'redis_degraded', generationId, operation: 'mark_terminal' });
            throw error;
          }
          if (!result.owned) {
            onOwnershipLost();
            throw new Error('GENERATION_PRODUCER_FENCED');
          }
          lastEventId = result.event?.id ?? lastEventId;
          observe({
            event: 'terminal',
            generationId,
            status: terminal.status,
            code: terminal.code ?? null,
          });
        });
      },
    });
  };

  const readOwnedTerminal = async (
    generationId: string,
    actorKey: string,
  ): Promise<ArenaGenerationTerminalRecord | null> => {
    return dependencies.terminalStore?.readOwnedTerminal({
      generationId,
      actorKey,
    }) ?? null;
  };

  const terminalEvidenceFromRecord = (
    record: ArenaGenerationTerminalRecord,
  ): {
    terminal: GenerationTerminal;
    terminalEvent: GenerationEventInput;
  } => {
    const terminal: GenerationTerminal = {
      status: record.status,
      ...(record.status === 'completed' && WebPackageArtifactSchema.safeParse(record.webPackage).success
        ? { webPackage: WebPackageArtifactSchema.parse(record.webPackage) } : {}),
      ...(record.errorCode ? { code: record.errorCode } : {}),
      ...(record.resultRef ? { resultRef: record.resultRef } : {}),
      ...(record.persistenceWarning ? {
        persistenceWarning: record.persistenceWarning,
      } : {}),
    };
    const terminalCode = terminal.status === 'producer_lost'
      ? terminal.code ?? 'PRODUCER_OWNERSHIP_LOST'
      : terminal.status === 'failed'
        ? terminal.code ?? 'GENERATION_FAILED'
        : terminal.code ?? null;
    return {
      terminal,
      terminalEvent: {
        type: terminal.status === 'failed' || terminal.status === 'producer_lost'
          ? 'error'
          : 'done',
        data: {
          ok: terminal.status === 'completed',
          status: terminal.status,
          ...(terminalCode ? { code: terminalCode } : {}),
          ...(terminal.resultRef ? { resultRef: terminal.resultRef } : {}),
          ...(terminal.webPackage ? { webPackage: terminal.webPackage } : {}),
          ...(terminal.persistenceWarning ? {
            persistenceWarning: terminal.persistenceWarning,
            replayUnavailable: true,
            resultAvailable: false,
          } : {}),
        },
      },
    };
  };

  const acceptedStatePayloadHashes = (state: GenerationReplayStoreState): readonly string[] => (
    state.roomAdmission?.version === ROOM_GENERATION_START_GATE_VERSION
      ? [state.payloadHash, roomGenerationLegacyPayloadHash(state.roomAdmission)]
      : [state.payloadHash]
  );

  const terminalRecordMatchesIdentity = (input: {
    record: ArenaGenerationTerminalRecord;
    generationId: string;
    generationRequestId: string;
    acceptedPayloadHashes: readonly string[];
  }): boolean => Boolean(
    input.record.generationId === input.generationId
    && input.record.generationRequestId === input.generationRequestId
    && typeof input.record.payloadHash === 'string'
    && input.acceptedPayloadHashes.includes(input.record.payloadHash)
  );

  const terminalStateEvidenceMatches = (input: {
    state: GenerationReplayStoreState;
    event: GenerationStreamEvent | null;
    requireSnapshot?: boolean;
  }): boolean => {
    const { state, event } = input;
    const terminal = state.terminal;
    if (
      !terminal
      || !event
      || !state.lastEventId
      || event.id !== state.lastEventId
      || state.status !== terminal.status
      || state.leaseExpiresAt !== null
      || !event.data
      || typeof event.data !== 'object'
    ) return false;
    const eventData = event.data as {
      code?: unknown;
      ok?: unknown;
      resultRef?: unknown;
      persistenceWarning?: unknown;
      status?: unknown;
    };
    const expectedType = terminal.status === 'failed' || terminal.status === 'producer_lost'
      ? 'error'
      : 'done';
    const expectedCode = terminal.status === 'producer_lost'
      ? terminal.code ?? 'PRODUCER_OWNERSHIP_LOST'
      : terminal.status === 'failed'
        ? terminal.code ?? 'GENERATION_FAILED'
        : terminal.code ?? null;
    if (
      event.type !== expectedType
      || eventData.status !== terminal.status
      || eventData.ok !== (terminal.status === 'completed')
      || (eventData.code ?? null) !== expectedCode
      || (eventData.resultRef ?? null) !== (terminal.resultRef ?? null)
      || (eventData.persistenceWarning ?? null) !== (terminal.persistenceWarning ?? null)
    ) return false;
    if (input.requireSnapshot && state.snapshot === null) return false;
    return state.snapshot === null || (
      state.snapshot.status === terminal.status
      && state.snapshot.lastEventId === event.id
      && (state.snapshot.terminalResultRef ?? null) === (terminal.resultRef ?? null)
      && (state.snapshot.persistenceWarning ?? null) === (terminal.persistenceWarning ?? null)
    );
  };

  const hasExactTerminalStateEvidence = async (
    state: GenerationReplayStoreState,
    requireSnapshot = false,
  ): Promise<boolean> => {
    if (!state.terminal || !state.lastEventId) return false;
    const event = await dependencies.store.readEvent({
      generationId: state.generationId,
      eventId: state.lastEventId,
    }).catch(() => null);
    return terminalStateEvidenceMatches({ state, event, requireSnapshot });
  };

  const readBackTerminalEvidence = async (input: {
    generationId: string;
    actorKey: string;
    record: ArenaGenerationTerminalRecord;
    requireSnapshot: boolean;
    acceptedPayloadHashes?: readonly string[];
  }): Promise<GenerationReplayStoreState | null> => {
    const { terminal } = terminalEvidenceFromRecord(input.record);
    const durableState = await dependencies.store.readState({
      generationId: input.generationId,
      actorKey: input.actorKey,
    }).catch(() => null);
    const durableTerminalEvent = durableState?.lastEventId
      ? await dependencies.store.readEvent({
          generationId: input.generationId,
          eventId: durableState.lastEventId,
        }).catch(() => null)
      : null;
    const terminalEventMatches = durableState && terminalStateEvidenceMatches({
      state: durableState,
      event: durableTerminalEvent,
      requireSnapshot: input.requireSnapshot,
    });
    if (!durableState || !durableTerminalEvent || !terminalEventMatches) return null;
    const acceptedPayloadHashes = input.acceptedPayloadHashes ?? [durableState.payloadHash];
    if (
      durableState.generationId !== input.generationId
      || !acceptedPayloadHashes.includes(durableState.payloadHash)
      || !terminalRecordMatchesIdentity({
        record: input.record,
        generationId: input.generationId,
        generationRequestId: durableState.generationRequestId,
        acceptedPayloadHashes,
      })
      || durableState.status !== terminal.status
      || durableState.terminal?.status !== terminal.status
      || (durableState.terminal.resultRef ?? null) !== (terminal.resultRef ?? null)
      || (durableState.terminal.code ?? null) !== (terminal.code ?? null)
      || (durableState.terminal.persistenceWarning ?? null)
        !== (terminal.persistenceWarning ?? null)
    ) return null;
    return durableState;
  };

  const commitOwnedTerminalEvidence = async (input: {
    generationId: string;
    actorKey: string;
    producerToken: string;
    record: ArenaGenerationTerminalRecord;
    priorState: GenerationReplayStoreState;
    replayEvidence: 'uncertain-owner-recovery' | 'legacy-durable-rebuild';
    now: string;
    acceptedPayloadHashes?: readonly string[];
  }): Promise<GenerationReplayStoreState | null> => {
    const { terminal, terminalEvent } = terminalEvidenceFromRecord(input.record);
    const replayUncertain = input.replayEvidence === 'uncertain-owner-recovery'
      || input.priorState.terminal?.replayUncertain === true;
    if (replayUncertain) terminal.replayUncertain = true;
    // Durable content proves the final body, not a complete reasoning transcript.
    // Only historical cache rebuilds retain the legacy body-only projection.
    const selected = replayUncertain ? { snapshot: null } : selectTerminalSnapshotWithinBudget({
      status: terminal.status,
      markdown: input.record.markdown,
      reasoning: input.record.reasoning,
      lastEventId: input.priorState.lastEventId,
      updatedAt: input.now,
      telemetry: input.priorState.snapshot?.telemetry ?? null,
      terminalResultRef: terminal.resultRef ?? null,
      ...(terminal.persistenceWarning ? { persistenceWarning: terminal.persistenceWarning } : {}),
    }, terminal.status !== 'completed' || input.record.contentAvailable === true);
    if ('overBudget' in selected && selected.overBudget) {
      observe({ event: 'redis_degraded', generationId: input.generationId, operation: 'snapshot_budget' });
    }
    const committed = await dependencies.store.markTerminal({
      generationId: input.generationId,
      producerToken: input.producerToken,
      terminal,
      terminalEvent,
      ...(selected.snapshot ? { terminalSnapshot: selected.snapshot } : { clearTerminalSnapshot: true }),
      now: input.now,
    }).catch(() => null);
    if (!committed?.owned) return null;
    return readBackTerminalEvidence({
      generationId: input.generationId,
      actorKey: input.actorKey,
      record: input.record,
      requireSnapshot: selected.snapshot !== null,
      ...(input.acceptedPayloadHashes
        ? { acceptedPayloadHashes: input.acceptedPayloadHashes }
        : {}),
    });
  };

  const inspectOwnedFinalization = async (
    generationId: string,
    actorKey: string,
  ): Promise<
    | { kind: 'not-found' }
    | { kind: 'pending'; payloadHash: string | null }
    | { kind: 'terminal'; terminal: ArenaGenerationTerminalRecord }
  > => {
    if (dependencies.terminalStore?.inspectOwnedFinalization) {
      return dependencies.terminalStore.inspectOwnedFinalization({ generationId, actorKey });
    }
    const terminal = await readOwnedTerminal(generationId, actorKey);
    return terminal ? { kind: 'terminal', terminal } : { kind: 'not-found' };
  };

  const reconcileOwnedActiveState = async (
    actor: ArenaGenerationActor,
    state: GenerationReplayStoreState,
  ): Promise<{
    actor: ArenaGenerationActor;
    state: GenerationReplayStoreState;
    terminalFallback: ArenaGenerationTerminalRecord | null;
  } | Response> => {
    const generationId = state.generationId;
    const leaseExpired = (
      state.status === 'reserved'
      || state.status === 'running'
      || state.status === 'finalizing'
    )
      && state.leaseExpiresAt !== null
      && Date.parse(state.leaseExpiresAt) <= dependencies.now().getTime();
    if (!leaseExpired) return { actor, state, terminalFallback: null };

    let terminalFallback = await readOwnedTerminal(generationId, actor.actorKey);
    if (state.roomAdmission?.version === ROOM_GENERATION_START_GATE_VERSION
      && state.status === 'reserved' && !terminalFallback) {
      return jsonResponse({ code: 'GENERATION_FINALIZATION_PENDING', error: 'Room cancellation durable evidence remains pending' }, 503);
    }
    const now = dependencies.now().toISOString();
    const reaperToken = dependencies.createProducerToken?.() ?? crypto.randomUUID();
    const claimed = await dependencies.store.claimLeaseExpiry({
      generationId,
      actorKey: actor.actorKey,
      reaperToken,
      now,
      leaseExpiresAt: addLeaseDuration(dependencies.now(), leaseDurationMs),
    }).catch(() => null);
    if (!claimed || claimed.kind === 'not-expired') {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
        error: 'Generation terminal reconciliation pending',
      }, 503);
    }
    if (claimed.kind === 'forbidden' || claimed.kind === 'not-found') {
      return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
    }
    if (claimed.kind === 'terminal') {
      const concurrentTerminal = terminalFallback
        ?? await readOwnedTerminal(generationId, actor.actorKey).catch(() => null);
      const durableState = concurrentTerminal?.status === claimed.status
        && terminalRecordMatchesIdentity({
          record: concurrentTerminal,
          generationId,
          generationRequestId: state.generationRequestId,
          acceptedPayloadHashes: acceptedStatePayloadHashes(state),
        })
        ? await readBackTerminalEvidence({
            generationId,
            actorKey: actor.actorKey,
            record: concurrentTerminal,
            requireSnapshot: false,
            acceptedPayloadHashes: acceptedStatePayloadHashes(state),
          })
        : null;
      if (!concurrentTerminal || !durableState) {
        return jsonResponse({
          code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
          error: 'Generation terminal reconciliation pending',
        }, 503);
      }
      return {
        actor,
        terminalFallback: concurrentTerminal,
        state: durableState,
      };
    }
    if (
      claimed.generationRequestId !== state.generationRequestId
      || claimed.payloadHash !== state.payloadHash
    ) {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
        error: 'Generation terminal reconciliation pending',
      }, 503);
    }
    if (terminalFallback && !terminalRecordMatchesIdentity({
      record: terminalFallback,
      generationId,
      generationRequestId: claimed.generationRequestId,
      acceptedPayloadHashes: acceptedStatePayloadHashes(state),
    })) {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
        error: 'Generation terminal reconciliation pending',
      }, 503);
    }
    if (!terminalFallback) {
      if (claimed.intendedTerminal) {
        const durable = await inspectOwnedFinalization(generationId, actor.actorKey)
          .catch(() => ({ kind: 'not-found' as const }));
        if (durable.kind === 'terminal') terminalFallback = durable.terminal;
        if (durable.kind !== 'terminal') {
          return jsonResponse({
            code: 'GENERATION_FINALIZATION_PENDING',
            error: 'Generation durable finalization remains pending',
          }, 503);
        }
      }
    }
    if (!terminalFallback) {
      if (!dependencies.terminalStore?.reconcileExpiredLease) {
        return jsonResponse({
          code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
          error: 'Generation terminal reconciliation unavailable',
        }, 503);
      }
      terminalFallback = await dependencies.terminalStore.reconcileExpiredLease({
        multiplayerParticipation: state.multiplayerParticipation,
        generationId,
        generationRequestId: claimed.generationRequestId,
        actorKey: actor.actorKey,
        payloadHash: claimed.payloadHash,
        mode: claimed.mode,
        updatedAt: now,
        code: 'PRODUCER_LEASE_EXPIRED',
      }).catch(() => null);
    }
    if (
      !terminalFallback
      || !terminalRecordMatchesIdentity({
        record: terminalFallback,
        generationId,
        generationRequestId: claimed.generationRequestId,
        acceptedPayloadHashes: acceptedStatePayloadHashes(state),
      })
    ) {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
        error: 'Generation terminal reconciliation pending',
      }, 503);
    }
    const durableState = await commitOwnedTerminalEvidence({
      generationId,
      actorKey: actor.actorKey,
      producerToken: reaperToken,
      record: terminalFallback,
      priorState: state,
      replayEvidence: 'uncertain-owner-recovery',
      now,
      acceptedPayloadHashes: acceptedStatePayloadHashes(state),
    });
    if (!durableState) {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
        error: 'Generation terminal reconciliation pending',
      }, 503);
    }
    if (terminalFallback.status === 'producer_lost') {
      observe({ event: 'producer_lost', generationId, reason: 'lease_expired' });
    }
    return {
      actor,
      terminalFallback,
      state: durableState,
    };
  };

  const resolveOwnedStateForActor = async (
    actor: ArenaGenerationActor,
    generationId: string,
  ): Promise<{
    actor: ArenaGenerationActor;
    state: GenerationReplayStoreState;
    terminalFallback: ArenaGenerationTerminalRecord | null;
  } | Response> => {
    let state: GenerationReplayStoreState | null;
    let terminalFallback: ArenaGenerationTerminalRecord | null = null;
    try {
      state = await dependencies.store.readState({
        generationId,
        actorKey: actor.actorKey,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'REDIS_GENERATION_UNCERTAIN_SNAPSHOT_UNAVAILABLE') {
        return jsonResponse({
          code: 'GENERATION_TERMINAL_CONTENT_UNAVAILABLE',
          error: 'Generation terminal content unavailable',
        }, 503);
      }
      if (error instanceof Error && error.message === 'REDIS_GENERATION_STORAGE_VERSION_INVALID') {
        return jsonResponse({ code: 'GENERATION_STATE_UNAVAILABLE', error: 'Generation state unavailable' }, 503);
      }
      const durable = await inspectOwnedFinalization(generationId, actor.actorKey)
        .catch(() => ({ kind: 'not-found' as const }));
      if (durable.kind === 'pending') {
        return jsonResponse({
          code: 'GENERATION_FINALIZATION_PENDING',
          error: 'Generation durable finalization remains pending',
        }, 503);
      }
      if (durable.kind === 'terminal') terminalFallback = durable.terminal;
      if (durable.kind === 'not-found') {
        return jsonResponse({
          code: 'GENERATION_STATE_UNAVAILABLE',
          error: 'Generation state unavailable',
        }, 503);
      }
      state = null;
    }

    if (!state) {
      if (!terminalFallback) {
        const durable = await inspectOwnedFinalization(generationId, actor.actorKey)
          .catch(() => ({ kind: 'not-found' as const }));
        if (durable.kind === 'pending') {
          return jsonResponse({
            code: 'GENERATION_FINALIZATION_PENDING',
            error: 'Generation durable finalization remains pending',
          }, 503);
        }
        if (durable.kind === 'terminal') terminalFallback = durable.terminal;
      }
      if (!terminalFallback) {
        return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
      }
      if (terminalFallback.generationId !== generationId) {
        return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
      }
      const expectedGenerationId = await dependencies.deriveGenerationId({
        actorKey: actor.actorKey,
        generationRequestId: terminalFallback.generationRequestId,
      }).catch(() => null);
      if (expectedGenerationId !== generationId) {
        return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
      }
      state = {
        actorKey: actor.actorKey,
        generationId: terminalFallback.generationId,
        generationRequestId: terminalFallback.generationRequestId,
        payloadHash: terminalFallback.payloadHash ?? '',
        mode: null,
        producerToken: '',
        status: terminalFallback.status,
        lastEventId: null,
        updatedAt: terminalFallback.updatedAt,
        leaseExpiresAt: null,
        snapshot: {
          status: terminalFallback.status,
          markdown: terminalFallback.markdown,
          reasoning: terminalFallback.reasoning,
          lastEventId: null,
          updatedAt: terminalFallback.updatedAt,
          terminalResultRef: terminalFallback.resultRef,
          ...(terminalFallback.persistenceWarning ? {
            persistenceWarning: terminalFallback.persistenceWarning,
          } : {}),
        },
        terminal: {
          status: terminalFallback.status,
          resultRef: terminalFallback.resultRef,
          ...(terminalFallback.persistenceWarning ? {
            persistenceWarning: terminalFallback.persistenceWarning,
          } : {}),
        },
        cancelRequested: terminalFallback.status === 'cancelled',
        cancelReason: terminalFallback.status === 'cancelled' ? 'user' : null,
      };
    }
    if (state.actorKey !== actor.actorKey || state.generationId !== generationId) {
      return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
    }
    if (state.terminal && !terminalFallback && !await hasExactTerminalStateEvidence(state)) {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
        error: 'Generation terminal reconciliation pending',
      }, 503);
    }
    if (terminalFallback && !terminalRecordMatchesIdentity({
      record: terminalFallback,
      generationId: state.generationId,
      generationRequestId: state.generationRequestId,
      acceptedPayloadHashes: acceptedStatePayloadHashes(state),
    })) {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
        error: 'Generation terminal reconciliation pending',
      }, 503);
    }
    if (
      !terminalFallback
      && state.status === 'completed'
      && state.snapshot?.status !== 'completed'
    ) {
      const durable = await inspectOwnedFinalization(generationId, actor.actorKey)
        .catch(() => ({ kind: 'not-found' as const }));
      if (durable.kind === 'pending') {
        return jsonResponse({
          code: 'GENERATION_FINALIZATION_PENDING',
          error: 'Generation durable finalization remains pending',
        }, 503);
      }
      if (durable.kind === 'terminal') terminalFallback = durable.terminal;
      if (durable.kind === 'not-found') {
        return jsonResponse({
          code: 'GENERATION_TERMINAL_CONTENT_UNAVAILABLE',
          error: 'Generation terminal content unavailable',
        }, 503);
      }
    }
    if (terminalFallback && !terminalRecordMatchesIdentity({
      record: terminalFallback,
      generationId: state.generationId,
      generationRequestId: state.generationRequestId,
      acceptedPayloadHashes: acceptedStatePayloadHashes(state),
    })) {
      return jsonResponse({
        code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
        error: 'Generation terminal reconciliation pending',
      }, 503);
    }
    if (terminalFallback) return { actor, state, terminalFallback };
    return reconcileOwnedActiveState(actor, state);
  };

  const resolveOwnedState = async (
    request: Request,
    generationId: string,
  ): Promise<{
    actor: ArenaGenerationActor;
    state: GenerationReplayStoreState;
    terminalFallback: ArenaGenerationTerminalRecord | null;
  } | Response> => {
    const actor = await dependencies.resolveActor(request);
    if (!actor) return jsonResponse({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);
    return resolveOwnedStateForActor(actor, generationId);
  };

  const ownedFailureFromResponse = async (
    response: Response,
  ): Promise<Extract<
    ArenaGenerationOwnedProjectionResult,
    { kind: 'not-found' | 'unavailable' }
  >> => {
    if (response.status === 404) return { kind: 'not-found' };
    const allowedCodes = new Set([
      'GENERATION_FINALIZATION_PENDING',
      'GENERATION_STATE_UNAVAILABLE',
      'GENERATION_TERMINAL_CONTENT_EXPIRED',
      'GENERATION_TERMINAL_CONTENT_UNAVAILABLE',
      'GENERATION_TERMINAL_RECONCILIATION_PENDING',
    ]);
    let code = 'GENERATION_STATE_UNAVAILABLE';
    try {
      const body = await response.clone().json() as { code?: unknown };
      if (typeof body.code === 'string' && allowedCodes.has(body.code)) code = body.code;
    } catch {
      // The trusted seam intentionally projects no response body or diagnostic.
    }
    return { kind: 'unavailable', code };
  };

  const safeTerminalErrorCode = (
    status: GenerationStatus,
    candidate: string | null | undefined,
  ): string | null => {
    if (status !== 'failed' && status !== 'producer_lost') return null;
    if (candidate && /^[A-Z][A-Z0-9_]{1,79}$/u.test(candidate)) return candidate;
    return status === 'producer_lost'
      ? 'PRODUCER_OWNERSHIP_LOST'
      : 'GENERATION_FAILED';
  };

  const createStatusResponse = (
    state: GenerationReplayStoreState,
    actor: ArenaGenerationActor,
  ): Response => withActorHeaders(jsonResponse({
    generationId: state.generationId,
    generationRequestId: state.generationRequestId,
    status: state.status,
    resumable: state.status === 'reserved'
      || state.status === 'running'
      || state.status === 'finalizing',
    lastEventId: state.lastEventId,
    updatedAt: state.updatedAt,
    ...(state.status === 'completed' && state.terminal?.resultRef
      ? { resultRef: state.terminal.resultRef }
      : {}),
    ...(state.status === 'completed' && state.terminal?.persistenceWarning
      ? {
        finalAuthoritative: true,
        resultAvailable: false,
        persistenceWarning: state.terminal.persistenceWarning,
        replayUnavailable: true,
      }
      : {}),
  }, 200), actor);

  const createTerminalContentUnavailableResponse = (): Response => jsonResponse({
    code: 'GENERATION_TERMINAL_CONTENT_UNAVAILABLE',
    error: 'Generation terminal content is temporarily unavailable',
  }, 503);

  const isTerminalContentExpired = (
    terminal: ArenaGenerationTerminalRecord | null,
  ): terminal is ArenaGenerationTerminalRecord => Boolean(
    terminal?.status === 'completed'
    && terminal.contentAvailable !== true
    && terminal.contentUnavailableReason === 'not-found'
  );

  const isTerminalContentNotArchived = (
    terminal: ArenaGenerationTerminalRecord | null,
  ): terminal is ArenaGenerationTerminalRecord => Boolean(
    terminal?.status === 'completed'
    && terminal.contentAvailable !== true
    && terminal.contentUnavailableReason === 'not-archived'
  );

  const createNotArchivedTerminalStatusResponse = (
    state: GenerationReplayStoreState,
    terminal: ArenaGenerationTerminalRecord,
    actor: ArenaGenerationActor,
  ): Response => withActorHeaders(jsonResponse({
    generationId: state.generationId,
    generationRequestId: state.generationRequestId,
    status: 'completed',
    resumable: false,
    lastEventId: state.lastEventId,
    updatedAt: terminal.updatedAt,
    finalAuthoritative: true,
    resultAvailable: false,
    persistenceWarning: ARENA_OUTPUT_NOT_ARCHIVED_WARNING,
    replayUnavailable: true,
  }, 200), actor);

  const createExpiredTerminalStatusResponse = (
    state: GenerationReplayStoreState,
    terminal: ArenaGenerationTerminalRecord,
    actor: ArenaGenerationActor,
  ): Response => withActorHeaders(jsonResponse({
    generationId: state.generationId,
    generationRequestId: state.generationRequestId,
    status: 'completed',
    resumable: false,
    lastEventId: state.lastEventId,
    updatedAt: terminal.updatedAt,
    finalAuthoritative: true,
    resultAvailable: false,
    contentRetention: 'expired',
  }, 200), actor);

  const createTerminalContentExpiredResponse = (): Response => jsonResponse({
    code: 'GENERATION_TERMINAL_CONTENT_EXPIRED',
    error: 'Generation terminal content retention has expired',
  }, 410);

  const createTerminalFallbackSubscription = (
    terminal: ArenaGenerationTerminalRecord,
    after: string | null = null,
  ): ArenaGenerationSubscription | Response => {
    if (
      terminal.status === 'completed'
      && terminal.contentAvailable !== true
      && !isTerminalContentNotArchived(terminal)
    ) {
      return isTerminalContentExpired(terminal)
        ? createTerminalContentExpiredResponse()
        : createTerminalContentUnavailableResponse();
    }
    const [snapshotId, terminalId] = (() => {
      if (!after) return ['0-0', '0-1'];
      const match = after.match(/^(\d+)-(\d+)$/u);
      if (!match) return ['0-0', '0-1'];
      const milliseconds = match[1]!;
      const sequence = match[2]!;
      return [
        `${milliseconds}-${addSmallDecimal(sequence, 1)}`,
        `${milliseconds}-${addSmallDecimal(sequence, 2)}`,
      ];
    })();
    const snapshot: GenerationSnapshot = {
      status: terminal.status,
      ...(terminal.telemetry ? { telemetry: terminal.telemetry } : {}),
      markdown: terminal.status === 'completed' || (terminal.status === 'failed' && terminal.resultRef)
        ? terminal.markdown : '',
      reasoning: terminal.status === 'completed' ? terminal.reasoning : '',
      lastEventId: null,
      updatedAt: terminal.updatedAt,
      terminalResultRef: terminal.status === 'completed' ? terminal.resultRef : null,
      ...(isTerminalContentNotArchived(terminal) ? {
        persistenceWarning: ARENA_OUTPUT_NOT_ARCHIVED_WARNING,
      } : {}),
    };
    const snapshotEvent: GenerationStreamEvent = {
      id: snapshotId,
      type: 'snapshot',
      data: snapshot,
    };
    const terminalEvent: GenerationStreamEvent = {
      id: terminalId,
      type: terminal.status === 'failed' || terminal.status === 'producer_lost'
        ? 'error'
        : 'done',
      data: {
        ok: terminal.status === 'completed',
        status: terminal.status,
        ...(getPublicAiErrorMessage(terminal.errorCode)
          ? { message: getPublicAiErrorMessage(terminal.errorCode) } : {}),
        ...(
          terminal.status === 'failed' || terminal.status === 'producer_lost'
            ? {
              code: terminal.errorCode
                ?? (terminal.status === 'producer_lost'
                  ? 'PRODUCER_OWNERSHIP_LOST'
                  : 'GENERATION_FAILED'),
            }
            : {}
        ),
        ...(terminal.status === 'completed' && terminal.resultRef
          ? { resultRef: terminal.resultRef }
          : {}),
        ...(terminal.status === 'completed' && WebPackageArtifactSchema.safeParse(terminal.webPackage).success
          ? { webPackage: WebPackageArtifactSchema.parse(terminal.webPackage) } : {}),
        ...(isTerminalContentNotArchived(terminal) ? {
          persistenceWarning: ARENA_OUTPUT_NOT_ARCHIVED_WARNING,
          replayUnavailable: true,
          resultAvailable: false,
        } : {}),
      },
    };
    const stream = new ReadableStream<GenerationStreamEvent>({
      start(controller) {
        controller.enqueue(snapshotEvent);
        controller.enqueue(terminalEvent);
        observe({
          event: 'replay',
          generationId: terminal.generationId,
          events: 2,
          bytes: encodeGenerationSseEvent(snapshotEvent).byteLength
            + encodeGenerationSseEvent(terminalEvent).byteLength,
          snapshotBootstrap: true,
        });
        controller.close();
      },
    });
    return Object.freeze({
      generationId: terminal.generationId,
      generationRequestId: terminal.generationRequestId,
      headers: Object.freeze({
        'X-Mahoshojo-Generation-Id': terminal.generationId,
        'X-Mahoshojo-Generation-Request-Id': terminal.generationRequestId,
        'X-Mahoshojo-Generation-Fallback': 'terminal',
        [ARENA_GENERATION_TERMINAL_STATUS_HEADER]: terminal.status,
      }),
      events: stream,
    });
  };

  const createTerminalFallbackResponse = (
    terminal: ArenaGenerationTerminalRecord,
    after: string | null = null,
  ): Response => {
    const subscription = createTerminalFallbackSubscription(terminal, after);
    return subscription instanceof Response
      ? subscription
      : subscriptionToSseResponse(subscription);
  };

  const createReplaySubscription = (
    generationId: string,
    generationRequestId: string,
    payloadHash: string,
    after: string | null,
    actorKey: string,
    responseHeaders: Readonly<Record<string, string>> = {},
  ): ArenaGenerationSubscription => {
    let cancelled = false;
    let cursor = after;
    let snapshotBootstrapped = false;
    const stream = new ReadableStream<GenerationStreamEvent>({
      start(controller) {
        const pump = async (): Promise<void> => {
          const terminalFallback = async (): Promise<ArenaGenerationTerminalRecord | null> => (
            readOwnedTerminal(generationId, actorKey)
          );
          const nextSyntheticId = (increment: 1 | 2 = 1): string => {
            const match = cursor?.match(/^(\d+)-(\d+)$/u);
            if (!match) return increment === 1 ? '0-0' : '0-1';
            return `${match[1]}-${addSmallDecimal(match[2]!, increment)}`;
          };
          const monotonicSnapshotId = (candidate: string | null): string => {
            if (!cursor) return candidate ?? '0-0';
            return candidate && compareGenerationSseIds(candidate, cursor) > 0
              ? candidate
              : nextSyntheticId();
          };
          const enqueueReplayError = (code: string): void => {
            const id = nextSyntheticId();
            controller.enqueue({
              id,
              type: 'error',
              data: {
                code,
                status: code === 'GENERATION_STATE_LOST' ? 'producer_lost' : 'failed',
              },
            });
            cursor = id;
            controller.close();
          };
          const enqueueExpiredTerminal = (
            terminal: ArenaGenerationTerminalRecord,
          ): void => {
            const snapshotId = nextSyntheticId();
            cursor = snapshotId;
            const terminalId = nextSyntheticId();
            const snapshotEvent: GenerationStreamEvent = {
              id: snapshotId,
              type: 'snapshot',
              data: {
                status: 'completed',
                markdown: '',
                reasoning: '',
                lastEventId: null,
                updatedAt: terminal.updatedAt,
                telemetry: null,
                terminalResultRef: null,
              },
            };
            const terminalEvent: GenerationStreamEvent = {
              id: terminalId,
              type: 'done',
              data: {
                ok: true,
                status: 'completed',
                code: 'GENERATION_TERMINAL_CONTENT_EXPIRED',
                resultAvailable: false,
                contentRetention: 'expired',
              },
            };
            controller.enqueue(snapshotEvent);
            controller.enqueue(terminalEvent);
            observe({
              event: 'replay',
              generationId,
              events: 2,
              bytes: encodeGenerationSseEvent(snapshotEvent).byteLength
                + encodeGenerationSseEvent(terminalEvent).byteLength,
              snapshotBootstrap: true,
            });
            cursor = terminalId;
            controller.close();
          };
          const enqueueTerminalSnapshot = (
            snapshot: GenerationSnapshot,
            terminal: GenerationTerminal,
            preserveFullContent = false,
            exactTerminalEvent?: GenerationStreamEvent,
          ): void => {
            const base = cursor?.match(/^(\d+)-(\d+)$/u);
            const milliseconds = base?.[1] ?? '0';
            const sequence = base?.[2] ?? null;
            const snapshotId = `${milliseconds}-${sequence ? addSmallDecimal(sequence, 1) : '0'}`;
            const terminalId = `${milliseconds}-${sequence ? addSmallDecimal(sequence, 2) : '1'}`;
            const snapshotEvent: GenerationStreamEvent = {
              id: snapshotId,
              type: 'snapshot',
              data: {
                ...snapshot,
                status: terminal.status,
                ...(terminal.status === 'completed' || preserveFullContent
                  ? {
                    terminalResultRef: terminal.resultRef ?? null,
                    ...(terminal.persistenceWarning
                      ? { persistenceWarning: terminal.persistenceWarning }
                      : {}),
                  }
                  : { markdown: '', reasoning: '', terminalResultRef: null }),
              },
            };
            const terminalEvent: GenerationStreamEvent = exactTerminalEvent ? {
              ...exactTerminalEvent, id: terminalId,
            } : {
              id: terminalId,
              type: terminal.status === 'failed' || terminal.status === 'producer_lost'
                ? 'error'
                : 'done',
              data: {
                ok: terminal.status === 'completed',
                status: terminal.status,
                ...(terminal.code ? { code: terminal.code } : {}),
                ...(terminal.status === 'completed' && terminal.resultRef
                  ? { resultRef: terminal.resultRef }
                  : {}),
                ...(terminal.status === 'completed' && terminal.webPackage ? { webPackage: terminal.webPackage } : {}),
                ...(terminal.persistenceWarning ? {
                  persistenceWarning: terminal.persistenceWarning,
                  replayUnavailable: true,
                  resultAvailable: false,
                } : {}),
                ...(terminal.status === 'failed' && terminal.publicError ? {
                  error: terminal.publicError.message,
                  message: terminal.publicError.message,
                  ...(terminal.publicError.upstreamStatus === undefined
                    ? {}
                    : { upstreamStatus: terminal.publicError.upstreamStatus }),
                  ...(terminal.publicError.upstreamRequestId === undefined
                    ? {}
                    : { upstreamRequestId: terminal.publicError.upstreamRequestId }),
                } : {}),
              },
            };
            controller.enqueue(snapshotEvent);
            controller.enqueue(terminalEvent);
            observe({
              event: 'replay',
              generationId,
              events: 2,
              bytes: encodeGenerationSseEvent(snapshotEvent).byteLength
                + encodeGenerationSseEvent(terminalEvent).byteLength,
              snapshotBootstrap: true,
            });
            controller.close();
          };
          const recoverUncertainTerminal = async (
            state: GenerationReplayStoreState,
            terminalEvent?: GenerationStreamEvent,
          ): Promise<boolean> => {
            if (state.terminal?.replayUncertain !== true) return false;
            const exactTerminalEvent = terminalEvent ?? (state.lastEventId
              ? await dependencies.store.readEvent({ generationId, eventId: state.lastEventId })
              : null);
            if (!terminalStateEvidenceMatches({ state, event: exactTerminalEvent })) {
              throw new Error('GENERATION_TERMINAL_RECONCILIATION_PENDING');
            }
            if (!state.snapshot) {
              if (state.terminal.status === 'completed') {
                // Success requires complete text. Do not substitute body-only
                // durable content or reset the client's partial reasoning.
                throw new Error('GENERATION_TERMINAL_CONTENT_UNAVAILABLE');
              }
              // A verified failure/cancellation is authoritative even when its
              // partial text is not recoverable. Report it without a reset.
              const event = { ...exactTerminalEvent!, id: monotonicSnapshotId(exactTerminalEvent!.id) };
              controller.enqueue(event);
              cursor = event.id;
              observe({ event: 'replay', generationId, events: 1,
                bytes: encodeGenerationSseEvent(event).byteLength, snapshotBootstrap: false });
              controller.close();
              return true;
            }
            enqueueTerminalSnapshot(state.snapshot, state.terminal, true, exactTerminalEvent!);
            return true;
          };
          const pipeTerminalFallback = async (
            fallback: ArenaGenerationTerminalRecord,
          ): Promise<void> => {
            // A terminal can commit after the caller's last read. Recheck its
            // uncertainty before a body-only durable fallback replaces text.
            const retained = await dependencies.store.readState({ generationId, actorKey }).catch((error) => {
              if (error instanceof Error && error.message === 'REDIS_GENERATION_UNCERTAIN_SNAPSHOT_UNAVAILABLE') throw error;
              if (error instanceof Error && error.message === 'REDIS_GENERATION_STORAGE_VERSION_INVALID') {
                throw new Error('GENERATION_STATE_UNAVAILABLE');
              }
              return null;
            });
            if (retained && await recoverUncertainTerminal(retained)) return;
            if (retained && !retained.terminal) {
              throw new Error('GENERATION_TERMINAL_CONTENT_UNAVAILABLE');
            }
            if (!terminalRecordMatchesIdentity({
              record: fallback,
              generationId,
              generationRequestId,
              acceptedPayloadHashes: [payloadHash],
            })) {
              enqueueReplayError('GENERATION_TERMINAL_RECONCILIATION_PENDING');
              return;
            }
            if (fallback.status === 'completed' && fallback.contentAvailable !== true) {
              if (isTerminalContentExpired(fallback)) {
                enqueueExpiredTerminal(fallback);
                return;
              }
              if (!isTerminalContentNotArchived(fallback)) {
                throw new Error('GENERATION_TERMINAL_CONTENT_UNAVAILABLE');
              }
            }
            const fallbackSubscription = createTerminalFallbackSubscription(fallback, cursor);
            if (fallbackSubscription instanceof Response) {
              throw new Error('GENERATION_TERMINAL_CONTENT_UNAVAILABLE');
            }
            const fallbackReader = fallbackSubscription.events.getReader();
            while (true) {
              const next = await fallbackReader.read();
              if (next.done) break;
              controller.enqueue(next.value);
            }
            controller.close();
          };
          try {
            while (!cancelled) {
              const batch = await dependencies.store.readAfter({
                generationId,
                after: cursor,
                blockMs: replayPollMs,
              });
              if (cancelled) return;

              if (batch.kind === 'window-lost') {
                const state = await dependencies.store.readState({ generationId });
                if (state && await recoverUncertainTerminal(state)) return;
                const snapshot = state ? state.snapshot : await dependencies.store.readSnapshot({ generationId });
                if (!snapshot) {
                  const fallback = await terminalFallback();
                  if (fallback) {
                    await pipeTerminalFallback(fallback);
                    return;
                  }
                  enqueueReplayError('REPLAY_WINDOW_LOST');
                  return;
                }
                if (state?.terminal) {
                  if (!await hasExactTerminalStateEvidence(state, true)) {
                    enqueueReplayError('GENERATION_TERMINAL_RECONCILIATION_PENDING');
                    return;
                  }
                  enqueueTerminalSnapshot(snapshot, state.terminal);
                  return;
                }
                if (snapshotBootstrapped) {
                  enqueueReplayError('REPLAY_WINDOW_LOST');
                  return;
                }
                const snapshotCursor = monotonicSnapshotId(snapshot.lastEventId);
                const event: GenerationStreamEvent = {
                  id: snapshotCursor,
                  type: 'snapshot',
                  data: snapshot,
                };
                controller.enqueue(event);
                observe({
                  event: 'replay',
                  generationId,
                  events: 1,
                  bytes: encodeGenerationSseEvent(event).byteLength,
                  snapshotBootstrap: true,
                });
                cursor = snapshotCursor;
                snapshotBootstrapped = true;
              } else if (batch.kind === 'stream-missing') {
                const state = await dependencies.store.readState({ generationId });
                if (state && await recoverUncertainTerminal(state)) return;
                const snapshot = state?.snapshot
                  ?? await dependencies.store.readSnapshot({ generationId });
                if (state?.terminal && snapshot) {
                  if (!await hasExactTerminalStateEvidence(state, true)) {
                    enqueueReplayError('GENERATION_TERMINAL_RECONCILIATION_PENDING');
                    return;
                  }
                  enqueueTerminalSnapshot(snapshot, state.terminal);
                  return;
                }
                if (state?.terminal) {
                  const fallback = await terminalFallback();
                  if (fallback) {
                    await pipeTerminalFallback(fallback);
                    return;
                  }
                }
                // Redis creates the stream lazily on the first append. Active state
                // with no cursor proves that the stream has not been evicted.
                const awaitingFirstEvent = state?.terminal === null
                  && state.lastEventId === null
                  && (
                    state.status === 'reserved'
                    || state.status === 'running'
                    || state.status === 'finalizing'
                  );
                if (snapshot) {
                  if (snapshotBootstrapped) {
                    enqueueReplayError('REPLAY_STREAM_MISSING');
                    return;
                  }
                  const snapshotId = monotonicSnapshotId(snapshot.lastEventId);
                  const event: GenerationStreamEvent = {
                    id: snapshotId,
                    type: 'snapshot',
                    data: snapshot,
                  };
                  controller.enqueue(event);
                  cursor = snapshotId;
                  snapshotBootstrapped = true;
                  observe({
                    event: 'replay',
                    generationId,
                    events: 1,
                    bytes: encodeGenerationSseEvent(event).byteLength,
                    snapshotBootstrap: true,
                  });
                } else if (!awaitingFirstEvent) {
                  enqueueReplayError('REPLAY_STREAM_MISSING');
                  return;
                }
              } else {
                let terminalBatchEvent: GenerationStreamEvent | undefined;
                for (let index = batch.events.length - 1; index >= 0; index -= 1) {
                  const candidate = batch.events[index]!;
                  if (candidate.type === 'done' || candidate.type === 'error') {
                    terminalBatchEvent = candidate;
                    break;
                  }
                }
                if (terminalBatchEvent) {
                  const terminalState = await dependencies.store.readState({ generationId });
                  if (terminalState?.terminal?.replayUncertain === true) {
                    // Preserve the batch's metadata and all already available
                    // deltas before replacing text from authoritative evidence.
                    for (const event of batch.events) {
                      if (event.type === 'done' || event.type === 'error') continue;
                      if (cancelled) return;
                      controller.enqueue(event);
                      cursor = event.id;
                    }
                    if (terminalState.lastEventId !== terminalBatchEvent.id
                      || !terminalStateEvidenceMatches({ state: terminalState, event: terminalBatchEvent })) {
                      throw new Error('GENERATION_TERMINAL_RECONCILIATION_PENDING');
                    }
                    await recoverUncertainTerminal(terminalState, terminalBatchEvent);
                    return;
                  }
                  if (
                    !terminalState
                    || terminalState.lastEventId !== terminalBatchEvent.id
                    || !terminalStateEvidenceMatches({
                      state: terminalState,
                      event: terminalBatchEvent,
                    })
                  ) {
                    enqueueReplayError('GENERATION_TERMINAL_RECONCILIATION_PENDING');
                    return;
                  }
                }
                let replayBytes = 0;
                let sawTerminal = false;
                for (const event of batch.events) {
                  if (cancelled) return;
                  controller.enqueue(event);
                  replayBytes += encodeGenerationSseEvent(event).byteLength;
                  cursor = event.id;
                  if (event.type === 'done' || event.type === 'error') sawTerminal = true;
                }
                if (batch.events.length > 0) {
                  observe({
                    event: 'replay',
                    generationId,
                    events: batch.events.length,
                    bytes: replayBytes,
                    snapshotBootstrap: false,
                  });
                }
                if (sawTerminal) {
                  controller.close();
                  return;
                }
              }

              let state = await dependencies.store.readState({ generationId });
              if (!state) {
                const durable = await inspectOwnedFinalization(generationId, actorKey)
                  .catch(() => ({ kind: 'not-found' as const }));
                if (durable.kind === 'terminal') {
                  await pipeTerminalFallback(durable.terminal);
                  return;
                }
                if (durable.kind === 'pending') {
                  await new Promise<void>((resolve) => setTimeout(resolve, replayPollMs));
                  continue;
                }
                enqueueReplayError('GENERATION_STATE_LOST');
                return;
              }
              const reconciled = await reconcileOwnedActiveState({ actorKey }, state);
              if (reconciled instanceof Response) {
                if (reconciled.status === 503) {
                  await new Promise<void>((resolve) => setTimeout(resolve, replayPollMs));
                  continue;
                }
                enqueueReplayError('GENERATION_STATE_LOST');
                return;
              }
              state = reconciled.state;
              if (reconciled.terminalFallback) {
                if (await recoverUncertainTerminal(state)) return;
                await pipeTerminalFallback(reconciled.terminalFallback);
                return;
              }
              if (state.terminal && batch.events.length === 0) {
                if (await recoverUncertainTerminal(state)) return;
                const snapshot = state.snapshot ?? await dependencies.store.readSnapshot({ generationId });
                if (snapshot) {
                  if (!await hasExactTerminalStateEvidence(state, true)) {
                    enqueueReplayError('GENERATION_TERMINAL_RECONCILIATION_PENDING');
                    return;
                  }
                  enqueueTerminalSnapshot(snapshot, state.terminal);
                  return;
                }
                const fallback = await terminalFallback();
                if (fallback) {
                  await pipeTerminalFallback(fallback);
                  return;
                }
                enqueueReplayError('GENERATION_TERMINAL_EVIDENCE_MISSING');
                return;
              }
              if (batch.events.length === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, replayIdleDelayMs));
              }
            }
          } catch (error) {
            if (cancelled) return;
            observe({ event: 'redis_degraded', generationId, operation: 'read_replay' });
            controller.error(error);
          }
        };
        void pump();
      },
      cancel() {
        cancelled = true;
        observe({ event: 'client_disconnect', generationId });
      },
    });

    return Object.freeze({
      generationId,
      generationRequestId,
      headers: Object.freeze({
      'X-Mahoshojo-Generation-Id': generationId,
      'X-Mahoshojo-Generation-Request-Id': generationRequestId,
        ...responseHeaders,
      }),
      events: stream,
    });
  };

  const createReplayResponse = (
    generationId: string,
    generationRequestId: string,
    payloadHash: string,
    after: string | null,
    actorKey: string,
    responseHeaders: Readonly<Record<string, string>> = {},
  ): Response => subscriptionToSseResponse(createReplaySubscription(
    generationId,
    generationRequestId,
    payloadHash,
    after,
    actorKey,
    responseHeaders,
  ));

  const launchProducer = async (input: {
    generationId: string;
    generationRequestId: string;
    actorKey: string;
    producerToken: string;
    payloadHash: string;
    payload: Record<string, unknown>;
    roomContext?: RoomStartContextData;
  }): Promise<void> => {
    if (activeProducers.has(input.generationId)) return;
    const controller = new AbortController();
    const loseOwnership = (): void => {
      if (!controller.signal.aborted) controller.abort('producer_lost');
    };
    const replayWriter = createReplayWriter(
      input.generationId,
      input.producerToken,
      loseOwnership,
    );
    if (input.roomContext?.admission.version === ROOM_GENERATION_START_GATE_VERSION) {
      const bound = await input.roomContext.bindProducer!(await hashRoomProducerToken(input.producerToken));
      if (!bound) throw new ArenaGenerationFinalizationPendingError();
    }
    const now = dependencies.now();
    const running = await dependencies.store.markRunning({
      ...(input.roomContext ? { roomAdmission: input.roomContext.admission } : {}),
      generationId: input.generationId,
      producerToken: input.producerToken,
      now: now.toISOString(),
      leaseExpiresAt: addLeaseDuration(now, leaseDurationMs),
    });
    if (!running.owned) {
      if (input.roomContext?.admission.version === ROOM_GENERATION_START_GATE_VERSION) throw new ArenaGenerationFinalizationPendingError();
      throw new Error('GENERATION_PRODUCER_FENCED');
    }
    if (running.cancelRequested) {
      const cancelReason = running.cancelReason ?? 'user';
      if (input.roomContext?.admission.version === ROOM_GENERATION_START_GATE_VERSION) {
        const recorder = dependencies.noProviderCancellationRecorder;
        if (!recorder) throw new ArenaGenerationFinalizationPendingError();
        const written = await recorder.record({ admission: input.roomContext.admission, acceptedPayloadHashes: [input.payloadHash] });
        if (written.kind !== 'recorded') throw new ArenaGenerationFinalizationPendingError();
      }
      await replayWriter.finish({
        status: 'cancelled',
        code: generationCancelCode(cancelReason),
      });
      return;
    }

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const executionPromise = dependencies.executor.execute({
      generationId: input.generationId, generationRequestId: input.generationRequestId,
      actorKey: input.actorKey, producerToken: input.producerToken, payloadHash: input.payloadHash, payload: input.payload,
      signal: controller.signal,
      emit: replayWriter.emit,
      claimFinalization: async (_terminal) => {
        if (controller.signal.reason === 'producer_lost') return { kind: 'fenced' };
        const claimNow = dependencies.now();
        const claimed = await dependencies.store.claimFinalization({
          generationId: input.generationId,
          producerToken: input.producerToken,
          now: claimNow.toISOString(),
          leaseExpiresAt: addLeaseDuration(claimNow, leaseDurationMs),
          ...(_terminal.status === 'completed' ? { terminal: _terminal } : {}),
        });
        if (claimed.kind === 'fenced') loseOwnership();
        if (claimed.kind === 'cancelled' && !controller.signal.aborted) {
          controller.abort(claimed.cancelReason ?? 'user');
        }
        return claimed;
      },
    });

    const promise = (async (): Promise<void> => {
      try {
        heartbeat = setInterval(() => {
          const heartbeatNow = dependencies.now();
          void dependencies.store.heartbeat({
            generationId: input.generationId,
            producerToken: input.producerToken,
            now: heartbeatNow.toISOString(),
            leaseExpiresAt: addLeaseDuration(heartbeatNow, leaseDurationMs),
          }).then((result) => {
            if (!result.owned) {
              loseOwnership();
              return;
            }
            if (result.cancelRequested) controller.abort(result.cancelReason ?? 'user');
          }).catch(() => {
            observe({
              event: 'redis_degraded',
              generationId: input.generationId,
              operation: 'heartbeat',
            });
          });
        }, heartbeatIntervalMs);
        const terminal = await executionPromise;
        try {
          await replayWriter.finish(terminal);
        } catch (error) {
          if (terminal.status !== 'completed') throw error;
          // The Provider result has already been delivered and durable finalization
          // has already decided success. A Redis terminal projection failure may
          // leave replay/finalization pending, but must not manufacture a failed
          // generation and overwrite the completed intent.
          return;
        }
      } catch (error) {
        const terminal: GenerationTerminal = controller.signal.reason === 'producer_lost'
          ? { status: 'producer_lost', code: 'PRODUCER_OWNERSHIP_LOST' }
          : controller.signal.aborted
            ? {
              status: 'cancelled',
              code: generationCancelCode(
                isGenerationCancelReason(controller.signal.reason)
                  ? controller.signal.reason
                  : 'user',
              ),
            }
          : { status: 'failed', code: 'GENERATION_FAILED' };
        await replayWriter.emit({
          type: 'telemetry',
          data: { errorClass: error instanceof Error ? error.name : 'Error' },
        });
        if (error instanceof ArenaGenerationFinalizationPendingError) return;
        await replayWriter.finish(terminal);
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        activeProducers.delete(input.generationId);
      }
    })();

    activeProducers.set(input.generationId, { controller, promise });
    void promise.catch(() => undefined);
  };

  const recordAuditableRejection = async (input: {
    rejection: ArenaGenerationAuditableRejection;
    roomContext?: RoomStartContextData;
    actor: ArenaGenerationActor;
    generationRequestId: string;
    claimedTerminalFence?: Readonly<{
      generationId: string;
      producerToken: string;
    }>;
  }): Promise<Response> => {
    const original = (): Response => withActorHeaders(input.rejection.response, input.actor);
    let terminalFence: {
      created: boolean;
      producerToken: string;
    } | null = input.claimedTerminalFence
      ? { created: true, producerToken: input.claimedTerminalFence.producerToken }
      : null;
    let generationId: string | undefined = input.claimedTerminalFence?.generationId;
    const releaseClaimedFence = async (): Promise<void> => {
      if (!terminalFence?.created || !generationId) return;
      await dependencies.store.releaseReservation({
        generationId,
        producerToken: terminalFence.producerToken,
      }).catch(() => ({ released: false }));
    };
    if (
      input.rejection.actorKey !== input.actor.actorKey
      || input.rejection.generationRequestId !== input.generationRequestId
    ) {
      await releaseClaimedFence();
      return original();
    }
    if (!dependencies.rejectedTerminalRecorder) {
      await releaseClaimedFence();
      return original();
    }
    let responseSnapshot: RejectedResponseSnapshot;
    try {
      responseSnapshot = await snapshotRejectedResponse(input.rejection.response);
    } catch {
      await releaseClaimedFence();
      return original();
    }
    let payloadHash: string;
    try {
      generationId ??= await dependencies.deriveGenerationId({
        actorKey: input.actor.actorKey,
        generationRequestId: input.generationRequestId,
      });
      payloadHash = await dependencies.hashPayload(input.rejection.fingerprintPayload);
      if (input.roomContext && (input.roomContext.admission.generationId !== generationId
        || (input.roomContext.admission.generationPayloadDigest !== null
          && input.roomContext.admission.generationPayloadDigest !== `sha256:${payloadHash}`))) {
        await releaseClaimedFence();
        return original();
      }
      if (!terminalFence) {
        const reservationPayloadHash = splitMaterialization
          ? await dependencies.hashPayload({
            reservationHashVersion: ARENA_SEEDED_RESERVATION_HASH_VERSION,
            semanticPayload: input.rejection.fingerprintPayload,
          })
          : payloadHash;
        const producerToken = dependencies.createProducerToken?.() ?? crypto.randomUUID();
        const now = dependencies.now();
        const reservation = await dependencies.store.reserve({
          ...(input.roomContext ? { roomAdmission: input.roomContext.admission, producerTokenDigest: await hashRoomProducerToken(producerToken) } : {}),
          actorKey: input.actor.actorKey,
          generationRequestId: input.generationRequestId,
          generationId,
          payloadHash: reservationPayloadHash,
          producerToken,
          now: now.toISOString(),
          leaseExpiresAt: addLeaseDuration(now, leaseDurationMs),
          mode: input.rejection.audit.mode,
        });
        if (reservation.kind === 'conflict') {
          return withActorHeaders(jsonResponse({
            code: 'GENERATION_REQUEST_CONFLICT',
            error: 'generationRequestId 已用于不同请求',
          }, 409), input.actor);
        }
        terminalFence = {
          created: reservation.kind === 'created',
          producerToken,
        };
        if (reservation.kind === 'reused') {
          const state = await dependencies.store.readState({
            generationId,
            actorKey: input.actor.actorKey,
          });
          if (!state?.terminal) return original();
        }
      }
      const recorded = await dependencies.rejectedTerminalRecorder.record({
        generationId,
        generationRequestId: input.generationRequestId,
        actorKey: input.actor.actorKey,
        payloadHash,
        code: input.rejection.code,
        stage: input.rejection.stage,
        endpoint: input.rejection.audit.endpoint,
        generationMode: input.rejection.audit.generationMode,
        startedAt: input.rejection.audit.startedAt,
        mode: input.rejection.audit.mode,
        pvpContext: input.rejection.audit.pvpContext,
      });
      if (recorded.kind === 'conflict') {
        if (terminalFence.created) {
          await releaseClaimedFence();
        }
        return withActorHeaders(jsonResponse({
          code: 'GENERATION_REQUEST_CONFLICT',
          error: 'generationRequestId 已用于不同请求',
        }, 409), input.actor);
      }
      if (terminalFence?.created) {
        const terminalNow = dependencies.now().toISOString();
        const priorState = await dependencies.store.readState({
          generationId,
          actorKey: input.actor.actorKey,
        }).catch(() => null);
        if (priorState) {
          const evidence = await commitOwnedTerminalEvidence({
            generationId,
            actorKey: input.actor.actorKey,
            producerToken: terminalFence.producerToken,
            record: {
              generationId,
              generationRequestId: input.generationRequestId,
              status: 'failed',
              updatedAt: terminalNow,
              resultRef: null,
              markdown: '',
              reasoning: '',
              errorCode: input.rejection.code,
              payloadHash: priorState.payloadHash,
              contentAvailable: true,
            },
            priorState,
            replayEvidence: 'legacy-durable-rebuild',
            now: terminalNow,
          });
          if (!evidence) {
            observe({
              event: 'redis_degraded',
              generationId,
              operation: 'rejection_terminal_evidence',
            });
          }
        }
      }
    } catch {
      if (terminalFence?.created) {
        await releaseClaimedFence();
      }
      return original();
    }
    return withActorHeaders(withRejectedGenerationIdentity(
      responseSnapshot,
      generationId!,
      input.generationRequestId,
    ), input.actor);
  };

  const service: ArenaGenerationApplicationService = {
    storyProtocolVersion: ARENA_STORY_PROTOCOL_VERSION,
    async cancelRoomOwned(input) {
      const context = readRoomCancelContext(input.context);
      if (!context) return { kind: 'unavailable', code: 'GENERATION_STATE_UNAVAILABLE' };
      const admission = context.admission;
      const actorKey = `pvp-room:${admission.roomId}`;
      const unavailable = () => ({ kind: 'unavailable' as const, code: 'GENERATION_STATE_UNAVAILABLE' as const });
      try {
        const cancellation = await dependencies.store.requestCancel({
          generationId: admission.generationId, actorKey, reason: 'user',
          now: dependencies.now().toISOString(), roomAdmission: admission,
          producerTokenDigest: context.producerTokenDigest,
        });
        if (cancellation.kind === 'accepted' && cancellation.previousStatus === 'running') {
          const producer = activeProducers.get(admission.generationId);
          if (producer && !producer.controller.signal.aborted) producer.controller.abort(cancellation.cancelReason);
          return { kind: 'accepted', cancelReason: cancellation.cancelReason };
        }
        if (cancellation.kind === 'forbidden') return cancellation;
        if (cancellation.kind === 'finalizing') return cancellation;
        const priorState = await dependencies.store.readState({ generationId: admission.generationId, actorKey });
        const exactCore = priorState
          && priorState.generationRequestId === admission.generationRequestId
          && sameRoomGenerationAdmission(priorState.roomAdmission, admission);
        const acceptedHashes = [roomGenerationLegacyPayloadHash(admission), ...(exactCore ? [priorState.payloadHash] : [])];
        const neverStarted = cancellation.kind === 'accepted' && cancellation.previousStatus === 'reserved'
          || cancellation.kind === 'not-found' && context.producerTokenDigest === null;
        if (neverStarted) {
          if (!dependencies.noProviderCancellationRecorder) return unavailable();
          const written = await dependencies.noProviderCancellationRecorder.record({ admission, acceptedPayloadHashes: acceptedHashes });
          if (written.kind !== 'recorded' && written.kind !== 'already-terminal') return unavailable();
        }
        const durable = await inspectOwnedFinalization(admission.generationId, actorKey);
        if (durable.kind !== 'terminal'
          || durable.terminal.generationRequestId !== admission.generationRequestId
          || !durable.terminal.payloadHash || !acceptedHashes.includes(durable.terminal.payloadHash)) return unavailable();
        if (priorState && exactCore && !priorState.terminal) {
          if (priorState.leaseExpiresAt && Date.parse(priorState.leaseExpiresAt) <= dependencies.now().getTime()) {
            const recovered = await reconcileOwnedActiveState({ actorKey }, priorState);
            if (recovered instanceof Response || !recovered.state.terminal) return unavailable();
            return { kind: 'terminal', status: recovered.state.terminal.status };
          }
          const committed = await commitOwnedTerminalEvidence({
            generationId: admission.generationId, actorKey, producerToken: priorState.producerToken,
            record: durable.terminal, priorState, replayEvidence: 'legacy-durable-rebuild',
            now: dependencies.now().toISOString(), acceptedPayloadHashes: acceptedHashes,
          });
          if (!committed) return unavailable();
        }
        return { kind: 'terminal', status: durable.terminal.status };
      } catch { return unavailable(); }
    },

    async cancelOwned(input): Promise<ArenaGenerationOwnedCancelResult> {
      const result = await dependencies.store.requestCancel({
        generationId: input.generationId,
        actorKey: input.actorKey,
        reason: input.reason,
        now: dependencies.now().toISOString(),
      });
      if (result.kind === 'accepted') {
        const producer = activeProducers.get(input.generationId);
        if (producer && !producer.controller.signal.aborted) {
          producer.controller.abort(result.cancelReason);
        }
        observe({
          event: 'cancel',
          generationId: input.generationId,
          reason: result.cancelReason,
          outcome: 'accepted',
        });
      } else if (result.kind === 'terminal') {
        observe({
          event: 'cancel',
          generationId: input.generationId,
          reason: input.reason,
          outcome: 'terminal',
        });
      }
      return result;
    },

    async readOwnedProjection(input): Promise<ArenaGenerationOwnedProjectionResult> {
      const owned = await resolveOwnedStateForActor(
        { actorKey: input.actorKey },
        input.generationId,
      );
      if (owned instanceof Response) return ownedFailureFromResponse(owned);
      let terminalFallback = owned.terminalFallback;
      if (
        owned.state.status === 'completed'
        && !terminalFallback?.roomSafeResult
        && dependencies.terminalStore
      ) {
        const durable = await readOwnedTerminal(input.generationId, input.actorKey)
          .catch(() => null);
        if (
          durable?.status === 'completed'
          && terminalRecordMatchesIdentity({
            record: durable,
            generationId: owned.state.generationId,
            generationRequestId: owned.state.generationRequestId,
            acceptedPayloadHashes: acceptedStatePayloadHashes(owned.state),
          })
        ) terminalFallback = durable;
      }
      const terminalContentExpired = isTerminalContentExpired(terminalFallback);
      const terminalContentNotArchived = isTerminalContentNotArchived(terminalFallback);
      if (
        terminalFallback?.status === 'completed'
        && terminalFallback.contentAvailable !== true
        && !terminalContentExpired
        && !terminalContentNotArchived
      ) {
        return {
          kind: 'unavailable',
          code: 'GENERATION_TERMINAL_CONTENT_UNAVAILABLE',
        };
      }
      const snapshot = owned.state.snapshot;
      const finalAuthoritative = owned.state.status === 'completed'
        || owned.state.status === 'failed'
        || owned.state.status === 'cancelled'
        || owned.state.status === 'producer_lost';
      const resultAvailable = owned.state.status === 'completed'
        && !terminalContentExpired
        && !terminalContentNotArchived
        && Boolean(
          terminalFallback?.resultRef
          ?? owned.state.terminal?.resultRef
        ?? snapshot?.terminalResultRef,
      );
      return {
        kind: 'found',
        projection: Object.freeze({
          generationId: owned.state.generationId,
          generationRequestId: owned.state.generationRequestId,
          status: owned.state.status,
          markdown: owned.state.status === 'completed'
            ? terminalContentExpired
              ? ''
              : terminalFallback?.markdown ?? snapshot?.markdown ?? ''
            : owned.state.status === 'reserved'
                || owned.state.status === 'running'
                || owned.state.status === 'finalizing'
              ? snapshot?.markdown ?? ''
              : '',
          resumeCursor: snapshot?.lastEventId ?? owned.state.lastEventId,
          updatedAt: terminalFallback?.updatedAt
            ?? snapshot?.updatedAt
            ?? owned.state.updatedAt,
          finalAuthoritative,
          resultAvailable,
          generationRecordId: resultAvailable ? owned.state.generationId : null,
          errorCode: safeTerminalErrorCode(
            owned.state.status,
            terminalFallback?.errorCode ?? owned.state.terminal?.code,
          ),
          ...(terminalContentNotArchived ? {
            persistenceWarning: ARENA_OUTPUT_NOT_ARCHIVED_WARNING,
            replayUnavailable: true,
          } : {}),
          ...(terminalContentExpired ? { contentRetention: 'expired' as const } : {}),
          ...(owned.state.status === 'completed' && terminalFallback?.roomSafeResult
            ? { roomSafeResult: terminalFallback.roomSafeResult }
            : {}),
        }),
      };
    },

    async resumeOwnedSubscription(input): Promise<ArenaGenerationOwnedSubscriptionResult> {
      const owned = await resolveOwnedStateForActor(
        { actorKey: input.actorKey },
        input.generationId,
      );
      if (owned instanceof Response) return ownedFailureFromResponse(owned);
      if (owned.state.terminal?.replayUncertain === true
        && owned.state.terminal.status === 'completed' && !owned.state.snapshot) {
        return { kind: 'unavailable', code: 'GENERATION_TERMINAL_CONTENT_UNAVAILABLE' };
      }
      const subscription = owned.terminalFallback && owned.state.terminal?.replayUncertain !== true
        ? createTerminalFallbackSubscription(owned.terminalFallback, input.after)
        : createReplaySubscription(
          owned.state.generationId,
          owned.state.generationRequestId,
          owned.state.payloadHash,
          input.after,
          owned.actor.actorKey,
          owned.actor.responseHeaders,
        );
      if (subscription instanceof Response) return ownedFailureFromResponse(subscription);
      return { kind: 'subscribed', subscription };
    },

    async create(request: Request): Promise<Response> {
      const subscription = await service.createSubscription(request);
      return subscription instanceof Response
        ? subscription
        : subscriptionToSseResponse(subscription);
    },

    async createParsedSubscription(
      request: Request,
      command: ArenaGenerationCreateCommand,
    ): Promise<ArenaGenerationSubscription | Response> {
      if (request.method !== 'POST') {
        return withNotDispatchedHeader(jsonResponse({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }, 405));
      }
      const generationRequestId = typeof command?.generationRequestId === 'string'
        ? command.generationRequestId.trim()
        : '';
      if (!isGenerationRequestId(generationRequestId)) {
        return withNotDispatchedHeader(jsonResponse({
          code: 'INVALID_GENERATION_REQUEST_ID',
          error: 'generationRequestId 无效',
        }, 400));
      }
      if (
        !command.payload
        || typeof command.payload !== 'object'
        || Array.isArray(command.payload)
      ) {
        return withNotDispatchedHeader(jsonResponse({ code: 'INVALID_REQUEST', error: '请求体必须是对象' }, 400));
      }
      if (
        !Number.isSafeInteger(command.bodyBytes)
        || command.bodyBytes < 0
        || command.bodyBytes > MAX_ARENA_CREATE_BODY_BYTES
      ) {
        return withNotDispatchedHeader(jsonResponse({
          code: 'ARENA_REQUEST_TOO_LARGE',
          error: '请求体超过允许的大小',
        }, 413));
      }
      const payload = { ...command.payload };
      delete payload.generationRequestId;
      const identity = command.trustedStoryIdentity === undefined
        ? null : ArenaStoryIdentitySchema.safeParse(command.trustedStoryIdentity);
      if (identity && !identity.success) {
        return withNotDispatchedHeader(jsonResponse({ code: 'INVALID_STORY_IDENTITY', error: '故事请求身份无效' }, 400));
      }
      parsedCreateCommands.set(request, {
        generationRequestId,
        payload,
        bodyBytes: command.bodyBytes,
        ...(identity?.success ? { trustedStoryIdentity: Object.freeze(identity.data) } : {}),
        ...(command.trustedRoomContext && readRoomStartContext(command.trustedRoomContext)
          ? { trustedRoomContext: command.trustedRoomContext } : {}),
      });
      try {
        return await service.createSubscription(request);
      } finally {
        parsedCreateCommands.delete(request);
      }
    },

    async createSubscription(
      request: Request,
    ): Promise<ArenaGenerationSubscription | Response> {
      if (request.method !== 'POST') {
        return withNotDispatchedHeader(jsonResponse({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }, 405));
      }
      let actor = await dependencies.resolveActor(request);
      if (!actor) return withNotDispatchedHeader(jsonResponse({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401));
      const parsed = parsedCreateCommands.get(request) ?? await parseCreatePayload(request);
      if (parsed instanceof Response) return withNotDispatchedHeader(parsed);
      if (dependencies.resolveCreateActor) {
        actor = await dependencies.resolveCreateActor({
          request,
          actor,
          generationRequestId: parsed.generationRequestId,
          payload: parsed.payload,
        });
        if (!actor) return withNotDispatchedHeader(jsonResponse({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401));
      }

      const roomContext = readRoomStartContext(parsed.trustedRoomContext);
      if (actor.actorKey.startsWith('pvp-room:')) {
        if (!roomContext || actor.actorKey !== `pvp-room:${roomContext.admission.roomId}`
          || parsed.generationRequestId !== roomContext.admission.generationRequestId) {
          return withNotDispatchedHeader(jsonResponse({ code: 'ARENA_ROOM_START_CONTEXT_REQUIRED', error: 'Trusted Room start context required' }, 403));
        }
      } else if (roomContext) {
        return withNotDispatchedHeader(jsonResponse({ code: 'ARENA_ROOM_START_CONTEXT_INVALID', error: 'Room actor mismatch' }, 403));
      }

      let semanticPayload: Record<string, unknown>;
      let materializationPayload: Record<string, unknown> | null = null;
      let prepared: PreparedArenaGeneration | MaterializedArenaGeneration | null = null;
      if (splitMaterialization) {
        const preflighted = await dependencies.executor.preflight!({
          request,
          actorKey: actor.actorKey,
          generationRequestId: parsed.generationRequestId,
          payload: parsed.payload,
        });
        if (preflighted instanceof Response) return withNotDispatchedHeader(preflighted);
        if (isArenaGenerationAuditableRejection(preflighted)) {
          return recordAuditableRejection({
            ...(roomContext ? { roomContext } : {}),
            rejection: preflighted,
            actor,
            generationRequestId: parsed.generationRequestId,
          });
        }
        semanticPayload = preflighted.semanticPayload;
        materializationPayload = preflighted.materializationPayload;
      } else {
        const legacyPrepared = dependencies.executor.prepare
          ? await dependencies.executor.prepare({
            request,
            actorKey: actor.actorKey,
            generationRequestId: parsed.generationRequestId,
            payload: parsed.payload,
          })
          : {
          executionPayload: parsed.payload,
          semanticPayload: parsed.payload,
        };
        if (legacyPrepared instanceof Response) return withNotDispatchedHeader(legacyPrepared);
        if (isArenaGenerationAuditableRejection(legacyPrepared)) {
          return recordAuditableRejection({
            ...(roomContext ? { roomContext } : {}),
            rejection: legacyPrepared,
            actor,
            generationRequestId: parsed.generationRequestId,
          });
        }
        prepared = legacyPrepared;
        semanticPayload = legacyPrepared.semanticPayload;
      }

      if (parsed.trustedStoryIdentity) {
        // Node preflight strips every __arenaServer field from untrusted semantic input.
        // Add this one only AFTER preflight, without putting it into execution/model input.
        // Legacy requests stay byte-for-byte on their existing hash path.
        semanticPayload = { ...semanticPayload, __arenaServerStoryIdentityV1: parsed.trustedStoryIdentity };
      }
      const generationId = await dependencies.deriveGenerationId({
        actorKey: actor.actorKey,
        generationRequestId: parsed.generationRequestId,
      });
      const producerToken = dependencies.createProducerToken?.() ?? crypto.randomUUID();
      const inputBytes = encodedBytes(semanticPayload);
      const legacyPayloadHash = await dependencies.hashPayload(semanticPayload);
      const payloadHash = splitMaterialization
        ? await dependencies.hashPayload({
          reservationHashVersion: ARENA_SEEDED_RESERVATION_HASH_VERSION,
          semanticPayload,
        })
        : legacyPayloadHash;
      const matchesPayloadHash = (candidate: string | null | undefined): boolean => (
        candidate === payloadHash
        || (splitMaterialization && candidate === legacyPayloadHash)
      );
      if (roomContext && (roomContext.admission.generationId !== generationId
        || (roomContext.admission.generationPayloadDigest !== null
          && roomContext.admission.generationPayloadDigest !== `sha256:${legacyPayloadHash}`))) {
        return withNotDispatchedHeader(jsonResponse({ code: 'GENERATION_REQUEST_CONFLICT', error: 'Room generation identity mismatch' }, 409));
      }
      const producerTokenDigest = roomContext ? await hashRoomProducerToken(producerToken) : undefined;
      const preparationSeed = splitMaterialization
        ? (dependencies.createPreparationSeed?.() ?? createSecurePreparationSeed())
        : null;
      if (preparationSeed !== null && !isArenaPreparationSeed(preparationSeed)) {
        throw new Error('Arena generation preparation seed 无效');
      }
      const now = dependencies.now();
      let reservation: Awaited<ReturnType<GenerationReplayStore['reserve']>>;
      try {
        reservation = await dependencies.store.reserve({
          ...(roomContext ? { roomAdmission: roomContext.admission, producerTokenDigest } : {}),
          multiplayerParticipation: extractArenaMultiplayerParticipation(semanticPayload.multiplayerGenerationSnapshot, actor.actorKey),
          actorKey: actor.actorKey,
          generationRequestId: parsed.generationRequestId,
          generationId,
          payloadHash,
          ...(preparationSeed ? { preparationSeed } : {}),
          ...(splitMaterialization && materializationVersion
            ? { preparationVersion: materializationVersion }
            : {}),
          ...(typeof semanticPayload.mode === 'string'
            ? { mode: semanticPayload.mode }
            : {}),
          producerToken,
          now: now.toISOString(),
          leaseExpiresAt: addLeaseDuration(now, leaseDurationMs),
        });
      } catch {
        observe({ event: 'request', generationId, outcome: 'unavailable', inputBytes });
        observe({ event: 'redis_degraded', generationId, operation: 'reserve' });
        // A failed reservation must not erase a known uncertain terminal hint
        // before the durable body-only fallback is considered.
        try {
          const retained = await dependencies.store.readState({ generationId, actorKey: actor.actorKey });
          if (retained?.terminal?.replayUncertain === true) {
            if (retained.generationRequestId !== parsed.generationRequestId || !matchesPayloadHash(retained.payloadHash)) {
              return withActorHeaders(jsonResponse({
                code: 'GENERATION_REQUEST_CONFLICT', error: 'generationRequestId 已用于不同请求',
              }, 409), actor);
            }
            const requireSnapshot = retained.terminal.status === 'completed';
            if ((requireSnapshot && !retained.snapshot) || !await hasExactTerminalStateEvidence(retained, requireSnapshot)) {
              return withActorHeaders(createTerminalContentUnavailableResponse(), actor);
            }
            return withActorSubscriptionHeaders(createReplaySubscription(
              generationId, retained.generationRequestId, retained.payloadHash, null, actor.actorKey,
            ), actor);
          }
          if (retained && !retained.terminal) {
            return withActorHeaders(jsonResponse({
              code: 'GENERATION_RESERVATION_UNAVAILABLE',
              error: '无法确认 generation reservation',
            }, 503), actor);
          }
        } catch (error) {
          if (error instanceof Error && error.message === 'REDIS_GENERATION_UNCERTAIN_SNAPSHOT_UNAVAILABLE') {
            return withActorHeaders(createTerminalContentUnavailableResponse(), actor);
          }
          if (error instanceof Error && error.message === 'REDIS_GENERATION_STORAGE_VERSION_INVALID') {
            return withActorHeaders(jsonResponse({
              code: 'GENERATION_STATE_UNAVAILABLE', error: 'Generation state unavailable',
            }, 503), actor);
          }
        }
        let durable: Awaited<ReturnType<typeof inspectOwnedFinalization>> = { kind: 'not-found' };
        try {
          durable = await inspectOwnedFinalization(generationId, actor.actorKey);
        } catch {
          // The response below remains fail closed when neither Redis nor D1 can prove ownership.
        }
        if (durable.kind === 'pending') {
          if (durable.payloadHash && !matchesPayloadHash(durable.payloadHash)) {
            return jsonResponse({
              code: 'GENERATION_REQUEST_CONFLICT',
              error: 'generationRequestId 已用于不同请求',
            }, 409);
          }
          return jsonResponse({
            code: 'GENERATION_FINALIZATION_PENDING',
            error: 'Generation durable finalization remains pending',
          }, 503);
        }
        if (durable.kind === 'terminal') {
          const terminal = durable.terminal;
          if (
            terminal.generationId !== generationId
            || terminal.generationRequestId !== parsed.generationRequestId
            || !matchesPayloadHash(terminal.payloadHash)
          ) {
            observe({ event: 'request', generationId, outcome: 'conflict', inputBytes });
            return jsonResponse({
              code: 'GENERATION_REQUEST_CONFLICT',
              error: 'generationRequestId 已用于不同请求',
            }, 409);
          }
          observe({ event: 'request', generationId, outcome: 'reused', inputBytes });
          const fallback = createTerminalFallbackSubscription(terminal);
          return fallback instanceof Response
            ? withActorHeaders(fallback, actor)
            : withActorSubscriptionHeaders(fallback, actor);
        }
        return jsonResponse({
          code: 'GENERATION_RESERVATION_UNAVAILABLE',
          error: '无法确认 generation reservation',
        }, 503);
      }

      if (reservation.kind === 'conflict' && splitMaterialization) {
        try {
          const legacyState = await dependencies.store.readState({
            generationId,
            actorKey: actor.actorKey,
          });
          if (
            legacyState?.payloadHash === legacyPayloadHash
            && !legacyState.preparationSeed
            && !legacyState.preparationVersion
          ) {
            reservation = {
              kind: 'reused',
              generationId: legacyState.generationId,
              preparationSeed: null,
              preparationVersion: null,
            };
          }
        } catch {
          observe({ event: 'redis_degraded', generationId, operation: 'read_state' });
          return jsonResponse({
            code: 'GENERATION_STATE_UNAVAILABLE',
            error: '无法确认 generation state',
          }, 503);
        }
      }
      if (reservation.kind === 'conflict') {
        observe({ event: 'request', generationId, outcome: 'conflict', inputBytes });
        return jsonResponse({
          code: 'GENERATION_REQUEST_CONFLICT',
          error: 'generationRequestId 已用于不同请求',
        }, 409);
      }
      if (reservation.kind === 'created' && dependencies.terminalStore) {
        let durable: Awaited<ReturnType<typeof inspectOwnedFinalization>>;
        try {
          durable = await inspectOwnedFinalization(generationId, actor.actorKey);
        } catch {
          const releaseResult = await dependencies.store.releaseReservation({
            generationId,
            producerToken,
          }).catch(() => ({ released: false }));
          const errorResponse = jsonResponse({
            code: 'GENERATION_TERMINAL_LOOKUP_UNAVAILABLE',
            error: '无法确认 generation terminal state',
          }, 503);
          return releaseResult.released ? withNotDispatchedHeader(errorResponse) : errorResponse;
        }
        if (durable.kind === 'pending') {
          await dependencies.store.releaseReservation({
            generationId,
            producerToken,
          }).catch(() => ({ released: false }));
          if (durable.payloadHash && !matchesPayloadHash(durable.payloadHash)) {
            return jsonResponse({
              code: 'GENERATION_REQUEST_CONFLICT',
              error: 'generationRequestId 已用于不同请求',
            }, 409);
          }
          return jsonResponse({
            code: 'GENERATION_FINALIZATION_PENDING',
            error: 'Generation durable finalization remains pending',
          }, 503);
        }
        if (durable.kind === 'terminal') {
          const terminal = durable.terminal;
          if (
            terminal.generationId !== generationId
            || terminal.generationRequestId !== parsed.generationRequestId
            || !matchesPayloadHash(terminal.payloadHash)
          ) {
            await dependencies.store.releaseReservation({
              generationId,
              producerToken,
            }).catch(() => ({ released: false }));
            observe({ event: 'request', generationId, outcome: 'conflict', inputBytes });
            return jsonResponse({
              code: 'GENERATION_REQUEST_CONFLICT',
              error: 'generationRequestId 已用于不同请求',
            }, 409);
          }
          const reservedState = await dependencies.store.readState({
            generationId,
            actorKey: actor.actorKey,
          }).catch(() => null);
          const durableState = reservedState
            ? await commitOwnedTerminalEvidence({
                generationId,
                actorKey: actor.actorKey,
                producerToken,
                record: terminal,
                priorState: reservedState,
                replayEvidence: 'legacy-durable-rebuild',
                now: dependencies.now().toISOString(),
                acceptedPayloadHashes: splitMaterialization
                  ? [payloadHash, legacyPayloadHash]
                  : [payloadHash],
              })
            : null;
          if (!durableState) {
            return jsonResponse({
              code: 'GENERATION_TERMINAL_RECONCILIATION_PENDING',
              error: 'Generation terminal reconciliation pending',
            }, 503);
          }
          observe({ event: 'request', generationId, outcome: 'reused', inputBytes });
          if (durableState.terminal?.replayUncertain === true) {
            if (durableState.terminal.status === 'completed' && !durableState.snapshot) {
              return withActorHeaders(createTerminalContentUnavailableResponse(), actor);
            }
            return withActorSubscriptionHeaders(createReplaySubscription(
              generationId, durableState.generationRequestId, durableState.payloadHash, null, actor.actorKey,
            ), actor);
          }
          const fallback = createTerminalFallbackSubscription(terminal);
          return fallback instanceof Response
            ? withActorHeaders(fallback, actor)
            : withActorSubscriptionHeaders(fallback, actor);
        }
      }
      if (splitMaterialization) {
        const reservedSeed = reservation.preparationSeed ?? null;
        const reservedVersion = reservation.preparationVersion ?? null;
        if (
          !isArenaPreparationSeed(reservedSeed)
          || !isArenaPreparationVersion(reservedVersion)
        ) {
          if (reservation.kind === 'created') {
            const releaseResult = await dependencies.store.releaseReservation({
              generationId: reservation.generationId,
              producerToken,
            }).catch(() => ({ released: false }));
            const errorResponse = jsonResponse({
              code: 'GENERATION_PREPARATION_UNAVAILABLE',
              error: 'Generation preparation state unavailable',
            }, 503);
            return releaseResult.released ? withNotDispatchedHeader(errorResponse) : errorResponse;
          }
          prepared = {
            executionPayload: materializationPayload!,
          };
        } else {
          try {
            const materialized = await dependencies.executor.materialize!({
              request,
              actorKey: actor.actorKey,
              generationRequestId: parsed.generationRequestId,
              payload: materializationPayload!,
              preparationSeed: reservedSeed,
              preparationVersion: reservedVersion,
            });
            if (isArenaGenerationAuditableRejection(materialized)) {
              if (reservation.kind !== 'created') return materialized.response;
              return recordAuditableRejection({
            ...(roomContext ? { roomContext } : {}),
                rejection: materialized,
                actor,
                generationRequestId: parsed.generationRequestId,
                claimedTerminalFence: {
                  generationId: reservation.generationId,
                  producerToken,
                },
              });
            }
            if (materialized instanceof Response) {
              if (reservation.kind === 'created') {
                const releaseResult = await dependencies.store.releaseReservation({
                  generationId: reservation.generationId,
                  producerToken,
                }).catch(() => ({ released: false }));
                return releaseResult.released ? withNotDispatchedHeader(materialized) : materialized;
              }
              prepared = { executionPayload: materializationPayload! };
            } else {
              prepared = materialized;
            }
          } catch {
            if (reservation.kind === 'created') {
              const releaseResult = await dependencies.store.releaseReservation({
                generationId: reservation.generationId,
                producerToken,
              }).catch(() => ({ released: false }));
              const errorResponse = jsonResponse({
                code: 'GENERATION_MATERIALIZATION_FAILED',
                error: 'Generation materialization failed',
              }, 500);
              return releaseResult.released ? withNotDispatchedHeader(errorResponse) : errorResponse;
            }
            prepared = { executionPayload: materializationPayload! };
          }
        }
      }
      if (!prepared) throw new Error('ARENA_GENERATION_NOT_MATERIALIZED');
      observe({
        event: 'request',
        generationId: reservation.generationId,
        outcome: reservation.kind,
        inputBytes,
      });
      if (reservation.kind === 'created') {
        try {
          await launchProducer({
            generationId: reservation.generationId,
            generationRequestId: parsed.generationRequestId,
            actorKey: actor.actorKey,
            producerToken,
            payloadHash,
            payload: prepared.executionPayload,
            ...(roomContext ? { roomContext } : {}),
          });
        } catch (error) {
          if (roomContext?.admission.version === ROOM_GENERATION_START_GATE_VERSION || error instanceof ArenaGenerationFinalizationPendingError) {
            return jsonResponse({ code: 'GENERATION_FINALIZATION_PENDING', error: 'Room admission or durable cancellation remains unconfirmed' }, 503);
          }
          const terminalNow = dependencies.now().toISOString();
          const priorState = await dependencies.store.readState({
            generationId: reservation.generationId,
            actorKey: actor.actorKey,
          }).catch(() => null);
          if (priorState) {
            await commitOwnedTerminalEvidence({
              generationId: reservation.generationId,
              actorKey: actor.actorKey,
              producerToken,
              record: {
                generationId: reservation.generationId,
                generationRequestId: parsed.generationRequestId,
                status: 'producer_lost',
                updatedAt: terminalNow,
                resultRef: null,
                markdown: '',
                reasoning: '',
                errorCode: 'PRODUCER_OWNERSHIP_UNAVAILABLE',
                payloadHash,
                contentAvailable: true,
              },
              priorState,
              replayEvidence: 'uncertain-owner-recovery',
              now: terminalNow,
            });
          }
          observe({
            event: 'producer_lost',
            generationId: reservation.generationId,
            reason: 'ownership_unavailable',
          });
          return jsonResponse({
            code: 'GENERATION_OWNERSHIP_UNAVAILABLE',
            error: '无法建立 generation producer ownership',
          }, 503);
        }
      }
      return withActorSubscriptionHeaders(
        createReplaySubscription(
          reservation.generationId,
          parsed.generationRequestId,
          payloadHash,
          null,
          actor.actorKey,
          prepared.responseHeaders,
        ),
        actor,
      );
    },

    async cancelRequest(request: Request): Promise<Response> {
      const actor = await dependencies.resolveActor(request);
      if (!actor) return jsonResponse({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);
      const payload = await readOptionalCancelPayload(request);
      if (payload instanceof Response) return payload;
      const generationRequestId = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).generationRequestId
        : null;
      if (
        typeof generationRequestId !== 'string'
        || !isGenerationRequestId(generationRequestId)
      ) {
        return jsonResponse({
          code: 'GENERATION_REQUEST_ID_INVALID',
          error: 'generationRequestId is required',
        }, 400);
      }
      const cancelReason = cancelReasonFromPayload(payload);
      if (cancelReason instanceof Response) return cancelReason;
      const generationId = await dependencies.deriveGenerationId({
        actorKey: actor.actorKey,
        generationRequestId,
      });
      let result: Awaited<ReturnType<GenerationReplayStore['requestCancel']>>;
      try {
        result = await dependencies.store.requestCancel({
          generationId,
          actorKey: actor.actorKey,
          reason: cancelReason,
          now: dependencies.now().toISOString(),
          ...(!actor.actorKey.startsWith('pvp-room:') ? { preCancelRequestId: generationRequestId } : {}),
        });
      } catch {
        const durable = await inspectOwnedFinalization(generationId, actor.actorKey)
          .catch(() => ({ kind: 'not-found' as const }));
        if (durable.kind === 'terminal') {
          if (
            durable.terminal.generationId !== generationId
            || durable.terminal.generationRequestId !== generationRequestId
          ) {
            return jsonResponse({
              code: 'GENERATION_STATE_UNAVAILABLE',
              error: 'Generation state unavailable',
            }, 503);
          }
          return withActorHeaders(jsonResponse({
            generationId,
            status: durable.terminal.status,
            cancelled: durable.terminal.status === 'cancelled',
          }, 200), actor);
        }
        if (durable.kind === 'pending') {
          return withActorHeaders(jsonResponse({
            code: 'GENERATION_FINALIZATION_IN_PROGRESS',
            generationId,
            status: 'finalizing',
            cancelled: false,
          }, 409), actor);
        }
        return jsonResponse({
          code: 'GENERATION_STATE_UNAVAILABLE',
          error: 'Generation state unavailable',
        }, 503);
      }
      if (result.kind === 'not-found' || result.kind === 'forbidden') {
        return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
      }
      if (result.kind === 'accepted') {
        activeProducers.get(generationId)?.controller.abort(result.cancelReason);
        observe({
          event: 'cancel',
          generationId,
          reason: result.cancelReason,
          outcome: 'accepted',
        });
        return withActorHeaders(jsonResponse({
          generationId,
          status: 'cancelling',
          cancelled: true,
        }, 202), actor);
      }
      if (result.kind === 'finalizing') {
        return withActorHeaders(jsonResponse({
          code: 'GENERATION_FINALIZATION_IN_PROGRESS',
          generationId,
          status: 'finalizing',
          cancelled: false,
        }, 409), actor);
      }
      return withActorHeaders(jsonResponse({
        generationId,
        status: result.status,
        cancelled: result.status === 'cancelled',
      }, 200), actor);
    },

    async lookup(
      request: Request,
      params: ArenaGenerationRequestRouteParams,
    ): Promise<Response> {
      const actor = await dependencies.resolveActor(request);
      if (!actor) return jsonResponse({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);
      if (!isGenerationRequestId(params.generationRequestId)) {
        return jsonResponse({
          code: 'GENERATION_REQUEST_ID_INVALID',
          error: 'generationRequestId is invalid',
        }, 400);
      }
      const generationId = await dependencies.deriveGenerationId({
        actorKey: actor.actorKey,
        generationRequestId: params.generationRequestId,
      });
      const owned = await resolveOwnedStateForActor(actor, generationId);
      if (owned instanceof Response) {
        if (owned.status !== 404) return owned;
        return jsonResponse({
          code: 'GENERATION_REQUEST_NOT_FOUND',
          error: 'Generation request not found',
        }, 404);
      }
      if (owned.state.generationRequestId !== params.generationRequestId) {
        return jsonResponse({
          code: 'GENERATION_REQUEST_NOT_FOUND',
          error: 'Generation request not found',
        }, 404);
      }
      if (
        owned.terminalFallback?.status === 'completed'
        && owned.terminalFallback.contentAvailable !== true
      ) {
        return isTerminalContentNotArchived(owned.terminalFallback)
          ? createNotArchivedTerminalStatusResponse(
              owned.state,
              owned.terminalFallback,
              owned.actor,
            )
          : isTerminalContentExpired(owned.terminalFallback)
            ? createExpiredTerminalStatusResponse(
              owned.state,
              owned.terminalFallback,
              owned.actor,
            )
            : createTerminalContentUnavailableResponse();
      }
      return createStatusResponse(owned.state, owned.actor);
    },

    async resume(request: Request, params: ArenaGenerationRouteParams): Promise<Response> {
      const startedAt = Date.now();
      observe({ event: 'resume', generationId: params.generationId, outcome: 'attempt' });
      let after: string | null;
      try {
        after = resolveResumeCursor(request);
      } catch {
        observe({
          event: 'resume',
          generationId: params.generationId,
          outcome: 'failure',
          reason: 'cursor_conflict',
          latencyMs: Date.now() - startedAt,
        });
        return jsonResponse({ code: 'RESUME_CURSOR_CONFLICT', error: '恢复游标冲突' }, 400);
      }
      const owned = await resolveOwnedState(request, params.generationId);
      if (owned instanceof Response) {
        const reason = owned.status === 401
          ? 'unauthorized'
          : owned.status === 404
            ? 'not_found'
            : owned.status === 503
              ? 'state_unavailable'
              : 'unknown';
        observe({
          event: 'resume',
          generationId: params.generationId,
          outcome: 'failure',
          reason,
          latencyMs: Date.now() - startedAt,
        });
        return owned;
      }
      if (owned.state.terminal?.replayUncertain === true
        && owned.state.terminal.status === 'completed' && !owned.state.snapshot) {
        return withActorHeaders(createTerminalContentUnavailableResponse(), owned.actor);
      }
      observe({
        event: 'resume',
        generationId: params.generationId,
        outcome: 'success',
        latencyMs: Date.now() - startedAt,
      });
      if (owned.terminalFallback && owned.state.terminal?.replayUncertain !== true) {
        return withActorHeaders(
          createTerminalFallbackResponse(owned.terminalFallback, after),
          owned.actor,
        );
      }
      return withActorHeaders(
        createReplayResponse(
          owned.state.generationId,
          owned.state.generationRequestId,
          owned.state.payloadHash,
          after,
          owned.actor.actorKey,
        ),
        owned.actor,
      );
    },

    async status(request: Request, params: ArenaGenerationRouteParams): Promise<Response> {
      const owned = await resolveOwnedState(request, params.generationId);
      if (owned instanceof Response) return owned;
      if (
        owned.terminalFallback?.status === 'completed'
        && owned.terminalFallback.contentAvailable !== true
      ) {
        return isTerminalContentNotArchived(owned.terminalFallback)
          ? createNotArchivedTerminalStatusResponse(
              owned.state,
              owned.terminalFallback,
              owned.actor,
            )
          : isTerminalContentExpired(owned.terminalFallback)
            ? createExpiredTerminalStatusResponse(
              owned.state,
              owned.terminalFallback,
              owned.actor,
            )
            : createTerminalContentUnavailableResponse();
      }
      return createStatusResponse(owned.state, owned.actor);
    },

    async cancel(request: Request, params: ArenaGenerationRouteParams): Promise<Response> {
      const owned = await resolveOwnedState(request, params.generationId);
      if (owned instanceof Response) return owned;
      const cancelPayload = await readOptionalCancelPayload(request);
      if (cancelPayload instanceof Response) return cancelPayload;
      const cancelReason = cancelReasonFromPayload(cancelPayload);
      if (cancelReason instanceof Response) return cancelReason;
      if (owned.terminalFallback) {
        return withActorHeaders(jsonResponse({
          generationId: params.generationId,
          status: owned.terminalFallback.status,
          cancelled: owned.terminalFallback.status === 'cancelled',
        }, 200), owned.actor);
      }
      const result = await dependencies.store.requestCancel({
        generationId: params.generationId,
        actorKey: owned.actor.actorKey,
        reason: cancelReason,
        now: dependencies.now().toISOString(),
      });
      if (result.kind === 'not-found' || result.kind === 'forbidden') {
        return jsonResponse({ code: 'GENERATION_NOT_FOUND', error: 'Generation not found' }, 404);
      }
      if (result.kind === 'terminal') {
        observe({
          event: 'cancel',
          generationId: params.generationId,
          reason: cancelReason,
          outcome: 'terminal',
        });
        return withActorHeaders(jsonResponse({
          generationId: params.generationId,
          status: result.status,
          cancelled: result.status === 'cancelled',
        }, 200), owned.actor);
      }
      if (result.kind === 'finalizing') {
        return withActorHeaders(jsonResponse({
          code: 'GENERATION_FINALIZATION_IN_PROGRESS',
          generationId: params.generationId,
          status: 'finalizing',
          cancelled: false,
        }, 409), owned.actor);
      }
      observe({
        event: 'cancel',
        generationId: params.generationId,
        reason: result.cancelReason,
        outcome: 'accepted',
      });
      activeProducers.get(params.generationId)?.controller.abort(result.cancelReason);
      return withActorHeaders(jsonResponse({
        generationId: params.generationId,
        status: 'cancelling',
        cancelled: true,
      }, 202), owned.actor);
    },
  };
  return Object.freeze(service);
};
