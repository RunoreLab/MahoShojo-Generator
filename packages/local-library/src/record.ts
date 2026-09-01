import { OnlineDataCardTypeSchema } from '@mahoshojo/contracts/data-cards';
import { SafeJsonValueSchema, type JsonValue } from '@mahoshojo/contracts/json-value';
import { z } from './zod';

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
]);
export type LocalCardProvenanceKind = z.infer<typeof LocalCardProvenanceKindSchema>;

export const LocalCardExecutionProvenanceSchema = z.enum([
  'downloaded',
  'direct-local',
  'direct-remote',
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
