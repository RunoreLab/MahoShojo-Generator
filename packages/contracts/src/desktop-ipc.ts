import { z } from './zod';

import { MAX_SECRET_REF_LENGTH, SECRET_REF_PATTERN, SecretRefSchema, isSecretRef } from './secret-ref';
import { WebPackageMediaTypeSchema, WebPackagePathSchema } from './web-package';
import { utf8ByteLimitedStringSchema } from './wire-size';

/** Native backup 的标识只能选择本机备份，不能充当路径。新增契约不改变 portable archive。 */
export const DesktopBackupIdSchema = z.string().max(128).regex(
  /^local-library-[0-9]{8}T[0-9]{6}Z(?:-(?:[2-9]|[1-9][0-9]+))?$/u,
);
const DesktopBackupByteCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const DesktopBackupSummarySchema = z.object({
  backupId: DesktopBackupIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  // 路径只允许由 native 回显；任何请求均不得接受这些字段。
  absolutePath: z.string().min(1),
  directory: z.string().min(1),
  databaseBytes: DesktopBackupByteCountSchema,
  blobCount: DesktopBackupByteCountSchema,
  blobBytes: DesktopBackupByteCountSchema,
}).strict();
export type DesktopBackupSummary = z.infer<typeof DesktopBackupSummarySchema>;
export const DesktopBackupListSchema = z.object({
  backups: z.array(DesktopBackupSummarySchema),
  invalidCount: DesktopBackupByteCountSchema,
}).strict();
export type DesktopBackupList = z.infer<typeof DesktopBackupListSchema>;
export const DesktopBackupErrorSchema = z.object({
  code: z.enum([
    'invalid-backup-id', 'backup-incomplete', 'backup-unsupported-version', 'backup-corrupt',
    'backup-source-unavailable', 'backup-failed', 'maintenance-busy',
  ]),
  message: z.string().min(1).max(512),
}).strict();
export type DesktopBackupError = z.infer<typeof DesktopBackupErrorSchema>;

export const DesktopPrepareRestoreRequestSchema = z.object({ backupId: DesktopBackupIdSchema }).strict();
export const DesktopRestoreIdSchema = z.string().max(128).regex(/^restore-[0-9]+-[0-9]+-[0-9]+$/u);
export const DesktopPrepareRestoreResponseSchema = z.object({
  restoreId: DesktopRestoreIdSchema,
  backupId: DesktopBackupIdSchema,
  preRestoreBackupId: DesktopBackupIdSchema,
}).strict();
export type DesktopPrepareRestoreResponse = z.infer<typeof DesktopPrepareRestoreResponseSchema>;
export const DesktopRestoreErrorSchema = z.object({
  code: z.enum([
    ...DesktopBackupErrorSchema.shape.code.options,
    'restore-pending', 'restore-invalid-intent', 'restore-failed',
  ]),
  message: z.string().min(1).max(512),
}).strict();
export type DesktopRestoreError = z.infer<typeof DesktopRestoreErrorSchema>;

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
/**
 * 写入语义。
 *
 * `overwrite` 是常规覆盖写。`insert-if-absent` 只在 id **当前不存在**时写入，
 * 已存在则整条不动并在响应里回报 `alreadyPresent`。
 *
 * 它存在的理由是 existing-wins 的导入策略此前只能是 `get` 然后 `put`：两步之间
 * 另一个写入可以插进来，于是"本地已存在的记录一律保留"只是一个尽力
 * 而为的约定，而不是保证。共享端口与 native 都提供这个原语后，导入侧可以在
 * 存储层直接表达这条意图。
 *
 * 语义上它**不是** upsert 的别名：已存在时 tombstone 也不会被清除——保留意味着不动，
 * 包括不动它的墓碑。因此导入无法靠它复活一条用户删掉的记录。
 */
export const DesktopLocalLibraryWriteModeSchema = z.enum(['overwrite', 'insert-if-absent']);
export type DesktopLocalLibraryWriteMode = z.infer<typeof DesktopLocalLibraryWriteModeSchema>;

export const DesktopSaveLocalCardRequestSchema = z
  .object({
    /** 已通过 `LocalCardRecordV1Schema` 校验的完整记录，序列化为 JSON 文本。 */
    document: utf8ByteLimitedStringSchema(MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES),
    index: DesktopLocalCardIndexSchema,
    /** 缺省 `overwrite`，因此旧客户端的请求形状与行为都不变。 */
    writeMode: DesktopLocalLibraryWriteModeSchema.default('overwrite'),
  })
  .strict();
