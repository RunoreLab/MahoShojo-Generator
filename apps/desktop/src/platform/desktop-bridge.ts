/**
 * Desktop 渲染层与 Rust 之间的唯一通道。
 *
 * 这一层刻意保持极薄：它只负责把命令名与参数递给 Tauri，并把失败归一成可诊断错误。
 * 它不提供任何 endpoint、路径、SQL 或通用 fetch 形态的能力，因为那些必须由 Rust 侧
 * 依据已保存的 Profile 与应用自有路径决定（见 SPEC-desktop-client-v1 DESK-030 / DESK-053）。
 */

/**
 * 应用自有 command 的调用名。
 *
 * 注意不使用 `plugin:<name>|` 前缀：那是 Tauri 插件的命名空间，本项目在 V1 不引入任何
 * 插件，可信能力全部是本应用自己的 `#[tauri::command]`。
 */
export const DESKTOP_RUNTIME_INFO_COMMAND = 'desktop_runtime_info' as const;

export interface DesktopRuntimeInfo {
  readonly appVersion: string;
  readonly tauriVersion: string;
  readonly os: string;
  readonly arch: string;
  readonly packaged: boolean;
}

export class DesktopBridgeError extends Error {
  readonly command: string;

  constructor(command: string, message: string) {
    super(message);
    this.name = 'DesktopBridgeError';
    this.command = command;
  }
}

const isNonBlankString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * 对 Rust 返回的运行时自述做 fail-closed 归一。
 *
 * renderer 不信任 IPC 返回值：字段缺失或类型不符时直接失败，而不是用默认值把
 * 「本地运行时信息不可用」伪装成「运行正常」。
 */
export const normalizeDesktopRuntimeInfo = (raw: unknown): DesktopRuntimeInfo => {
  if (raw === null || typeof raw !== 'object') {
    throw new DesktopBridgeError(
      DESKTOP_RUNTIME_INFO_COMMAND,
      'desktop runtime info must be an object',
    );
  }

  const candidate = raw as Record<string, unknown>;
  const required = ['appVersion', 'tauriVersion', 'os', 'arch'] as const;
  for (const key of required) {
    if (!isNonBlankString(candidate[key])) {
      throw new DesktopBridgeError(
        DESKTOP_RUNTIME_INFO_COMMAND,
        `desktop runtime info field "${key}" must be a non-blank string`,
      );
    }
  }

  if (typeof candidate.packaged !== 'boolean') {
    throw new DesktopBridgeError(
      DESKTOP_RUNTIME_INFO_COMMAND,
      'desktop runtime info field "packaged" must be a boolean',
    );
  }

  return {
    appVersion: candidate.appVersion as string,
    tauriVersion: candidate.tauriVersion as string,
    os: candidate.os as string,
    arch: candidate.arch as string,
    packaged: candidate.packaged,
  };
};

interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export const readDesktopRuntimeInfo = async (
  invoke: InvokeFn,
): Promise<DesktopRuntimeInfo> => {
  let raw: unknown;
  try {
    raw = await invoke(DESKTOP_RUNTIME_INFO_COMMAND);
  } catch (cause) {
    throw new DesktopBridgeError(
      DESKTOP_RUNTIME_INFO_COMMAND,
      cause instanceof Error ? cause.message : 'desktop runtime info command failed',
    );
  }

  return normalizeDesktopRuntimeInfo(raw);
};
