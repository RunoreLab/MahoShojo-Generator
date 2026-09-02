import {
  ArenaMultiplayerGenerationSnapshotSchema,
  ArenaRoomGenerationResultSchema,
  type ArenaMultiplayerGenerationSnapshot,
  type ArenaRoomGenerationResult,
} from '@mahoshojo/contracts/arena-room';
import {
  ARENA_OUTPUT_NOT_ARCHIVED_WARNING,
  type ArenaGenerationApplicationService,
  type ArenaGenerationOwnedCancelResult,
  type ArenaGenerationOwnedProjectionResult,
  type ArenaGenerationSubscription,
  type GenerationStatus,
  type GenerationStreamEvent,
} from '@mahoshojo/hosted-api/arena-generation/service';
import {
  ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER,
  ARENA_PVP_GENERATION_SIGNATURE_HEADER,
  hashArenaGenerationPayload,
} from '@mahoshojo/hosted-runtime/arena-generation';

type TerminalGenerationStatus = Extract<
  GenerationStatus,
  'completed' | 'failed' | 'cancelled' | 'producer_lost'
>;

export type ArenaRoomGenerationEvent =
  | Readonly<{ id: string; type: 'markdown'; chunk: string }>
  | Readonly<{
    id: string;
    type: 'snapshot';
    status: GenerationStatus;
    markdown: string;
    updatedAt: string;
    lastEventId: string | null;
  }>
  | Readonly<{
    id: string;
    type: 'done';
    status: TerminalGenerationStatus;
    generationRecordId: string | null;
    resultAvailable: boolean;
  }>
  | Readonly<{
    id: string;
    type: 'error';
    status: Extract<TerminalGenerationStatus, 'failed' | 'producer_lost'>;
    code: string;
  }>;

export type ArenaRoomGenerationSubscription = Readonly<{
  generationId: string;
  generationRequestId: string;
  roomSafeMetadata?: ArenaRoomGenerationResult;
  events: ReadableStream<ArenaRoomGenerationEvent>;
}>;

export type ArenaRoomGenerationStartResult =
  | Readonly<{ kind: 'subscribed'; subscription: ArenaRoomGenerationSubscription }>
  | Readonly<{ kind: 'rejected'; status: number; code: string }>;

export type ArenaRoomGenerationSubscriptionResult =
  | Readonly<{ kind: 'subscribed'; subscription: ArenaRoomGenerationSubscription }>
  | Readonly<{ kind: 'not-found' }>
  | Readonly<{ kind: 'unavailable'; code: string }>;

export type ArenaRoomGenerationProjectionResult = ArenaGenerationOwnedProjectionResult;

export type ArenaRoomGenerationCancelResult = ArenaGenerationOwnedCancelResult
  | Readonly<{ kind: 'unavailable'; code: 'GENERATION_STATE_UNAVAILABLE' }>;

export type ArenaRoomGenerationIdentityInput = Readonly<{
  roomId: string;
  generationRequestId: string;
}>;

export type ArenaRoomGenerationStartInput = Readonly<{
  request: Request;
  roomId: string;
  generationRequestId: string;
  payload: Readonly<Record<string, unknown>>;
  internalGuidance: string;
  pvpContext: Readonly<{ matchId: string; roundId: string }>;
  multiplayerSnapshot: ArenaMultiplayerGenerationSnapshot;
}>;

export type ArenaRoomGenerationSemanticPayloadInput = Omit<
  ArenaRoomGenerationStartInput,
  'request'
>;

export type ArenaRoomGenerationOwnedInput = Readonly<{
  roomId: string;
  generationId: string;
}>;

export type ArenaRoomGenerationResumeInput = ArenaRoomGenerationOwnedInput & Readonly<{
  after: string | null;
}>;

export interface ArenaRoomGenerationPort {
  cancelOwned(_input: ArenaRoomGenerationOwnedInput): Promise<ArenaRoomGenerationCancelResult>;
  deriveGenerationId(_input: ArenaRoomGenerationIdentityInput): Promise<string>;
  hashSemanticPayload(_input: ArenaRoomGenerationSemanticPayloadInput): Promise<string>;
  startFromHostRequest(_input: ArenaRoomGenerationStartInput): Promise<ArenaRoomGenerationStartResult>;
  readOwnedProjection(_input: ArenaRoomGenerationOwnedInput): Promise<ArenaRoomGenerationProjectionResult>;
  resumeOwnedSubscription(
    _input: ArenaRoomGenerationResumeInput,
  ): Promise<ArenaRoomGenerationSubscriptionResult>;
}