export type DesktopSaveLocalCardRequest = z.infer<typeof DesktopSaveLocalCardRequestSchema>;

/**
 * `alreadyPresent` 只在 `insert-if-absent` 下有意义：它告诉调用方"你要写的东西已经
 * 在那里了，而且我没有动它"。与"写入成功"是两种不同的结果，UI 不能把它们
 * 合并成同一个提示。
 */
export const DesktopSaveLocalCardResponseSchema = z
  .object({
    id: DesktopLocalCardIdSchema,
    alreadyPresent: z.boolean().default(false),
  })
  .strict();
export type DesktopSaveLocalCardResponse = z.infer<typeof DesktopSaveLocalCardResponseSchema>;

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
  // 维护窗口（GC / 审计 / 备份）期间的写入被拒（D2.2a / DESK-065）。
  // 刻意**不**并入 store-failure：它不是数据出错，而是一次可重试的时机问题。UI 把它
  // 显示成"本地库正忙，请稍后重试"；并入失败会让用户以为自己的数据坏了。
  'maintenance-busy',
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
    /** 语义同 `DesktopSaveLocalCardRequestSchema.writeMode`。 */
    writeMode: DesktopLocalLibraryWriteModeSchema.default('overwrite'),
    /** 渲染层时钟。软删/恢复必须单调推进，native 不引入时间库。 */
    now: DesktopLocalCardTimestampSchema,
  })
  .strict();
export type DesktopSaveWebPackageRequest = z.infer<typeof DesktopSaveWebPackageRequestSchema>;

export const DesktopSaveWebPackageResponseSchema = z
  .object({
    id: DesktopLocalCardIdSchema,
    blobOutcome: DesktopBlobWriteOutcomeSchema,
    /** 语义同 `DesktopSaveLocalCardResponseSchema.alreadyPresent`。 */
    alreadyPresent: z.boolean().default(false),
  })
  .strict();
export type DesktopSaveWebPackageResponse = z.infer<typeof DesktopSaveWebPackageResponseSchema>;

/**
 * 读取一个本地 Web 包的原始归档字节。
 *
 * 参数是 **manifest 摘要**（`record.ref.digest` = 记录的 `contentDigest`），**不是**包 id。
 * 共享端口 `WebPackageRepository.readArchive(digest)` 与 Web 的 IndexedDB adapter 都以摘要为
 * 键：manifest 摘要不是 `wp_…` 形式，拿它当 id 查会让真实读取路径必然落空。
 *
 * **响应方向没有 schema，这是刻意的。** 该命令返回 Tauri raw 响应，渲染层拿到 `ArrayBuffer`；
 * 过去它返回 `{archive: {b64, len}}` 信封，而 base64 的 33% 体积开销加上一次解码峰值会落在 D2.3
 * 导出期间——那条路径对**每个** Web 包都要读一遍字节。
 *
 * 因此 `DesktopBase64BytesSchema` 只剩**写入**方向在用。`DESK-064` 要求的"二进制载荷自带长度"
 * 在 raw 响应下由传输层本身满足：字节数就是长度，不存在需要额外声明的截断。
 */
export const DesktopReadWebPackageArchiveRequestSchema = z
  .object({ contentDigest: DesktopLocalCardDigestSchema })
  .strict();
export type DesktopReadWebPackageArchiveRequest = z.infer<
  typeof DesktopReadWebPackageArchiveRequestSchema
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

/**
 * 本地库维护 IPC（D2.2）。
 *
 * ## 报告形状与实现无关
 *
 * 桶的语义（"什么叫孤儿"、"什么叫可达"）是**领域知识**而不是 Desktop 细节，因此投影
 * 放在契约包、由 Rust 与未来的 Web 实现共同对齐。但 V1 只有 native 侧实现审计——
 * Web 的 IndexedDB 把记录与字节写在同一个事务里，天然不产生孤儿（见 `DESK-055`），
 * 因此那里没有可审计的中间态。这不是"Web 不需要审计"，而是"Web 当前没有审计的对象"。
 *
 * ## 六个桶
 *
 * `record-without-reference` 单列：外键方向是"引用行 → 包记录"，因此数据库**不**约束
 * "每个包记录都必须有引用行"。缺引用行的包对用户表现为"打不开"（`readArchive` 返回
 * `null`），与真正的字节损坏无法区分。
 *
 * ## 报告 MUST NOT 携带文件路径
 *
 * blob 的物理布局是 adapter 内部实现（`DESK-057`）。带路径的报告会让"同一份库在两台设备上
 * 的审计结果不同"，而那对用户判断毫无价值。因此定位信息只有摘要与包 id。
 */

