import { z } from './zod';
import { JsonValueSchema, type JsonValue } from './json-value';
import { jsonUtf8ByteLength, utf8ByteLimitedStringSchema } from './wire-size';
import { DesktopHostedPresetConfigSchema, DesktopHostedSystemConfigSchema } from './desktop-cloud';
import { ARENA_CANONICAL_CAPABILITIES, ARENA_CANONICAL_RESOURCE_LIMITS } from './arena-capabilities';
import { WebPackageArtifactSchema, WebPackageRefSchema, WebPackagePromptProjectionSchema } from './web-package';

/** Independent Arena protocol: never expands the existing six Hosted families. */
export const DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION = 'arena-hosted-sse-v1' as const;
export const ARENA_EXPECTED_USER_ID_HEADER = 'X-Mahoshojo-Arena-Expected-User-Id';
export const DESKTOP_ARENA_HOSTED_CAPABILITY_PATH = '/api/hosted/dr-readiness';
/** Missing is legacy; present-but-invalid is never an authentication fallback. */
export const parseArenaExpectedUserIdAssertion = (value: string): number | null => {
  if (!/^v1:[1-9][0-9]{0,15}$/u.test(value)) return null;
  const id = Number(value.slice(3));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export const DESKTOP_ARENA_HOSTED_LIMITS = Object.freeze({
  requestBodyBytes: ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes,
  outputContentBytes: ARENA_CANONICAL_RESOURCE_LIMITS.outputContentBytes,
  eventWireBytes: 6 * ARENA_CANONICAL_RESOURCE_LIMITS.outputContentBytes + 64 * 1024,
  ipcTextBytes: 64 * 1024,
  ipcEnvelopeBytes: 512 * 1024,
  headerEncodedBytes: 64 * 1024,
  headerDecodedBytes: 64 * 1024,
  recoveryPointerCodeUnits: 16_384,
});
export const DesktopArenaHostedCapabilitySchema = z.object({
  contractVersion: z.literal(DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION),
  expectedUserIdAssertion: z.literal('v1'),
  stream: z.literal('sse-v1'),
}).strict();
export const DESKTOP_ARENA_HOSTED_CAPABILITY = Object.freeze(DesktopArenaHostedCapabilitySchema.parse({
  contractVersion: DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION, expectedUserIdAssertion: 'v1', stream: 'sse-v1',
}));
export const DesktopArenaHostedReadinessSchema = z.object({
  ok: z.literal(true), contractVersion: z.literal('g25e1-v1'), placement: z.literal('hono-primary'),
  databaseProvider: z.literal('hono-d1-primary'), consistency: z.literal('replica-ok'),
  arenaHosted: DesktopArenaHostedCapabilitySchema,
}).strict();
export const DesktopArenaHostedProductSchema = z.enum(['battle', 'arena']);
export const DesktopArenaHostedRequestIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);
export const DesktopArenaHostedGenerationIdSchema = z.string().regex(/^arena_[a-f0-9]{64}$/u);
export const DesktopArenaHostedCursorSchema = z.string().max(128).regex(/^\d+-\d+$/u);
export const DesktopArenaHostedActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('anonymous') }).strict(),
  z.object({ kind: z.literal('account'), expectedUserId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
]);
export type DesktopArenaHostedActor = z.infer<typeof DesktopArenaHostedActorSchema>;
export const DesktopArenaHostedScopeSchema = z.object({
  product: DesktopArenaHostedProductSchema, requestId: DesktopArenaHostedRequestIdSchema,
  actor: DesktopArenaHostedActorSchema,
}).strict();
export type DesktopArenaHostedScope = z.infer<typeof DesktopArenaHostedScopeSchema>;

const JsonObjectSchema = JsonValueSchema.refine((v): v is Record<string, JsonValue> => v !== null && typeof v === 'object' && !Array.isArray(v))
  .transform((v) => v as Record<string, JsonValue>);
