import {
  DesktopCloudLoginBeginResponseSchema,
  DesktopCloudLoginOutcomeSchema,
  DesktopCloudOnlineStatusSchema,
  DesktopCloudSessionStatusSchema,
  DesktopCloudSignOutResultSchema,
} from '@mahoshojo/contracts/desktop-cloud';
import type {
  DesktopCloudErrorCode,
  DesktopCloudLoginBeginResponse,
  DesktopCloudLoginOutcome,
  DesktopCloudOnlineStatus,
  DesktopCloudSessionStatus,
  DesktopCloudSignOutResult,
} from '@mahoshojo/contracts/desktop-cloud';

import { DesktopBridgeError } from './desktop-bridge';

/**
 * 项目服务云通路的 renderer 侧薄桥（D5.0c，`DESK-090..094`）。
 *
 * 只暴露六条窄命令；所有返回都过 `desktop-cloud` 契约 schema——IPC 边界上的
 * 非法载荷直接变成 `DesktopCloudError('invalid-response')`，而不是被 UI 信任。
 * 会话 cookie、grant code、PKCE verifier 从定义上就不存在于这些类型里。
 */

export const CLOUD_LOGIN_BEGIN_COMMAND = 'cloud_login_begin' as const;
export const CLOUD_LOGIN_AWAIT_COMMAND = 'cloud_login_await' as const;
export const CLOUD_LOGIN_CANCEL_COMMAND = 'cloud_login_cancel' as const;
export const CLOUD_AUTH_STATUS_COMMAND = 'cloud_auth_status' as const;
export const CLOUD_SIGN_OUT_COMMAND = 'cloud_sign_out' as const;
export const CLOUD_ONLINE_STATUS_COMMAND = 'cloud_online_status' as const;

export interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export class DesktopCloudError extends Error {
  readonly command: string;
  readonly code: DesktopCloudErrorCode | 'bridge-invalid';

  constructor(command: string, code: DesktopCloudErrorCode | 'bridge-invalid', message: string) {
    super(message);
    this.name = 'DesktopCloudError';
    this.command = command;
    this.code = code;
  }
}

const isDesktopCloudErrorCode = (value: string): value is DesktopCloudErrorCode =>
  [
    'not-authenticated',
    'flow-not-found',
    'flow-in-progress',
    'cancelled',
    'timeout',
    'state-mismatch',
    'protocol-mismatch',
    'network-error',
    'server-unavailable',
    'invalid-response',
    'storage-unavailable',
    'internal-error',
  ].includes(value);

const toCloudError = (command: string, cause: unknown): DesktopCloudError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    return new DesktopCloudError(
      command,
      isDesktopCloudErrorCode(code) ? code : 'internal-error',
      message,
    );
  }
  if (cause instanceof Error) {
    return new DesktopCloudError(command, 'internal-error', cause.message);
  }
  return new DesktopCloudError(command, 'internal-error', 'cloud command failed');
};

const parseResult = <T>(
  command: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  raw: unknown,
): T => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    throw new DesktopCloudError(
      command,
      'bridge-invalid',
      `native 返回不符合 desktop-cloud 契约的载荷（${command}）`,
    );
  }
  return parsed.data;
};

/** 开始一次登录：native 打开系统浏览器授权页并返回 flowId 与授权 URL（手动备用）。 */
export const beginCloudLogin = async (
  invoke: InvokeFn,
): Promise<DesktopCloudLoginBeginResponse> => {
  let raw: unknown;
  try {
    raw = await invoke(CLOUD_LOGIN_BEGIN_COMMAND);
  } catch (cause) {
    throw toCloudError(CLOUD_LOGIN_BEGIN_COMMAND, cause);
  }
  return parseResult(
    CLOUD_LOGIN_BEGIN_COMMAND,
    DesktopCloudLoginBeginResponseSchema,
    raw,
  );
};

/**
 * 等待登录流程完成。返回值是**结果**而不是异常：failed/cancelled 是正常终态，
 * 只有 IPC/契约级异常才抛 `DesktopCloudError`。
 */
export const awaitCloudLogin = async (
  invoke: InvokeFn,
  flowId: string,
): Promise<DesktopCloudLoginOutcome> => {
  let raw: unknown;
  try {
    raw = await invoke(CLOUD_LOGIN_AWAIT_COMMAND, { flowId });
  } catch (cause) {
    throw toCloudError(CLOUD_LOGIN_AWAIT_COMMAND, cause);
  }
  return parseResult(CLOUD_LOGIN_AWAIT_COMMAND, DesktopCloudLoginOutcomeSchema, raw);
};

/** 取消进行中的登录流程；返回是否确有一个流程被取消。 */
export const cancelCloudLogin = async (
  invoke: InvokeFn,
  flowId: string,
): Promise<boolean> => {
  let raw: unknown;
  try {
    raw = await invoke(CLOUD_LOGIN_CANCEL_COMMAND, { flowId });
  } catch (cause) {
    throw toCloudError(CLOUD_LOGIN_CANCEL_COMMAND, cause);
  }
  if (typeof raw !== 'boolean') {
    throw new DesktopBridgeError(CLOUD_LOGIN_CANCEL_COMMAND, 'cancel result must be a boolean');
  }
  return raw;
};

/** 查询账号会话状态（含服务端确认；unreachable 不代表已注销）。 */
export const readCloudAuthStatus = async (
  invoke: InvokeFn,
): Promise<DesktopCloudSessionStatus> => {
  let raw: unknown;
  try {
    raw = await invoke(CLOUD_AUTH_STATUS_COMMAND);
  } catch (cause) {
    throw toCloudError(CLOUD_AUTH_STATUS_COMMAND, cause);
  }
  return parseResult(CLOUD_AUTH_STATUS_COMMAND, DesktopCloudSessionStatusSchema, raw);
};

/** 登出：本地凭据无条件删除；`revoked` 反映服务端会话是否同步作废。 */
export const signOutCloud = async (
  invoke: InvokeFn,
): Promise<DesktopCloudSignOutResult> => {
  let raw: unknown;
  try {
    raw = await invoke(CLOUD_SIGN_OUT_COMMAND);
  } catch (cause) {
    throw toCloudError(CLOUD_SIGN_OUT_COMMAND, cause);
  }
  return parseResult(CLOUD_SIGN_OUT_COMMAND, DesktopCloudSignOutResultSchema, raw);
};

/** 主动使用在线能力时的探测：服务可达性 + hosted 契约版本兼容性。 */
export const probeCloudOnlineStatus = async (
  invoke: InvokeFn,
): Promise<DesktopCloudOnlineStatus> => {
  let raw: unknown;
  try {
    raw = await invoke(CLOUD_ONLINE_STATUS_COMMAND);
  } catch (cause) {
    throw toCloudError(CLOUD_ONLINE_STATUS_COMMAND, cause);
  }
  return parseResult(CLOUD_ONLINE_STATUS_COMMAND, DesktopCloudOnlineStatusSchema, raw);
};