/** 审计的一个发现。`kind` 是桶，`digest` / `packageId` 是定位信息。 */
export const DesktopLocalLibraryAuditFindingSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('reference-file-missing'),
      /** 打不开这个包的记录 id。 */
      packageId: DesktopLocalCardIdSchema,
      /** 引用行指向的 blob 摘要。 */
      digest: DesktopLocalCardDigestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reference-bytes-mismatch'),
      packageId: DesktopLocalCardIdSchema,
      digest: DesktopLocalCardDigestSchema,
      /** metadata 声称的字节数。 */
      expectedByteLength: z.number().int().nonnegative(),
      /** 磁盘上的实际字节数。 */
      actualByteLength: z.number().int().nonnegative(),
      /**
       * 长度是否一致。与 `actualByteLength` 分开报告，让 UI 能区分"被截断"与
       * "内容不同但等长"——后者是最难被长度检查发现的一种损坏。
       */
      lengthMatches: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unreferenced-metadata'),
      digest: DesktopLocalCardDigestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('orphan-file'),
      digest: DesktopLocalCardDigestSchema,
      byteLength: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('record-without-reference'),
      packageId: DesktopLocalCardIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('foreign-key-violation'),
      table: z.string().min(1).max(128),
      rowId: z.number().int(),
      parent: z.string().min(1).max(128),
      foreignKeyId: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type DesktopLocalLibraryAuditFinding = z.infer<
  typeof DesktopLocalLibraryAuditFindingSchema
>;

/** 审计的桶标识。UI 按它分组统计。 */
export const DESKTOP_LOCAL_LIBRARY_AUDIT_KINDS = [
  'reference-file-missing',
  'reference-bytes-mismatch',
  'unreferenced-metadata',
  'orphan-file',
  'record-without-reference',
  'foreign-key-violation',
] as const;
export type DesktopLocalLibraryAuditKind = (typeof DESKTOP_LOCAL_LIBRARY_AUDIT_KINDS)[number];

/**
 * 该桶是否代表**用户可见的损坏**。
 *
 * 孤儿文件与无引用 metadata 都不算：它们是崩溃窗口产物或 purge 之后的回收候选，用户不会
 * 因此少看到任何一个包。把它们标成损坏会让真正需要处理的问题被稀释。
 *
 * 外键违规**不算**：它是数据库层的不变量被破坏，症状必然落到上面三个桶之一（用户看到的是
 * "包打不开"）。单独把它算作损坏会让同一件事被报告两次。
 */
export const DESKTOP_LOCAL_LIBRARY_AUDIT_DAMAGE_KINDS = [
  'reference-file-missing',
  'reference-bytes-mismatch',
  'record-without-reference',
] as const satisfies readonly DesktopLocalLibraryAuditKind[];

export const DesktopLocalLibraryAuditReportSchema = z
  .object({
    findings: z.array(DesktopLocalLibraryAuditFindingSchema).max(100_000),
    schemaVersion: z.number().int().nonnegative(),
    /**
     * 参与审计的规模。给出分母是必要的：一份"0 个问题"来自空库与来自 500 个包的库，
     * 含义完全不同。UI 不应把前者显示成"本地库健康"。
     */
    referencedBlobCount: z.number().int().nonnegative(),
    blobMetadataCount: z.number().int().nonnegative(),
    webPackageCount: z.number().int().nonnegative(),
  })
  .strict();
export type DesktopLocalLibraryAuditReport = z.infer<
  typeof DesktopLocalLibraryAuditReportSchema
>;

/** 审计失败。刻意与本地库存储错误分开：审计失败是"不知道库怎么样"，不是"库坏了"。 */
export const DesktopLocalLibraryAuditErrorCodeSchema = z.enum([
  'audit-unavailable',
  'audit-failure',
]);
export type DesktopLocalLibraryAuditErrorCode = z.infer<
  typeof DesktopLocalLibraryAuditErrorCodeSchema
>;

