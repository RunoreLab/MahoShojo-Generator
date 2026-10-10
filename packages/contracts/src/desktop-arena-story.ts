import { z } from './zod';
import { ArenaStoryCreateRequestSchema } from './arena-story';
import { ARENA_RECONCILIATION_LIMITS, ArenaReconciliationIssueSchema, ArenaReconciliationSuccessSchema } from './arena-reconciliation';
import {
  DESKTOP_ARENA_HOSTED_LIMITS, DesktopArenaHostedActorSchema,
  DesktopArenaHostedProductSchema, DesktopArenaHostedRequestIdSchema,
  DesktopArenaHostedHeaderMetaSchema, DesktopArenaHostedSseEventSchema,
} from './desktop-arena-hosted';
import { JsonValueSchema } from './json-value';
import { jsonUtf8ByteLength } from './wire-size';

/** Internal vertical-slice candidate with a narrow native binder. Production release
 * still requires the complete journey, source-matched CI and independent review. */
export const STORY_CANDIDATE_COMMIT_BYTES = 128 * 1024 * 1024;
export const STORY_CANDIDATE_FRAME_BYTES = 4 * 1024 * 1024;
export const STORY_CANDIDATE_PAGE_BYTES = 128 * 1024;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const preview = z.string().refine((value) => new TextEncoder().encode(value).byteLength <= 192);
export const StoryPartKindSchema = z.enum(['session', 'seed', 'chapter', 'checkpoint0', 'checkpoint1']);
export const StoryRecordKindSchema = z.enum(['session', 'seed', 'chapter', 'checkpoint']);
export const StoryCommitManifestSchema = z.object({
  version: z.literal(1), operationId: id, sessionId: id,
  expectedRevision: integer.max(Number.MAX_SAFE_INTEGER - 1), expectedLastChapterId: id.nullable(),
  parts: z.array(z.object({ kind: StoryPartKindSchema, byteLength: integer.min(1).max(STORY_CANDIDATE_COMMIT_BYTES), digest }).strict()).min(3).max(5),
}).strict().superRefine((value, context) => {
  const expected = value.expectedRevision === 0 ? ['session', 'seed', 'chapter', 'checkpoint0', 'checkpoint1'] : ['session', 'chapter', 'checkpoint1'];
  if (value.parts.map((part) => part.kind).join(',') !== expected.join(',')
    || (value.expectedRevision === 0) !== (value.expectedLastChapterId === null)
    || value.parts.reduce((total, part) => total + part.byteLength, 0) > STORY_CANDIDATE_COMMIT_BYTES) {
    context.addIssue({ code: 'custom', message: 'Invalid story commit declaration' });
  }
});
export const StoryReceiptSchema = z.object({
  version: z.literal(1), operationId: id, sessionId: id, chapterId: id,
  chapterIndex: integer.min(1), revision: integer.min(1), chapterCount: integer.min(1),
  checkpointIds: z.array(id).min(1).max(2), wireDigest: digest,
}).strict();
export const StoryBeginOutcomeSchema = z.object({ token: z.string().regex(/^[a-f0-9]{32}-[a-f0-9]{32}$/u), totalBytes: integer }).strict();
export const StoryAppendOutcomeSchema = z.object({ token: z.string(), kind: StoryPartKindSchema, receivedBytes: integer }).strict();
export const StorySessionCursorSchema = z.object({ updatedAt: integer, id }).strict();
export const StoryChapterCursorSchema = z.object({ index: integer.min(1), id }).strict();
export const StorySessionHeadSchema = z.object({
  id, revision: integer.min(1), titlePreview: preview, titleTruncated: z.boolean(),
  mode: z.enum(['classic', 'kizuna', 'daily', 'scenario']), chapterPlan: z.object({ totalChapters: integer.min(1).max(20), source: z.enum(['user', 'scenario']), locked: z.boolean() }).strict().optional(), createdAt: integer, updatedAt: integer,
  chapterCount: integer.min(1), lastChapterId: id,
}).strict();
export const StoryChapterHeadSchema = z.object({
  id, index: integer.min(1), action: z.enum(['start', 'continue']), status: z.literal('active'), titlePreview: preview, titleTruncated: z.boolean(),
  createdAt: integer, markdownByteLength: integer,
}).strict();
export const StorySessionPageSchema = z.object({ rows: z.array(StorySessionHeadSchema).max(50), nextCursor: StorySessionCursorSchema.nullable() }).strict();
export const StoryChapterPageSchema = z.object({ sessionId: id, revision: integer.min(1), rows: z.array(StoryChapterHeadSchema).max(50), nextCursor: StoryChapterCursorSchema.nullable() }).strict();
export const StoryRecordDescriptorSchema = z.object({
  instance: z.string().regex(/^[a-f0-9]{32}$/u), sessionId: id, recordId: id, revision: integer.min(1),
  kind: StoryRecordKindSchema, byteLength: integer.min(1).max(STORY_CANDIDATE_COMMIT_BYTES), digest,
}).strict();
export const StoryContinueDescriptorsSchema = z.object({
  session: StoryRecordDescriptorSchema, seed: StoryRecordDescriptorSchema, checkpoint: StoryRecordDescriptorSchema,
  recentChapters: z.array(StoryRecordDescriptorSchema).min(1).max(12), head: StorySessionHeadSchema,
}).strict();

