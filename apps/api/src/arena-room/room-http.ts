import type { Context, Hono } from 'hono';
import {
  ARENA_ROOM_HTTP_BASE_PATH,
  ARENA_ROOM_HTTP_ROUTES,
  ArenaProposalIdSchema,
  ARENA_ROOM_WEBSOCKET_PATH,
  ARENA_ROOM_WEBSOCKET_PROTOCOL,
  ArenaRoomCreateRequestSchema,
  ArenaRoomEpochMutationRequestSchema,
  ArenaRoomGenerationStartRequestSchema,
  ArenaRoomGenerationViewResponseSchema,
  ArenaRoomJoinRequestSchema,
  ArenaRoomLeaveResponseSchema,
  ArenaRoomProposalMutationResponseSchema,
  ArenaRoomProposalResolveRequestSchema,
  ArenaRoomProposalSubmitRequestSchema,
  ArenaRoomProposalWithdrawRequestSchema,
  ArenaRoomSessionResponseSchema,
  ArenaRoomTicketRequestSchema,
  ArenaRoomTicketResponseSchema,
  MAX_CONTROL_MESSAGE_BYTES,
  MAX_ARENA_ROOM_GENERATION_START_BYTES,
  OpaqueKeySchema,
  PROTOCOL_VERSION,
  RoomDirectoryPageSchema,
  RoomDirectoryPageQuerySchema,
  type ArenaRoomHttpErrorCode,
} from '@mahoshojo/contracts/arena-room';

import type { HonoAppVariables } from '#/middleware/request-metadata';
import {
  ArenaRoomMembershipError,
  type ArenaRoomMembershipService,
} from './room-membership-service';
import {
  RoomDirectoryServiceError,
  type ArenaRoomDirectoryService,
} from './room-directory-service';
import {
  DEFAULT_ARENA_ROOM_TICKET_TTL_SECONDS,
} from './room-ticket';
import type { ArenaRoomWebSocketAuthority } from './room-websocket-authority';
import {
  ArenaRoomProposalError,
  type ArenaRoomProposalService,
  type ArenaRoomProposalMutationView,
} from './room-proposal-service';
import {
  ArenaRoomGenerationError,
  type ArenaRoomGenerationService,
} from './room-generation-service';

type ArenaRoomHttpContext = Context<{ Variables: HonoAppVariables }>;

export type ArenaRoomAuthenticationResolution =
  | Readonly<{ status: 'authenticated'; userId: number }>
  | Readonly<{ status: 'anonymous' }>
  | Readonly<{ status: 'denied' }>;

export type ArenaRoomHttpRateLimitResult = {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
};

export type ArenaRoomHttpDependencies = {
  readonly resolveAuthentication: (
    request: Request,
  ) => Promise<ArenaRoomAuthenticationResolution>;
  readonly memberships: Pick<
    ArenaRoomMembershipService,
    'close' | 'create' | 'getSession' | 'join' | 'leave'
  >;
  readonly directory: Pick<ArenaRoomDirectoryService, 'discoverPublic'>;
  readonly websocketAuthority: Pick<ArenaRoomWebSocketAuthority, 'issue'>;
  readonly proposals: Pick<ArenaRoomProposalService, 'resolve' | 'submit' | 'withdraw'>;
  readonly generations: Pick<ArenaRoomGenerationService, 'read' | 'start'>;
  readonly rateLimit: (input: {
    readonly operation: ArenaRoomHttpOperation;
    readonly accountUserId: number;
    readonly roomId?: string;
    readonly limit: number;
    readonly windowSeconds: number;
  }) => Promise<ArenaRoomHttpRateLimitResult | null>;
};

export type ArenaRoomHttpRegistrationOptions = {
  readonly isAllowedOrigin: (origin: string) => boolean;
};

type ArenaRoomHttpOperation =
  | 'close'
  | 'create'
  | 'createBudget'
  | 'discover'
  | 'join'
  | 'leave'
  | 'generationRead'
  | 'generationStart'
  | 'proposalResolve'
  | 'proposalSubmit'
  | 'proposalWithdraw'
  | 'session'
  | 'ticket';

const OPERATION_LIMITS: Readonly<Record<
  ArenaRoomHttpOperation,
  { readonly limit: number; readonly windowSeconds: number }