export const DesktopLocalLibraryAuditErrorSchema = z
  .object({
    code: DesktopLocalLibraryAuditErrorCodeSchema,
    message: z.string().min(1).max(512),
  })
  .strict();
export type DesktopLocalLibraryAuditError = z.infer<
  typeof DesktopLocalLibraryAuditErrorSchema
>;

/**
 * 孤儿 GC 的结果（D2.2c）。
 *
 * 五个计数让"跑了但什么都没回收"与"根本没跑"可区分——前者正常（库干净，或用户还没 purge），
 * 后者说明候选集计算坏了。
 */
export const DesktopLocalLibraryGcReportSchema = z
  .object({
    /** 进入候选集的 digest 数。 */
    scanned: z.number().int().nonnegative(),
    /** 实际删除的 metadata 行数。 */
    reclaimed: z.number().int().nonnegative(),
    /**
     * 实际删除的文件数。它与 `reclaimed` 的差值有意义：差值大于零说明有些行的文件本来
     * 就不在（损坏形态）——GC 删了行（正确）但没有文件可删。
     */
    filesRemoved: z.number().int().nonnegative(),
    /** 回收的字节数。 */
    bytesReclaimed: z.number().int().nonnegative(),
    /**
     * 删除文件失败的条数（权限、I/O）。metadata 行已删（正确），剩下的是孤儿文件，
     * 下一次审计会报成桶四。UI 应把它显示为"部分文件未能删除"。
     */
    filesFailed: z.number().int().nonnegative(),
  })
  .strict();
export type DesktopLocalLibraryGcReport = z.infer<
  typeof DesktopLocalLibraryGcReportSchema
>;

/** GC 失败。与审计错误同样分开：GC 失败是"不知道能回收什么"，不是"库坏了"。 */
export const DesktopLocalLibraryGcErrorCodeSchema = z.enum([
  'gc-unavailable',
  'gc-failure',
]);
export type DesktopLocalLibraryGcErrorCode = z.infer<
  typeof DesktopLocalLibraryGcErrorCodeSchema
>;

export const DesktopLocalLibraryGcErrorSchema = z
  .object({
    code: DesktopLocalLibraryGcErrorCodeSchema,
    message: z.string().min(1).max(512),
  })
  .strict();
export type DesktopLocalLibraryGcError = z.infer<typeof DesktopLocalLibraryGcErrorSchema>;

/**
 * 导出归档失败的投影。
 *
 * 错误码与 `export.rs` 的 `ExportError` 一一对应。`export-too-large` 刻意与打包侧的
 * `archive-too-large` **分开**：前者的判定方是 native（按落盘上限），后者是打包器（按内存预算）。
 * 合成一个码之后，UI 无法告诉用户"你的库太大"还是"我们的实现只能打包到这么大"——而这两件事
 * 的建议动作不同（前者要删东西，后者要等流式实现）。
 *
 * `export-stale` 意味着 exportId 对不上当前会话：一次迟到的旧块。UI **MUST NOT** 把它显示成
 * "导出失败，请重试"——真实原因是 renderer 刷新过，正确处理是重新走一次完整导出。
 *
 * `export-target-occupied` 与上面相反：导出本身没有问题，只是 `begin` 回显的最终路径在发布那一刻
 * 已被别的进程或用户占用。它和 `export-race` 是仅有的两个"重试即可"的原因，因此 UI **SHOULD**
 * 明确提示重试，
 * 而不是归入无法归类的失败。它 MUST NOT 被静默换成一个别的文件名——那会让 `begin` 回显的路径
 * 变成仅供参考。
 *
 * `export-race` 表示清单快照与打包时**重新读取**的字节不一致——某条记录在两次读取之间被改写。导出
 * 在语义上是 self-consistent-enumeration 而不是 snapshot，所以它不会因为源变化而"无效"，但**不能**
 * 把不再匹配的摘要写进清单：那会产出一个本应用自己的导入器随后会拒绝的归档。它同样是瞬时的，UI
 * MUST NOT 把它显示成数据损坏；`message` 携带具体条目路径便于诊断。
 */
export const DesktopArchiveExportErrorCodeSchema = z.enum([
  'export-too-large',
  'export-empty-declaration',
  'export-no-session',
  'export-stale',
  'export-overflow',
  'export-target-occupied',
  'export-race',
  'export-unavailable',
  'export-failure',
]);
export type DesktopArchiveExportErrorCode = z.infer<
  typeof DesktopArchiveExportErrorCodeSchema
