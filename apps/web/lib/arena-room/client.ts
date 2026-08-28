import {
  ARENA_ROOM_HTTP_BASE_PATH,
  ArenaRoomCreateRequestSchema,
  ArenaRoomEpochMutationRequestSchema,
  ArenaRoomHttpErrorResponseSchema,
  ArenaRoomJoinRequestSchema,
  ArenaRoomLeaveResponseSchema,
  ArenaRoomProposalMutationResponseSchema,
  ArenaRoomProposalResolveRequestSchema,
  ArenaRoomProposalSubmitRequestSchema,
  ArenaRoomProposalWithdrawRequestSchema,
  ArenaRoomSessionResponseSchema,
  ArenaRoomTicketRequestSchema,
  ArenaRoomTicketResponseSchema,
  RoomDirectoryPageQuerySchema,
  RoomDirectoryPageSchema,
  type ArenaRoomCreateRequest,
  type ArenaRoomJoinRequest,
  type ArenaRoomLeaveResponse,
  type ArenaRoomProposalMutationResponse,
  type ArenaRoomProposalResolveRequest,
  type ArenaRoomProposalSubmitRequest,
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
      return request({
        path: pathFor(roomId, 'leave'),
        method: 'POST',
        body: ArenaRoomEpochMutationRequestSchema.parse({ expectedRoomEpoch }),
        schema: ArenaRoomLeaveResponseSchema,
      });
    },

    async close(roomId, expectedRoomEpoch) {
      return request({
        path: pathFor(roomId, 'close'),
        method: 'POST',
        body: ArenaRoomEpochMutationRequestSchema.parse({ expectedRoomEpoch }),
        schema: ArenaRoomLeaveResponseSchema,
      });
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

    buildWebSocketUrl(ticket) {
      const parsed = ArenaRoomTicketResponseSchema.parse(ticket);
      const url = new URL(parsed.websocket.path, base);
      url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('ticket', parsed.ticket);
      return url.toString();
    },
  });
};
