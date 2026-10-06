import { OnlineDataCardTypeSchema } from '@mahoshojo/contracts/data-cards';
import { SafeJsonValueSchema, type JsonValue } from '@mahoshojo/contracts/json-value';
import { z } from './zod';

// `signature-unverified` 系 2026-10-06 经维护者决策补充进 ADR provenance
// 域与本 schema（见 docs/decisions/2026-08-22_022300 修订记录），并非该
// ADR 原始取值。V1 不升版本成立的口径：LocalCardRecordV1 为 Web/Desktop
// 共用的本地卡格式，在首个写出该取值的已发布 writer 出现之前，所有受
// 支持的 reader 已接受完整取值域。首个发布版本之后，任何取值域或结构
// 扩展 MUST 单调升 schemaVersion 并提供 V1/V2 双读迁移（LIB-011），
// 不得原地修改已发布版本的取值域。
export const LOCAL_CARD_SCHEMA_VERSION = 1 as const;
export const LocalCardSchemaVersionSchema = z.literal(LOCAL_CARD_SCHEMA_VERSION);

export const LocalCardIdSchema = z.string().trim().min(1).max(256);
export const LocalCardContentDigestSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}:[A-Za-z0-9_-]{16,256}$/u, 'must be an algorithm-tagged content digest');
export const Sha256ChecksumSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/u, 'must be a lowercase SHA-256 digest');

const IsoTimestampSchema = z.string().datetime({ offset: true });
const OptionalNonBlankStringSchema = (maxLength: number) => z.string().trim().min(1).max(maxLength);

export const LocalCardProvenanceKindSchema = z.enum([
  'official-signed',
  'unsigned',
  'signature-invalid',
  'signature-unverified',
]);
export type LocalCardProvenanceKind = z.infer<typeof LocalCardProvenanceKindSchema>;

export const LocalCardExecutionProvenanceSchema = z.enum([
  'downloaded',
  'direct-local',
  'direct-remote',
  'hosted',
  'imported',
  'edited',
]);
export type LocalCardExecutionProvenance = z.infer<typeof LocalCardExecutionProvenanceSchema>;

const LocalCardSignatureEvidenceShape = {
  signature: z.string().min(1).max(16 * 1024),
  signatureVersion: z.number().int().positive().optional(),
  signatureKeyId: OptionalNonBlankStringSchema(256).optional(),
  execution: LocalCardExecutionProvenanceSchema.optional(),
};

/**
 * `official-signed`：签名证据来自本次会话的新鲜服务端响应（或线上下载副本）；
 * `signature-unverified`：签名证据存在，但载体是可编辑的本地草稿/导入件——
 * 只陈述“含签名字段”，不声称官方签名（本机不做验签，DESK-PROD-012）。
 */
export const LocalCardProvenanceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('official-signed'),
      ...LocalCardSignatureEvidenceShape,
    })
    .strict(),
  z
    .object({
      kind: z.literal('signature-invalid'),
      ...LocalCardSignatureEvidenceShape,
    })
    .strict(),
  z
    .object({
      kind: z.literal('signature-unverified'),
      ...LocalCardSignatureEvidenceShape,
    })
    .strict(),
  z
    .object({
      kind: z.literal('unsigned'),
      execution: LocalCardExecutionProvenanceSchema.optional(),
    })
    .strict(),
]);
export type LocalCardProvenance = z.infer<typeof LocalCardProvenanceSchema>;

export const LocalCardCloudRefSchema = z
  .object({
    cardId: OptionalNonBlankStringSchema(256),
    cloudRevision: OptionalNonBlankStringSchema(256).optional(),
    copiedAt: IsoTimestampSchema,
  })
  .strict();
export type LocalCardCloudRef = z.infer<typeof LocalCardCloudRefSchema>;

export const LocalCardRecordV1Schema = z
  .object({
    id: LocalCardIdSchema,
    schemaVersion: LocalCardSchemaVersionSchema,
    storageLocation: z.literal('local'),
    cardType: OnlineDataCardTypeSchema,
    title: z.string().trim().min(1).max(512),
    data: SafeJsonValueSchema,
    contentDigest: LocalCardContentDigestSchema,
    provenance: LocalCardProvenanceSchema,
    cloudRef: LocalCardCloudRefSchema.optional(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.optional(),
  })
  .strict()
  .superRefine((record, context) => {
    const createdAt = Date.parse(record.createdAt);
    const updatedAt = Date.parse(record.updatedAt);
    if (updatedAt < createdAt) {
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'updatedAt must not precede createdAt',
      });
    }
    if (record.deletedAt !== undefined && Date.parse(record.deletedAt) < createdAt) {
      context.addIssue({
        code: 'custom',
        path: ['deletedAt'],
        message: 'deletedAt must not precede createdAt',
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
    data: JSON.parse(JSON.stringify(record.data)) as JsonValue,
  }));
export type LocalCardRecordV1 = z.infer<typeof LocalCardRecordV1Schema>;

export const LocalCardRecordSchema = LocalCardRecordV1Schema;
export type LocalCardRecord = LocalCardRecordV1;

/**
 * 为一次状态变更（保存、软删、恢复）算出一个合法的 `updatedAt`。
 *
 * 记录契约要求 `createdAt <= updatedAt <= deletedAt`。系统时钟回拨（用户改时间、NTP 校正）
 * 会让 `now` 落在既有 `updatedAt` 之前，于是软删会写出一条**自身非法**的记录，或者让
 * 存储层的 keyset 排序出现"新记录排在旧记录之前"的漏读。
 *
 * 因此写入时间被抬到既有 `updatedAt` 之上：tombstone 仍然单调，也不撒谎。
 *
 * 抬升到"相等"而不是"严格 +1ms"是刻意的：时钟回拨时声称一个比现在更晚的时刻是编造数据，
 * 而相等既满足契约的 `createdAt <= updatedAt <= deletedAt`，又保证 keyset 排序不会倒退。
 * 代价是"软删后立刻恢复"这类在同一次回拨内发生的状态变更不会改变排序位置——那只影响
 * 列表顺序，不影响正确性。
 *
 * 这条规则住在包里而不是各 adapter 里，因为它同时约束 IndexedDB adapter 与 SQLite
 * adapter——两份实现必然漂移，而漂移的后果是"同一张卡在 Web 与 Desktop 上顺序不同"。
 *
 * @param previousUpdatedAt 既有 `updatedAt`；新建记录时传 `undefined`。
 * @param now 便于测试注入的时钟来源，默认 `Date.now`。
 */
export const nextLocalTimestamp = (
  previousUpdatedAt: string | undefined,
  now: () => number = Date.now,
): string => {
  const current = new Date(now()).toISOString();
  if (previousUpdatedAt === undefined) return current;
  const previous = Date.parse(previousUpdatedAt);
  // 上一次时间戳无法解析时不抬升：那是数据已损坏的信号，掩盖它只会把问题推到更深处。
  if (Number.isNaN(previous)) return current;
  return now() < previous ? previousUpdatedAt : current;
};
