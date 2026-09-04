import type { Context, Hono } from 'hono';
import {
  ARENA_ROOM_HTTP_BASE_PATH,
  ARENA_ROOM_HTTP_ROUTES,
  ARENA_ROOM_ERROR_TAXONOMY_HEADER,
  ARENA_ROOM_ERROR_TAXONOMY_VERSION,
  ArenaProposalIdSchema,
  ARENA_ROOM_WEBSOCKET_PATH,
  ARENA_ROOM_WEBSOCKET_PROTOCOL,
  ArenaRoomCreateRequestSchema,
  ArenaRoomEpochMutationRequestSchema,
  ArenaRoomGenerationCancelRequestSchema,
  ArenaRoomGenerationHistoryResponseSchema,
  ArenaRoomGenerationHistoryViewResponseSchema,
  ArenaRoomGenerationStartRequestSchema,
  ArenaRoomGenerationViewResponseSchema,
  ArenaRoomJoinRequestSchema,
  ArenaRoomLeaveResponseSchema,
  ArenaRoomMemberKickRequestSchema,
  ArenaRoomProposalMutationResponseSchema,
  ArenaRoomProposalResolveRequestSchema,
  ArenaRoomProposalSubmitRequestSchema,
  ArenaRoomProposalWithdrawRequestSchema,
  ArenaRoomPublishConfigRequestSchema,
  ArenaRoomSessionResponseSchema,
  ArenaRoomTicketRequestSchema,
  ArenaRoomTicketResponseSchema,
  MAX_CONTROL_MESSAGE_BYTES,
  MAX_ARENA_ROOM_GENERATION_START_BYTES,
  MAX_PENDING_PROPOSALS_PER_MEMBER,
  MAX_PROPOSAL_BYTES,
  MAX_PROPOSAL_CHANGES,
  MAX_ROOM_MEMBERS,
  OpaqueKeySchema,
  PROTOCOL_VERSION,
  RoomDirectoryPageSchema,
  RoomDirectoryPageQuerySchema,
  isArenaRoomErrorTaxonomyAccepted,
  resolveArenaRoomLegacyHttpErrorCode,
  type ArenaRoomHttpErrorCode,
  type ArenaRoomLegacyHttpErrorCode,
} from '@mahoshojo/contracts/arena-room';
import { ARENA_RESOURCE_BUDGET } from '@mahoshojo/hosted-api/arena-generation/resource-budget';

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
import {
  ArenaRoomConfigError,
  type ArenaRoomConfigService,
} from './room-config-service';

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
    'close' | 'create' | 'getSession' | 'hasCreationReceipt' | 'join' | 'kick' | 'leave'
  >;
  readonly directory: Pick<ArenaRoomDirectoryService, 'discoverPublic'>;
  readonly websocketAuthority: Pick<ArenaRoomWebSocketAuthority, 'issue'>;
  readonly proposals: Pick<ArenaRoomProposalService, 'resolve' | 'submit' | 'withdraw'>;
  readonly generations: Pick<
    ArenaRoomGenerationService,
    'cancel' | 'list' | 'read' | 'readHistory' | 'start'
  >;
  readonly configs: Pick<ArenaRoomConfigService, 'publish'>;
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
  | 'configPublish'
  | 'create'
  | 'createBudget'
  | 'discover'
  | 'generationCancel'
  | 'join'
  | 'kick'
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
  configPublish: { limit: 10, windowSeconds: 60 },
  generationStart: { limit: 5, windowSeconds: 60 },
  generationRead: { limit: 120, windowSeconds: 60 },
  generationCancel: { limit: 10, windowSeconds: 60 },
  kick: { limit: 30, windowSeconds: 60 },
  proposalSubmit: { limit: 20, windowSeconds: 60 },
  proposalResolve: { limit: 30, windowSeconds: 60 },
  proposalWithdraw: { limit: 20, windowSeconds: 60 },
});

type ArenaRoomRequestIssue = Readonly<{
  code:
    | 'ROOM_CONFIG_COMBATANT_LIMIT'
    | 'ROOM_CONFIG_REFERENCE_LIMIT'
    | 'ROOM_CONFIG_SHAREABILITY_INVALID'
    | 'ROOM_GENERATION_COMBATANT_LIMIT'
    | 'ROOM_PROPOSAL_BYTE_LIMIT'
    | 'ROOM_PROPOSAL_CHANGE_LIMIT'
    | 'ROOM_REFERENCE_VERSION_MISSING';
  current?: number;
  maximum?: number;
  target?: string;
}>;

