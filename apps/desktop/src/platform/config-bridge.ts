import {
  DesktopConfigErrorCodeSchema,
  DesktopConfigReadResultSchema,
  DesktopConfigWriteResultSchema,
} from '@mahoshojo/contracts/desktop-ipc';
import type {
  DesktopConfigErrorCode,
  DesktopConfigReadResult,
  DesktopConfigWriteRequest,
  DesktopConfigWriteResult,
} from '@mahoshojo/contracts/desktop-ipc';

/**
 * 人工配置 `config.json` 的 renderer 侧薄桥（D5.1-S2，`DESK-SET-004`/`005`）。
 *
 * 三条窄命令：读（有界 + revision）、写（expectedRevision 复核 + 原子替换）、
 * 打开固定配置目录。renderer 拿不到路径参数——文件在哪、叫什么完全由
 * native 决定。字段域语义（登记/默认/降级/诊断）在
 * `@mahoshojo/contracts/desktop-config`，不在这条桥里。
 */

export const DESKTOP_CONFIG_READ_COMMAND = 'desktop_config_read' as const;
export const DESKTOP_CONFIG_WRITE_COMMAND = 'desktop_config_write' as const;
export const DESKTOP_CONFIG_OPEN_DIRECTORY_COMMAND = 'desktop_config_open_directory' as const;

export interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export class DesktopConfigError extends Error {
  readonly command: string;
  readonly code: DesktopConfigErrorCode | 'bridge-invalid';

  constructor(command: string, code: DesktopConfigErrorCode | 'bridge-invalid', message: string) {
    super(message);
    this.name = 'DesktopConfigError';
    this.command = command;
    this.code = code;
  }
}

const toConfigError = (command: string, cause: unknown): DesktopConfigError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    const parsedCode = DesktopConfigErrorCodeSchema.safeParse(code);
    return new DesktopConfigError(
      command,
      parsedCode.success ? parsedCode.data : 'internal-error',
      message,
    );
  }
  if (cause instanceof Error) {
    return new DesktopConfigError(command, 'internal-error', cause.message);
  }
  return new DesktopConfigError(command, 'internal-error', 'config command failed');
};

const parseResult = <T>(
  command: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  raw: unknown,
): T => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    throw new DesktopConfigError(
      command,
      'bridge-invalid',
      `native 返回不符合 desktop-ipc 契约的载荷（${command}）`,
    );
  }
  return parsed.data;
};

/** 固定 `config.json` 的有界读取：文件状态（missing/ok/oversized/invalid-utf8）+ revision。 */
export const readDesktopConfig = async (invoke: InvokeFn): Promise<DesktopConfigReadResult> => {
  let raw: unknown;
  try {
    raw = await invoke(DESKTOP_CONFIG_READ_COMMAND);
  } catch (cause) {
    throw toConfigError(DESKTOP_CONFIG_READ_COMMAND, cause);
  }
  return parseResult(DESKTOP_CONFIG_READ_COMMAND, DesktopConfigReadResultSchema, raw);
};

/**
 * 携带读取时的 `expectedRevision` 写整份内容；`null` 表示「文件必须仍不存在」。
 * 外部改动返回 `config-conflict`——调用方据此保留双方并提示重载，不重试、不覆盖。
 */
export const writeDesktopConfig = async (
  invoke: InvokeFn,
  request: DesktopConfigWriteRequest,
): Promise<DesktopConfigWriteResult> => {
  let raw: unknown;
  try {
    raw = await invoke(DESKTOP_CONFIG_WRITE_COMMAND, { request });
  } catch (cause) {
    throw toConfigError(DESKTOP_CONFIG_WRITE_COMMAND, cause);
  }
  return parseResult(DESKTOP_CONFIG_WRITE_COMMAND, DesktopConfigWriteResultSchema, raw);
};

/** 打开固定的配置目录（必要时 native 先创建）。 */
export const openDesktopConfigDirectory = async (invoke: InvokeFn): Promise<void> => {
  try {
    await invoke(DESKTOP_CONFIG_OPEN_DIRECTORY_COMMAND);
  } catch (cause) {
    throw toConfigError(DESKTOP_CONFIG_OPEN_DIRECTORY_COMMAND, cause);
  }
};