type ArenaRoomGenerationPortDependencies = Readonly<{
  generationService: Pick<
    ArenaGenerationApplicationService,
    'cancelOwned' | 'createSubscription' | 'readOwnedProjection' | 'resumeOwnedSubscription'
  >;
  pvpAuthority: Readonly<{
    sign(_input: {
      generationRequestId: string;
      payload: Readonly<Record<string, unknown>>;
    }): Promise<string | null>;
  }>;
  internalGuidanceAuthority: Readonly<{
    sign(_guidance: string): Promise<string | null>;
  }>;
  deriveGenerationId(_input: {
    actorKey: string;
    generationRequestId: string;
  }): Promise<string>;
  canonicalizeSemanticPayload(_input: Readonly<{
    payload: Readonly<Record<string, unknown>>;
    trustedInternalGuidance: string;
    trustedPvpContext: Readonly<{ roomId: string; matchId: string; roundId: string }>;
  }>): Promise<Record<string, unknown>>;
}>;

const actorKeyForRoom = (roomId: string): string => `pvp-room:${roomId}`;

export const buildArenaRoomGenerationPayload = (
  input: ArenaRoomGenerationSemanticPayloadInput,
): Readonly<Record<string, unknown>> => {
  const callerPayload = { ...input.payload };
  delete callerPayload.generationRequestId;
  return Object.freeze({
    ...callerPayload,
    internalGuidance: input.internalGuidance.trim(),
    pvpContext: Object.freeze({
      roomId: input.roomId,
      matchId: input.pvpContext.matchId,
      roundId: input.pvpContext.roundId,
    }),
    multiplayerGenerationSnapshot: input.multiplayerSnapshot,
  });
};

export const hashArenaRoomGenerationPayload = async (
  input: ArenaRoomGenerationSemanticPayloadInput,
  canonicalizeSemanticPayload: ArenaRoomGenerationPortDependencies['canonicalizeSemanticPayload'],
): Promise<string> => {
  const semanticPayload = await canonicalizeSemanticPayload({
    payload: buildArenaRoomGenerationPayload(input),
    trustedInternalGuidance: input.internalGuidance.trim(),
    trustedPvpContext: {
      roomId: input.roomId,
      matchId: input.pvpContext.matchId,
      roundId: input.pvpContext.roundId,
    },
  });
  return `sha256:${await hashArenaGenerationPayload(semanticPayload)}`;
};

const recordOf = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const isGenerationStatus = (value: unknown): value is GenerationStatus => (
  value === 'reserved'
  || value === 'running'
  || value === 'finalizing'
  || value === 'completed'
  || value === 'failed'
  || value === 'cancelled'
  || value === 'producer_lost'
);

const safeErrorCode = (value: unknown, fallback: string): string => (
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/u.test(value)
    ? value
    : fallback
);

const projectEvent = (
  generationId: string,
  event: GenerationStreamEvent,
): ArenaRoomGenerationEvent | null => {
  const data = recordOf(event.data);
  if (event.type === 'markdown') {
    return typeof data?.chunk === 'string'
      ? Object.freeze({ id: event.id, type: 'markdown', chunk: data.chunk })
      : null;
  }
  if (event.type === 'snapshot') {
    if (
      !isGenerationStatus(data?.status)
      || typeof data.markdown !== 'string'
      || typeof data.updatedAt !== 'string'
      || !(typeof data.lastEventId === 'string' || data.lastEventId === null)
    ) return null;
    return Object.freeze({
      id: event.id,
      type: 'snapshot',
      status: data.status,
      markdown: data.markdown,
      updatedAt: data.updatedAt,
      lastEventId: data.lastEventId,
    });
  }
  if (event.type === 'done') {
    const status = data?.status;
    if (
      status !== 'completed'
      && status !== 'cancelled'
      && status !== 'failed'
      && status !== 'producer_lost'
    ) return null;
    const resultAvailable = typeof data?.resultRef === 'string' && data.resultRef.length > 0;
    return Object.freeze({
      id: event.id,
      type: 'done',
      status,
      generationRecordId: resultAvailable ? generationId : null,
      resultAvailable,
    });
  }
  if (event.type === 'error') {
    const status = data?.status === 'producer_lost' ? 'producer_lost' : 'failed';
    return Object.freeze({
      id: event.id,
      type: 'error',
      status,
      code: safeErrorCode(
        data?.code,
        status === 'producer_lost' ? 'PRODUCER_OWNERSHIP_LOST' : 'GENERATION_FAILED',
      ),
    });
  }
  return null;
};