const json = JsonValueSchema;
/** Nested user card data remains lossless; only the top-level authority surface is closed. */
const DesktopArenaHostedWritableBodySchema = z.object({
  reportFormat: z.enum(['markdown', 'web']),
  combatants: z.array(JsonObjectSchema).min(1).max(32),
  mode: z.enum(['classic', 'kizuna', 'daily', 'scenario']),
  webPackageRef: WebPackageRefSchema.optional(), webPackagePromptProjection: WebPackagePromptProjectionSchema.optional(),
  arenaFreeRankingEnabled: z.literal(false).optional(), userGuidance: z.string().optional(),
  scenario: JsonObjectSchema.optional(), auxScenarios: z.array(json).optional(), materials: z.array(json).optional(),
  scenarioTitle: z.string().nullable().optional(), scenarioFileName: z.string().nullable().optional(),
  scenarioSourceDataCardId: z.string().optional(), scenarioSourceDataCardUpdatedAt: z.string().optional(),
  teams: JsonObjectSchema.optional(), teamNames: JsonObjectSchema.optional(), language: z.string().optional(),
  readArenaHistory: z.boolean().optional(), arenaHistoryReadLimit: z.number().int().positive().nullable().optional(),
  writeArenaHistory: z.boolean(), readCurrentState: z.boolean().optional(), writeCurrentState: z.boolean(),
  readNarrativeHistory: z.boolean().optional(), writeNarrativeHistory: z.boolean().optional(),
  narrativeHistoryReadLimit: z.number().int().positive().nullable().optional(), narrativeHistory: z.array(json).optional(),
  isDowngrade: z.literal(false).optional(), adjudicationEvents: z.array(json).max(100).optional(),
  storyLength: z.string().optional(), customStoryLength: z.string().optional(),
  questionnaireSelections: z.array(json).optional(), questionnaires: z.array(json).optional(),
}).strict().superRefine((body, ctx) => {
  if (body.combatants.length < ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode[body.mode]
    || (body.mode === 'scenario' && !body.scenario)
    || [body.auxScenarios, body.materials, body.questionnaires, body.narrativeHistory].reduce((n, a) => n + (a?.length ?? 0), 0) > 256
    || jsonUtf8ByteLength(body) > DESKTOP_ARENA_HOSTED_LIMITS.requestBodyBytes
    || (body.reportFormat !== 'web' && (body.webPackageRef || body.webPackagePromptProjection))) {
    ctx.addIssue({ code: 'custom', message: 'invalid Arena Hosted business request' });
  }
});
export const DesktopArenaHostedBodySchema = DesktopArenaHostedWritableBodySchema.refine(
  value => !value.writeArenaHistory && !value.writeCurrentState, 'legacy Arena writes remain disabled');
export type DesktopArenaHostedBody = z.infer<typeof DesktopArenaHostedBodySchema>;
const scope = DesktopArenaHostedScopeSchema.shape;
export const DesktopArenaHostedCreateRequestSchema = z.object({
  operation: z.literal('create-stream'), ...scope,
  body: DesktopArenaHostedWritableBodySchema,
  reconciliationVersion: z.literal('arena-reconciliation-v1').optional(),
  systemConfig: DesktopHostedSystemConfigSchema.optional(), presetConfig: DesktopHostedPresetConfigSchema.optional(),
  replaceRequestId: DesktopArenaHostedRequestIdSchema.optional(),
}).strict().refine((v) => !(v.systemConfig && v.presetConfig), { message: 'funding selections are mutually exclusive' })
  .refine((v) => v.reconciliationVersion !== undefined || (!v.body.writeArenaHistory && !v.body.writeCurrentState), { message: 'legacy Arena writes remain disabled' });
