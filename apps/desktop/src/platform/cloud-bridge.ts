import { Channel } from '@tauri-apps/api/core';
import {
  DesktopCloudErrorCodeSchema,
  DesktopCloudLoginBeginResponseSchema,
  DesktopCloudLoginOutcomeSchema,
  DesktopCloudOnlineStatusSchema,
  DesktopCloudSessionStatusSchema,
  DesktopCloudSignOutResultSchema,
  DesktopHostedGenerateRequestSchema,
  HostedGenerationEventSchema,
} from '@mahoshojo/contracts/desktop-cloud';
import type {
  DesktopCloudErrorCode,
  DesktopCloudLoginBeginResponse,
  DesktopCloudLoginOutcome,
  DesktopCloudOnlineStatus,
  DesktopCloudSessionStatus,
  DesktopCloudSignOutResult,
  DesktopHostedGenerateRequest,
  HostedGenerationEvent,
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
export const STREAM_HOSTED_AI_COMMAND = 'stream_hosted_ai' as const;
export const CANCEL_HOSTED_AI_COMMAND = 'cancel_hosted_ai' as const;

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

export const toCloudError = (command: string, cause: unknown): DesktopCloudError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    // 错误码以共享 contract 为唯一事实源，不再手抄列表；未知 code 归一为
    // internal-error，已声明的 code（invalid-request 等）原样透出。
    const parsedCode = DesktopCloudErrorCodeSchema.safeParse(code);
    return new DesktopCloudError(
      command,
      parsedCode.success ? parsedCode.data : 'internal-error',
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

/** Channel 的最小结构。Tauri 的 `Channel` 满足它。 */
export interface HostedAiChannel {
  onmessage?: (event: HostedGenerationEvent) => void;
}

export interface StreamHostedAiOptions {
  /** Channel 工厂，默认使用 Tauri 的 `Channel`；测试可注入替身（同 direct-ai-bridge）。 */
  createChannel?: () => HostedAiChannel;
}

/**
 * 打开一次 hosted 生成流（当前只开放系统默认通道）。
 *
 * renderer 只给「路由标识 + 非秘密业务载荷」：endpoint、会话 cookie 与凭据注入
 * 全部在 native 侧；服务器 BYOK 在 native Provider 绑定落地前没有 IPC 通道
 * （DESK-093）。事件经 `HostedGenerationEventSchema` 过滤——未知名/非法载荷的
 * 事件不进入 UI，统一投影为一个 bridge-invalid error 事件。
 */
export const streamHostedAi = (
  invoke: InvokeFn,
  request: DesktopHostedGenerateRequest,
  onEvent: (event: HostedGenerationEvent) => void,
  options?: StreamHostedAiOptions,
): Promise<void> => {
  const parsedRequest = DesktopHostedGenerateRequestSchema.parse(request);
  const channel = (options?.createChannel ?? (() => new Channel<HostedGenerationEvent>()))();
  channel.onmessage = (raw) => {
    const parsed = HostedGenerationEventSchema.safeParse(raw);
    onEvent(
      parsed.success
        ? parsed.data
        : {
            event: 'error',
            data: { ok: false, code: 'bridge-invalid', message: 'native 推送了契约外事件' },
          },
    );
  };

  return invoke(STREAM_HOSTED_AI_COMMAND, {
    request: parsedRequest,
    onEvent: channel,
  })
    .then(() => undefined)
    .catch((cause: unknown) => {
      throw toCloudError(STREAM_HOSTED_AI_COMMAND, cause);
    });
};

/** 取消一次在途 hosted 生成；返回是否确有请求被取消。 */
export const cancelHostedAi = async (
  invoke: InvokeFn,
  requestId: string,
): Promise<boolean> => {
  let raw: unknown;
  try {
    raw = await invoke(CANCEL_HOSTED_AI_COMMAND, { requestId });
  } catch (cause) {
    throw toCloudError(CANCEL_HOSTED_AI_COMMAND, cause);
  }
  if (typeof raw !== 'boolean') {
    throw new DesktopBridgeError(CANCEL_HOSTED_AI_COMMAND, 'cancel result must be a boolean');
  }
  return raw;
};
