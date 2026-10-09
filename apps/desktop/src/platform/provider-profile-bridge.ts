import {
  DirectProviderExecutionProfileSchema,
  DirectProviderProfileV1Schema,
  toDirectProviderExecutionProfile,
  type DirectProviderExecutionProfile,
  type DirectProviderProfileV1,
} from '@mahoshojo/contracts/provider-profile';

import { DesktopBridgeError } from './desktop-bridge';

/**
 * Provider Profile 的渲染层桥接。
 *
 * 职责边界（`ADR-desktop-tauri-v1` 第 7 条）：记录组装与完整校验留在 TypeScript，native 侧
 * 只按 id 存取 opaque 文档。因此这里的顺序是固定的：
 *
 * 1. 用 `DirectProviderProfileV1Schema` 校验完整文档（跨字段规则在这一步生效）；
 * 2. 投影成 native 真正需要的窄字段；
 * 3. 调用 `validate_provider_execution_profile` 让 native 侧独立再验一次；
 * 4. 两边都通过才落盘。
 *
 * 落盘的文档始终是**完整** Profile，而不是投影：native 侧执行时需要自己从完整文档里解析，
 * 投影只用于"保存前先让 native 表态"这一步。
 */

export const SAVE_PROVIDER_PROFILE_COMMAND = 'save_provider_profile' as const;
export const LIST_PROVIDER_PROFILE_IDS_COMMAND = 'list_provider_profile_ids' as const;
export const GET_PROVIDER_PROFILE_COMMAND = 'get_provider_profile' as const;
export const DELETE_PROVIDER_PROFILE_COMMAND = 'delete_provider_profile' as const;
export const VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND =
  'validate_provider_execution_profile' as const;

export class DesktopProviderProfileError extends Error {
  readonly command: string;
  readonly code: string;

  constructor(command: string, code: string, message: string) {
    super(`${command}: ${message}`);
    this.name = 'DesktopProviderProfileError';
    this.command = command;
    this.code = code;
  }
}

interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

// 只透传原生稳定代码，不展示反序列化文本、SQL、路径或第三方消息。
const NATIVE_ERROR_CODES = new Set([
  'store-unavailable', 'invalid-document', 'document-too-large', 'index-mismatch',
  'record-tombstoned', 'transition-mismatch', 'record-missing', 'non-monotonic-timestamp',
  'invalid-query', 'maintenance-busy', 'store-failure',
  'provider-profile-malformed', 'provider-profile-unsupported-adapter',
  'provider-profile-invalid-base-url', 'provider-profile-insecure-base-url',
  'provider-profile-project-owned-endpoint', 'provider-profile-invalid-header',
  'provider-profile-secret-header-overlap', 'provider-profile-invalid-secret-ref',
]);

/** Tauri 在进入命令前就可能拒绝参数；这不是 SQLite 的 store-failure。 */
const toBridgeError = (command: string, cause: unknown): DesktopProviderProfileError => {
  if (cause !== null && typeof cause === 'object' && 'code' in cause
    && typeof cause.code === 'string' && NATIVE_ERROR_CODES.has(cause.code)) {
    return new DesktopProviderProfileError(command, cause.code, `本机操作失败（${cause.code}）`);
  }
  const raw = typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : '';
  const code = /invalid args?|missing required key|expected (?:a )?string/iu.test(raw)
    ? 'ipc-invalid-arguments' : 'ipc-call-failed';
  return new DesktopProviderProfileError(command, code, `本机通信失败（${code}）`);
};

const assertNativeAccepts = (
  command: string,
  echoed: unknown,
  expected: DirectProviderExecutionProfile,
): void => {
  // native 侧原样回显它解析出的投影。若两边对同一份文档的理解不同（字段被丢、命名不同、
  // 或 native 悄悄放宽了规则），这里必须失败而不是继续落盘。
  const parsed = DirectProviderExecutionProfileSchema.safeParse(echoed);
  if (!parsed.success) {
    throw new DesktopProviderProfileError(
      command,
      'provider-profile-mismatch',
      'native side returned a profile projection this client cannot read',
    );
  }
  // Rust 的 header map 使用 BTreeMap；键插入顺序不是 wire 的业务语义。
  // 两侧均已通过 strict schema，因此只做 JSON 对象键排序，不删字段、不转换值。
  const canonical = (value: DirectProviderExecutionProfile): string => JSON.stringify(
    value,
    (_key, entry: unknown) => entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
      : entry,
  );
  if (canonical(parsed.data) !== canonical(expected)) {
    throw new DesktopProviderProfileError(
      command,
      'provider-profile-mismatch',
      'native side derived a different execution profile than the client',
    );
  }
};

