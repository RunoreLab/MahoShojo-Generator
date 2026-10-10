import { z } from 'zod';

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
    'story-conflict', 'story-operation-mismatch', 'story-missing', 'maintenance-busy', 'story-io', 'story-export-no-space', 'story-corrupt', 'story-commit-unknown']),
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
