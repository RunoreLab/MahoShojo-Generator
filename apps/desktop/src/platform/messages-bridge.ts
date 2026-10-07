import {
  DesktopMessagesRequestSchema,
  DesktopMessagesResponseSchema,
} from '@mahoshojo/contracts/desktop-cloud';
import type {
  DesktopMessagesRequest,
  DesktopMessagesResponse,
} from '@mahoshojo/contracts/desktop-cloud';

import { DesktopCloudError, toCloudError, type InvokeFn } from './cloud-bridge';

/**
 * 消息中心云端通路的 renderer 薄桥（D5.1d-1）。
 *
 * 与 `card-library-bridge` 同一条窄边界：调用方给 `routeId` + `query` +
 * `body`，method/path/会话 cookie 由 native 路由表注入。请求与返回都过
 * `desktop-cloud` 契约 schema——renderer 侧非法输入在发出 IPC 前就被拒绝，
 * native 返回非法载荷抛出 `DesktopCloudError('bridge-invalid')`。
 */

export const MESSAGES_REQUEST_COMMAND = 'cloud_messages_request' as const;

/**
 * 发起一次消息中心请求。
 *
 * - `DesktopCloudError('not-authenticated')`：Required 路由（summary/read/
 *   read-all）在无会话时 fail-closed，未产生网络请求；
 * - 传输/上游失败：`network-error` / `server-unavailable` 等原样透传；
 * - 业务非 2xx 不是异常——`status` + `body` 原样返回给调用方按业务处理。
 */
export const requestMessagesRoute = async (
  invoke: InvokeFn,
  request: DesktopMessagesRequest,
): Promise<DesktopMessagesResponse> => {
  const parsedRequest = DesktopMessagesRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    throw new DesktopCloudError(
      MESSAGES_REQUEST_COMMAND,
      'invalid-request',
      '消息请求不符合 desktop-cloud 契约',
    );
  }

  let raw: unknown;
  try {
    raw = await invoke(MESSAGES_REQUEST_COMMAND, { request: parsedRequest.data });
  } catch (cause) {
    throw toCloudError(MESSAGES_REQUEST_COMMAND, cause);
  }

  const parsed = DesktopMessagesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DesktopCloudError(
      MESSAGES_REQUEST_COMMAND,
      'bridge-invalid',
      `native 返回不符合 desktop-cloud 契约（${MESSAGES_REQUEST_COMMAND}）`,
    );
  }
  return parsed.data;
};
