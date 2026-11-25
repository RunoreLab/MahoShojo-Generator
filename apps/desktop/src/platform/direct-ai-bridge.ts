import { DesktopProviderTargetSchema, type DesktopProviderTarget } from '@mahoshojo/contracts/provider-target';
import { Channel } from '@tauri-apps/api/core';
import { AiExecutionRequestSchema, type AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';

import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';

import { DesktopBridgeError } from './desktop-bridge';
import { invokeWithChannelDelivery, NativeChannelDeliveryError } from './native-channel-delivery';

/**
 * `AiExecutionPort` 的桌面实现。
 *
 * 关键取舍：native 侧只实现**流式**通路，`execute()` 通过收集流得到结果。这样"只有一条执行
 * 通路"成立，取消、超时、限流、协议校验都只需要在一处正确实现，而
 * `collectAiStreamResult` 已经把这些不变式编码好了。
 */

export const STREAM_TARGET_AI_COMMAND = 'stream_target_ai' as const;
export const STREAM_DIRECT_AI_COMMAND = 'stream_direct_ai' as const;
export const CANCEL_DIRECT_AI_COMMAND = 'cancel_direct_ai' as const;

export class DesktopAiError extends Error {
  readonly command: string;
  readonly code: string;

  constructor(command: string, code: string, message: string) {
    super(message);
    this.name = 'DesktopAiError';
    this.command = command;
    this.code = code;
  }
}

/** Closed local diagnostics only; never expose an arbitrary Native/provider message. */
export const desktopChannelDeliveryFailure = (cause: unknown): NativeChannelDeliveryError | undefined => {
  if (cause instanceof DesktopAiError && (cause.code === 'native-invoke-rejected' || cause.code === 'ipc-receipt-invalid'
    || cause.code === 'ipc-delivery-invalid' || cause.code === 'ipc-delivery-timeout')) return new NativeChannelDeliveryError(cause.code);
  return undefined;
};

interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** Channel 的最小结构。Tauri 的 `Channel` 满足它。 */
export interface DirectAiChannel {
  onmessage?: (event: AiStreamEvent) => void;
}

export interface DesktopAiExecutionOptions {
  invoke: InvokeFn;
  profileId: string;
  providerTarget?: DesktopProviderTarget;
  /**
   * Channel 工厂，默认使用 Tauri 的 `Channel`。
   *
   * 之所以留成可替换：真实 `Channel` 依赖 WebView 的 `window` 与 IPC internals，在 node
   * 测试环境下不存在。为了测流式交付顺序而引入整套 DOM 测试环境不划算，因此在 IPC
   * 边界注入替身，而不是伪造全局。
   */
  createChannel?: () => DirectAiChannel;
}

const toAiError = (command: string, cause: unknown): DesktopAiError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    return new DesktopAiError(command, code, message);
  }
  return new DesktopAiError(command, 'internal-error', 'Direct AI execution failed');
};

/**
 * 打开一次 Direct 流。
 *
 * `profileId` 是唯一的选择器：endpoint、header 与凭据都由 native 侧从本地库与凭据存储解析，
 * 这里不传、也无法传任何 endpoint 或 secret。请求里的 temperature 仍可表达业务默认，
 * Native 按保存 Profile 的协议能力在首次构造时投影：Messages 不发送 temperature，
 * 不因上游失败删参重试。thinking 暂无 Direct wire；旧偏好由配置层保留。
 */
export const openDirectAiStream = (
  options: DesktopAiExecutionOptions,
  request: AiExecutionRequest,
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> => {
  // 校验并复制完整 DTO；不能把业务请求缩减为事件身份，否则 native 无法反序列化。
  const parsedRequest = AiExecutionRequestSchema.parse(request);
  const channel = (options.createChannel ?? (() => new Channel<AiStreamEvent>()))();
  channel.onmessage = onEvent;

  const command = options.providerTarget ? STREAM_TARGET_AI_COMMAND : STREAM_DIRECT_AI_COMMAND;
  const selection = options.providerTarget ? { target: DesktopProviderTargetSchema.parse(options.providerTarget) } : { profileId: options.profileId };
  return invokeWithChannelDelivery(options.invoke, command, {
      ...selection,
      request: parsedRequest,
      onEvent: channel,
    }, parsedRequest.requestId, signal, (event) => { if (event.type === 'started') onEvent(event); })
    .catch((cause: unknown) => {
      throw toAiError(command, cause);
    });
};

export const cancelDirectAi = async (
  invoke: InvokeFn,
  requestId: string,
): Promise<boolean> => {
  let result: unknown;
  try {
    result = await invoke(CANCEL_DIRECT_AI_COMMAND, { requestId });
  } catch (cause) {
    throw toAiError(CANCEL_DIRECT_AI_COMMAND, cause);
  }
  if (typeof result !== 'boolean') {
    throw new DesktopBridgeError(
      CANCEL_DIRECT_AI_COMMAND,
      'cancel result must be a boolean',
    );
  }
  return result;
};
