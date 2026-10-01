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
    /**
     * keyset 排序键（UTC epoch 毫秒），由 native 从 document 的 `updatedAt` 自行解析。
     *
     * 带上它是因为契约允许任意 UTC offset：两个 offset 不同的时间戳文本可能表示同一时刻，
     * 只有规范化后的排序键能与存储层的比较口径完全一致。缺省为 0 以兼容首屏游标。
     */
    updatedAtSort: z.number().int().default(0),
    updatedAt: DesktopLocalCardTimestampSchema,
    id: DesktopLocalCardIdSchema,
  })
  .strict();
export type DesktopLocalCardCursor = z.infer<typeof DesktopLocalCardCursorSchema>;

/**
 * 保存、软删与恢复共用同一种请求形状。
 *
 * 三者交出的都是**组装完成的完整记录**。刻意不提供 `(id, deletedAt)` 形态：只改索引列而
 * 不动 document，会让 `get()` 交回一条与索引列不一致的记录——`get()` 返回的正是 document，
 * 调用方因此会以为记录仍活动，而 `list` 却已把它隐藏。
 */
export const DesktopSaveLocalCardRequestSchema = z
  .object({
    /** 已通过 `LocalCardRecordV1Schema` 校验的完整记录，序列化为 JSON 文本。 */
    document: utf8ByteLimitedStringSchema(MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES),
    index: DesktopLocalCardIndexSchema,
  })
  .strict();
export type DesktopSaveLocalCardRequest = z.infer<typeof DesktopSaveLocalCardRequestSchema>;

export const DesktopLocalCardWriteIntentSchema = z.enum(['save', 'delete', 'restore']);
export type DesktopLocalCardWriteIntent = z.infer<typeof DesktopLocalCardWriteIntentSchema>;

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
  'transition-mismatch',
  'record-missing',
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

/**
 * blob 存储的公开投影。与 `DesktopStoreError` **同一形状**，使渲染层只需要一个错误解析器。
 *
 * `blob-corrupt` 与 `blob-digest-mismatch` 分开是必要的：前者是本机存储损坏（可能需要提示
 * 用户做完整性检查），后者是调用方交来的字节与它声称的地址不符（是调用方的 bug）。
 */
export const DesktopBlobErrorCodeSchema = z.enum([
  'blob-unavailable',
  'blob-digest-mismatch',
  'blob-corrupt',
  'blob-too-large',
  'blob-not-found',
  'blob-failure',
]);
export type DesktopBlobErrorCode = z.infer<typeof DesktopBlobErrorCodeSchema>;

export const DesktopBlobErrorSchema = z
  .object({
    code: DesktopBlobErrorCodeSchema,
    message: z.string().min(1).max(512),
  })
  .strict();
export type DesktopBlobError = z.infer<typeof DesktopBlobErrorSchema>;

/** 本地库错误：记录存储与 blob 存储共用同一个投影形状。 */
export const DesktopLocalLibraryErrorSchema = z
  .object({
    code: z.union([DesktopStoreErrorCodeSchema, DesktopBlobErrorCodeSchema]),
    message: z.string().min(1).max(512),
  })
  .strict();
export type DesktopLocalLibraryError = z.infer<typeof DesktopLocalLibraryErrorSchema>;

export const MAX_DESKTOP_LOCAL_PACKAGE_ARCHIVE_BYTES = 64 * 1024 * 1024;

/**
 * base64 传输的二进制载荷。
 *
 * 记录原始长度并在解码后核对：截断的 base64 若被静默接受，会变成一个"看起来完整"的短 ZIP，
 * 而它的失败点会落在解包器里，离真正的原因很远。
 */
/**
 * 承载字节的 base64 信封。
 *
 * `b64` 允许为空串：空字节序列在传输层是可表示的，而"一个空 archive 不是合法 ZIP"属于
 * ZIP 校验的职责，不该由传输信封顺带断言。反过来，`b64` 与 `len` 的一致性**无法**在这里
 * 断言（那需要先解码），因此由两端在解码后核对 `len`——静默接受截断载荷会产出一个看起来
 * 完整的短包，把失败点推到解包器里，离真正原因很远。
 */
export const DesktopBase64BytesSchema = z
  .object({
    b64: z
      .string()
      .max(Math.ceil((MAX_DESKTOP_LOCAL_PACKAGE_ARCHIVE_BYTES * 4) / 3) + 8),
    len: z.number().int().nonnegative().max(MAX_DESKTOP_LOCAL_PACKAGE_ARCHIVE_BYTES),
  })
  .strict();
export type DesktopBase64Bytes = z.infer<typeof DesktopBase64BytesSchema>;

/** blob 写入的三种结果。`repaired` MUST 被透传到 UI。 */
export const DesktopBlobWriteOutcomeSchema = z.enum(['stored', 'alreadyPresent', 'repaired']);
export type DesktopBlobWriteOutcome = z.infer<typeof DesktopBlobWriteOutcomeSchema>;

