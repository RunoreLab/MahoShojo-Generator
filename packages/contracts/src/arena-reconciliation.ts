import { z } from './zod';
import { ARENA_CANONICAL_CAPABILITIES, ARENA_CANONICAL_RESOURCE_LIMITS } from './arena-capabilities';
import { JsonValueSchema, type JsonValue } from './json-value';
import { jsonUtf8ByteLength, utf8ByteLength } from './wire-size';

/** Explicit Next opt-in. Headerless Web reconciliation retains its existing contract. */
export const ARENA_RECONCILIATION_PROTOCOL_VERSION = 'arena-reconciliation-v1' as const;
export const ARENA_RECONCILIATION_PROTOCOL_HEADER = 'X-Mahoshojo-Arena-Reconciliation-Protocol';
export const ARENA_RECONCILIATION_LIMITS = Object.freeze({
  requestBodyBytes: ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes,
  maxCombatants: ARENA_CANONICAL_CAPABILITIES.maxCombatants,
  // A separate Desktop receive budget, NOT an upper bound for every legal producer result.
  responseBodyBytes: 16 * 1024 * 1024,
  // At most one issue for each current, frozen, and ambiguous-name roster entry.
  maxIssues: 3 * ARENA_CANONICAL_CAPABILITIES.maxCombatants,
});

export const ArenaReconciliationCapabilitySchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(ARENA_RECONCILIATION_PROTOCOL_VERSION),
  expectedUserIdAssertion: z.literal('v1'),
  ownership: z.literal('generation-actor'),
  effects: z.literal('frozen-manifest-v1'),
}).strict();
export const ARENA_RECONCILIATION_CAPABILITY = Object.freeze(ArenaReconciliationCapabilitySchema.parse({
  ok: true,
  contractVersion: ARENA_RECONCILIATION_PROTOCOL_VERSION,
  expectedUserIdAssertion: 'v1',
  ownership: 'generation-actor',
  effects: 'frozen-manifest-v1',
}));

export const ArenaReconciliationGenerationIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);
const jsonObject = JsonValueSchema.refine((value) => value !== null && typeof value === 'object' && !Array.isArray(value))
  .transform((value) => value as Record<string, JsonValue>);
const combatantIndex = z.number().int().nonnegative().max(ARENA_RECONCILIATION_LIMITS.maxCombatants - 1);

/** Only readable card identity and data cross this boundary, never client native authority. */
export const ArenaReconciliationCombatantSchema = z.object({
  type: z.string(),
  data: jsonObject,
  isPreset: z.boolean().optional(),
  filename: z.string().optional(),
  sourceDataCardId: z.string().optional(),
  dataCardId: z.string().optional(),
  roomCombatantKey: z.string().optional(),
}).strict();
export const ArenaReconciliationRequestSchema = z.object({
  generationId: ArenaReconciliationGenerationIdSchema,
  combatants: z.array(ArenaReconciliationCombatantSchema).min(1).max(ARENA_RECONCILIATION_LIMITS.maxCombatants),
}).strict().refine((value) => jsonUtf8ByteLength(value) <= ARENA_RECONCILIATION_LIMITS.requestBodyBytes);
export type ArenaReconciliationRequest = z.infer<typeof ArenaReconciliationRequestSchema>;

/** These are the existing Next producer's three warning/error shapes, including null names. */
export const ArenaReconciliationIssueSchema = z.union([
  z.object({
    combatantIndex,
    code: z.literal('ARENA_RECONCILIATION_COMBATANT_UNMATCHED'),
    message: z.string(),
  }).strict(),
  z.object({
    rosterIndex: combatantIndex,
    characterName: z.string().nullable(),
    code: z.literal('ARENA_RECONCILIATION_ROSTER_COMBATANT_MISSING'),
    message: z.string(),
  }).strict(),
  z.object({
    characterName: z.string().nullable(),
    code: z.literal('ARENA_RECONCILIATION_IMPACT_AMBIGUOUS'),
    message: z.string(),
  }).strict(),
]);
export type ArenaReconciliationIssue = z.infer<typeof ArenaReconciliationIssueSchema>;
const issues = z.array(ArenaReconciliationIssueSchema).max(ARENA_RECONCILIATION_LIMITS.maxIssues);
export const ArenaReconciliationUpdatedCombatantSchema = z.object({
  combatantIndex,
  data: jsonObject,
  isNative: z.boolean(),
}).strict().refine((value) => !value.isNative
  || (typeof value.data.signature === 'string' && value.data.signature.trim().length > 0),
'native results require fresh server signature evidence');
export const ArenaReconciliationSuccessSchema = z.object({
  version: z.literal(ARENA_RECONCILIATION_PROTOCOL_VERSION),
  generationId: ArenaReconciliationGenerationIdSchema,
  success: z.literal(true),
  updatedCombatants: z.array(ArenaReconciliationUpdatedCombatantSchema).max(ARENA_RECONCILIATION_LIMITS.maxCombatants),
  warnings: issues,
}).strict().refine((value) => new Set(value.updatedCombatants.map((entry) => entry.combatantIndex)).size === value.updatedCombatants.length,
  'duplicate combatant index');
export type ArenaReconciliationSuccess = z.infer<typeof ArenaReconciliationSuccessSchema>;
export const ArenaReconciliationErrorSchema = z.object({
  version: z.literal(ARENA_RECONCILIATION_PROTOCOL_VERSION),
  generationId: ArenaReconciliationGenerationIdSchema.optional(),
  code: z.string().min(1),
  error: z.string().min(1),
  errors: issues.optional(),
}).strict();
export type ArenaReconciliationError = z.infer<typeof ArenaReconciliationErrorSchema>;
export const ArenaReconciliationResponseSchema = z.union([
  ArenaReconciliationSuccessSchema,
  ArenaReconciliationErrorSchema,
]);
export type ArenaReconciliationResponse = z.infer<typeof ArenaReconciliationResponseSchema>;

/** Validate the entire response before any local card is replaced; never truncate or partly apply. */
export const parseArenaReconciliationResponse = (
  raw: string,
  generationId: string,
  combatantCount: number,
): ArenaReconciliationResponse => {
  if (!Number.isInteger(combatantCount) || combatantCount < 1 || combatantCount > ARENA_RECONCILIATION_LIMITS.maxCombatants
    || !ArenaReconciliationGenerationIdSchema.safeParse(generationId).success) {
    throw new Error('ARENA_RECONCILIATION_INVALID_CONTEXT');
  }
  if (utf8ByteLength(raw) > ARENA_RECONCILIATION_LIMITS.responseBodyBytes) {
    throw new Error('ARENA_RECONCILIATION_RESPONSE_TOO_LARGE');
  }
  const response = ArenaReconciliationResponseSchema.parse(JSON.parse(raw) as unknown);
  if (response.generationId !== undefined && response.generationId !== generationId) {
    throw new Error('ARENA_RECONCILIATION_GENERATION_MISMATCH');
  }
  const responseIssues = 'success' in response ? response.warnings : response.errors ?? [];
  if (('success' in response && response.updatedCombatants.some((entry) => entry.combatantIndex >= combatantCount))
    || responseIssues.some((issue) => 'combatantIndex' in issue && issue.combatantIndex >= combatantCount)) {
    throw new Error('ARENA_RECONCILIATION_COMBATANT_INDEX_INVALID');
  }
  return response;
};