>;

export const DesktopArchiveExportErrorSchema = z
  .object({
    code: DesktopArchiveExportErrorCodeSchema,
    message: z.string().min(1).max(512),
  })
  .strict();
export type DesktopArchiveExportError = z.infer<typeof DesktopArchiveExportErrorSchema>;

export const DesktopBeginArchiveExportResponseSchema = z
  .object({
    /** 由 native 分配的单调 id。渲染层 MUST 在每次 append 时原样回传。 */
    exportId: z.number().int().positive(),
    /**
     * 计划的最终绝对路径。
     *
     * 文件在 `begin` 时**还不存在**：它要到收满声明字节才被原子 rename 到这里。回显计划路径是
     * 为了让 UI 在导出进行中就能显示"会存到哪里"，而不是让用户等到最后才知道。
     */
    absolutePath: z.string().min(1).max(4096),
  })
  .strict();
export type DesktopBeginArchiveExportResponse = z.infer<
  typeof DesktopBeginArchiveExportResponseSchema
>;

export const DesktopAppendArchiveExportChunkResponseSchema = z
  .object({
    writtenByteLength: z.number().int().nonnegative(),
    /** 累计字节已达声明总长。此时文件已 sync 并原子 rename。 */
    complete: z.boolean(),
    /** 仅在 `complete` 为真时出现，且等于 `begin` 回显的那个路径。 */
    absolutePath: z.string().min(1).max(4096).optional(),
  })
  .strict()
  .superRefine((response, context) => {
    // `complete` 与 `absolutePath` 必须同时出现或同时缺席。让 schema 强制这一点，
    // 是因为渲染层要用它决定"导出成功了吗"——而"complete 但没有路径"会逼它自己编一个。
    if (response.complete !== (response.absolutePath !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['absolutePath'],
        message: 'absolutePath must be present exactly when complete is true',
      });
    }
  });
export type DesktopAppendArchiveExportChunkResponse = z.infer<
  typeof DesktopAppendArchiveExportChunkResponseSchema
>;

/**
 * Web Package 受限 webview（D4b / DESK-013 / DESK-014）的 IPC 与协议契约。
 *
 * ## 形状
 *
 * 一次"打开 Web Package"分三步，与归档导出同构（begin 声明、raw 追加、确认完成）：
 *
 * 1. `begin_web_package_instance`：渲染层声明 entry、窗口标题与**完整文件表**
 *    （路径 + mediaType + 字节数）。native 校验声明并分配 instance id；它不接触任何
 *    ZIP/manifest——解包与 overlay 语义全部留在 TypeScript 权威实现。
 * 2. `append_web_package_resource`：逐文件 raw 字节投递，instance、路径与块内偏移
 *    走 header。每份文件按 `x-webpkg-offset` 升序切成不超过
 *    `MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES` 的块投递——"实例总预算"不是
 *    "单次 IPC 预算"，与 `MAX_LOCAL_LIBRARY_IPC_CHUNK_BYTES` 同一原则。
 * 3. `open_web_package_instance`：全部文件到齐后 native 创建 `webpkg-<id>` webview。
 *
 * 资源随后由 `maho-webpkg://` 自定义协议服务。URL 形状与
 * `WEB_PACKAGE_INSTANCE_PREFIX` 同源：`maho-webpkg://localhost/__web-package__/instance/<id>/<path>`
 * （Windows/Android 上映射为 `http://maho-webpkg.localhost/…`）。
 *
 * ## 边界
 *
 * - webview label `webpkg-<instanceId>` 与 instance id **双向钉定**：resolver 只响应
 *   与请求 webview label 匹配的 instance 资源，任何 label 不带 `webpkg-` 前缀或
 *   id 不一致的请求都以 404 告终——包括 main-ui 自己。
 * - 渲染层**不能**决定 instance id、webview label 或资源 URL：三者全由 native 分配。
 * - renderer 不提供任何文件系统路径、URL 或命令面；`x-webpkg-path` 只携带
 *   percent-encode 后的逻辑包路径，且仍须通过 portable path 校验。
 * - 与导出一样，三条命令**不持维护许可**：它们不读写本地库，类型上就够不着连接。
 */
