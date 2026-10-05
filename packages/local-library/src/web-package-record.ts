import { WebPackageManifestSchema, WebPackageRefSchema } from '@mahoshojo/contracts/web-package';
import { z } from './zod';

import {
  LocalCardCloudRefSchema,
  LocalCardContentDigestSchema,
  LocalCardIdSchema,
  LocalCardProvenanceSchema,
} from './record';

export const LOCAL_WEB_PACKAGE_SCHEMA_VERSION = 1 as const;

const IsoTimestampSchema = z.string().datetime({ offset: true });

/**
 * 本地库中的 Web 包记录。
 *
 * Web 包不是数据卡，因此不复用 `LocalCardRecordV1`：`cardType` 属于线上数据卡枚举，
 * 往里塞 `'web-package'` 会让 16 处数据卡消费点看到一个假的类型。两者共享
 * `storageLocation` / `contentDigest` / `provenance` / 时间戳这几条不变量，
 * 但各自保留自己的身份与载荷形状。
 *
 * manifest 只含文件摘要，不含文件内容；ZIP 字节由存储层放在同一事务写入的
 * archive 记录里（见 `WebPackageRepository.put`）。
 */
export const LocalWebPackageRecordV1Schema = z
  .object({
    id: LocalCardIdSchema,
    schemaVersion: z.literal(LOCAL_WEB_PACKAGE_SCHEMA_VERSION),
    storageLocation: z.literal('local'),
    entityKind: z.literal('web-package'),
    title: z.string().trim().min(1).max(512),
    /** 作者身份行的简短来源说明，通常是 `id@version`。 */
    summary: z.string().trim().max(512),
    ref: WebPackageRefSchema,
    manifest: WebPackageManifestSchema,
    /** 与 `ref.digest` 相同：Web 包的内容身份由 canonical manifest 决定。 */
    contentDigest: LocalCardContentDigestSchema,
    /** 本地 ZIP 的字节数，用于空间提示；不代表展开后的体积。 */
    archiveByteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    provenance: LocalCardProvenanceSchema,
    cloudRef: LocalCardCloudRefSchema.optional(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.optional(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.contentDigest !== record.ref.digest) {
      context.addIssue({
        code: 'custom',
        path: ['contentDigest'],
        message: 'contentDigest must equal the package ref digest',
      });
    }
    // canonical identity 在**记录契约**里成立，而不是每个 adapter 各写一遍。
    // 它此前只在 Web 的 `put` 里用代码检查，于是 Desktop 侧没有任何保证，而"id 必须是摘要的
    // 派生结果"正是共享端口按摘要读档的前提（`DESK-063`）。
    if (record.id !== deriveLocalWebPackageId(record.ref.digest)) {
      context.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'id must be derived from the package ref digest',
      });
    }
    const createdAt = Date.parse(record.createdAt);
    const updatedAt = Date.parse(record.updatedAt);
    if (updatedAt < createdAt) {
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'updatedAt must not precede createdAt',
      });
    }
    if (record.deletedAt !== undefined && Date.parse(record.deletedAt) < updatedAt) {
      context.addIssue({
        code: 'custom',
        path: ['deletedAt'],
        message: 'deletedAt must not precede updatedAt',
      });
    }
  })
  .transform((record) => ({
    ...record,
    manifest: JSON.parse(JSON.stringify(record.manifest)) as typeof record.manifest,
  }));
export type LocalWebPackageRecordV1 = z.infer<typeof LocalWebPackageRecordV1Schema>;