class ArenaRoomRequestError extends Error {
  constructor(
    readonly kind: 'invalid' | 'too-large',
    readonly issue?: ArenaRoomRequestIssue,
  ) {
    super(kind);
    this.name = 'ArenaRoomRequestError';
  }
}

const errorBody = (code: ArenaRoomHttpErrorCode, error: string, retryAfterSeconds?: number) => ({
  code,
  error,
  ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
});

const hasNegotiatedGranularErrors = (context: ArenaRoomHttpContext): boolean => (
  context.req.header(ARENA_ROOM_ERROR_TAXONOMY_HEADER) === ARENA_ROOM_ERROR_TAXONOMY_VERSION
  || isArenaRoomErrorTaxonomyAccepted(context.req.header('accept'))
);

const negotiatedErrorBody = (
  context: ArenaRoomHttpContext,
  code: ArenaRoomHttpErrorCode,
  error: string,
  legacyCode: ArenaRoomLegacyHttpErrorCode = resolveArenaRoomLegacyHttpErrorCode(code),
) => {
  context.header('vary', 'Accept', { append: true });
  context.header('vary', ARENA_ROOM_ERROR_TAXONOMY_HEADER, { append: true });
  context.header('cache-control', 'no-store');
  return errorBody(hasNegotiatedGranularErrors(context) ? code : legacyCode, error);
};

const invalidRequest = (context: ArenaRoomHttpContext, message = '房间请求无效') => (
  context.json(errorBody('ROOM_REQUEST_INVALID', message), 400)
);

const unavailable = (context: ArenaRoomHttpContext) => {
  context.header('retry-after', '1');
  return context.json(errorBody('ROOM_UNAVAILABLE', '房间运行时暂不可用', 1), 503);
};

