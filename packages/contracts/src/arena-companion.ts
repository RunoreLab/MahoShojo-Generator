import { z } from './zod';
import { ARENA_CANONICAL_RESOURCE_LIMITS } from './arena-capabilities';
import { DesktopArenaHostedGenerationIdSchema, DesktopArenaHostedPublicBodySchema } from './desktop-arena-hosted';
import { ProviderModelIdSchema } from './provider-target';
import { WebPackageArtifactSchema, WebPackageRefSchema } from './web-package';

/** Opt-in complete non-stream report. It does not change the legacy Web or SSE contract. */
export const ARENA_COMPANION_PROTOCOL_VERSION = 'arena-companion-v1' as const;
export const ARENA_COMPANION_PROTOCOL_HEADER = 'X-Mahoshojo-Arena-Companion-Protocol';
export const ARENA_COMPANION_JSON_LIMITS = Object.freeze({
  // Proven source bound: 12O + 2I + two copies of 2100 resolved nodes + bounded SDK metadata + fixed skeleton.
  wireBytes: 12 * ARENA_CANONICAL_RESOURCE_LIMITS.outputContentBytes
    + 2 * ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes
    + 2 * 2100 * 256 + 6 * (12000 + 80 + 200) + 65536,
  adjudicationNodes: 2100,
});

const mode = z.enum(['classic', 'kizuna', 'daily', 'scenario']);
const reporter = z.object({ name: z.string(), publication: z.string() }).strict();
const guidance = z.object({ characterName: z.string(), guidance: z.string().max(100) }).strict();
const impact = z.object({ characterName: z.string(), impact: z.string().optional(), currentStateSummary: z.string().optional() }).strict();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ArenaCompanionAdjudicationResultSchema = z.object({
  depth: z.number().int().min(0).max(20), description: z.string(), type: z.string(),
  roll: z.number().int().min(1).max(100), outcome: z.string(), details: z.string(),
}).strict();
const adjudications = z.array(ArenaCompanionAdjudicationResultSchema).max(ARENA_COMPANION_JSON_LIMITS.adjudicationNodes);

/** Normalizer's native candidates + reasoning sum legitimately exceeds MAX_SAFE_INTEGER. */
export const ArenaCompanionUsageSchema = z.object({
  promptTokens: count.optional(),
  completionTokens: z.number().nonnegative().max(2 * Number.MAX_SAFE_INTEGER).refine(Number.isInteger).optional(),
  totalTokens: count.optional(), cachedTokens: count.optional(), reasoningTokens: count.optional(), textTokens: count.optional(),
  completionTokensIncludesReasoning: z.boolean().optional(),
}).strict();
export const ArenaCompanionReasoningSchema = z.union([
  z.object({
    status: z.enum(['done', 'unavailable']), source: z.literal('sdk'),
    text: z.string().max(12000).nullable(), summary: z.string().max(80).nullable(),
    // The existing SDK reader floors any finite number, not only nonnegative safe integers.
    reasoningTokens: z.number().refine(Number.isInteger).nullable(),
    anomalyFlags: z.tuple([z.literal('truncated')]).optional(),
  }).strict(),
  z.object({ status: z.literal('complete'), text: z.string() }).strict(),
]);
/** Validate the existing model rule without applying its trim transformation. */
export const ArenaCompanionModelIdSchema = z.string().refine((value) => {
  const parsed = ProviderModelIdSchema.safeParse(value);
  return parsed.success && parsed.data === value;
}, 'unsupported model metadata');