export const DesktopArenaHostedResumeRequestSchema = z.object({
  operation: z.literal('resume'), ...scope, generationId: DesktopArenaHostedGenerationIdSchema,
  after: DesktopArenaHostedCursorSchema.optional(),
}).strict();
export const DesktopArenaHostedStreamRequestSchema = z.discriminatedUnion('operation', [
  DesktopArenaHostedCreateRequestSchema, DesktopArenaHostedResumeRequestSchema,
]);
export const DesktopArenaHostedControlRequestSchema = z.discriminatedUnion('operation', [
  // Explicit user recovery may rebind the same intent to a new verified session epoch; never automatic C0 lookup.
  z.object({ operation: z.literal('lookup-request'), ...scope, restoreSession: z.literal(true).optional() }).strict(),
  z.object({ operation: z.literal('status'), ...scope, generationId: DesktopArenaHostedGenerationIdSchema }).strict(),
  z.object({ operation: z.literal('stop'), ...scope, generationId: DesktopArenaHostedGenerationIdSchema.optional(), reason: z.enum(['user', 'content_policy']) }).strict(),
]);
export const DesktopArenaHostedDetachRequestSchema = z.object({ product: DesktopArenaHostedProductSchema, requestId: DesktopArenaHostedRequestIdSchema }).strict();
export const DesktopArenaHostedOperationSchema = z.union([DesktopArenaHostedStreamRequestSchema, DesktopArenaHostedControlRequestSchema]);
export type DesktopArenaHostedStreamRequest = z.infer<typeof DesktopArenaHostedStreamRequestSchema>;
export type DesktopArenaHostedControlRequest = z.infer<typeof DesktopArenaHostedControlRequestSchema>;
export type DesktopArenaHostedDetachRequest = z.infer<typeof DesktopArenaHostedDetachRequestSchema>;
export type DesktopArenaHostedOperation = z.infer<typeof DesktopArenaHostedOperationSchema>;
export const DesktopArenaHostedPublicBodySchema = z.object({
  generationId: DesktopArenaHostedGenerationIdSchema.optional(), generationRequestId: DesktopArenaHostedRequestIdSchema.optional(),
  code: z.string().max(128).regex(/^[A-Z][A-Z0-9_]+$/u).optional(), error: z.string().max(2048).optional(), message: z.string().max(2048).optional(),
  status: z.enum(['reserved', 'running', 'finalizing', 'completed', 'failed', 'cancelled', 'producer_lost', 'cancelling']).optional(),
  cancelled: z.boolean().optional(), resumable: z.boolean().optional(), lastEventId: DesktopArenaHostedCursorSchema.nullable().optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(), resultRef: z.string().max(2048).nullable().optional(),
  finalAuthoritative: z.boolean().optional(), resultAvailable: z.boolean().optional(), replayUnavailable: z.boolean().optional(),
  persistenceWarning: z.enum(['OUTPUT_NOT_ARCHIVED', 'PERSISTENCE_UNAVAILABLE']).optional(), contentRetention: z.literal('expired').optional(),
}).strict().refine((v) => v.status !== undefined || v.code !== undefined || v.error !== undefined);
export type DesktopArenaHostedPublicBody = z.infer<typeof DesktopArenaHostedPublicBodySchema>;
export const DesktopArenaHostedHeaderMetaSchema = z.object({
  reportFormat: z.enum(['markdown', 'web']), webPackageRef: WebPackageRefSchema.optional(),
  mode: z.enum(['classic', 'kizuna', 'daily', 'scenario']).optional(), scenarioDisplayName: z.string().optional(),
  language: z.string().optional(), storyLength: z.string().optional(),
  outputContract: z.enum(['stream-markdown', 'web-document', 'web-package-target']).optional(),
  reporterInfo: JsonObjectSchema.optional(), userGuidance: z.string().optional(),
  characterGuidances: z.array(json).max(32).optional(), adjudicationResults: z.array(json).max(100).optional(),
  narrativeHistoryReadCount: z.number().int().nonnegative().optional(),
}).strict().refine((v) => jsonUtf8ByteLength(v) <= DESKTOP_ARENA_HOSTED_LIMITS.headerDecodedBytes);
export type DesktopArenaHostedHeaderMeta = z.infer<typeof DesktopArenaHostedHeaderMetaSchema>;
export const DesktopArenaHostedMetadataStateSchema = z.enum(['available', 'missing', 'invalid', 'oversized']);
export const DesktopArenaHostedRecoveryCredentialStateSchema = z.enum(['stored', 'memory-only']);
const sequence = { requestId: DesktopArenaHostedRequestIdSchema, sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) };
export const DesktopArenaHostedChannelEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('response'), ...sequence, status: z.number().int().min(100).max(599),
    generationId: DesktopArenaHostedGenerationIdSchema.optional(), generationRequestId: DesktopArenaHostedRequestIdSchema.optional(),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(), headerMeta: DesktopArenaHostedHeaderMetaSchema.optional(),
    body: DesktopArenaHostedPublicBodySchema.optional(),
    metadataState: DesktopArenaHostedMetadataStateSchema, recoveryCredentialState: DesktopArenaHostedRecoveryCredentialStateSchema,
  }).strict(),
  z.object({ kind: z.literal('sse-fragment'), ...sequence, text: utf8ByteLimitedStringSchema(DESKTOP_ARENA_HOSTED_LIMITS.ipcTextBytes), final: z.boolean() }).strict(),
  z.object({ kind: z.literal('stream-end'), ...sequence }).strict(),
]).superRefine((v, ctx) => {
  if (jsonUtf8ByteLength(v) > DESKTOP_ARENA_HOSTED_LIMITS.ipcEnvelopeBytes
    || (v.kind === 'response' && ((v.status >= 200 && v.status < 300 && v.body !== undefined)
      || ((v.metadataState === 'available') !== Boolean(v.headerMeta)
      || (v.headerMeta && jsonUtf8ByteLength(v.headerMeta) > DESKTOP_ARENA_HOSTED_LIMITS.headerDecodedBytes))))) {
    ctx.addIssue({ code: 'custom', message: 'invalid Arena Hosted IPC envelope' });
  }
});
export type DesktopArenaHostedChannelEvent = z.infer<typeof DesktopArenaHostedChannelEventSchema>;
export const DesktopArenaHostedControlResponseSchema = z.object({
  status: z.number().int().min(100).max(599), body: DesktopArenaHostedPublicBodySchema,
  recoveryCredentialState: DesktopArenaHostedRecoveryCredentialStateSchema,
}).strict().refine((v) => jsonUtf8ByteLength(v) <= DESKTOP_ARENA_HOSTED_LIMITS.ipcEnvelopeBytes);
export type DesktopArenaHostedControlResponse = z.infer<typeof DesktopArenaHostedControlResponseSchema>;
export const DesktopArenaHostedRecoveryPointerSchema = z.object({
  version: z.literal(1), product: DesktopArenaHostedProductSchema,
  protocolVersion: z.literal(DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION), requestId: DesktopArenaHostedRequestIdSchema,
  generationId: DesktopArenaHostedGenerationIdSchema.optional(), cursor: DesktopArenaHostedCursorSchema.optional(),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/u), actor: DesktopArenaHostedActorSchema,
  format: z.enum(['markdown', 'web']), battleMode: z.enum(['classic', 'kizuna', 'daily', 'scenario']),
  webPackageRef: WebPackageRefSchema.optional(), updatedAt: z.string().datetime({ offset: true }),
  state: z.enum(['prepared', 'dispatched', 'connecting', 'generating', 'recovering_initial', 'reconnecting', 'resuming', 'unknown', 'cancelling', 'cancelled', 'cancel_unconfirmed', 'completed', 'failed', 'interrupted', 'producer_lost']),
}).strict().refine((v) => JSON.stringify(v).length <= DESKTOP_ARENA_HOSTED_LIMITS.recoveryPointerCodeUnits
  && (v.format === 'web' || v.webPackageRef === undefined));