const mapServiceError = (context: ArenaRoomHttpContext, error: unknown): Response => {
  if (error instanceof ArenaRoomRequestError) {
    if (error.kind === 'too-large') {
      if (error.issue?.code === 'ROOM_PROPOSAL_BYTE_LIMIT') {
        return context.json(negotiatedErrorBody(
          context,
          error.issue.code,
          `配置提案超过 ${MAX_PROPOSAL_BYTES / 1_024} KiB 的大小限制；请拆分或精简变更后重试。`,
        ), 413);
      }
      return context.json(errorBody(
        'ROOM_PAYLOAD_TOO_LARGE',
        '房间请求内容超过大小限制，请减少内容后重试。',
      ), 413);
    }
    if (error.issue?.code === 'ROOM_GENERATION_COMBATANT_LIMIT') {
      return context.json(negotiatedErrorBody(
        context,
        error.issue.code,
        `当前有 ${error.issue.current ?? '?'} 位参战角色，最多支持 ${error.issue.maximum ?? 32} 位；请移除多余角色后再开始生成。`,
      ), 400);
    }
    if (error.issue?.code === 'ROOM_CONFIG_COMBATANT_LIMIT') {
      return context.json(negotiatedErrorBody(
        context,
        error.issue.code,
        `当前有 ${error.issue.current ?? '?'} 位参战角色，房间配置最多支持 ${error.issue.maximum ?? 32} 位；请移除多余角色后重试。`,
      ), 400);
    }
    if (error.issue?.code === 'ROOM_CONFIG_REFERENCE_LIMIT') {
      return context.json(negotiatedErrorBody(
        context,
        error.issue.code,
        `当前共有 ${error.issue.current ?? '?'} 个辅助情景与素材，累计最多支持 ${error.issue.maximum ?? 256} 个；请移除多余内容后重试。`,
      ), 400);
    }
    if (error.issue?.code === 'ROOM_CONFIG_SHAREABILITY_INVALID') {
      return context.json(negotiatedErrorBody(
        context,
        error.issue.code,
        '房间配置包含无法安全共享的字段或引用关系；请检查标记的配置项后重试。',
      ), 400);
    }
    if (error.issue?.code === 'ROOM_PROPOSAL_CHANGE_LIMIT') {
      return context.json(negotiatedErrorBody(
        context,
        error.issue.code,
        `当前配置提案有 ${error.issue.current ?? '?'} 项变更，单个提案最多支持 ${error.issue.maximum ?? MAX_PROPOSAL_CHANGES} 项；请拆分后重试。`,
      ), 400);
    }
    if (error.issue?.code === 'ROOM_REFERENCE_VERSION_MISSING') {
      return context.json(negotiatedErrorBody(
        context,
        error.issue.code,
        `${error.issue.target ?? '数据卡'}缺少版本信息；请刷新或重新选择该数据卡后重试。`,
      ), 400);
    }
    return invalidRequest(context);
  }
  if (error instanceof ArenaRoomMembershipError) {
    switch (error.code) {
      case 'ROOM_CLOSED':
      case 'ROOM_NOT_FOUND':
        return context.json(errorBody('ROOM_NOT_FOUND', '房间不存在或已关闭'), 404);
      case 'ROOM_EPOCH_STALE':
        return context.json(errorBody('ROOM_CONFLICT', '房间实例已变化，请重新进入房间后重试。'), 409);
      case 'ROOM_CREATION_REQUEST_CONFLICT':
        return context.json(errorBody('ROOM_CONFLICT', '创建请求已绑定其他意图或结果已过期'), 409);
      case 'ROOM_MEMBERSHIP_NOT_ACTIVE':
      case 'ROOM_MEMBERSHIP_REVOKED':
      case 'ROOM_PERMISSION_DENIED':
        return context.json(errorBody('ROOM_FORBIDDEN', '没有此房间操作权限'), 403);
      case 'ROOM_REFERENCE_DENIED':
        return context.json(negotiatedErrorBody(context,
          'ROOM_REFERENCE_DENIED',
          '当前账号无权将对应数据卡加入房间；请改用可访问的数据卡或联系作者调整权限。',
        ), hasNegotiatedGranularErrors(context) ? 403 : 409);
      case 'ROOM_REFERENCE_STALE':
        return context.json(negotiatedErrorBody(context,
          'ROOM_REFERENCE_STALE',
          '数据卡版本已更新，请重新同步或重新选择对应数据卡后重试。',
        ), 409);
      case 'ROOM_REFERENCE_UNAVAILABLE':
        return unavailable(context);
      case 'ROOM_INPUT_INVALID':
        return invalidRequest(context);
      case 'ROOM_MEMBERSHIP_TRANSITION_DENIED':
        return context.json(errorBody('ROOM_CONFLICT', '房间状态已发生变化，请刷新后重试。'), 409);
      case 'ROOM_MEMBER_LIMIT_REACHED':
        return context.json(negotiatedErrorBody(context,
          'ROOM_MEMBER_LIMIT_REACHED',
          `房间最多容纳 ${MAX_ROOM_MEMBERS} 人，当前已有 ${MAX_ROOM_MEMBERS} 人；请等待有成员退出后重试。`,
        ), 409);
      case 'ROOM_CONFIG_FRAME_TOO_LARGE':
        return context.json(negotiatedErrorBody(context,
          'ROOM_CONFIG_FRAME_TOO_LARGE',
          '房间配置快照超过 64 KiB，请减少角色、情景、素材或引导内容后重试。',
        ), 413);
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
        return context.json(errorBody('ROOM_NOT_FOUND', '提案不存在'), 404);
      case 'ROOM_PROPOSAL_PENDING_LIMIT_REACHED':
        return context.json(negotiatedErrorBody(context,
          'ROOM_PROPOSAL_PENDING_LIMIT_REACHED',
          `每位成员最多保留 ${MAX_PENDING_PROPOSALS_PER_MEMBER} 个待处理提案，当前已有 ${MAX_PENDING_PROPOSALS_PER_MEMBER} 个；请先撤回或等待处理现有提案。`,
        ), 409);
      case 'ROOM_PROPOSAL_BYTE_LIMIT':
        return context.json(negotiatedErrorBody(context,
          'ROOM_PROPOSAL_BYTE_LIMIT',
          `配置提案超过 ${MAX_PROPOSAL_BYTES / 1_024} KiB 的大小限制；请拆分或精简变更后重试。`,
        ), 413);
      case 'ROOM_CONFIG_FRAME_TOO_LARGE':
        return context.json(negotiatedErrorBody(context,
          'ROOM_CONFIG_FRAME_TOO_LARGE',
          '房间快照超过 64 KiB，请减少配置内容或先处理现有提案后重试。',
        ), 413);
      // 细分 code（ROOM_EPOCH_STALE 等）尚未进入协商 taxonomy（当前 v2 是
      // exact-match，新增 code 会让已协商 v2 的旧 bundle 解析失败）；
      // 先只细化 message，code 保持双方 schema 都兼容的 ROOM_CONFLICT。
      case 'ROOM_EPOCH_STALE':
        return context.json(errorBody('ROOM_CONFLICT', '房间实例已更换，请重新进入房间后再试。'), 409);
      case 'ROOM_REVISION_STALE':
        return context.json(errorBody('ROOM_CONFLICT', '房间配置刚发生更新，请等待房间状态同步后重试。'), 409);
      case 'ROOM_PROPOSAL_CONFLICT':
        return context.json(errorBody('ROOM_CONFLICT', '提案与当前房间配置存在冲突；请在审阅面板逐项确认或取消勾选冲突项后重试。'), 409);
      case 'ROOM_TRANSITION_DENIED':
        return context.json(errorBody('ROOM_CONFLICT', '房间当前状态不允许该操作，请稍后重试。'), 409);
      case 'ROOM_REFERENCE_DENIED':
        return context.json(negotiatedErrorBody(context,
          'ROOM_REFERENCE_DENIED',
          '配置提案引用的数据卡不可用于当前房间；请改用房主可访问的数据卡后重新提交。',
        ), hasNegotiatedGranularErrors(context) ? 403 : 409);
      case 'ROOM_REFERENCE_STALE':
        return context.json(negotiatedErrorBody(context,
          'ROOM_REFERENCE_STALE',
          '提案引用的数据卡已更新，请重新同步或重新选择数据卡后再提交。',
        ), 409);
      case 'ROOM_OPERATION_UNKNOWN':
      case 'ROOM_REFERENCE_UNAVAILABLE':
        return unavailable(context);
    }
  }
  if (error instanceof ArenaRoomGenerationError) {
    const issueParams = error.issue?.params;
    const numericParam = (key: string, fallback: number): number => (
      typeof issueParams?.[key] === 'number' ? issueParams[key] : fallback
    );
    const targetLabel = (() => {
      const kind = error.target?.kind === 'combatant' ? '角色'
        : error.target?.kind === 'scenario' ? '情景'
          : error.target?.kind === 'material' ? '素材'
            : '房主本地内容';
      return error.target?.displayName ? `${kind}「${error.target.displayName}」` : kind;
    })();
    switch (error.code) {
      case 'ROOM_GENERATION_COMBATANTS_EMPTY': {
        const current = numericParam('current', 0);
        const required = numericParam('required', 1);
        return context.json(negotiatedErrorBody(context,
          'ROOM_GENERATION_COMBATANTS_EMPTY',
          `当前有 ${current} 位参战角色，至少需要 ${required} 位；请添加角色后再开始生成。`,
        ), 409);
      }
      case 'ROOM_GENERATION_COMBATANTS_INSUFFICIENT': {
        const current = numericParam('current', 0);
        const required = numericParam('required', 1);
        const mode = issueParams?.mode === 'classic' ? '经典模式'
          : issueParams?.mode === 'kizuna' ? '羁绊模式'
            : issueParams?.mode === 'daily' ? '日常模式'
              : issueParams?.mode === 'scenario' ? '情景模式'
                : '当前模式';
        return context.json(negotiatedErrorBody(context,
          'ROOM_GENERATION_COMBATANTS_INSUFFICIENT',
          `${mode}当前有 ${current} 位参战角色，至少需要 ${required} 位；请继续添加角色。`,
        ), 409);
      }
      case 'ROOM_GENERATION_SCENARIO_REQUIRED':
        return context.json(negotiatedErrorBody(context,
          'ROOM_GENERATION_SCENARIO_REQUIRED',
          '情景模式需要主情景，请先选择或载入主情景后再开始生成。',
        ), 409);
      case 'ROOM_GENERATION_COMBATANT_LIMIT':
        return context.json(negotiatedErrorBody(context,
          'ROOM_GENERATION_COMBATANT_LIMIT',
          `参战角色超过运行时上限 ${ARENA_RESOURCE_BUDGET.maxCombatants} 位；请移除多余角色后再开始生成。`,
        ), 400);
      case 'ROOM_RUNTIME_BODY_LIMIT':
        return context.json(negotiatedErrorBody(context,
          'ROOM_RUNTIME_BODY_LIMIT',
          `生成请求超过运行时 ${ARENA_RESOURCE_BUDGET.hardBodyBytes / 1_024 / 1_024} MiB 的正文上限；请减少角色、情景、素材或叙事历史后重试。`,
        ), 413);
      case 'ROOM_RUNTIME_REFERENCE_LIMIT':
        return context.json(negotiatedErrorBody(context,
          'ROOM_RUNTIME_REFERENCE_LIMIT',
          `辅助情景、素材、问卷与叙事历史累计超过运行时上限 ${ARENA_RESOURCE_BUDGET.maxReferenceItemsSanity} 项；请减少引用内容后重试。`,
        ), 400);
      case 'ROOM_RUNTIME_ADJUDICATION_LIMIT':
        return context.json(negotiatedErrorBody(context,
          'ROOM_RUNTIME_ADJUDICATION_LIMIT',
          `裁定事件超过运行时上限 ${ARENA_RESOURCE_BUDGET.maxAdjudicationEvents} 项；请减少裁定记录后重试。`,
        ), 400);
      case 'ROOM_RUNTIME_PROMPT_BUDGET_EXCEEDED':
        return context.json(negotiatedErrorBody(context,
          'ROOM_RUNTIME_PROMPT_BUDGET_EXCEEDED',
          '生成提示词超过当前渠道的安全预算；请缩短角色、情景、素材、引导或叙事历史内容后重试。',
        ), 400);
      case 'ROOM_PROVIDER_CONFIG_INVALID':
        return context.json(negotiatedErrorBody(context,
          'ROOM_PROVIDER_CONFIG_INVALID',
          '当前生成渠道配置无效；请检查服务商、模型和 API Key 后重试。',
        ), 400);
      case 'ROOM_HOST_LOCAL_PAYLOAD_MISSING':
        return context.json(negotiatedErrorBody(context,
          'ROOM_HOST_LOCAL_PAYLOAD_MISSING',
          `${targetLabel}来自房主本地文件，但当前页面无法取得完整内容；请房主重新载入后重试。`,
        ), 400);
      case 'ROOM_HOST_LOCAL_PAYLOAD_INVALID':
        return context.json(negotiatedErrorBody(context,
          'ROOM_HOST_LOCAL_PAYLOAD_INVALID',
          '房主本地内容列表不完整或包含重复项；请重新载入内容并更新房间配置。',
        ), 400);
      case 'ROOM_HOST_LOCAL_KIND_MISMATCH':
        return context.json(negotiatedErrorBody(context,
          'ROOM_HOST_LOCAL_KIND_MISMATCH',
          `${targetLabel}的内容类别与房间配置不一致；请重新选择正确类别的文件。`,
        ), 400);
      case 'ROOM_HOST_LOCAL_TYPE_MISMATCH':
        return context.json(negotiatedErrorBody(context,
          'ROOM_HOST_LOCAL_TYPE_MISMATCH',
          `${targetLabel}的角色类型与房间配置不一致；请重新载入该角色或更新房间配置。`,
        ), 400);
      case 'ROOM_HOST_LOCAL_DIGEST_MISMATCH':
        return context.json(negotiatedErrorBody(context,
          'ROOM_HOST_LOCAL_DIGEST_MISMATCH',
          `${targetLabel}在加入房间配置后已发生变化；请重新载入并更新房间配置。`,
        ), 409);
      case 'ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING':
        return context.json(negotiatedErrorBody(context,
          'ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING',
          `${targetLabel}缺少本地内容版本；请由房主重新发布房间配置后重试。`,
        ), 400);
      case 'ROOM_CONFIG_FRAME_TOO_LARGE':
        return context.json(negotiatedErrorBody(context,
          'ROOM_CONFIG_FRAME_TOO_LARGE',
          '房间快照超过 64 KiB，请减少配置内容后再开始生成。',
        ), 413);
      case 'ROOM_GENERATION_INPUT_INVALID':
        return invalidRequest(context);
      case 'ROOM_PERMISSION_DENIED':
        return context.json(errorBody('ROOM_FORBIDDEN', '没有此房间生成操作权限'), 403);
      case 'ROOM_REFERENCE_DENIED':
        return context.json(negotiatedErrorBody(context,
          'ROOM_REFERENCE_DENIED',
          '生成所需的数据卡当前不可读取；请重新选择有权限的数据卡并更新房间配置。',
          'ROOM_FORBIDDEN',
        ), 403);
      case 'ROOM_GENERATION_NOT_FOUND':
        return context.json(errorBody('ROOM_NOT_FOUND', '房间生成不存在'), 404);
      case 'ROOM_EPOCH_STALE':
      case 'ROOM_GENERATION_CONFLICT':
      case 'ROOM_REVISION_STALE':
        return context.json(errorBody('ROOM_CONFLICT', '房间生成状态已发生变化'), 409);
      case 'ROOM_REFERENCE_STALE':
        return context.json(negotiatedErrorBody(context,
          'ROOM_REFERENCE_STALE',
          '数据卡加入房间后已更新，请重新同步或重新选择对应数据卡后重试。',
        ), 409);
      case 'ROOM_GENERATION_UNAVAILABLE':
      case 'ROOM_OPERATION_UNKNOWN':
      case 'ROOM_REFERENCE_UNAVAILABLE':
        return unavailable(context);
    }
  }
  if (error instanceof ArenaRoomConfigError) {
    switch (error.code) {
      case 'ROOM_CONFIG_FRAME_TOO_LARGE':
        return context.json(negotiatedErrorBody(context,
          'ROOM_CONFIG_FRAME_TOO_LARGE',
          '房间配置快照超过 64 KiB，请减少角色、情景、素材或引导内容后重试。',
        ), 413);
      case 'ROOM_CONFIG_INPUT_INVALID':
        return invalidRequest(context);
      case 'ROOM_PERMISSION_DENIED':
        return context.json(errorBody('ROOM_FORBIDDEN', '没有此房间配置发布权限'), 403);
      case 'ROOM_EPOCH_STALE':
      case 'ROOM_REVISION_STALE':
      case 'ROOM_TRANSITION_DENIED':
        return context.json(errorBody('ROOM_CONFLICT', '房间配置已发生变化'), 409);
      case 'ROOM_REFERENCE_DENIED':
        return context.json(negotiatedErrorBody(context,
          'ROOM_REFERENCE_DENIED',
          '房间配置引用的数据卡当前不可读取；请重新选择有权限的数据卡后再发布。',
        ), hasNegotiatedGranularErrors(context) ? 403 : 409);
      case 'ROOM_REFERENCE_STALE':
        return context.json(negotiatedErrorBody(context,
          'ROOM_REFERENCE_STALE',
          '房间配置引用的数据卡已更新，请重新同步或重新选择数据卡后再发布。',
        ), 409);
      case 'ROOM_OPERATION_UNKNOWN':
      case 'ROOM_REFERENCE_UNAVAILABLE':
        return unavailable(context);
    }
  }
  return unavailable(context);
};

