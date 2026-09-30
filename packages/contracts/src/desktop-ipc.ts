import { z } from './zod';

import { MAX_SECRET_REF_LENGTH, SECRET_REF_PATTERN, SecretRefSchema, isSecretRef } from './secret-ref';
import { utf8ByteLimitedStringSchema } from './wire-size';

/**
 * Desktop IPC 的 runtime-neutral 契约片段。
 *
 * 这里只放**纯数据形状**：renderer 与 Rust 两侧各自镜像这些约束，并用同一份 fixture
 * 保证不漂移（见 `SPEC-desktop-client-v1` DESK-033）。本模块不得引入任何 Tauri、
 * DOM、环境变量或服务器依赖。
 */

export const MAX_DESKTOP_SECRET_REF_LENGTH = MAX_SECRET_REF_LENGTH;
export const MAX_DESKTOP_SECRET_VALUE_BYTES = 8 * 1024;

/**
 * Secret 引用的合法字符集。
 *
 * 单点定义在 `./secret-ref`，此处按原名再导出，避免 Desktop 侧出现第二份判据。
 */
export const DESKTOP_SECRET_REF_PATTERN = SECRET_REF_PATTERN;

export const DesktopSecretRefSchema = SecretRefSchema;

export const DesktopSecretValueSchema = utf8ByteLimitedStringSchema(MAX_DESKTOP_SECRET_VALUE_BYTES);

export type DesktopSecretRef = z.infer<typeof DesktopSecretRefSchema>;
export const DesktopSecretStoreErrorCodeSchema = z.enum([
  'invalid-secret-ref',
  'secret-value-too-large',
  'secret-store-unavailable',
  'secret-store-failure',
]);
export type DesktopSecretStoreErrorCode = z.infer<typeof DesktopSecretStoreErrorCodeSchema>;

/**
 * Secret 存储失败的公开投影。
 *
 * `message` **MUST NOT** 包含 secret 明文，也不得回显操作系统凭据存储的原始错误串，
 * 因为那些串可能包含目标名之外的实现细节。
 */
export const DesktopSecretStoreErrorSchema = z
  .object({
    code: DesktopSecretStoreErrorCodeSchema,
    message: z.string().min(1).max(512),
  })
  .strict();
export type DesktopSecretStoreError = z.infer<typeof DesktopSecretStoreErrorSchema>;

export const isDesktopSecretRef = isSecretRef;