export type DesktopArenaHostedRecoveryPointer = z.infer<typeof DesktopArenaHostedRecoveryPointerSchema>;

const GenerationStatusSchema = z.enum(['reserved', 'running', 'finalizing', 'completed', 'failed', 'cancelled', 'producer_lost']);
const TerminalStatusSchema = z.enum(['completed', 'failed', 'cancelled', 'producer_lost']);
const warning = z.enum(['OUTPUT_NOT_ARCHIVED', 'PERSISTENCE_UNAVAILABLE']);
const publicCode = z.string().max(128).regex(/^[A-Z][A-Z0-9_]+$/u);
const shortText = z.string().max(2048);
const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional();
export const DesktopArenaHostedTelemetrySchema = z.union([z.object({
  version: z.literal(1).optional(), aiModel: z.string().optional(),
  usage: z.object({ promptTokens: tokenCount, completionTokens: tokenCount, reasoningTokens: tokenCount, totalTokens: tokenCount, cachedTokens: tokenCount, textTokens: tokenCount, completionTokensIncludesReasoning: z.boolean().optional() }).strict().optional(),
  narrativeHistoryReadCount: z.number().int().nonnegative().optional(),
}).strict(), z.object({ errorClass: z.string().min(1).max(256) }).strict()]);
const terminal = {
  ok: z.boolean().optional(), status: TerminalStatusSchema, code: publicCode.optional(),
  error: shortText.optional(), message: shortText.optional(), resultRef: shortText.nullable().optional(),
  upstreamStatus: z.number().int().min(100).max(599).optional(), upstreamRequestId: shortText.optional(),
  webPackage: WebPackageArtifactSchema.optional(), persistenceWarning: warning.optional(),
  replayUnavailable: z.boolean().optional(), resultAvailable: z.boolean().optional(), contentRetention: z.literal('expired').optional(),
};
export const DesktopArenaHostedSseEventSchema = z.discriminatedUnion('event', [
  z.object({ id: DesktopArenaHostedCursorSchema, event: z.literal('markdown'), data: z.object({ chunk: z.string() }).strict() }).strict(),
  z.object({ id: DesktopArenaHostedCursorSchema, event: z.literal('reasoning'), data: z.object({ chunk: z.string(), source: z.literal('sdk').optional(), status: z.literal('thinking').optional() }).strict() }).strict(),
  z.object({ id: DesktopArenaHostedCursorSchema, event: z.literal('reasoning_done'), data: z.object({ source: z.literal('sdk'), status: z.enum(['done', 'unavailable']) }).strict() }).strict(),
  z.object({ id: DesktopArenaHostedCursorSchema, event: z.literal('telemetry'), data: DesktopArenaHostedTelemetrySchema }).strict(),
  z.object({ id: DesktopArenaHostedCursorSchema, event: z.literal('snapshot'), data: z.object({
    status: GenerationStatusSchema, markdown: z.string(), reasoning: z.string(), lastEventId: DesktopArenaHostedCursorSchema.nullable(),
    updatedAt: z.string().datetime({ offset: true }), telemetry: DesktopArenaHostedTelemetrySchema.nullable().optional(),
    terminalResultRef: shortText.nullable().optional(), persistenceWarning: warning.nullable().optional(),
  }).strict() }).strict(),
  z.object({ id: DesktopArenaHostedCursorSchema, event: z.literal('meta'), data: z.object({ parseOk: z.literal(true), meta: JsonObjectSchema, raw: z.string().max(8000), rawTruncated: z.boolean(), webPackage: WebPackageArtifactSchema.optional() }).strict() }).strict(),
  z.object({ id: DesktopArenaHostedCursorSchema, event: z.literal('meta_error'), data: z.object({ parseOk: z.literal(false), error: shortText, raw: z.string().max(8000).optional(), rawTruncated: z.boolean().optional() }).strict() }).strict(),
  z.object({ id: DesktopArenaHostedCursorSchema, event: z.literal('done'), data: z.object({ ...terminal, ok: z.boolean() }).strict().refine((v) => v.ok === (v.status === 'completed')) }).strict(),
  z.object({ id: DesktopArenaHostedCursorSchema, event: z.literal('error'), data: z.object(terminal).strict().refine((v) => (v.status === 'failed' || v.status === 'producer_lost') && v.ok !== true) }).strict(),
]).superRefine((v, ctx) => {
  const wire = `id: ${v.id}\nevent: ${v.event}\ndata: ${JSON.stringify(v.data)}\n\n`;
  const decoded = v.event === 'snapshot' ? v.data.markdown + v.data.reasoning
    : v.event === 'markdown' || v.event === 'reasoning' ? v.data.chunk : '';
  if (new TextEncoder().encode(wire).byteLength > DESKTOP_ARENA_HOSTED_LIMITS.eventWireBytes
    || new TextEncoder().encode(decoded).byteLength > DESKTOP_ARENA_HOSTED_LIMITS.outputContentBytes) {
    ctx.addIssue({ code: 'custom', message: 'Arena Hosted SSE budget exceeded' });
  }
});
export type DesktopArenaHostedSseEvent = z.infer<typeof DesktopArenaHostedSseEventSchema>;

