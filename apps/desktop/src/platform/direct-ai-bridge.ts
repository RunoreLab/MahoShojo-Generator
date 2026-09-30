import { Channel } from '@tauri-apps/api/core';

import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';

import { DesktopBridgeError } from './desktop-bridge';

/**
 * `AiExecutionPort` 的桌面实现。
 *
 * 关键取舍：native 侧只实现**流式**通路，`execute()` 通过收集流得到结果。这样"只有一条执行
 * 通路"成立，取消、超时、限流、协议校验都只需要在一处正确实现，而
 * `collectAiStreamResult` 已经把这些不变式编码好了。
 */

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

interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface DesktopAiExecutionOptions {
  invoke: InvokeFn;
  profileId: string;
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
 * 这里不传、也无法传任何 endpoint 或 secret。
 */
export const openDirectAiStream = (
  options: DesktopAiExecutionOptions,
  request: { requestId: string; contractVersion: number },
  onEvent: (event: AiStreamEvent) => void,
): Promise<void> => {
  const channel = new Channel<AiStreamEvent>();
  channel.onmessage = onEvent;

  return options
    .invoke(STREAM_DIRECT_AI_COMMAND, {
      profileId: options.profileId,
      request,
      onEvent: channel,
    })
    .then(() => undefined)
    .catch((cause: unknown) => {
      throw toAiError(STREAM_DIRECT_AI_COMMAND, cause);
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