type ZodLikeIssue = Readonly<{
  code?: unknown;
  origin?: unknown;
  maximum?: unknown;
  path?: readonly PropertyKey[];
  params?: unknown;
  errors?: unknown;
}>;

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
);

const issuePaths = (
  issue: ZodLikeIssue,
  parent: readonly PropertyKey[] = [],
): readonly (readonly PropertyKey[])[] => {
  const path = [...parent, ...(issue.path ?? [])];
  const nested = Array.isArray(issue.errors)
    ? issue.errors.flatMap((group) => Array.isArray(group)
      ? group.flatMap((entry) => recordOf(entry)
        ? issuePaths(entry as ZodLikeIssue, path)
        : [])
      : [])
    : [];
  return [path, ...nested];
};

const referenceTarget = (path: readonly PropertyKey[]): string => {
  const combatants = path.lastIndexOf('combatants');
  if (combatants >= 0 && typeof path[combatants + 1] === 'number') {
    return `角色 ${Number(path[combatants + 1]) + 1}`;
  }
  const auxScenarios = path.lastIndexOf('auxScenarios');
  if (auxScenarios >= 0 && typeof path[auxScenarios + 1] === 'number') {
    return `辅助情景 ${Number(path[auxScenarios + 1]) + 1}`;
  }
  const materials = path.lastIndexOf('materials');
  if (materials >= 0 && typeof path[materials + 1] === 'number') {
    return `素材 ${Number(path[materials + 1]) + 1}`;
  }
  if (path.includes('scenario')) return '主情景';
  const changes = path.lastIndexOf('changes');
  if (changes >= 0 && typeof path[changes + 1] === 'number') {
    return `提案变更 ${Number(path[changes + 1]) + 1} 中的数据卡`;
  }
  return '数据卡';
};

