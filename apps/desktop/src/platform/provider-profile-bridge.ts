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
    super(message);
    this.name = 'DesktopProviderProfileError';
    this.command = command;
    this.code = code;
  }
}

interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** 把 native 侧返回的失败归一成带稳定 code 的错误。未知形状一律 fail closed。 */
const toBridgeError = (command: string, cause: unknown): DesktopProviderProfileError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    return new DesktopProviderProfileError(command, code, message);
  }
  return new DesktopProviderProfileError(command, 'store-failure', 'local store call failed');
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
  if (JSON.stringify(parsed.data) !== JSON.stringify(expected)) {
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

export const saveProviderProfile = async (
  invoke: InvokeFn,
  document: DirectProviderProfileV1,
): Promise<void> => {
  const validated = parseProviderProfileDocument(document);
  const projection = toDirectProviderExecutionProfile(validated);

  let echoed: unknown;
  try {
    echoed = await invoke(VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND, {
      document: projection,
    });
  } catch (cause) {
    throw toBridgeError(VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND, cause);
  }
  assertNativeAccepts(VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND, echoed, projection);

  try {
    await invoke(SAVE_PROVIDER_PROFILE_COMMAND, {
      document: validated,
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
  if (result === null || result === undefined) return null;
  return parseProviderProfileDocument(result);
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