export const LocalWebPackageQuerySchema = z
  .object({
    includeDeleted: z.boolean().optional(),
    limit: z.number().int().min(1).max(100),
    cursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict();
export type LocalWebPackageQuery = z.infer<typeof LocalWebPackageQuerySchema>;

export const LocalWebPackagePageSchema = z
  .object({
    items: z.array(LocalWebPackageRecordV1Schema).max(100),
    nextCursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict();
export type LocalWebPackagePage = z.infer<typeof LocalWebPackagePageSchema>;

/**
 * 二进制载荷判定。
 *
 * 不能只写 `instanceof ArrayBuffer`：结构化克隆可能来自另一个 realm（worker、
 * 测试用的 fake-indexeddb），那里的 ArrayBuffer 内部槽相同但原型链不同，
 * `instanceof` 会返回 false。按内部槽判定才能同时覆盖同 realm 与跨 realm。
 */
export const isBinaryPayload = (value: unknown): value is ArrayBufferLike =>
  (typeof value === 'object'
    && value !== null
    && (Object.prototype.toString.call(value) === '[object ArrayBuffer]' || ArrayBuffer.isView(value)));

/** ZIP 字节与记录分开存储，列表查询因此不必反序列化包内容。 */
export const LocalWebPackageArchiveSchema = z
  .object({
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    bytes: z.custom<ArrayBufferLike>(isBinaryPayload, 'must be binary data'),
    cachedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type LocalWebPackageArchive = z.infer<typeof LocalWebPackageArchiveSchema>;

/**
 * 由 manifest 摘要派生本地 Web 包 id。
 *
 * 这是 **canonical identity** 的唯一权威实现：Web 的 IndexedDB adapter 与 Desktop 的 SQLite
 * adapter 共用它。它此前住在 `apps/web` 里，等于把跨运行时共享数据的派生规则变成某个前端的
 * 私有细节——规则一旦漂移，导出的库在另一端就对不上。
 *
 * 与 `deriveLocalDataCardIdV1` 同构：去掉 `sha256:` 前缀后取前 32 位十六进制。
 * 改动会让所有历史 Web 包 id 变化，因此按 `DESK-061` 属于版本化演进，不能原地修改。
 */
export const deriveLocalWebPackageId = (digest: string): string =>
  `wp_${digest.replace(/^sha256:/u, '').slice(0, 32)}`;

/**
 * 本地 Web 包仓储端口。delete/restore 与 `CardRepository` 同为幂等软删语义，
 * 且永不触网——本地包不上传服务器。
 *
 * 软删**不改变归档字节的可达性**：`delete` 只写 tombstone 并保留字节，`restore` 因此能让包
 * 重新可用。只有 `purge` 才移除记录与它独占的字节。把丢弃字节的时机提前到 `delete` 会让
 * `restore` 产出一条"记录在、字节缺"的损坏行——这类行读出来是 `null`，与损坏无法区分。
 *
 * `readArchive` 的参数是 **manifest 摘要**（`record.ref.digest`），不是包 id：归档在存储层
 * 以摘要为键，而摘要不是 `wp_…` 形式的 id。混用会让读取必然落空。
 */
/** `putIfAbsent` 的结果。 */
export type WebPackageWriteOutcome =
  | Readonly<{ written: true }>
  | Readonly<{ alreadyPresent: true }>;

export interface WebPackageRepository {
  get(_id: string): Promise<LocalWebPackageRecordV1 | null>;
  /** 排除 tombstone，除非显式 includeDeleted。 */
  list(_query: LocalWebPackageQuery): Promise<LocalWebPackagePage>;
  /** 按 canonical identity 覆盖写入；同一 digest 视为同一包的重新导入。 */
  put(_record: LocalWebPackageRecordV1, _archive: Uint8Array): Promise<void>;
  /**
   * 仅在 id **当前不存在**时写入记录与它的 archive 字节；已存在则两者都不动。
   *
   * "两者都不动"包含 archive 字节：只跳过记录却写了 blob，会留下一份没人引用的副本，
   * 而 `reclaim` 要等到下一次维护窗口才收得掉。
   *
   * 与 `put` 的差别是**原子性**。`put` 允许按 canonical identity 覆盖同一 digest，因此导入侧的
   * existing-wins 不能用它——先 `get` 再 `put` 之间有窗口，那会把"保留本地已有的包"降级成尽力而为。
   */
  putIfAbsent(
    _record: LocalWebPackageRecordV1,
    _archive: Uint8Array,
  ): Promise<WebPackageWriteOutcome>;
  /** 幂等软删：只写 tombstone，保留 archive 字节，使 `restore` 能真正恢复可用状态。 */
  delete(_id: string): Promise<void>;
  restore(_id: string): Promise<void>;
  /** 彻底删除记录与它独占的 archive 字节。幂等：缺失 id 同样成功。 */
  purge(_id: string): Promise<void>;
  /** 读取 ZIP 字节；记录存在但字节缺失时返回 null（属于可恢复的损坏行）。 */
  readArchive(_digest: string): Promise<Uint8Array | null>;
}