export const ArenaCompanionMetadataSchema = z.object({
  reportFormat: z.enum(['markdown', 'web']),
  outputContract: z.enum(['structured-report', 'web-document', 'web-package-target']),
  webPackageRef: WebPackageRefSchema.optional(), mode: mode.optional(),
  scenarioDisplayName: z.string().optional(), language: z.string().optional(), storyLength: z.string().optional(),
  reporterInfo: reporter.optional(), userGuidance: z.string().max(200).optional(),
  characterGuidances: z.array(guidance).max(32).optional(), adjudicationResults: adjudications.optional(),
  narrativeHistoryReadCount: count.optional(),
}).strict().superRefine((value, context) => {
  if ((value.reportFormat === 'markdown') !== (value.outputContract === 'structured-report')
    || (value.outputContract === 'web-package-target') !== Boolean(value.webPackageRef)) {
    context.addIssue({ code: 'custom', message: 'inconsistent companion output contract' });
  }
});
export type ArenaCompanionMetadata = z.infer<typeof ArenaCompanionMetadataSchema>;
export const ArenaCompanionReportSchema = z.object({
  headline: z.string(), reporterInfo: reporter,
  article: z.object({ body: z.string(), analysis: z.string() }).strict(),
  officialReport: z.object({ winner: z.string(), conclusion: z.string() }).strict(), mode,
  reportFormat: z.literal('web').optional(), webHtml: z.string().optional(), webPackage: WebPackageArtifactSchema.optional(),
  userGuidance: z.string().max(200).optional(), characterGuidances: z.array(guidance).max(32).optional(),
  aiModel: ArenaCompanionModelIdSchema.optional(), aiUsage: ArenaCompanionUsageSchema.optional(),
  aiReasoning: ArenaCompanionReasoningSchema.optional(), narrativeHistoryReadCount: count.optional(),
}).strict().superRefine((value, context) => {
  if (value.reportFormat === 'web'
    ? (value.webHtml === undefined) === (value.webPackage === undefined)
    : value.webHtml !== undefined || value.webPackage !== undefined) {
    context.addIssue({ code: 'custom', message: 'inconsistent companion report format' });
  }
});
export type ArenaCompanionReport = z.infer<typeof ArenaCompanionReportSchema>;
export const ArenaCompanionSuccessBodySchema = z.object({
  report: ArenaCompanionReportSchema, updatedCombatants: z.tuple([]), generationId: DesktopArenaHostedGenerationIdSchema,
  adjudicationResults: adjudications.optional(), impacts: z.array(impact).optional(),
}).strict();
export type ArenaCompanionSuccessBody = z.infer<typeof ArenaCompanionSuccessBodySchema>;
export const ArenaCompanionErrorBodySchema = DesktopArenaHostedPublicBodySchema.refine((value) => Boolean(value.code || value.error));
export const ArenaCompanionSuccessEnvelopeSchema = z.object({
  version: z.literal(ARENA_COMPANION_PROTOCOL_VERSION), body: ArenaCompanionSuccessBodySchema, metadata: ArenaCompanionMetadataSchema,
}).strict().superRefine((value, context) => {
  const { report } = value.body;
  const isWeb = value.metadata.reportFormat === 'web';
  if (isWeb !== (report.reportFormat === 'web')
    || (value.metadata.outputContract === 'web-package-target') !== Boolean(report.webPackage)
    || (report.webHtml !== undefined && report.webHtml !== report.article.body)
    || (report.webPackage && JSON.stringify(report.webPackage.packageRef) !== JSON.stringify(value.metadata.webPackageRef))) {
    context.addIssue({ code: 'custom', message: 'inconsistent companion envelope' });
  }
});
export type ArenaCompanionSuccessEnvelope = z.infer<typeof ArenaCompanionSuccessEnvelopeSchema>;
export const ArenaCompanionErrorEnvelopeSchema = z.object({
  version: z.literal(ARENA_COMPANION_PROTOCOL_VERSION), body: ArenaCompanionErrorBodySchema,
  metadata: ArenaCompanionMetadataSchema.nullable(),
}).strict();
export const ArenaCompanionEnvelopeSchema = z.union([ArenaCompanionSuccessEnvelopeSchema, ArenaCompanionErrorEnvelopeSchema]);
export type ArenaCompanionEnvelope = z.infer<typeof ArenaCompanionEnvelopeSchema>;

/** No raw wire is retained by the result; export preserves JSON value semantics, not HTTP bytes. */
export const parseArenaCompanionEnvelope = (raw: string): ArenaCompanionEnvelope => {
  if (new TextEncoder().encode(raw).byteLength > ARENA_COMPANION_JSON_LIMITS.wireBytes) {
    throw new Error('ARENA_COMPANION_RESPONSE_TOO_LARGE');
  }
  return ArenaCompanionEnvelopeSchema.parse(JSON.parse(raw));
};