/** Web 包记录的索引列。与本地卡同构：native 从 document 复核，不采信这些值。 */
export const DesktopWebPackageIndexSchema = z
  .object({
    id: DesktopLocalCardIdSchema,
    updatedAt: DesktopLocalCardTimestampSchema,
    deletedAt: DesktopLocalCardTimestampSchema.optional(),
    /** manifest 的内容摘要；必须等于 document 里的 `contentDigest`。 */
    contentDigest: DesktopLocalCardDigestSchema,
  })
  .strict();
export type DesktopWebPackageIndex = z.infer<typeof DesktopWebPackageIndexSchema>;

/**
 * 保存一个本地 Web 包。
 *
 * archive 的地址由 native **自行从字节算出**，调用方无处声明地址——因此不存在"声明与内容
 * 不符"这种输入：同一份字节永远落在同一个地址。
 */
export const DesktopSaveWebPackageRequestSchema = z
  .object({
    document: utf8ByteLimitedStringSchema(MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES),
    index: DesktopWebPackageIndexSchema,
    archive: DesktopBase64BytesSchema,
    /** 渲染层时钟。软删/恢复必须单调推进，native 不引入时间库。 */
    now: DesktopLocalCardTimestampSchema,
  })
  .strict();
export type DesktopSaveWebPackageRequest = z.infer<typeof DesktopSaveWebPackageRequestSchema>;

export const DesktopSaveWebPackageResponseSchema = z
  .object({
    id: DesktopLocalCardIdSchema,
    blobOutcome: DesktopBlobWriteOutcomeSchema,
  })
  .strict();
export type DesktopSaveWebPackageResponse = z.infer<typeof DesktopSaveWebPackageResponseSchema>;

/**
 * 读取一个本地 Web 包的原始归档字节。
 *
 * 参数是 **manifest 摘要**（`record.ref.digest` = 记录的 `contentDigest`），**不是**包 id。
 * 共享端口 `WebPackageRepository.readArchive(digest)` 与 Web 的 IndexedDB adapter 都以摘要为
 * 键：manifest 摘要不是 `wp_…` 形式，拿它当 id 查会让真实读取路径必然落空。
 */
export const DesktopReadWebPackageArchiveRequestSchema = z
  .object({ contentDigest: DesktopLocalCardDigestSchema })
  .strict();
export type DesktopReadWebPackageArchiveRequest = z.infer<
  typeof DesktopReadWebPackageArchiveRequestSchema
>;

/**
 * 读取一个本地 Web 包的原始归档字节的**响应**。
 *
 * 载荷包在 `archive` 字段里，而不是把 invoke 的返回值直接当载荷：native 曾返回一根裸
 * base64 字符串，而渲染层按 `{b64, len}` 解析——两侧各自的单测都绿（各自 mock 了对方的
 * 形状），真实 IPC 才炸。信封形状由 `DesktopBase64BytesSchema` 单点定义。
 */
export const DesktopReadWebPackageArchiveResponseSchema = z
  .object({ archive: DesktopBase64BytesSchema })
  .strict();
export type DesktopReadWebPackageArchiveResponse = z.infer<
  typeof DesktopReadWebPackageArchiveResponseSchema
>;

/**
 * 删除/恢复一个本地 Web 包。
 *
 * 与保存请求分开，是因为**状态转移不产生新字节**。若复用保存请求，"恢复一个包"也得先把整个
 * ZIP 读回内存才能调一次命令——既慢，又在字节已缺失时把恢复变成不可能。
 *
 * 时间戳不作为独立参数：渲染层把算好的 `updatedAt`/`deletedAt` 写进 document，native 从
 * document 复核单调性。这样索引列与 document 不可能出现两个时间来源。
 */
export const DesktopWebPackageTransitionRequestSchema = z
  .object({
    document: utf8ByteLimitedStringSchema(MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES),
    index: DesktopWebPackageIndexSchema,
  })
  .strict();
export type DesktopWebPackageTransitionRequest = z.infer<
  typeof DesktopWebPackageTransitionRequestSchema
>;

export const DesktopListWebPackagesRequestSchema = z
  .object({
    includeDeleted: z.boolean().default(false),
    limit: z.number().int().min(1).max(MAX_DESKTOP_LOCAL_CARD_PAGE_SIZE),
    cursor: DesktopLocalCardCursorSchema.optional(),
  })
  .strict();
export type DesktopListWebPackagesRequest = z.infer<typeof DesktopListWebPackagesRequestSchema>;

export const DesktopListWebPackagesResponseSchema = z
  .object({
    documents: z.array(utf8ByteLimitedStringSchema(MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES)),
    nextCursor: DesktopLocalCardCursorSchema.optional(),
  })
  .strict();
export type DesktopListWebPackagesResponse = z.infer<typeof DesktopListWebPackagesResponseSchema>;