/** Validates one complete block. No partial EOF, duplicate fields or extra transport directives. */
export const parseDesktopArenaHostedSseBlock = (block: string): DesktopArenaHostedSseEvent => {
  if (new TextEncoder().encode(block).byteLength > DESKTOP_ARENA_HOSTED_LIMITS.eventWireBytes
    || !block.endsWith('\n\n') || block.includes('\r')) throw new Error('ARENA_HOSTED_PROTOCOL_INVALID');
  const lines = block.slice(0, -2).split('\n');
  if (lines.length !== 3 || !lines[0]?.startsWith('id: ') || !lines[1]?.startsWith('event: ') || !lines[2]?.startsWith('data: ')) {
    throw new Error('ARENA_HOSTED_PROTOCOL_INVALID');
  }
  return DesktopArenaHostedSseEventSchema.parse({ id: lines[0].slice(4), event: lines[1].slice(7), data: JSON.parse(lines[2].slice(6)) });
};

/** Safe Native failure evidence; only unknown may enter C0 first-response recovery. */
export const DesktopArenaHostedErrorSchema = z.object({
  code: z.enum(['invalid-request', 'invalid-response', 'storage-unavailable', 'scope-changed', 'network-error',
    'capability-unavailable', 'reconciliation-capability-unavailable', 'reconciliation-output-too-large', 'create-already-attempted', 'recovery-conflict', 'recovery-unavailable', 'recovery-expired',
    'generation-unavailable', 'resume-cursor-mismatch', 'subscription-in-progress', 'output-too-large', 'stream-truncated', 'detached']),
  message: z.string().min(1).max(512), dispatchState: z.enum(['not-dispatched', 'unknown']),
  // Independent native evidence: only prior-retained can authorize a conditional local-pointer rollback.
  intentOwnership: z.enum(['prior-retained', 'current-owned', 'unknown']),
}).strict();
export type DesktopArenaHostedError = z.infer<typeof DesktopArenaHostedErrorSchema>;

/** Local read-only identity hint, never an assertion that the server retains a result. */
export const DesktopArenaHostedRecoveryHintRequestSchema = z.object({ product: DesktopArenaHostedProductSchema }).strict();
export type DesktopArenaHostedRecoveryHintRequest = z.infer<typeof DesktopArenaHostedRecoveryHintRequestSchema>;
const recoveryHintIdentity = {
  product: DesktopArenaHostedProductSchema, requestId: DesktopArenaHostedRequestIdSchema,
  actorKind: z.enum(['anonymous', 'account']),
};
export const DesktopArenaHostedRecoveryHintSchema = z.discriminatedUnion('state', [
  z.object({ product: DesktopArenaHostedProductSchema, state: z.literal('none') }).strict(),
  z.object({ product: DesktopArenaHostedProductSchema, state: z.literal('unavailable') }).strict(),
  z.object({ ...recoveryHintIdentity, state: z.literal('available') }).strict(),
  z.object({ ...recoveryHintIdentity, state: z.literal('expired') }).strict(),
]);
export type DesktopArenaHostedRecoveryHint = z.infer<typeof DesktopArenaHostedRecoveryHintSchema>;
