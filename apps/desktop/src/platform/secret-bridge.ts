import {
  DesktopSecretRefSchema,
  DesktopSecretStoreErrorSchema,
  DesktopSecretValueSchema,
  type DesktopSecretStoreError,
} from '@mahoshojo/contracts/desktop-ipc';

import { DesktopBridgeError } from './desktop-bridge';

/**
 * 持久 secret 的渲染层桥接。
 *
 * 这里刻意只提供 set / has / delete：已持久化的 secret 不得由任何 renderer 可达的接口
 * 读回（见 `ADR-desktop-tauri-v1` 第 6 条与 `SPEC-desktop-client-v1` DESK-041）。
 * 明文只在用户录入的那一刻存在于输入框与本函数参数中。
 *
 * 引用与取值的合法性由 `@mahoshojo/contracts` 的 schema 在 IPC 之前先判定，
 * Rust 侧用同一份约束再判定一次，两侧共用一份 fixture 以保证不漂移。
 */

export const SET_PROVIDER_SECRET_COMMAND = 'set_provider_secret' as const;
export const HAS_PROVIDER_SECRET_COMMAND = 'has_provider_secret' as const;
export const DELETE_PROVIDER_SECRET_COMMAND = 'delete_provider_secret' as const;

export class DesktopSecretBridgeError extends Error {
  readonly command: string;
  readonly code: DesktopSecretStoreError['code'];

  constructor(command: string, error: DesktopSecretStoreError) {
    super(error.message);
    this.name = 'DesktopSecretBridgeError';
    this.command = command;
    this.code = error.code;
  }
}

interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

const assertValidSecretRef = (command: string, secretRef: string): void => {
  if (DesktopSecretRefSchema.safeParse(secretRef).success) return;
  throw new DesktopBridgeError(command, `invalid secret reference: ${JSON.stringify(secretRef)}`);
};

const assertSecretValueSize = (command: string, value: string): void => {
  if (DesktopSecretValueSchema.safeParse(value).success) return;
  throw new DesktopBridgeError(
    command,
    'secret value must be a string within the UTF-8 byte ceiling',
  );
};

/**
 * 把 Rust 返回的失败归一成公开错误投影。
 *
 * Rust 侧的 message 已保证不含明文；这里再 fail-closed 校验一次，避免后端意外回显
 * 未知形状时被原样透传到 UI 或日志。
 */
const toPublicError = (command: string, cause: unknown): DesktopSecretBridgeError => {
  const parsed = DesktopSecretStoreErrorSchema.safeParse(cause);
  if (parsed.success) return new DesktopSecretBridgeError(command, parsed.data);
  return new DesktopSecretBridgeError(command, {
    code: 'secret-store-failure',
    message: 'operating system credential store rejected the operation',
  });
};

export const setProviderSecret = async (
  invoke: InvokeFn,
  secretRef: string,
  value: string,
): Promise<void> => {
  assertValidSecretRef(SET_PROVIDER_SECRET_COMMAND, secretRef);
  assertSecretValueSize(SET_PROVIDER_SECRET_COMMAND, value);
  try {
    await invoke(SET_PROVIDER_SECRET_COMMAND, { secretRef, value });
  } catch (cause) {
    throw toPublicError(SET_PROVIDER_SECRET_COMMAND, cause);
  }
};

export const hasProviderSecret = async (
  invoke: InvokeFn,
  secretRef: string,
): Promise<boolean> => {
  assertValidSecretRef(HAS_PROVIDER_SECRET_COMMAND, secretRef);
  let result: unknown;
  try {
    result = await invoke(HAS_PROVIDER_SECRET_COMMAND, { secretRef });
  } catch (cause) {
    throw toPublicError(HAS_PROVIDER_SECRET_COMMAND, cause);
  }
  if (typeof result !== 'boolean') {
    throw new DesktopBridgeError(
      HAS_PROVIDER_SECRET_COMMAND,
      'credential existence result must be a boolean',
    );
  }
  return result;
};

export const deleteProviderSecret = async (
  invoke: InvokeFn,
  secretRef: string,
): Promise<void> => {
  assertValidSecretRef(DELETE_PROVIDER_SECRET_COMMAND, secretRef);
  try {
    await invoke(DELETE_PROVIDER_SECRET_COMMAND, { secretRef });
  } catch (cause) {
    throw toPublicError(DELETE_PROVIDER_SECRET_COMMAND, cause);
  }
};