const classifyRequestIssue = (
  issues: readonly ZodLikeIssue[],
  input: unknown,
  scope: 'config' | 'generation' | 'proposal' | 'other',
): ArenaRoomRequestIssue | undefined => {
  const root = recordOf(input);
  const sharedConfig = recordOf(root?.sharedConfig);
  for (const issue of issues) {
    const path = issue.path ?? [];
    if (
      issue.code === 'too_big'
      && issue.origin === 'array'
      && path.at(-1) === 'combatants'
      && Array.isArray(sharedConfig?.combatants)
      && typeof issue.maximum === 'number'
    ) {
      return {
        code: scope === 'generation'
          ? 'ROOM_GENERATION_COMBATANT_LIMIT'
          : 'ROOM_CONFIG_COMBATANT_LIMIT',
        current: sharedConfig.combatants.length,
        maximum: issue.maximum,
      };
    }
    const params = recordOf(issue.params);
    if (
      params?.gateCode === 'ROOM_CONFIG_REFERENCE_LIMIT'
      && typeof params.current === 'number'
      && typeof params.maximum === 'number'
    ) {
      return {
        code: 'ROOM_CONFIG_REFERENCE_LIMIT',
        current: params.current,
        maximum: params.maximum,
      };
    }
    if (
      scope === 'proposal'
      && issue.code === 'too_big'
      && issue.origin === 'array'
      && (path.at(-1) === 'changes' || path.at(-1) === 'selectedChangeIds')
      && typeof issue.maximum === 'number'
    ) {
      const values = path.at(-1) === 'changes' ? root?.changes : root?.selectedChangeIds;
      return {
        code: 'ROOM_PROPOSAL_CHANGE_LIMIT',
        current: Array.isArray(values) ? values.length : undefined,
        maximum: issue.maximum,
      };
    }
    const missingVersionPath = issuePaths(issue).find((candidate) => (
      candidate.at(-2) === 'ref' && candidate.at(-1) === 'versionToken'
    ));
    if (missingVersionPath) {
      return {
        code: 'ROOM_REFERENCE_VERSION_MISSING',
        target: referenceTarget(missingVersionPath),
      };
    }
  }
  if (
    (scope === 'config' || scope === 'generation')
    && issues.some((issue) => issuePaths(issue).some((path) => path[0] === 'sharedConfig'))
  ) {
    return { code: 'ROOM_CONFIG_SHAREABILITY_INVALID' };
  }
  return undefined;
};

