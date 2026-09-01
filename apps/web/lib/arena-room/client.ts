import {
  ARENA_ROOM_HTTP_BASE_PATH,
  ARENA_ROOM_ERROR_TAXONOMY_ACCEPT,
  ArenaRoomCreateRequestSchema,
  ArenaRoomEpochMutationRequestSchema,
  ArenaRoomGenerationStartRequestSchema,
  ArenaRoomGenerationCancelRequestSchema,
  ArenaRoomGenerationViewResponseSchema,
  ArenaRoomHttpErrorResponseSchema,
  ArenaRoomJoinRequestSchema,
  ArenaRoomLeaveResponseSchema,
  ArenaRoomProposalMutationResponseSchema,
  ArenaRoomProposalResolveRequestSchema,
  ArenaRoomProposalSubmitRequestSchema,
  ArenaRoomProposalWithdrawRequestSchema,
  ArenaRoomPublishConfigRequestSchema,
  ArenaRoomMemberKickRequestSchema,
  ArenaRoomSessionResponseSchema,
  ArenaRoomTicketRequestSchema,
  ArenaRoomTicketResponseSchema,
  RoomDirectoryPageQuerySchema,
  RoomDirectoryPageSchema,
  type ArenaRoomCreateRequest,
  type ArenaRoomGenerationStartRequest,
  type ArenaRoomGenerationCancelRequest,
  type ArenaRoomGenerationViewResponse,
  type ArenaRoomJoinRequest,
  type ArenaRoomLeaveResponse,
  type ArenaRoomProposalMutationResponse,
  type ArenaRoomProposalResolveRequest,
  type ArenaRoomProposalSubmitRequest,
  type ArenaRoomPublishConfigRequest,
  type ArenaRoomMemberKickRequest,
  type ArenaRoomSessionResponse,
  type ArenaRoomTicketRequest,
  type ArenaRoomTicketResponse,
  type RoomDirectoryPage,
  type RoomDirectoryPageQuery,
} from '@mahoshojo/contracts/arena-room';

import { authStorage } from '@/lib/auth';

export type ArenaRoomClientErrorCode =
  | 'ROOM_AUTHENTICATION_REQUIRED'
  | 'ROOM_RESPONSE_INVALID'
  | 'ROOM_RESULT_UNKNOWN'
  | 'ROOM_UNAVAILABLE'
  | string;

export class ArenaRoomClientError extends Error {
  constructor(
    readonly code: ArenaRoomClientErrorCode,
    readonly status: number | null,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ArenaRoomClientError';
  }
}

export type ArenaRoomClient = {
  discover(query?: Partial<RoomDirectoryPageQuery>): Promise<RoomDirectoryPage>;
  create(request: ArenaRoomCreateRequest): Promise<ArenaRoomSessionResponse>;
  join(roomId: string, request: ArenaRoomJoinRequest): Promise<ArenaRoomSessionResponse>;
  getSession(roomId: string): Promise<ArenaRoomSessionResponse>;
  issueTicket(roomId: string, request: ArenaRoomTicketRequest): Promise<ArenaRoomTicketResponse>;
  leave(roomId: string, expectedRoomEpoch: string): Promise<ArenaRoomLeaveResponse>;
  close(roomId: string, expectedRoomEpoch: string): Promise<ArenaRoomLeaveResponse>;
  kick(
    roomId: string,
    targetUserId: string,
    expectedRoomEpoch: ArenaRoomMemberKickRequest['expectedRoomEpoch'],
  ): Promise<ArenaRoomSessionResponse>;
  submitProposal(
    roomId: string,
    request: ArenaRoomProposalSubmitRequest,
  ): Promise<ArenaRoomProposalMutationResponse>;
  resolveProposal(
    roomId: string,
    proposalId: string,
    request: ArenaRoomProposalResolveRequest,
  ): Promise<ArenaRoomProposalMutationResponse>;
  withdrawProposal(
    roomId: string,
    proposalId: string,
    expectedRoomEpoch: string,
  ): Promise<ArenaRoomProposalMutationResponse>;
  publishConfig(
    roomId: string,
    request: ArenaRoomPublishConfigRequest,
  ): Promise<ArenaRoomSessionResponse>;
  startGeneration(
    roomId: string,
    request: ArenaRoomGenerationStartRequest,
  ): Promise<ArenaRoomGenerationViewResponse>;
  getGenerationView(
    roomId: string,
    generationId: string,
  ): Promise<ArenaRoomGenerationViewResponse>;
  cancelGeneration(
    roomId: string,
    generationId: string,
    expectedRoomEpoch: ArenaRoomGenerationCancelRequest['expectedRoomEpoch'],
  ): Promise<ArenaRoomGenerationViewResponse>;
  buildWebSocketUrl(ticket: ArenaRoomTicketResponse): string;
};