export const DESKTOP_WEBPKG_URI_SCHEME = 'maho-webpkg' as const;
export const DESKTOP_WEBPKG_RESOURCE_HOST = 'localhost' as const;
export const DESKTOP_WEBPKG_WINDOWS_RESOURCE_HOST = 'maho-webpkg.localhost' as const;
export const DESKTOP_WEBPKG_INSTANCE_URL_PREFIX = '/__web-package__/instance/' as const;
export const DESKTOP_WEBPKG_WEBVIEW_LABEL_PREFIX = 'webpkg-' as const;
export const DESKTOP_WEBPKG_INSTANCE_ID_HEADER = 'x-webpkg-instance' as const;
export const DESKTOP_WEBPKG_RESOURCE_PATH_HEADER = 'x-webpkg-path' as const;
/** 本块字节在文件内的偏移（十进制 u64）。native 按"offset == 已收长度"验收。 */
export const DESKTOP_WEBPKG_RESOURCE_OFFSET_HEADER = 'x-webpkg-offset' as const;

export const MAX_DESKTOP_WEBPKG_INSTANCE_FILES = 4096;
/**
 * 单实例**常驻 staging 字节**上限：native 注册表里一个 instance 允许容纳的已收字节
 * 合计。它与 `MAX_ARCHIVE_EXPANDED_BYTES`（ZIP 解压防护）**语义独立**——一个是运行时
 * 内存占用界，一个是解包工作量界——即使当前恰好都取 256 MiB，任何一侧的调整都必须
 * 单独评审，不得因为数值相等就把它们当成同一个常量。
 */
export const MAX_DESKTOP_WEBPKG_INSTANCE_TOTAL_BYTES = 256 * 1024 * 1024;
/**
 * `append_web_package_resource` 单次请求的体上限。分块让"实例预算"与"单次 IPC
 * 预算"成为两个独立的量：渲染层可以投递 256 MiB 的文件，但任何一次请求体不超过
 * 4 MiB——与 `MAX_LOCAL_LIBRARY_IPC_CHUNK_BYTES` 同源。
 */
export const MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES = 4 * 1024 * 1024;
/**
 * `maho-webpkg` resolver 单帧响应上限：Range 请求的 206 响应不超过此值（镜像 Tauri
 * 官方 streaming 示例的单帧截断语义）。无 Range 的请求返回完整资源——单次响应分配的
 * 诚实上界因此是"实例预算"，不是这个数字；把大文件切成 Range 读是 webview 自己的事。
 */
export const MAX_DESKTOP_WEBPKG_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_DESKTOP_WEBPKG_LIVE_INSTANCES = 8;
export const MAX_DESKTOP_WEBPKG_LIVE_BYTES = 512 * 1024 * 1024;
export const MAX_DESKTOP_WEBPKG_TITLE_LENGTH = 128;

/**
 * instance id 由 native 以 `wpk-<单调正整数>` 分配；webview label 是 `webpkg-<id>`。
 * id 形态对调用方**不透明**：契约只要求原样回传，native 侧按自己的分配规则复核。
 */
export const DesktopWebPackageInstanceIdSchema = z
  .string()
  .regex(/^wpk-[1-9][0-9]{0,15}$/u)
  .max(32);
export type DesktopWebPackageInstanceId = z.infer<typeof DesktopWebPackageInstanceIdSchema>;

export const DesktopWebPackageInstanceWebviewLabelSchema = z
  .string()
  .regex(/^webpkg-wpk-[1-9][0-9]{0,15}$/u)
  .max(40);
export type DesktopWebPackageInstanceWebviewLabel = z.infer<
  typeof DesktopWebPackageInstanceWebviewLabelSchema
>;

/** 文件表的一项：渲染层声明，native 逐项复核并按声明长度验收字节。 */
export const DesktopWebPackageInstanceFileSchema = z
  .object({
    path: WebPackagePathSchema,
    mediaType: WebPackageMediaTypeSchema,
    byteLength: z.number().int().nonnegative().max(MAX_DESKTOP_WEBPKG_INSTANCE_TOTAL_BYTES),
  })
  .strict();
export type DesktopWebPackageInstanceFile = z.infer<typeof DesktopWebPackageInstanceFileSchema>;