>> = Object.freeze({
  create: { limit: 5, windowSeconds: 60 },
  createBudget: { limit: 32, windowSeconds: 24 * 60 * 60 },
  discover: { limit: 60, windowSeconds: 60 },
  join: { limit: 20, windowSeconds: 60 },
  session: { limit: 120, windowSeconds: 60 },
  ticket: { limit: 60, windowSeconds: 60 },
  leave: { limit: 20, windowSeconds: 60 },
  close: { limit: 10, windowSeconds: 60 },
  generationStart: { limit: 5, windowSeconds: 60 },
  generationRead: { limit: 120, windowSeconds: 60 },
  proposalSubmit: { limit: 20, windowSeconds: 60 },
  proposalResolve: { limit: 30, windowSeconds: 60 },
  proposalWithdraw: { limit: 20, windowSeconds: 60 },
});

class ArenaRoomRequestError extends Error {
  constructor(readonly kind: 'invalid' | 'too-large') {
    super(kind);
    this.name = 'ArenaRoomRequestError';
  }
}

const errorBody = (code: ArenaRoomHttpErrorCode, error: string, retryAfterSeconds?: number) => ({
  code,
  error,
  ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
});

const invalidRequest = (context: ArenaRoomHttpContext, message = 'Room 请求无效') => (
  context.json(errorBody('ROOM_REQUEST_INVALID', message), 400)
);

const unavailable = (context: ArenaRoomHttpContext) => {
  context.header('retry-after', '1');
  return context.json(errorBody('ROOM_UNAVAILABLE', '房间运行时暂不可用', 1), 503);
};

const mapServiceError = (context: ArenaRoomHttpContext, error: unknown): Response => {
  if (error instanceof ArenaRoomRequestError) {
    if (error.kind === 'too-large') {
      return context.json(errorBody('ROOM_PAYLOAD_TOO_LARGE', 'Room 请求体过大'), 413);
    }
    return invalidRequest(context);
  }
  if (error instanceof ArenaRoomMembershipError) {
    switch (error.code) {
      case 'ROOM_CLOSED':
      case 'ROOM_NOT_FOUND':
        return context.json(errorBody('ROOM_NOT_FOUND', '房间不存在或已关闭'), 404);
      case 'ROOM_EPOCH_STALE':
        return context.json(errorBody('ROOM_CONFLICT', '房间 incarnation 已发生变化'), 409);
      case 'ROOM_MEMBERSHIP_NOT_ACTIVE':
      case 'ROOM_MEMBERSHIP_REVOKED':
      case 'ROOM_PERMISSION_DENIED':
        return context.json(errorBody('ROOM_FORBIDDEN', '没有此房间操作权限'), 403);
      case 'ROOM_INPUT_INVALID':
        return invalidRequest(context);
      case 'ROOM_MEMBERSHIP_TRANSITION_DENIED':
        return context.json(errorBody('ROOM_CONFLICT', '房间状态已发生变化'), 409);
    }
  }
  if (error instanceof RoomDirectoryServiceError) {
    switch (error.code) {
      case 'ROOM_DIRECTORY_CURSOR_INVALID':
      case 'ROOM_DIRECTORY_INPUT_INVALID':
        return invalidRequest(context);
      case 'ROOM_DIRECTORY_STALE':
        return context.json(errorBody('ROOM_CONFLICT', '房间目录状态已发生变化'), 409);
      default:
        return unavailable(context);
    }
  }
  if (error instanceof ArenaRoomProposalError) {
    switch (error.code) {
      case 'ROOM_PROPOSAL_INPUT_INVALID':
        return invalidRequest(context);
      case 'ROOM_PERMISSION_DENIED':
        return context.json(errorBody('ROOM_FORBIDDEN', '没有此房间操作权限'), 403);
      case 'ROOM_PROPOSAL_NOT_FOUND':
        return context.json(errorBody('ROOM_NOT_FOUND', 'Proposal 不存在'), 404);
      case 'ROOM_EPOCH_STALE':
      case 'ROOM_PROPOSAL_CONFLICT':
      case 'ROOM_REFERENCE_DENIED':
      case 'ROOM_REFERENCE_STALE':
      case 'ROOM_REVISION_STALE':
      case 'ROOM_TRANSITION_DENIED':
        return context.json(errorBody('ROOM_CONFLICT', '房间状态已发生变化'), 409);
      case 'ROOM_OPERATION_UNKNOWN':
      case 'ROOM_REFERENCE_UNAVAILABLE':
        return unavailable(context);
    }
  }
  if (error instanceof ArenaRoomGenerationError) {
    switch (error.code) {
      case 'ROOM_GENERATION_INPUT_INVALID':
        return invalidRequest(context);
      case 'ROOM_PERMISSION_DENIED':
      case 'ROOM_REFERENCE_DENIED':
        return context.json(errorBody('ROOM_FORBIDDEN', '没有此房间生成操作权限'), 403);
      case 'ROOM_GENERATION_NOT_FOUND':
        return context.json(errorBody('ROOM_NOT_FOUND', '房间生成不存在'), 404);
      case 'ROOM_EPOCH_STALE':
      case 'ROOM_GENERATION_CONFLICT':
      case 'ROOM_REFERENCE_STALE':
      case 'ROOM_REVISION_STALE':
        return context.json(errorBody('ROOM_CONFLICT', '房间生成状态已发生变化'), 409);
      case 'ROOM_GENERATION_UNAVAILABLE':
      case 'ROOM_OPERATION_UNKNOWN':
      case 'ROOM_REFERENCE_UNAVAILABLE':
        return unavailable(context);
    }
  }
  return unavailable(context);
};

