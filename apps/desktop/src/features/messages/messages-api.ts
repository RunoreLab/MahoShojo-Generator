import { MessageListSchema, MessageSummarySchema } from '@mahoshojo/contracts/messages';
import type { MessageFilter, MessageListDto, MessageSummaryDto } from '@mahoshojo/contracts/messages';

import { requestMessagesRoute } from '../../platform/messages-bridge';
import { DesktopCloudError, type InvokeFn } from '../../platform/cloud-bridge';

/**
 * 消息中心的 renderer 适配层（D5.1d-1）。
 *
 * native 只透传「HTTP 状态 + JSON 正文」，业务形状由这里按
 * `@mahoshojo/contracts/messages` 的 schema 校验——校验失败与非 2xx 一样
 * 投影为「消息服务不可用」，绝不把脏数据喂给页面/顶栏（不伪造未读数）。
 *
 * 会话收束是这里的第二条职责（d-1-r1）：`/api/messages*` 允许匿名访问——
 * 服务端不认可当前 cookie 时不回 401，而是回 `200 + isAuthenticated:false`。
 * Desktop 的登录态调用把这类响应与 HTTP 401、native `not-authenticated`
 * 统一投影为 `MessagesSessionRejectedError`，由调用方触发一次
 * `sessionStore.refresh()` 收束身份投影，而不是把「匿名视图」缓存成
 * 已登录账号的未读数。
 */

/** 消息业务请求失败：HTTP 非 2xx，或正文不满足契约（`status === 0`）。 */
export class MessagesApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MessagesApiError';
    this.status = status;
  }
}

/**
 * 会话被服务端拒收（d-1-r1）。三种观察点同一语义：
 *
 * - Required 路由本地无凭据：native `DesktopCloudError('not-authenticated')`；
 * - Required 路由 HTTP 401：native 已清凭据，响应原样透传到这层；
 * - 登录态预期响应 `isAuthenticated:false`：服务端不认 cookie 但路由允许匿名。
 *
 * 调用方用 `isMessagesSessionRejected` 判定，命中即触发一次
 * `sessionStore.refresh()`——会话结论仍归 `DesktopCloudSessionStore` 统一下。
 */
export class MessagesSessionRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessagesSessionRejectedError';
  }
}

export const isMessagesSessionRejected = (cause: unknown): boolean =>
  cause instanceof MessagesSessionRejectedError ||
  (cause instanceof DesktopCloudError && cause.code === 'not-authenticated') ||
  (cause instanceof MessagesApiError && cause.status === 401);

const requireOk = (status: number, context: string): void => {
  // 401 = 服务端否认当前凭据（Required 路由 native 已清本地会话）：
  // 归入 session-rejected 统一收束，不混同于普通业务失败。
  if (status === 401) {
    throw new MessagesSessionRejectedError(`${context}：服务端返回 401`);
  }
  if (status < 200 || status > 299) {
    throw new MessagesApiError(status, `${context}：服务端返回 ${status}`);
  }
};

/** 顶栏/个人页共用的未读摘要（Required 路由——无本地凭据 fail-closed）。 */
export const readMessagesSummary = async (invoke: InvokeFn): Promise<MessageSummaryDto> => {
  const response = await requestMessagesRoute(invoke, { routeId: 'messages.summary' });
  requireOk(response.status, '消息摘要加载失败');
  const parsed = MessageSummarySchema.safeParse(response.body);
  if (!parsed.success) {
    throw new MessagesApiError(0, '消息摘要响应不符合契约');
  }
  // 服务端允许匿名访问该路由（`isAuthenticated:false` + 零计数）；Desktop
  // 只在本机已有账号时发起——拿到匿名摘要说明服务端已不认当前凭据，按会话
  // 被拒收束，绝不把「匿名零未读」写进该账号的摘要缓存。
  if (parsed.data.isAuthenticated !== true) {
    throw new MessagesSessionRejectedError('消息摘要返回匿名身份：服务端会话已失效');
  }
  return parsed.data;
};

/** 消息列表（Optional 路由——未登录仍可看全站；unread/direct 由服务端裁决）。 */
export const listMessages = async (
  invoke: InvokeFn,
  input: {
    readonly filter: MessageFilter;
    readonly cursor?: string | null;
    readonly limit?: number;
    /**
     * 登录态调用置 true：响应回 `isAuthenticated:false` 即服务端不认当前
     * 凭据（Optional 路由匿名仍回 200），同样按会话被拒收束。
     */
    readonly expectAuthenticated?: boolean;
  },
): Promise<MessageListDto> => {
  const query: Record<string, string> = {
    filter: input.filter,
    limit: String(input.limit ?? 20),
  };
  if (input.cursor) query.cursor = input.cursor;
  const response = await requestMessagesRoute(invoke, {
    routeId: 'messages.list',
    query,
  });
  requireOk(response.status, '消息列表加载失败');
  const parsed = MessageListSchema.safeParse(response.body);
  if (!parsed.success) {
    throw new MessagesApiError(0, '消息列表响应不符合契约');
  }
  if (input.expectAuthenticated === true && parsed.data.isAuthenticated !== true) {
    throw new MessagesSessionRejectedError('消息列表返回匿名身份：服务端会话已失效');
  }
  return parsed.data;
};

/** 标记定向消息已读（Required 路由）。 */
export const markMessagesRead = async (
  invoke: InvokeFn,
  ids: readonly string[],
): Promise<void> => {
  const response = await requestMessagesRoute(invoke, {
    routeId: 'messages.read',
    body: { ids: [...ids] },
  });
  requireOk(response.status, '标记已读失败');
};

/** 全部标记已读（Required 路由——同时推进全站游标）。 */
export const markAllMessagesRead = async (invoke: InvokeFn): Promise<void> => {
  const response = await requestMessagesRoute(invoke, { routeId: 'messages.read-all' });
  requireOk(response.status, '全部已读失败');
};