const projectSubscription = (
  subscription: ArenaGenerationSubscription,
): ArenaRoomGenerationSubscription => {
  const rawHeader = Object.entries(subscription.headers).find(
    ([name]) => name.toLowerCase() === 'x-mahoshojo-stream-meta',
  )?.[1];
  let roomSafeMetadata: ArenaRoomGenerationResult | undefined;
  if (rawHeader) {
    try {
      const decoded = recordOf(JSON.parse(decodeURIComponent(rawHeader)));
      const reporter = recordOf(decoded?.reporterInfo);
      const candidate = {
        version: 1,
        format: 'stream-markdown',
        ...(reporter ? {
          reporterInfo: { name: reporter.name, publication: reporter.publication },
        } : {}),
        mode: decoded?.mode,
        ...(decoded?.scenarioDisplayName === undefined
          ? {} : { scenarioDisplayName: decoded.scenarioDisplayName }),
        ...(decoded?.userGuidance === undefined
          ? {} : { sharedGuidance: decoded.userGuidance }),
        ...(decoded?.language === undefined ? {} : { language: decoded.language }),
        ...(decoded?.storyLength === undefined ? {} : { storyLength: decoded.storyLength }),
        ...(decoded?.adjudicationResults === undefined
          ? {} : { adjudicationResults: decoded.adjudicationResults }),
        ...(decoded?.narrativeHistoryReadCount === undefined
          ? {} : { narrativeHistoryReadCount: decoded.narrativeHistoryReadCount }),
      };
      const parsed = ArenaRoomGenerationResultSchema.safeParse(candidate);
      if (parsed.success) roomSafeMetadata = parsed.data;
    } catch {
      // Malformed or unrecognized headers never cross the Room projection boundary.
    }
  }
  return Object.freeze({
    generationId: subscription.generationId,
    generationRequestId: subscription.generationRequestId,
    ...(roomSafeMetadata ? { roomSafeMetadata } : {}),
    events: subscription.events.pipeThrough(new TransformStream<
      GenerationStreamEvent,
      ArenaRoomGenerationEvent
    >({
      transform(event, controller) {
        const projected = projectEvent(subscription.generationId, event);
        if (projected) controller.enqueue(projected);
      },
    })),
  });
};

const projectOwnedProjectionResult = (
  result: ArenaGenerationOwnedProjectionResult,
): ArenaRoomGenerationProjectionResult => {
  if (result.kind === 'not-found') return { kind: 'not-found' };
  if (result.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      code: safeErrorCode(result.code, 'GENERATION_STATE_UNAVAILABLE'),
    };
  }
  const projection = result.projection;
  const roomSafeResult = projection.status === 'completed'
    ? ArenaRoomGenerationResultSchema.safeParse(projection.roomSafeResult)
    : null;
  const errorCode = projection.status === 'failed' || projection.status === 'producer_lost'
    ? safeErrorCode(
      projection.errorCode,
      projection.status === 'producer_lost'
        ? 'PRODUCER_OWNERSHIP_LOST'
        : 'GENERATION_FAILED',
    )
    : null;
  return {
    kind: 'found',
    projection: Object.freeze({
      generationId: projection.generationId,
      generationRequestId: projection.generationRequestId,
      status: projection.status,
      markdown: projection.markdown,
      resumeCursor: projection.resumeCursor,
      updatedAt: projection.updatedAt,
      finalAuthoritative: projection.finalAuthoritative,
      resultAvailable: projection.resultAvailable,
      generationRecordId: projection.generationRecordId,
      errorCode,
      ...(projection.persistenceWarning === ARENA_OUTPUT_NOT_ARCHIVED_WARNING
        && projection.replayUnavailable === true
        ? { persistenceWarning: ARENA_OUTPUT_NOT_ARCHIVED_WARNING, replayUnavailable: true }
        : {}),
      ...(projection.contentRetention === 'expired'
        ? { contentRetention: 'expired' as const }
        : {}),
      ...(roomSafeResult?.success ? { roomSafeResult: roomSafeResult.data } : {}),
    }),
  };
};