// The records keep unknown JSON extensions. These are shallow carrier checks;
// Native repeats byte/identity/relationship checks and TS owns business semantics.
export const StorySourceSchema = z.object({
  mode: z.enum(['classic', 'kizuna', 'daily', 'scenario']), language: z.string(),
  storyLength: z.enum(['default', 'short', 'standard', 'detailed', 'long']), customStoryLength: z.string().optional(),
  generationMode: z.literal('stream'), providerMode: z.string().optional(), providerId: z.string().optional(), modelId: z.string().optional(),
}).strict();
export const StorySessionDocumentSchema = StorySessionHeadSchema.extend({
  title: z.string(), source: StorySourceSchema, sessionSummary: z.string().optional(),
  branchLabel: z.string().optional(), branchOf: z.object({sessionId:id,chapterId:id,chapterIndex:integer.min(1),chapterTitle:z.string().optional()}).passthrough().optional(),
  workingCheckpointId: id, lastInputCheckpointId: id,
  seed: z.never().optional(), workingCombatants: z.never().optional(), lastChapterInputCombatants: z.never().optional(),
}).passthrough();
export const StoryChapterDocumentSchema = StoryChapterHeadSchema.extend({
  sessionId: id, status: z.literal('active'), sourceChapterId: id.nullable().optional(), generationId: z.string().nullable().optional(),
  title: z.string(), markdown: z.string(), reportJson: z.record(z.string(), z.unknown()),
  deterministicDigest: z.object({ chapterTitle: z.string(), winner: z.string().optional(), officialConclusion: z.string().optional(), bodyExcerpt: z.string().optional(), impactDigest: z.array(z.object({characterName:z.string(),impact:z.string().optional(),currentStateSummary:z.string().optional()}).passthrough()).optional() }).passthrough(), cardSnapshot: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export const StoryCheckpointDocumentSchema = z.object({
  id, sessionId: id, boundaryIndex: integer, chapterId: id.nullable().optional(), combatants: z.array(z.unknown()), createdAt: integer,
}).passthrough();
export const StorySeedDocumentSchema = z.object({ combatants: z.array(z.unknown()) }).passthrough();

export type StoryCommitManifest = z.infer<typeof StoryCommitManifestSchema>;
export type StoryReceipt = z.infer<typeof StoryReceiptSchema>;
export type StoryPartKind = z.infer<typeof StoryPartKindSchema>;
export type StoryRecordKind = z.infer<typeof StoryRecordKindSchema>;
export type StoryRecordDescriptor = z.infer<typeof StoryRecordDescriptorSchema>;
export type StorySessionHead = z.infer<typeof StorySessionHeadSchema>;
export type StoryChapterHead = z.infer<typeof StoryChapterHeadSchema>;
export type StorySessionDocument = z.infer<typeof StorySessionDocumentSchema>;
export type StoryChapterDocument = z.infer<typeof StoryChapterDocumentSchema>;
export type StoryCheckpointDocument = z.infer<typeof StoryCheckpointDocumentSchema>;
export type StorySessionPage = z.infer<typeof StorySessionPageSchema>;
export type StoryChapterPage = z.infer<typeof StoryChapterPageSchema>;

/** Only a returned Native structured failure proves this attempt did not commit.
 * Transport exceptions and the explicit commit-unknown outcome never provide that proof. */
export const StoryNativeFailureSchema = z.object({
  code: z.enum(['story-invalid', 'story-too-large', 'story-staging-busy', 'story-stale', 'story-incomplete',
    'story-conflict', 'story-operation-mismatch', 'story-missing', 'maintenance-busy', 'story-io', 'story-export-no-space', 'story-corrupt', 'story-commit-unknown', 'story-originals-uncovered']),
  message: z.string(), writeEvidence: z.enum(['not-written', 'unknown']),
}).strict().refine((value) => value.code === 'story-commit-unknown' ? value.writeEvidence === 'unknown' : value.writeEvidence === 'not-written');

/** Exact double-pass Markdown export, scoped to one committed story generation. */
export const StoryMarkdownExportManifestSchema = z.object({
  sessionId: id, revision: integer.min(1), expectedHead: id, chapterCount: integer.min(1),
  expectedByteLength: integer.min(1),
}).strict();
export const StoryMarkdownExportBeginSchema = z.object({ token: StoryBeginOutcomeSchema.shape.token, expectedByteLength: integer.min(1) }).strict();
export const StoryMarkdownExportAppendSchema = z.object({ token: StoryBeginOutcomeSchema.shape.token, receivedBytes: integer }).strict();
export const StoryMarkdownExportOutcomeSchema = z.object({ token: StoryBeginOutcomeSchema.shape.token, absolutePath: z.string().min(1), byteLength: integer.min(1) }).strict();
export type StoryMarkdownExportManifest = z.infer<typeof StoryMarkdownExportManifestSchema>;
export type StoryMarkdownExportOutcome = z.infer<typeof StoryMarkdownExportOutcomeSchema>;

/** Durable, non-secret pending originals. The two active product slots are separate
 * from the shared Direct/pending upload reservation; none of these limits caps disk
 * pages, WAL, backup size or process memory. */
export const STORY_PENDING_LIMITS = Object.freeze({
  slotBytes: STORY_CANDIDATE_COMMIT_BYTES,
  activeSlots: 2,
  sharedUploadBytes: STORY_CANDIDATE_COMMIT_BYTES,
  sharedUploadCount: 2,
  metadataBytes: 64 * 1024,
  inputBytes: DESKTOP_ARENA_HOSTED_LIMITS.requestBodyBytes,
  outputContentBytes: DESKTOP_ARENA_HOSTED_LIMITS.outputContentBytes,
  metaBytes: DESKTOP_ARENA_HOSTED_LIMITS.eventWireBytes,
  headerBytes: DESKTOP_ARENA_HOSTED_LIMITS.headerDecodedBytes,
  roleResponseBytes: ARENA_RECONCILIATION_LIMITS.responseBodyBytes,
});

/** Keep the canonical story input refinements without copying their implementation.
 * safeExtend preserves the linear-context checks on the refined Zod object. The
 * provider carrier is forbidden even when explicitly present as undefined. Card
 * JSON is never recursively filtered by field name, normalized or truncated. */
const pendingInput = ArenaStoryCreateRequestSchema.safeExtend({ customProvider: z.never().optional() })
  .refine((value) => !Object.prototype.hasOwnProperty.call(value, 'customProvider'), 'Provider credentials are not pending input');
const pendingJson = z.unknown().refine((value) => JsonValueSchema.safeParse(value).success, 'Pending originals must be plain JSON');
export const StoryPendingInputSchema = pendingJson.pipe(pendingInput)
  .refine((value) => jsonUtf8ByteLength(value) <= STORY_PENDING_LIMITS.inputBytes, 'Story pending input exceeds its byte budget');
export type StoryPendingInput = z.infer<typeof StoryPendingInputSchema>;

/** These are parsed public carriers, never raw HTTP headers or authentication
 * bootstrap data. User-authored nested JSON/text may itself contain private words;
 * this boundary closes protocol authority, not a recursive content redactor. */
export const StoryPendingHeaderSchema = pendingJson.pipe(DesktopArenaHostedHeaderMetaSchema)
  .refine((value) => value.reportFormat === 'markdown' && value.webPackageRef === undefined
    && (value.outputContract === undefined || value.outputContract === 'stream-markdown'), 'Pending stories only retain Markdown header metadata');
type PendingMetaEvent = Extract<z.infer<typeof DesktopArenaHostedSseEventSchema>, { event: 'meta' | 'meta_error' }>;
export const StoryPendingMetaSchema = pendingJson.pipe(DesktopArenaHostedSseEventSchema)
  .refine((value) => value.event === 'meta' || value.event === 'meta_error', 'Pending meta requires an original meta event')
  .refine((value) => value.event !== 'meta' || value.data.webPackage === undefined, 'Pending stories cannot retain a Web package carrier')
  .refine((value) => jsonUtf8ByteLength(value) <= STORY_PENDING_LIMITS.metaBytes, 'Pending meta exceeds its byte budget')
  .transform((value) => value as PendingMetaEvent);
export const StoryPendingRoleResponseSchema = pendingJson.pipe(ArenaReconciliationSuccessSchema)
  .refine((value) => jsonUtf8ByteLength(value) <= STORY_PENDING_LIMITS.roleResponseBytes, 'Pending role response exceeds its byte budget');
export type StoryPendingHeader = z.infer<typeof StoryPendingHeaderSchema>;
export type StoryPendingMeta = z.infer<typeof StoryPendingMetaSchema>;
export type StoryPendingRoleResponse = z.infer<typeof StoryPendingRoleResponseSchema>;

/** Small, versioned chapter outcome. This is not an archive of the role response. */
export const StoryPendingRoleSyncSchema = z.object({
  version: z.literal(1), state: z.enum(['not-requested', 'accepted', 'old-roles']),
  warnings: z.array(ArenaReconciliationIssueSchema).max(ARENA_RECONCILIATION_LIMITS.maxIssues),
  reason: z.enum(['http-failure', 'user-kept-original']).optional(),
}).strict().refine((value) => (value.state === 'old-roles') === (value.reason !== undefined),
  'Only old roles require an explicit fallback reason')
  .refine((value) => value.state === 'accepted' || value.warnings.length === 0,
    'Only an accepted role response can carry reconciliation warnings');
export type StoryPendingRoleSync = z.infer<typeof StoryPendingRoleSyncSchema>;

export const StoryPendingPartKindSchema = z.enum([
  'input', 'markdown', 'reasoning', 'meta', 'header', 'roleResponse',
  'session', 'seed', 'chapter', 'checkpoint0', 'checkpoint1',
]);
export type StoryPendingPartKind = z.infer<typeof StoryPendingPartKindSchema>;
export const StoryPendingPartSchema = z.object({
  kind: StoryPendingPartKindSchema, byteLength: integer.min(1).max(STORY_PENDING_LIMITS.slotBytes), digest,
}).strict();
export const StoryPendingManifestSchema = z.object({
  version: z.literal(1), product: DesktopArenaHostedProductSchema,
  requestId: DesktopArenaHostedRequestIdSchema, actor: DesktopArenaHostedActorSchema,
  pendingRevision: integer.min(1), sessionId: id, operationId: id,
  outputCheckpointId: id, initialCheckpointId: id.nullable(), createdAt: integer,
  expectedRevision: integer.max(Number.MAX_SAFE_INTEGER - 1), expectedLastChapterId: id.nullable(),
  lastInputCheckpointId: id, inputDigest: digest,
  writeOptions: z.object({
    writeArenaHistory: z.boolean(), writeCurrentState: z.boolean(), writeNarrativeHistory: z.boolean(),
  }).strict(),
  modelCompleted: z.boolean(), roleState: z.enum(['not-requested', 'unresolved', 'accepted', 'old-roles']),
  roleInputDigest: digest.nullable(),
  parts: z.array(StoryPendingPartSchema).min(1).max(StoryPendingPartKindSchema.options.length),
  commitManifest: StoryCommitManifestSchema.nullable(),
}).strict().superRefine((value, context) => {
  const reject = (message: string): void => { context.addIssue({ code: 'custom', message }); };
  const kinds = value.parts.map((part) => part.kind);
  const order = kinds.map((kind) => StoryPendingPartKindSchema.options.indexOf(kind));
  if (kinds[0] !== 'input' || order.some((position, i) => i > 0 && position <= order[i - 1]!)) {
    reject('Pending parts must be unique, canonical and include the original input');
  }
  const part = (kind: StoryPendingPartKind) => value.parts.find((item) => item.kind === kind);
  if (part('input')?.digest !== value.inputDigest) reject('Pending input digest does not match its declaration');
  const limits: Partial<Record<StoryPendingPartKind, number>> = {
    input: STORY_PENDING_LIMITS.inputBytes, meta: STORY_PENDING_LIMITS.metaBytes,
    header: STORY_PENDING_LIMITS.headerBytes, roleResponse: STORY_PENDING_LIMITS.roleResponseBytes,
  };
  if (value.parts.some((item) => item.byteLength > (limits[item.kind] ?? STORY_PENDING_LIMITS.slotBytes))
    || (part('markdown')?.byteLength ?? 0) + (part('reasoning')?.byteLength ?? 0) > STORY_PENDING_LIMITS.outputContentBytes
    || value.parts.reduce((total, item) => total + item.byteLength, 0) > STORY_PENDING_LIMITS.slotBytes
    || jsonUtf8ByteLength(value) > STORY_PENDING_LIMITS.metadataBytes) reject('Pending declaration exceeds its byte budget');
  const start = value.expectedRevision === 0;
  if (start !== (value.initialCheckpointId !== null) || start !== (value.expectedLastChapterId === null)
    || (start && (value.lastInputCheckpointId !== value.initialCheckpointId
      || value.initialCheckpointId === value.outputCheckpointId))) reject('Inconsistent pending story baseline');
  if ((value.roleState === 'accepted') !== Boolean(part('roleResponse'))
    || (value.roleState === 'not-requested') !== (value.roleInputDigest === null)) reject('Inconsistent pending role evidence');
  const commitParts = value.parts.filter((item) => StoryPartKindSchema.safeParse(item.kind).success);
  const commit = value.commitManifest;
  if (commit === null) {
    if (commitParts.length !== 0) reject('Commit parts require the frozen commit manifest');
  } else if (!value.modelCompleted || value.roleState === 'unresolved'
    || commit.sessionId !== value.sessionId || commit.operationId !== value.operationId
    || commit.expectedRevision !== value.expectedRevision || commit.expectedLastChapterId !== value.expectedLastChapterId
    || commit.parts.length !== commitParts.length || commit.parts.some((item, i) => {
      const declared = commitParts[i];
      return !declared || item.kind !== declared.kind || item.byteLength !== declared.byteLength || item.digest !== declared.digest;
    })) reject('Pending frozen commit does not match its exact declaration and identity');
});
export type StoryPendingManifest = z.infer<typeof StoryPendingManifestSchema>;

export const StoryPendingKeySchema = z.object({
  product: DesktopArenaHostedProductSchema, requestId: DesktopArenaHostedRequestIdSchema, pendingRevision: integer.min(1),
}).strict();
export type StoryPendingKey = z.infer<typeof StoryPendingKeySchema>;
export const StoryPendingSnapshotSchema = z.object({
  manifest: StoryPendingManifestSchema, saveAttemptId: StoryBeginOutcomeSchema.shape.token.nullable(), restored: z.boolean(),
}).strict();
export type StoryPendingSnapshot = z.infer<typeof StoryPendingSnapshotSchema>;
export const StoryPendingBeginOutcomeSchema = z.object({
  token: StoryBeginOutcomeSchema.shape.token, totalBytes: integer.min(1).max(STORY_PENDING_LIMITS.slotBytes),
}).strict();
export const StoryPendingAppendOutcomeSchema = z.object({
  token: StoryBeginOutcomeSchema.shape.token, kind: StoryPendingPartKindSchema,
  receivedBytes: integer.max(STORY_PENDING_LIMITS.slotBytes),
}).strict();
/** Input/header/meta/roleResponse bytes are validated before persistence. An
 * incomplete carrier may have an in-memory append acknowledgement but a durable query offset of zero. Consumers
 * must not infer safe append replay or automatic upload retry from that offset. */
export const StoryPendingUploadSchema = z.object({
  token: StoryBeginOutcomeSchema.shape.token, manifest: StoryPendingManifestSchema,
  receivedBytes: z.array(z.object({
    kind: StoryPendingPartKindSchema, receivedBytes: integer.max(STORY_PENDING_LIMITS.slotBytes),
  }).strict()).min(1).max(StoryPendingPartKindSchema.options.length),
}).strict().superRefine((value, context) => {
  if (value.receivedBytes.length !== value.manifest.parts.length || value.receivedBytes.some((item, i) => {
    const declared = value.manifest.parts[i];
    return !declared || item.kind !== declared.kind || item.receivedBytes > declared.byteLength;
  })) context.addIssue({ code: 'custom', message: 'Pending offsets do not match the declared parts' });
});
export const StoryPendingSaveRequestSchema = z.object({ key: StoryPendingKeySchema, wireDigest: digest }).strict();
export const StoryPendingSaveAttemptRequestSchema = StoryPendingSaveRequestSchema.extend({ attemptId: StoryBeginOutcomeSchema.shape.token }).strict();
export const StoryPendingSavePreparationSchema = z.object({ attemptId: StoryBeginOutcomeSchema.shape.token }).strict();
export type StoryPendingSaveRequest = z.infer<typeof StoryPendingSaveRequestSchema>;
export type StoryPendingSaveAttemptRequest = z.infer<typeof StoryPendingSaveAttemptRequestSchema>;