type ClientOptions = {
  readonly origin: string;
  readonly fetch?: typeof fetch;
  readonly getAuthHeader?: () => Promise<string | null>;
};

type ResponseSchema<T> = {
  safeParse(input: unknown):
    | { readonly success: true; readonly data: T }
    | { readonly success: false };
};

const parseResponse = <T>(schema: ResponseSchema<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ArenaRoomClientError('ROOM_RESPONSE_INVALID', null, '房间服务返回了无效响应');
  }
  return parsed.data;
};

export const createArenaRoomClient = (options: ClientOptions): ArenaRoomClient => {
  const fetcher = options.fetch ?? globalThis.fetch;
  const getAuthHeader = options.getAuthHeader ?? (() => authStorage.getAuthHeader());
  const base = new URL(options.origin);
  if (
    !['http:', 'https:'].includes(base.protocol)
    || base.username
    || base.password
    || base.pathname !== '/'
    || base.search
    || base.hash
  ) {
    throw new Error('Arena Room API origin 必须是无 path/query/hash 的 HTTP(S) origin');
  }

  const request = async <T>(input: {
    readonly path: string;
    readonly method?: 'GET' | 'POST';
    readonly body?: unknown;
    readonly schema: ResponseSchema<T>;
    readonly unknownResult?: boolean;
  }): Promise<T> => {
    const authHeader = await getAuthHeader();
    if (!authHeader) {
      throw new ArenaRoomClientError(
        'ROOM_AUTHENTICATION_REQUIRED',
        401,
        '多人房间需要登录后使用',
      );
    }
    let response: Response;
    try {
      response = await fetcher(new URL(input.path, base), {
        method: input.method ?? 'GET',
        credentials: 'omit',
        headers: {
          accept: ARENA_ROOM_ERROR_TAXONOMY_ACCEPT,
          authorization: authHeader,
          ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      });
    } catch {
      throw new ArenaRoomClientError(
        input.unknownResult ? 'ROOM_RESULT_UNKNOWN' : 'ROOM_UNAVAILABLE',
        null,
        input.unknownResult
          ? '请求结果未知，请先确认房间状态，不要重复提交'
          : '房间运行时暂不可用',
        undefined,
      );
    }
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      if (input.unknownResult && response.status >= 500) {
        throw new ArenaRoomClientError(
          'ROOM_RESULT_UNKNOWN',
          response.status,
          '请求可能已提交，请先确认房间状态，不要重复提交',
        );
      }
      const parsed = ArenaRoomHttpErrorResponseSchema.safeParse(payload);
      throw new ArenaRoomClientError(
        parsed.success ? parsed.data.code : 'ROOM_RESPONSE_INVALID',
        response.status,
        parsed.success ? parsed.data.error : '房间服务返回了无效错误响应',
        parsed.success ? parsed.data.retryAfterSeconds : undefined,
      );
    }
    try {
      return parseResponse(input.schema, payload);
    } catch (error) {
      if (
        input.unknownResult
        && error instanceof ArenaRoomClientError
        && error.code === 'ROOM_RESPONSE_INVALID'
      ) {
        throw new ArenaRoomClientError(
          'ROOM_RESULT_UNKNOWN',
          response.status,
          '请求可能已提交，请先确认房间状态，不要重复提交',
        );
      }
      throw error;
    }
  };

  const pathFor = (roomId: string, suffix: string): string => (
    `${ARENA_ROOM_HTTP_BASE_PATH}/${encodeURIComponent(roomId)}/${suffix}`
  );

  const proposalPathFor = (roomId: string, proposalId: string, suffix: string): string => (
    pathFor(roomId, `proposals/${encodeURIComponent(proposalId)}/${suffix}`)
  );

  const assertGenerationViewIdentity = (
    view: ArenaRoomGenerationViewResponse,
    roomId: string,
    generationId?: string,
  ): ArenaRoomGenerationViewResponse => {
    if (
      view.roomId !== roomId
      || (generationId !== undefined && view.generation.generationId !== generationId)
    ) {
      throw new ArenaRoomClientError(
        'ROOM_RESPONSE_INVALID',
        null,
        '房间服务返回了无效响应',
      );
    }
    return view;
  };

  return Object.freeze({
    async discover(input = {}) {
      const query = RoomDirectoryPageQuerySchema.parse(input);
      const params = new URLSearchParams({ limit: String(query.limit) });
      if (query.cursor) params.set('cursor', query.cursor);
      return request({
        path: `${ARENA_ROOM_HTTP_BASE_PATH}?${params}`,
        schema: RoomDirectoryPageSchema,
      });
    },

    async create(input) {
      return request({
        path: ARENA_ROOM_HTTP_BASE_PATH,
        method: 'POST',
        body: ArenaRoomCreateRequestSchema.parse(input),
        schema: ArenaRoomSessionResponseSchema,
        unknownResult: true,
      });
    },

    async join(roomId, input) {
      return request({
        path: pathFor(roomId, 'join'),
        method: 'POST',
        body: ArenaRoomJoinRequestSchema.parse(input),
        schema: ArenaRoomSessionResponseSchema,
        unknownResult: true,
      });
    },

    async getSession(roomId) {
      return request({
        path: pathFor(roomId, 'session'),
        schema: ArenaRoomSessionResponseSchema,
      });
    },

    async issueTicket(roomId, input) {
      return request({
        path: pathFor(roomId, 'ticket'),
        method: 'POST',
        body: ArenaRoomTicketRequestSchema.parse(input),
        schema: ArenaRoomTicketResponseSchema,
      });
    },

    async leave(roomId, expectedRoomEpoch) {
      const result = await request({
        path: pathFor(roomId, 'leave'),
        method: 'POST',
        body: ArenaRoomEpochMutationRequestSchema.parse({ expectedRoomEpoch }),
        schema: ArenaRoomLeaveResponseSchema,
        unknownResult: true,
      });
      if (result.roomId !== roomId || result.outcome !== 'left') {
        throw new ArenaRoomClientError(
          'ROOM_RESULT_UNKNOWN',
          null,
          '请求可能已提交，请先确认房间状态，不要重复提交',
        );
      }
      return result;
    },

    async close(roomId, expectedRoomEpoch) {
      const result = await request({
        path: pathFor(roomId, 'close'),
        method: 'POST',
        body: ArenaRoomEpochMutationRequestSchema.parse({ expectedRoomEpoch }),
        schema: ArenaRoomLeaveResponseSchema,
        unknownResult: true,
      });
      if (result.roomId !== roomId || result.outcome !== 'closed') {
        throw new ArenaRoomClientError(
          'ROOM_RESULT_UNKNOWN',
          null,
          '请求可能已提交，请先确认房间状态，不要重复提交',
        );
      }
      return result;
    },

    async kick(roomId, targetUserId, expectedRoomEpoch) {
      const parsed = ArenaRoomMemberKickRequestSchema.parse({ expectedRoomEpoch });
      const nextSession = await request({
        path: pathFor(roomId, `members/${encodeURIComponent(targetUserId)}/kick`),
        method: 'POST',
        body: parsed,
        schema: ArenaRoomSessionResponseSchema,
        unknownResult: true,
      });
      const targetStillActive = nextSession.snapshot.members.some((member) => (
        member.userId === targetUserId && member.membershipState === 'active'
      ));
      if (
        nextSession.roomId !== roomId
        || nextSession.roomEpoch !== parsed.expectedRoomEpoch
        || nextSession.snapshot.roomId !== roomId
        || nextSession.snapshot.roomEpoch !== parsed.expectedRoomEpoch
        || nextSession.self.role !== 'host'
        || targetStillActive
      ) {
        throw new ArenaRoomClientError(
          'ROOM_RESULT_UNKNOWN',
          null,
          '请求可能已提交，请先确认房间状态，不要重复提交',
        );
      }
      return nextSession;
    },

    async submitProposal(roomId, input) {
      return request({
        path: pathFor(roomId, 'proposals'),
        method: 'POST',
        body: ArenaRoomProposalSubmitRequestSchema.parse(input),
        schema: ArenaRoomProposalMutationResponseSchema,
        unknownResult: true,
      });
    },

    async resolveProposal(roomId, proposalId, input) {
      return request({
        path: proposalPathFor(roomId, proposalId, 'resolve'),
        method: 'POST',
        body: ArenaRoomProposalResolveRequestSchema.parse(input),
        schema: ArenaRoomProposalMutationResponseSchema,
        unknownResult: true,
      });
    },

    async withdrawProposal(roomId, proposalId, expectedRoomEpoch) {
      return request({
        path: proposalPathFor(roomId, proposalId, 'withdraw'),
        method: 'POST',
        body: ArenaRoomProposalWithdrawRequestSchema.parse({ expectedRoomEpoch }),
        schema: ArenaRoomProposalMutationResponseSchema,
        unknownResult: true,
      });
    },

    async publishConfig(roomId, input) {
      const parsed = ArenaRoomPublishConfigRequestSchema.parse(input);
      const session = await request({
        path: pathFor(roomId, 'config'),
        method: 'POST',
        body: parsed,
        schema: ArenaRoomSessionResponseSchema,
        unknownResult: true,
      });
      if (
        session.roomId !== roomId
        || session.roomEpoch !== parsed.expectedRoomEpoch
        || session.self.role !== 'host'
        || (
          session.snapshot.revision !== parsed.expectedRevision
          && session.snapshot.revision !== parsed.expectedRevision + 1
        )
        || JSON.stringify(session.snapshot.sharedConfig) !== JSON.stringify(parsed.sharedConfig)
      ) {
        throw new ArenaRoomClientError(
          'ROOM_RESULT_UNKNOWN',
          null,
          '请求可能已提交，请先确认房间状态，不要重复提交',
        );
      }
      return session;
    },

    async startGeneration(roomId, input) {
      const parsed = ArenaRoomGenerationStartRequestSchema.parse(input);
      const view = await request({
        path: pathFor(roomId, 'generations'),
        method: 'POST',
        body: parsed,
        schema: ArenaRoomGenerationViewResponseSchema,
        unknownResult: true,
      });
      if (
        view.roomId !== roomId
        || view.roomEpoch !== parsed.expectedRoomEpoch
        || view.generation.generationRequestId !== parsed.generationRequestId
      ) {
        throw new ArenaRoomClientError(
          'ROOM_RESULT_UNKNOWN',
          null,
          '请求可能已提交，请先确认房间状态，不要重复提交',
        );
      }
      return view;
    },

    async getGenerationView(roomId, generationId) {
      const view = await request({
        path: pathFor(roomId, `generations/${encodeURIComponent(generationId)}`),
        schema: ArenaRoomGenerationViewResponseSchema,
      });
      return assertGenerationViewIdentity(view, roomId, generationId);
    },

    async cancelGeneration(roomId, generationId, expectedRoomEpoch) {
      const parsed = ArenaRoomGenerationCancelRequestSchema.parse({ expectedRoomEpoch });
      const view = await request({
        path: pathFor(roomId, `generations/${encodeURIComponent(generationId)}/cancel`),
        method: 'POST',
        body: parsed,
        schema: ArenaRoomGenerationViewResponseSchema,
        unknownResult: true,
      });
      if (
        view.roomId !== roomId
        || view.roomEpoch !== parsed.expectedRoomEpoch
        || view.generation.generationId !== generationId
      ) {
        throw new ArenaRoomClientError(
          'ROOM_RESULT_UNKNOWN',
          null,
          '请求可能已提交，请先确认房间状态，不要重复提交',
        );
      }
      return view;
    },

    buildWebSocketUrl(ticket) {
      const parsed = ArenaRoomTicketResponseSchema.parse(ticket);
      const url = new URL(parsed.websocket.path, base);
      url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('ticket', parsed.ticket);
      return url.toString();
    },
  });
};