const parseRequest = <T>(
  schema: {
    safeParse(input: unknown):
      | { readonly success: true; readonly data: T }
      | { readonly success: false };
  },
  input: unknown,
): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ArenaRoomRequestError('invalid');
  return parsed.data;
};

const readBoundedBody = async (
  request: Request,
  maxBytes = MAX_CONTROL_MESSAGE_BYTES,
): Promise<unknown> => {
  const rawLength = request.headers.get('content-length');
  if (rawLength) {
    const contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new ArenaRoomRequestError('invalid');
    }
    if (contentLength > maxBytes) {
      throw new ArenaRoomRequestError('too-large');
    }
  }
  if (!request.body) return {};
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new ArenaRoomRequestError('invalid');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ArenaRoomRequestError('too-large');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return {};
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ArenaRoomRequestError('invalid');
  }
};

const parseRoomId = (context: ArenaRoomHttpContext): string | Response => {
  const raw = context.req.param('roomId');
  const parsed = OpaqueKeySchema.safeParse(raw);
  return parsed.success && parsed.data === raw
    ? parsed.data
    : invalidRequest(context, 'roomId 无效');
};

const parseProposalId = (context: ArenaRoomHttpContext): string | Response => {
  const raw = context.req.param('proposalId');
  const parsed = ArenaProposalIdSchema.safeParse(raw);
  return parsed.success && parsed.data === raw
    ? parsed.data
    : invalidRequest(context, 'proposalId 无效');
};

const parseGenerationId = (context: ArenaRoomHttpContext): string | Response => {
  const raw = context.req.param('generationId');
  const parsed = OpaqueKeySchema.safeParse(raw);
  return parsed.success && parsed.data === raw && raw !== '.' && raw !== '..'
    ? parsed.data
    : invalidRequest(context, 'generationId 无效');
};

const authenticateAndLimit = async (
  context: ArenaRoomHttpContext,
  dependencies: ArenaRoomHttpDependencies,
  options: ArenaRoomHttpRegistrationOptions,
  operation: ArenaRoomHttpOperation,
  roomId?: string,
  additionalOperations: readonly ArenaRoomHttpOperation[] = [],
): Promise<{ readonly accepted: true; readonly accountUserId: number } | {
  readonly accepted: false;
  readonly response: Response;
}> => {
  const origin = context.req.header('origin')?.trim();
  if (origin && !options.isAllowedOrigin(origin)) {
    return {
      accepted: false,
      response: context.json(errorBody('ROOM_FORBIDDEN', '请求来源不受信任'), 403),
    };
  }
  const hasSessionCookie = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/u.test(
    context.req.header('cookie') ?? '',
  );
  if (context.req.method !== 'GET' && hasSessionCookie && !origin) {
    return {
      accepted: false,
      response: context.json(errorBody('ROOM_FORBIDDEN', '请求来源不受信任'), 403),
    };
  }

  let authentication: ArenaRoomAuthenticationResolution;
  try {
    authentication = await dependencies.resolveAuthentication(context.req.raw);
  } catch {
    return { accepted: false, response: unavailable(context) };
  }
  if (authentication.status === 'anonymous') {
    return {
      accepted: false,
      response: context.json(
        errorBody('ROOM_AUTHENTICATION_REQUIRED', '多人房间需要登录后使用'),
        401,
      ),
    };
  }
  if (authentication.status === 'denied') {
    return {
      accepted: false,
      response: context.json(errorBody('ROOM_AUTHENTICATION_DENIED', '登录状态无效'), 403),
    };
  }

  let lastResult: ArenaRoomHttpRateLimitResult | null = null;
  for (const limitedOperation of [operation, ...additionalOperations]) {
    const policy = OPERATION_LIMITS[limitedOperation];
    let result: ArenaRoomHttpRateLimitResult | null;
    try {
      result = await dependencies.rateLimit({
        operation: limitedOperation,
        accountUserId: authentication.userId,
        ...(roomId === undefined ? {} : { roomId }),
        ...policy,
      });
    } catch {
      result = null;
    }
    if (!result) return { accepted: false, response: unavailable(context) };
    if (!result.allowed) {
      context.header('x-ratelimit-limit', String(result.limit));
      context.header('x-ratelimit-remaining', String(result.remaining));
      context.header('retry-after', String(result.retryAfterSeconds));
      return {
        accepted: false,
        response: context.json(
          errorBody('ROOM_RATE_LIMITED', 'Room 请求过于频繁', result.retryAfterSeconds),
          429,
        ),
      };
    }
    lastResult = result;
  }
  if (!lastResult) return { accepted: false, response: unavailable(context) };
  context.header('x-ratelimit-limit', String(lastResult.limit));
  context.header('x-ratelimit-remaining', String(lastResult.remaining));
  return { accepted: true, accountUserId: authentication.userId };
};