const projectRejectedResponse = async (response: Response): Promise<
  Extract<ArenaRoomGenerationStartResult, { kind: 'rejected' }>
> => {
  let code = response.status >= 500
    ? 'GENERATION_STATE_UNAVAILABLE'
    : 'GENERATION_REQUEST_REJECTED';
  try {
    const body = await response.clone().json() as { code?: unknown };
    code = safeErrorCode(body.code, code);
  } catch {
    // No response body or diagnostic crosses this server-only boundary.
  }
  return { kind: 'rejected', status: response.status, code };
};

export const createArenaRoomGenerationPort = (
  dependencies: ArenaRoomGenerationPortDependencies,
): ArenaRoomGenerationPort => Object.freeze({
  async cancelOwned(input: ArenaRoomGenerationOwnedInput): Promise<ArenaRoomGenerationCancelResult> {
    try {
      return await dependencies.generationService.cancelOwned({
        actorKey: actorKeyForRoom(input.roomId),
        generationId: input.generationId,
        reason: 'user',
      });
    } catch {
      return { kind: 'unavailable', code: 'GENERATION_STATE_UNAVAILABLE' };
    }
  },

  deriveGenerationId: (input: ArenaRoomGenerationIdentityInput) => dependencies.deriveGenerationId({
    actorKey: actorKeyForRoom(input.roomId),
    generationRequestId: input.generationRequestId,
  }),

  hashSemanticPayload: (input: ArenaRoomGenerationSemanticPayloadInput) => (
    hashArenaRoomGenerationPayload(input, dependencies.canonicalizeSemanticPayload)
  ),

  async startFromHostRequest(
    input: ArenaRoomGenerationStartInput,
  ): Promise<ArenaRoomGenerationStartResult> {
    const parsedSnapshot = ArenaMultiplayerGenerationSnapshotSchema.safeParse(
      input.multiplayerSnapshot,
    );
    if (
      !parsedSnapshot.success
      || parsedSnapshot.data.roomId !== input.roomId
      || parsedSnapshot.data.generationRequestId !== input.generationRequestId
    ) {
      return {
        kind: 'rejected',
        status: 400,
        code: 'ARENA_MULTIPLAYER_SNAPSHOT_INVALID',
      };
    }
    const internalGuidance = input.internalGuidance.trim();
    const payload = buildArenaRoomGenerationPayload({
      roomId: input.roomId,
      generationRequestId: input.generationRequestId,
      payload: input.payload,
      internalGuidance,
      pvpContext: input.pvpContext,
      multiplayerSnapshot: parsedSnapshot.data,
    });
    const [pvpSignature, guidanceSignature] = await Promise.all([
      dependencies.pvpAuthority.sign({
        generationRequestId: input.generationRequestId,
        payload,
      }),
      dependencies.internalGuidanceAuthority.sign(internalGuidance),
    ]);
    if (!pvpSignature || !guidanceSignature) {
      return {
        kind: 'rejected',
        status: 503,
        code: 'ARENA_PVP_SIGNATURE_UNAVAILABLE',
      };
    }
    const headers = new Headers(input.request.headers);
    headers.delete('content-length');
    headers.set('Accept', 'text/event-stream');
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set(ARENA_PVP_GENERATION_SIGNATURE_HEADER, pvpSignature);
    headers.set(ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER, guidanceSignature);
    const request = new Request(input.request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, generationRequestId: input.generationRequestId }),
      signal: input.request.signal,
    });
    const subscription = await dependencies.generationService.createSubscription(request);
    return subscription instanceof Response
      ? projectRejectedResponse(subscription)
      : { kind: 'subscribed', subscription: projectSubscription(subscription) };
  },

  async readOwnedProjection(input: ArenaRoomGenerationOwnedInput) {
    const result = await dependencies.generationService.readOwnedProjection({
      actorKey: actorKeyForRoom(input.roomId),
      generationId: input.generationId,
    });
    return projectOwnedProjectionResult(result);
  },

  async resumeOwnedSubscription(
    input: ArenaRoomGenerationResumeInput,
  ): Promise<ArenaRoomGenerationSubscriptionResult> {
    const result = await dependencies.generationService.resumeOwnedSubscription({
      actorKey: actorKeyForRoom(input.roomId),
      generationId: input.generationId,
      after: input.after,
    });
    return result.kind === 'subscribed'
      ? { kind: 'subscribed', subscription: projectSubscription(result.subscription) }
      : result;
  },
});
