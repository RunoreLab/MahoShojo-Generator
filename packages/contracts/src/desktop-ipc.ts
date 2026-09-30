import { z } from './zod';

import { utf8ByteLimitedStringSchema } from './wire-size';

/**
 * Desktop IPC 的 runtime-neutral 契约片段。
 *
 * 这里只放**纯数据形状**：renderer 与 Rust 两侧各自镜像这些约束，并用同一份 fixture
 * 保证不漂移（见 `SPEC-desktop-client-v1` DESK-033）。本模块不得引入任何 Tauri、
 * DOM、环境变量或服务器依赖。
 */

export const MAX_DESKTOP_SECRET_REF_LENGTH = 256;
export const MAX_DESKTOP_SECRET_VALUE_BYTES = 8 * 1024;

/**
 * Secret 引用的合法字符集。
 *
 * 该引用会直接成为操作系统凭据存储的目标名，因此只允许 ASCII 字母、数字、点、下划线、
 * 冒号与连字符。这条规则同时阻止把凭据存储当成任意键值仓库使用，也保证
 * Provider Profile 的 id 必须先满足本规则才允许派生 secret 引用。
 */
export const DESKTOP_SECRET_REF_PATTERN = /^[A-Za-z0-9._:-]+$/u;

export const DesktopSecretRefSchema = z
  .string()
  .min(1)
  .max(MAX_DESKTOP_SECRET_REF_LENGTH)
  .regex(
    DESKTOP_SECRET_REF_PATTERN,
    'must only contain ASCII letters, digits, dot, underscore, colon or hyphen',
  );

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

export const isDesktopSecretRef = (value: string): boolean =>
  value.length > 0
  && value.length <= MAX_DESKTOP_SECRET_REF_LENGTH
  && DESKTOP_SECRET_REF_PATTERN.test(value);