const parseRequest = <T>(
  schema: {
    safeParse(input: unknown):
      | { readonly success: true; readonly data: T }
      | { readonly success: false; readonly error?: { readonly issues?: readonly ZodLikeIssue[] } };
  },
  input: unknown,
  scope: 'config' | 'generation' | 'proposal' | 'other' = 'other',
): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ArenaRoomRequestError(
      'invalid',
      classifyRequestIssue(parsed.error?.issues ?? [], input, scope),
    );
  }
  return parsed.data;
};

const readBoundedBody = async (
  request: Request,
  maxBytes = MAX_CONTROL_MESSAGE_BYTES,
  tooLargeIssue?: ArenaRoomRequestIssue,
): Promise<unknown> => {
  const rawLength = request.headers.get('content-length');
  if (rawLength) {
    const contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new ArenaRoomRequestError('invalid');
    }
    if (contentLength > maxBytes) {
      throw new ArenaRoomRequestError('too-large', tooLargeIssue);
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
        throw new ArenaRoomRequestError('too-large', tooLargeIssue);
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

const parseTargetUserId = (context: ArenaRoomHttpContext): string | Response => {
  const raw = context.req.param('targetUserId');
  const parsed = OpaqueKeySchema.safeParse(raw);
  return parsed.success && parsed.data === raw && raw !== '.' && raw !== '..'
    ? parsed.data
    : invalidRequest(context, 'targetUserId 无效');
};

const consumeRateLimit = async (
  context: ArenaRoomHttpContext,
  dependencies: ArenaRoomHttpDependencies,
  accountUserId: number,
  operation: ArenaRoomHttpOperation,
  roomId?: string,
): Promise<Response | null> => {
  const policy = OPERATION_LIMITS[operation];
  let result: ArenaRoomHttpRateLimitResult | null;
  try {
    result = await dependencies.rateLimit({
      operation,
      accountUserId,
      ...(roomId === undefined ? {} : { roomId }),
      ...policy,
    });
  } catch {
    result = null;
  }
  if (!result) return unavailable(context);
  context.header('x-ratelimit-limit', String(result.limit));
  context.header('x-ratelimit-remaining', String(result.remaining));
  if (result.allowed) return null;
  context.header('retry-after', String(result.retryAfterSeconds));
  return context.json(
    errorBody('ROOM_RATE_LIMITED', '房间请求过于频繁，请稍后重试。', result.retryAfterSeconds),
    429,
  );
};

const authenticateAndLimit = async (
  context: ArenaRoomHttpContext,
  dependencies: ArenaRoomHttpDependencies,
  options: ArenaRoomHttpRegistrationOptions,
  operation: ArenaRoomHttpOperation,
  roomId?: string,
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

  const rateLimitResponse = await consumeRateLimit(
    context,
    dependencies,
    authentication.userId,
    operation,
    roomId,
  );
  if (rateLimitResponse) return { accepted: false, response: rateLimitResponse };
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
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const request = parseRequest(
        ArenaRoomCreateRequestSchema,
        await readBoundedBody(context.req.raw),
        'config',
      );
      const existingReceipt = await dependencies.memberships.hasCreationReceipt({
        accountUserId: authorization.accountUserId,
        creationRequestId: request.creationRequestId,
      });
      if (!existingReceipt) {
        const budgetResponse = await consumeRateLimit(
          context,
          dependencies,
          authorization.accountUserId,
          'createBudget',
        );
        if (budgetResponse) return budgetResponse;
      }
      const session = await dependencies.memberships.create({
        accountUserId: authorization.accountUserId,
        creationRequestId: request.creationRequestId,
        requireExistingCreationReceipt: existingReceipt,
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
      // leave-member 与 kick 都会 revoke 成员资格，之后 join 同一房间会得到
      // ROOM_MEMBERSHIP_REVOKED；这里必须给出与「权限不足」可区分的明确文案。
      if (error instanceof ArenaRoomMembershipError && error.code === 'ROOM_MEMBERSHIP_REVOKED') {
        return context.json(errorBody(
          'ROOM_FORBIDDEN',
          '你已离开该房间或被房主移出，无法重新加入；请联系房主或加入其他房间。',
        ), 403);
      }
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
      if (
        error instanceof ArenaRoomMembershipError
        && (error.code === 'ROOM_MEMBERSHIP_NOT_ACTIVE'
          || error.code === 'ROOM_MEMBERSHIP_REVOKED')
      ) {
        return context.json(errorBody('ROOM_NOT_FOUND', '房间会话不存在或已结束'), 404);
      }
      return mapServiceError(context, error);
    }
  });

  app.post(ARENA_ROOM_HTTP_ROUTES.config, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'configPublish',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const request = parseRequest(
        ArenaRoomPublishConfigRequestSchema,
        await readBoundedBody(context.req.raw),
        'config',
      );
      const session = await dependencies.configs.publish({
        roomId,
        accountUserId: authorization.accountUserId,
        request,
      });
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
        await readBoundedBody(
          context.req.raw,
          MAX_PROPOSAL_BYTES,
          { code: 'ROOM_PROPOSAL_BYTE_LIMIT', maximum: MAX_PROPOSAL_BYTES },
        ),
        'proposal',
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
        'generation',
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

  app.get(ARENA_ROOM_HTTP_ROUTES.generations, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'generationRead',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const history = await dependencies.generations.list({
        roomId,
        accountUserId: authorization.accountUserId,
      });
      return context.json(ArenaRoomGenerationHistoryResponseSchema.parse(history), 200);
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
      const input = {
        roomId,
        generationId,
        accountUserId: authorization.accountUserId,
      };
      if (context.req.query('view') === 'history') {
        const history = await dependencies.generations.readHistory(input);
        return context.json(ArenaRoomGenerationHistoryViewResponseSchema.parse(history), 200);
      }
      const view = await dependencies.generations.read(input);
      return context.json(ArenaRoomGenerationViewResponseSchema.parse(view), 200);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  app.post(ARENA_ROOM_HTTP_ROUTES.generationCancel, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const generationId = parseGenerationId(context);
    if (generationId instanceof Response) return generationId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'generationCancel',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const request = parseRequest(
        ArenaRoomGenerationCancelRequestSchema,
        await readBoundedBody(context.req.raw),
      );
      const result = await dependencies.generations.cancel({
        roomId,
        generationId,
        accountUserId: authorization.accountUserId,
        request,
      });
      return context.json(ArenaRoomGenerationViewResponseSchema.parse(result), 200);
    } catch (error) {
      return mapServiceError(context, error);
    }
  });

  app.post(ARENA_ROOM_HTTP_ROUTES.memberKick, async (context) => {
    const roomId = parseRoomId(context);
    if (roomId instanceof Response) return roomId;
    const targetUserId = parseTargetUserId(context);
    if (targetUserId instanceof Response) return targetUserId;
    const authorization = await authenticateAndLimit(
      context,
      dependencies,
      options,
      'kick',
      roomId,
    );
    if (!authorization.accepted) return authorization.response;
    try {
      const request = parseRequest(
        ArenaRoomMemberKickRequestSchema,
        await readBoundedBody(context.req.raw),
      );
      const result = await dependencies.memberships.kick({
        roomId,
        accountUserId: authorization.accountUserId,
        targetUserId,
        expectedRoomEpoch: request.expectedRoomEpoch,
      });
      return context.json(sessionResponse(result), 200);
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
        'proposal',
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
