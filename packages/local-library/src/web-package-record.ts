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

/** ZIP 字节与记录分开存储，列表查询因此不必反序列化包内容。 */
export const LocalWebPackageArchiveSchema = z
  .object({
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    // 结构化克隆可能来自另一个 realm（worker / 测试用的 fake-indexeddb），
    // 因此这里接受 ArrayBuffer 与任意 TypedArray 视图，而不是只认 `instanceof ArrayBuffer`。
    bytes: z.custom<ArrayBufferLike>(
      (value) => value instanceof ArrayBuffer || ArrayBuffer.isView(value),
      'must be binary data',
    ),
    cachedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type LocalWebPackageArchive = z.infer<typeof LocalWebPackageArchiveSchema>;

/**
 * 本地 Web 包仓储端口。delete/restore 与 `CardRepository` 同为幂等软删语义，
 * 且永不触网——本地包不上传服务器。
 */
export interface WebPackageRepository {
  get(_id: string): Promise<LocalWebPackageRecordV1 | null>;
  /** 排除 tombstone，除非显式 includeDeleted。 */
  list(_query: LocalWebPackageQuery): Promise<LocalWebPackagePage>;
  /** 按 canonical identity 覆盖写入；同一 digest 视为同一包的重新导入。 */
  put(_record: LocalWebPackageRecordV1, _archive: Uint8Array): Promise<void>;
  /** 幂等软删，同时丢弃本地 archive 字节。 */
  delete(_id: string): Promise<void>;
  restore(_id: string): Promise<void>;
  /** 读取 ZIP 字节；记录存在但字节缺失时返回 null（属于可恢复的损坏行）。 */
  readArchive(_digest: string): Promise<Uint8Array | null>;
}