export const parseProviderProfileDocument = (document: unknown): DirectProviderProfileV1 => {
  const parsed = DirectProviderProfileV1Schema.safeParse(document);
  if (!parsed.success) {
    throw new DesktopBridgeError(
      VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND,
      'provider profile document failed client-side validation',
    );
  }
  return parsed.data;
};

/**
 * 保存前的完整校验：schema → 投影 → native 回显比对。不落盘。
 *
 * 单独导出是为了让调用方能在写凭据**之前**先确认 Profile 会被接受——否则编辑既有
 * 连接时会出现「凭据已更新但 Profile 保存失败」的部分成功窗口，旧 Profile 会静默开始
 * 使用新 Key。
 */
export const validateProviderExecutionProfile = async (
  invoke: InvokeFn,
  document: DirectProviderProfileV1,
): Promise<DirectProviderProfileV1> => {
  const validated = parseProviderProfileDocument(document);
  const projection = toDirectProviderExecutionProfile(validated);

  let echoed: unknown;
  try {
    echoed = await invoke(VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND, {
      document: JSON.stringify(projection),
    });
  } catch (cause) {
    throw toBridgeError(VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND, cause);
  }
  assertNativeAccepts(VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND, echoed, projection);
  return validated;
};

export const saveProviderProfile = async (
  invoke: InvokeFn,
  document: DirectProviderProfileV1,
): Promise<void> => {
  const validated = await validateProviderExecutionProfile(invoke, document);

  try {
    await invoke(SAVE_PROVIDER_PROFILE_COMMAND, {
      document: JSON.stringify(validated),
      updatedAt: validated.updatedAt,
    });
  } catch (cause) {
    throw toBridgeError(SAVE_PROVIDER_PROFILE_COMMAND, cause);
  }
};

export const listProviderProfileIds = async (invoke: InvokeFn): Promise<string[]> => {
  let result: unknown;
  try {
    result = await invoke(LIST_PROVIDER_PROFILE_IDS_COMMAND);
  } catch (cause) {
    throw toBridgeError(LIST_PROVIDER_PROFILE_IDS_COMMAND, cause);
  }
  if (!Array.isArray(result) || result.some((id) => typeof id !== 'string')) {
    throw new DesktopBridgeError(
      LIST_PROVIDER_PROFILE_IDS_COMMAND,
      'provider profile id list must be an array of strings',
    );
  }
  return result as string[];
};

export const getProviderProfile = async (
  invoke: InvokeFn,
  profileId: string,
): Promise<DirectProviderProfileV1 | null> => {
  let result: unknown;
  try {
    result = await invoke(GET_PROVIDER_PROFILE_COMMAND, { profileId });
  } catch (cause) {
    throw toBridgeError(GET_PROVIDER_PROFILE_COMMAND, cause);
  }
  if (result === null) return null;
  if (typeof result !== 'string') {
    throw new DesktopProviderProfileError(GET_PROVIDER_PROFILE_COMMAND, 'ipc-invalid-response', '本机返回的配置文档类型不正确');
  }
  let document: unknown;
  try {
    document = JSON.parse(result);
  } catch {
    throw new DesktopProviderProfileError(GET_PROVIDER_PROFILE_COMMAND, 'invalid-document', '已保存的配置不是有效 JSON');
  }
  const parsed = DirectProviderProfileV1Schema.safeParse(document);
  if (!parsed.success) {
    throw new DesktopProviderProfileError(GET_PROVIDER_PROFILE_COMMAND, 'invalid-document', '已保存的配置未通过校验');
  }
  return parsed.data;
};

export const deleteProviderProfile = async (
  invoke: InvokeFn,
  profileId: string,
): Promise<void> => {
  try {
    await invoke(DELETE_PROVIDER_PROFILE_COMMAND, { profileId });
  } catch (cause) {
    throw toBridgeError(DELETE_PROVIDER_PROFILE_COMMAND, cause);
  }
};
