import {
  DesktopCardLibraryRequestSchema,
  DesktopCardLibraryResponseSchema,
} from '@mahoshojo/contracts/desktop-cloud';
import type {
  DesktopCardLibraryRequest,
  DesktopCardLibraryResponse,
} from '@mahoshojo/contracts/desktop-cloud';

import { DesktopCloudError, toCloudError, type InvokeFn } from './cloud-bridge';

/**
 * 数据卡库云端通路的 renderer 薄桥（D5.0e，`DESK-ONLINE-010`）。
 *
 * 只暴露一条固定路由窄命令：调用方给 `routeId` + `query` + `body`，
 * method/path/会话 cookie 由 native 路由表注入。请求与返回都过
 * `desktop-cloud` 契约 schema——renderer 侧非法输入在发出 IPC 前就被
 * 拒绝（与 native 的 fail-closed 双重收口），native 返回非法载荷则
 * 抛出 `DesktopCloudError('bridge-invalid')`，不会把脏响应喂给 UI。
 */

export const CARD_LIBRARY_REQUEST_COMMAND = 'cloud_card_library_request' as const;

/**
 * 发起一次数据卡库请求。
 *
 * - `DesktopCloudError('not-authenticated')`：Required 路由在无会话时
 *   fail-closed，未产生网络请求；
 * - 传输/上游失败：`network-error` / `server-unavailable` 等原样透传；
 * - 业务非 2xx 不是异常——`status` + `body` 原样返回给调用方按业务处理。
 */
export const requestCardLibraryRoute = async (
  invoke: InvokeFn,
  request: DesktopCardLibraryRequest,
): Promise<DesktopCardLibraryResponse> => {
  const parsedRequest = DesktopCardLibraryRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    throw new DesktopCloudError(
      CARD_LIBRARY_REQUEST_COMMAND,
      'invalid-request',
      '数据卡请求不符合 desktop-cloud 契约',
    );
  }

  let raw: unknown;
  try {
    raw = await invoke(CARD_LIBRARY_REQUEST_COMMAND, { request: parsedRequest.data });
  } catch (cause) {
    throw toCloudError(CARD_LIBRARY_REQUEST_COMMAND, cause);
  }

  const parsed = DesktopCardLibraryResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DesktopCloudError(
      CARD_LIBRARY_REQUEST_COMMAND,
      'bridge-invalid',
      `native 返回不符合 desktop-cloud 契约（${CARD_LIBRARY_REQUEST_COMMAND}）`,
    );
  }
  return parsed.data;
};