const sessionResponse = (session: Awaited<ReturnType<
  ArenaRoomHttpDependencies['memberships']['getSession']
>>) => ArenaRoomSessionResponseSchema.parse({
  protocolVersion: PROTOCOL_VERSION,
  roomId: session.roomId,
  roomEpoch: session.roomEpoch,
  self: session.member,
  snapshot: session.snapshot,
});

const proposalResponse = (view: ArenaRoomProposalMutationView) => (
  ArenaRoomProposalMutationResponseSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    ...view,
  })
);

const noStore = (context: ArenaRoomHttpContext): void => {
  context.header('cache-control', 'no-store');
};

export const registerArenaRoomHttpRoutes = (
  app: Hono<{ Variables: HonoAppVariables }>,
  dependencies: ArenaRoomHttpDependencies,
  options: ArenaRoomHttpRegistrationOptions,
): void => {
  const applyNoStore = async (context: ArenaRoomHttpContext, next: () => Promise<void>) => {
    noStore(context);
    await next();
  };
  app.use(ARENA_ROOM_HTTP_BASE_PATH, applyNoStore);
  app.use(`${ARENA_ROOM_HTTP_BASE_PATH}/*`, applyNoStore);

  app.get(ARENA_ROOM_HTTP_ROUTES.collection, async (context) => {
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'discover',
    );
    if (!authorization.accepted) return authorization.response;
    const params = new URL(context.req.url).searchParams;
    if ([...params.keys()].some((key) => !['cursor', 'limit'].includes(key))) {
      return invalidRequest(context);
    }
    if (['cursor', 'limit'].some((key) => params.getAll(key).length > 1)) {
      return invalidRequest(context);
    }
    const rawLimit = params.get('limit');
    const parsed = RoomDirectoryPageQuerySchema.safeParse({
      ...(params.has('cursor') ? { cursor: params.get('cursor') } : {}),
      ...(rawLimit === null ? {} : { limit: Number(rawLimit) }),
    });
    if (!parsed.success) return invalidRequest(context);
    try {
      noStore(context);
      return context.json(RoomDirectoryPageSchema.parse(
        await dependencies.directory.discoverPublic(parsed.data),
      ), 200);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  app.post(ARENA_ROOM_HTTP_ROUTES.collection, async (context) => {
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'create',
      undefined,
      ['createBudget'],
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const request = parseRequest(
        ArenaRoomCreateRequestSchema,
        await readBoundedBody(context.req.raw),
      );
      const session = await dependencies.memberships.create({
        accountUserId: authorization.accountUserId,
        displayName: request.displayName,
        directory: request.directory,
        sharedConfig: request.sharedConfig,
      });
      noStore(context);
      return context.json(sessionResponse(session), 201);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  app.post(ARENA_ROOM_HTTP_ROUTES.join, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'join',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const request = parseRequest(
        ArenaRoomJoinRequestSchema,
        await readBoundedBody(context.req.raw),
      );
      const session = await dependencies.memberships.join({
        roomId,
        accountUserId: authorization.accountUserId,
        displayName: request.displayName,
      });
      noStore(context);
      return context.json(sessionResponse(session), 200);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  app.get(ARENA_ROOM_HTTP_ROUTES.session, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'session',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const session = await dependencies.memberships.getSession({
        roomId,
        accountUserId: authorization.accountUserId,
      });
      noStore(context);
      return context.json(sessionResponse(session), 200);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  app.post(ARENA_ROOM_HTTP_ROUTES.ticket, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'ticket',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const request = parseRequest(
        ArenaRoomTicketRequestSchema,
        await readBoundedBody(context.req.raw),
      );
      const ticket = await dependencies.websocketAuthority.issue({
        roomId,
        accountUserId: authorization.accountUserId,
        ...(request.reconnect === undefined ? {} : { reconnect: request.reconnect }),
      });
      noStore(context);
      return context.json(ArenaRoomTicketResponseSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        ticket,
        expiresInSeconds: DEFAULT_ARENA_ROOM_TICKET_TTL_SECONDS,
        websocket: {
          path: ARENA_ROOM_WEBSOCKET_PATH,
          protocol: ARENA_ROOM_WEBSOCKET_PROTOCOL,
        },
      }), 200);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  app.post(ARENA_ROOM_HTTP_ROUTES.proposals, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'proposalSubmit',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const request = parseRequest(
        ArenaRoomProposalSubmitRequestSchema,
        await readBoundedBody(context.req.raw),
      );
      const result = await dependencies.proposals.submit({
        roomId,
        accountUserId: authorization.accountUserId,
        request,
      });
      return context.json(proposalResponse(result), 200);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  app.post(ARENA_ROOM_HTTP_ROUTES.generations, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'generationStart',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const sourceRequest = new Request(context.req.url, {
        method: 'POST',
        headers: new Headers(context.req.raw.headers),
        signal: context.req.raw.signal,
      });
      const request = parseRequest(
        ArenaRoomGenerationStartRequestSchema,
        await readBoundedBody(context.req.raw, MAX_ARENA_ROOM_GENERATION_START_BYTES),
      );
      const view = await dependencies.generations.start({
        roomId,
        accountUserId: authorization.accountUserId,
        request,
        sourceRequest,
      });
      return context.json(ArenaRoomGenerationViewResponseSchema.parse(view), 202);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  app.get(ARENA_ROOM_HTTP_ROUTES.generation, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const generationId = parseGenerationId(context);
    if (generationId instanceof Response) return generationId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'generationRead',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const view = await dependencies.generations.read({
        roomId,
        generationId,
        accountUserId: authorization.accountUserId,
      });
      return context.json(ArenaRoomGenerationViewResponseSchema.parse(view), 200);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  app.post(ARENA_ROOM_HTTP_ROUTES.proposalResolve, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const proposalId = parseProposalId(context);
    if (proposalId instanceof Response) return proposalId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'proposalResolve',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const request = parseRequest(
        ArenaRoomProposalResolveRequestSchema,
        await readBoundedBody(context.req.raw),
      );
      const result = await dependencies.proposals.resolve({
        roomId,
        proposalId,
        accountUserId: authorization.accountUserId,
        request,
      });
      return context.json(proposalResponse(result), 200);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  app.post(ARENA_ROOM_HTTP_ROUTES.proposalWithdraw, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const proposalId = parseProposalId(context);
    if (proposalId instanceof Response) return proposalId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'proposalWithdraw',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const request = parseRequest(
        ArenaRoomProposalWithdrawRequestSchema,
        await readBoundedBody(context.req.raw),
      );
      const result = await dependencies.proposals.withdraw({
        roomId,
        proposalId,
        accountUserId: authorization.accountUserId,
        request,
      });
      return context.json(proposalResponse(result), 200);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  const registerExitRoute = (input: {
    readonly path: string;
    readonly operation: 'close' | 'leave';
    readonly outcome: 'closed' | 'left';
  }): void => {
    app.post(input.path, async (context) => {
      const roomId = parseRoomId(context);
      if (roomId instanceof Response) return roomId;
      const authorization = await authenticateAndLimit(
        context,
        dependencies,
        options,
        input.operation,
        roomId,
      );
      if (!authorization.accepted) return authorization.response;
      try {
        const request = parseRequest(
          ArenaRoomEpochMutationRequestSchema,
          await readBoundedBody(context.req.raw),
        );
        const result = await dependencies.memberships[input.operation]({
          roomId,
          accountUserId: authorization.accountUserId,
          expectedRoomEpoch: request.expectedRoomEpoch,
        });
        noStore(context);
        return context.json(ArenaRoomLeaveResponseSchema.parse({
          protocolVersion: PROTOCOL_VERSION,
          roomId,
          outcome: input.operation === 'leave' && result.member.role === 'host'
            ? 'closed'
            : input.outcome,
        }), 200);
      } catch (error) {
        return mapServiceError(context, error);
      }
    });
  };

  registerExitRoute({
    path: ARENA_ROOM_HTTP_ROUTES.leave,
    operation: 'leave',
    outcome: 'left',
  });
  registerExitRoute({
    path: ARENA_ROOM_HTTP_ROUTES.close,
    operation: 'close',
    outcome: 'closed',
  });
};
