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

/**
 * 本地卡的 IPC 契约片段（D2.0）。
 *
 * 这里定义的是**线上形状**，不是领域模型：`LocalCardRecordV1` 归 `@mahoshojo/local-library`
 * 所有，而本包是它的下游，因此不能反向 import（否则形成 workspace 依赖环）。两侧的映射
 * 发生在 `apps/desktop` 的 adapter 里，并由该 adapter 用 `LocalCardRecordV1Schema` 独立复核。
 *
 * ## 索引列为什么随记录一起传
 *
 * native 侧要在不解析业务 JSON 的前提下排序、过滤与分页，就必须把选择器显式传过去。native
 * 会从 document 中重新提取这些字段并与这里声明的值逐项比对，不一致即拒绝——两侧对同一条记录
 * 的理解不一致时**不落盘**，而不是写入一行自相矛盾的数据。
 */

/** 本地库单条 document 的 UTF-8 字节上限。 */
export const MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES = 4 * 1024 * 1024;

/** 单次 `list` 的页大小上限，与 `MAX_LOCAL_CARD_PAGE_SIZE` 对齐。 */
export const MAX_DESKTOP_LOCAL_CARD_PAGE_SIZE = 100;

const DesktopLocalCardIdSchema = z.string().trim().min(1).max(256);
/**
 * 本地库支持的卡类型。
 *
 * 与 `ONLINE_DATA_CARD_TYPES` 逐项相同：本地卡仍是那四类线上数据卡，`web-package` 是另一
 * 个实体、不在此列（见 `LocalWebPackageRecordV1Schema` 的说明）。单独列出而不 import
 * `@mahoshojo/contracts/data-cards` 是因为本模块是**线上**形状，跨子路径引用会让 fixture
 * 断言多绕一层；两者的一致性由 `packages/contracts` 自身的测试守住。
 */
export const DesktopLocalCardTypeSchema = z.enum(['character', 'scenario', 'history', 'questionnaire']);
const DesktopLocalCardTimestampSchema = z.string().datetime({ offset: true });
const DesktopLocalCardDigestSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}:[A-Za-z0-9_-]{16,256}$/u, 'must be an algorithm-tagged content digest');

/** native 侧用于 SQL 选择器的索引列。 */
export const DesktopLocalCardIndexSchema = z
  .object({
    id: DesktopLocalCardIdSchema,
    cardType: DesktopLocalCardTypeSchema,
    updatedAt: DesktopLocalCardTimestampSchema,
    deletedAt: DesktopLocalCardTimestampSchema.optional(),
    contentDigest: DesktopLocalCardDigestSchema,
  })
  .strict();
export type DesktopLocalCardIndex = z.infer<typeof DesktopLocalCardIndexSchema>;

/**
 * keyset 游标。
 *
 * 对调用方**不透明**：契约只要求它能原样回传，因此 Web 的 IndexedDB adapter 未来可以
 * 换成自己的游标编码而不必跟随 SQLite 实现。
 */
export const DesktopLocalCardCursorSchema = z
  .object({
    updatedAt: DesktopLocalCardTimestampSchema,
    id: DesktopLocalCardIdSchema,
  })
  .strict();
export type DesktopLocalCardCursor = z.infer<typeof DesktopLocalCardCursorSchema>;

export const DesktopSaveLocalCardRequestSchema = z
  .object({
    /** 已通过 `LocalCardRecordV1Schema` 校验的完整记录，序列化为 JSON 文本。 */
    document: utf8ByteLimitedStringSchema(MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES),
    index: DesktopLocalCardIndexSchema,
  })
  .strict();
export type DesktopSaveLocalCardRequest = z.infer<typeof DesktopSaveLocalCardRequestSchema>;

export const DesktopListLocalCardsRequestSchema = z
  .object({
    includeDeleted: z.boolean().default(false),
    cardTypes: z.array(DesktopLocalCardTypeSchema).max(4).default([]),
    limit: z.number().int().min(1).max(MAX_DESKTOP_LOCAL_CARD_PAGE_SIZE),
    cursor: DesktopLocalCardCursorSchema.optional(),
  })
  .strict();
export type DesktopListLocalCardsRequest = z.infer<typeof DesktopListLocalCardsRequestSchema>;

export const DesktopListLocalCardsResponseSchema = z
  .object({
    documents: z.array(utf8ByteLimitedStringSchema(MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES)),
    nextCursor: DesktopLocalCardCursorSchema.optional(),
  })
  .strict();
export type DesktopListLocalCardsResponse = z.infer<typeof DesktopListLocalCardsResponseSchema>;

/**
 * 本地库失败的公开投影。
 *
 * 与 secret 的错误投影同规则：`message` 是固定文案，**MUST NOT** 回显用户数据或 SQLite /
 * 文件系统的原始错误串。
 */
export const DesktopStoreErrorCodeSchema = z.enum([
  'store-unavailable',
  'invalid-document',
  'document-too-large',
  'index-mismatch',
  'record-tombstoned',
  'non-monotonic-timestamp',
  'invalid-query',
  'store-failure',
]);
export type DesktopStoreErrorCode = z.infer<typeof DesktopStoreErrorCodeSchema>;

export const DesktopStoreErrorSchema = z
  .object({
    code: DesktopStoreErrorCodeSchema,
    message: z.string().min(1).max(512),
  })
  .strict();
export type DesktopStoreError = z.infer<typeof DesktopStoreErrorSchema>;
