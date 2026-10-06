import {
  DesktopExternalLinkErrorCodeSchema,
  DesktopOpenExternalUrlRequestSchema,
  MAX_DESKTOP_EXTERNAL_URL_LENGTH,
} from '@mahoshojo/contracts/desktop-ipc';
import type { DesktopExternalLinkErrorCode } from '@mahoshojo/contracts/desktop-ipc';

/**
 * 受控外链的 renderer 侧薄桥（D5.1-P1，`DESK-PARITY-003` / `DESK-ONLINE-014`）。
 *
 * 只有一条命令：把一个 URL 交给 native，由它完成协议/凭据/结构校验后交给系统浏览器。
 * 「固定产品链接不确认、内容链接默认确认」是 UI 层策略，不在这条命令里——native
 * 校验对两者一视同仁，确认与否不改变安全边界。
 */

export const OPEN_EXTERNAL_URL_COMMAND = 'open_external_url' as const;

export interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export class DesktopExternalLinkError extends Error {
  readonly command: string;
  readonly code: DesktopExternalLinkErrorCode | 'bridge-invalid';

  constructor(command: string, code: DesktopExternalLinkErrorCode | 'bridge-invalid', message: string) {
    super(message);
    this.name = 'DesktopExternalLinkError';
    this.command = command;
    this.code = code;
  }
}

const toExternalLinkError = (cause: unknown): DesktopExternalLinkError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    const parsedCode = DesktopExternalLinkErrorCodeSchema.safeParse(code);
    return new DesktopExternalLinkError(
      OPEN_EXTERNAL_URL_COMMAND,
      parsedCode.success ? parsedCode.data : 'open-failed',
      message,
    );
  }
  if (cause instanceof Error) {
    return new DesktopExternalLinkError(OPEN_EXTERNAL_URL_COMMAND, 'open-failed', cause.message);
  }
  return new DesktopExternalLinkError(OPEN_EXTERNAL_URL_COMMAND, 'open-failed', 'external link command failed');
};

/**
 * 请求系统浏览器打开 `url`。
 *
 * renderer 端先做一层廉价预检（明显非法的输入根本不进 IPC），但 native 校验
 * 才是边界——预检只决定「值不值得发」，不决定「能不能开」。
 */
export const openExternalUrl = async (invoke: InvokeFn, url: string): Promise<void> => {
  const request = DesktopOpenExternalUrlRequestSchema.safeParse({ url });
  if (!request.success) {
    throw new DesktopExternalLinkError(OPEN_EXTERNAL_URL_COMMAND, 'invalid-url', 'URL 为空或超出长度上限');
  }

  // 预检与 native 同一规则：http/https、无凭据。这里提前失败可以避免一次
  // 注定被拒绝的往返；它绝不能替代 native 侧校验。
  try {
    const parsed = new URL(url);
    const isWebScheme = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    // `username`/`password` 无凭据时都是空串（不是 null）。
    const hasCredentials = parsed.username !== '' || parsed.password !== '';
    if (!isWebScheme || parsed.hostname === '' || hasCredentials) {
      throw new DesktopExternalLinkError(OPEN_EXTERNAL_URL_COMMAND, 'invalid-url', '仅允许 http/https 且不得携带凭据的 URL');
    }
  } catch (error) {
    if (error instanceof DesktopExternalLinkError) throw error;
    throw new DesktopExternalLinkError(OPEN_EXTERNAL_URL_COMMAND, 'invalid-url', '无法解析为合法 URL');
  }

  try {
    await invoke(OPEN_EXTERNAL_URL_COMMAND, { url: request.data.url });
  } catch (cause) {
    throw toExternalLinkError(cause);
  }
};

export { MAX_DESKTOP_EXTERNAL_URL_LENGTH };