export const DesktopBeginWebPackageInstanceRequestSchema = z
  .object({
    /** 渲染入口。必须是文件表中的一个 `text/html` 文件。 */
    entry: WebPackagePathSchema,
    /** 窗口标题（通常取 `manifest.name`）。由渲染层提供，native 只按长度截断式校验。 */
    title: z.string().trim().min(1).max(MAX_DESKTOP_WEBPKG_TITLE_LENGTH),
    files: z.array(DesktopWebPackageInstanceFileSchema).min(1).max(MAX_DESKTOP_WEBPKG_INSTANCE_FILES),
  })
  .strict()
  .superRefine((request, context) => {
    // 与 manifest 的 path 唯一性同规则：大小写折叠后判重（`WebPackageManifestSchema` 注释）。
    const seen = new Set<string>();
    let total = 0;
    for (const [index, file] of request.files.entries()) {
      const folded = file.path.toLowerCase();
      if (seen.has(folded)) {
        context.addIssue({ code: 'custom', path: ['files', index, 'path'], message: 'duplicate package path' });
      }
      seen.add(folded);
      total += file.byteLength;
    }
    if (total > MAX_DESKTOP_WEBPKG_INSTANCE_TOTAL_BYTES) {
      context.addIssue({ code: 'custom', path: ['files'], message: 'declared total exceeds instance budget' });
    }
    const entry = request.files.find((file) => file.path === request.entry);
    if (entry?.mediaType !== 'text/html') {
      context.addIssue({ code: 'custom', path: ['entry'], message: 'entry must be declared and be text/html' });
    }
  });
export type DesktopBeginWebPackageInstanceRequest = z.infer<
  typeof DesktopBeginWebPackageInstanceRequestSchema
>;

export const DesktopBeginWebPackageInstanceResponseSchema = z
  .object({ instanceId: DesktopWebPackageInstanceIdSchema })
  .strict();
export type DesktopBeginWebPackageInstanceResponse = z.infer<
  typeof DesktopBeginWebPackageInstanceResponseSchema
>;

/**
 * `append_web_package_resource` 的响应。
 *
 * 请求方向没有 schema——与 `append_local_archive_export_chunk` 同构：字节是整个 raw
 * 请求体，instance、逻辑路径与块内偏移走 `x-webpkg-instance` / `x-webpkg-path` /
 * `x-webpkg-offset` header（路径以 `encodeURIComponent` 逐段编码，native 解码后仍须
 * 通过 portable path 校验；offset 必须等于该文件已收字节数）。
 */
export const DesktopAppendWebPackageResourceResponseSchema = z
  .object({ receivedByteLength: z.number().int().nonnegative() })
  .strict();
export type DesktopAppendWebPackageResourceResponse = z.infer<
  typeof DesktopAppendWebPackageResourceResponseSchema
>;

export const DesktopOpenWebPackageInstanceRequestSchema = z
  .object({ instanceId: DesktopWebPackageInstanceIdSchema })
  .strict();
export type DesktopOpenWebPackageInstanceRequest = z.infer<
  typeof DesktopOpenWebPackageInstanceRequestSchema
>;

/** native 回显它实际创建的 webview label；渲染层 MUST 把它当返回值而不是自己拼。 */
export const DesktopOpenWebPackageInstanceResponseSchema = z
  .object({ label: DesktopWebPackageInstanceWebviewLabelSchema })
  .strict();
export type DesktopOpenWebPackageInstanceResponse = z.infer<
  typeof DesktopOpenWebPackageInstanceResponseSchema
>;

/**
 * webpkg 会话失败的公开投影。与 `export-*` 同规则：`webpkg-instance-stale` 意味着
 * staging TTL 已过（或新一轮 begin 顶替），正确处理是重新走完整流程，不是重试一次 append。
 */
export const DesktopWebPackageInstanceErrorCodeSchema = z.enum([
  'webpkg-invalid',
  'webpkg-too-many-files',
  'webpkg-too-large',
  'webpkg-too-many-instances',
  'webpkg-instance-missing',
  'webpkg-instance-stale',
  'webpkg-instance-incomplete',
  'webpkg-resource-undeclared',
  'webpkg-resource-duplicate',
  'webpkg-resource-mismatch',
  'webpkg-window-unavailable',
  'webpkg-failure',
]);
export type DesktopWebPackageInstanceErrorCode = z.infer<
  typeof DesktopWebPackageInstanceErrorCodeSchema
>;

export const DesktopWebPackageInstanceErrorSchema = z
  .object({
    code: DesktopWebPackageInstanceErrorCodeSchema,
    message: z.string().min(1).max(512),
  })
  .strict();
export type DesktopWebPackageInstanceError = z.infer<
  typeof DesktopWebPackageInstanceErrorSchema
>;
