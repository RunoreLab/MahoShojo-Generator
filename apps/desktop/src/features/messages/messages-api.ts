import { MessageListSchema, MessageSummarySchema } from '@mahoshojo/contracts/messages';
import type { MessageFilter, MessageListDto, MessageSummaryDto } from '@mahoshojo/contracts/messages';

import { requestMessagesRoute } from '../../platform/messages-bridge';
import type { InvokeFn } from '../../platform/cloud-bridge';

/**
 * 消息中心的 renderer 适配层（D5.1d-1）。
 *
 * native 只透传「HTTP 状态 + JSON 正文」，业务形状由这里按
 * `@mahoshojo/contracts/messages` 的 schema 校验——校验失败与非 2xx 一样
 * 投影为「消息服务不可用」，绝不把脏数据喂给页面/顶栏（不伪造未读数）。
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

const requireOk = (status: number, context: string): void => {
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
  return parsed.data;
};

/** 消息列表（Optional 路由——未登录仍可看全站；unread/direct 由服务端裁决）。 */
export const listMessages = async (
  invoke: InvokeFn,
  input: { readonly filter: MessageFilter; readonly cursor?: string | null; readonly limit?: number },
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
