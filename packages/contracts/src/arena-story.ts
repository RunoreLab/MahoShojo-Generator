import { z } from './zod';
import { ARENA_CANONICAL_CAPABILITIES, ARENA_CANONICAL_RESOURCE_LIMITS } from './arena-capabilities';

/** Server creation protocol only. This does not advertise a Desktop journey or local save. */
export const ARENA_STORY_PROTOCOL_VERSION = 'arena-story-v1' as const;
export const ARENA_STORY_PROTOCOL_HEADER = 'X-Mahoshojo-Arena-Story-Protocol';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const index = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const record = z.record(z.string(), z.unknown());
const combatants = z.array(z.unknown()).min(1).max(ARENA_CANONICAL_CAPABILITIES.maxCombatants);
const readLimit = z.number().int().min(1).max(999).optional();

/** Same projection as the shared story prompt; text is explicitly full or digest context. */
export const ArenaStoryRecentWindowItemSchema = z.object({
  chapterId: id, chapterIndex: index, title: z.string(),
  mode: z.enum(['full', 'digest']), text: z.string(), truncated: z.boolean(),
}).strict();

export const ArenaStoryIdentitySchema = z.object({
  version: z.literal(1), sessionId: id, action: z.enum(['start', 'continue']),
  chapterIndex: index, sourceChapterId: id.nullable(),
}).strict().refine((value) => value.action === 'start'
  ? value.chapterIndex === 1 && value.sourceChapterId === null
  : value.chapterIndex > 1 && value.sourceChapterId !== null, 'Inconsistent story identity');
export type ArenaStoryIdentity = z.infer<typeof ArenaStoryIdentitySchema>;

/** Server wire DTO. Native owns funding credentials; the renderer must never supply this carrier. */
export const ArenaStoryCreateRequestSchema = z.object({
  version: z.literal(1), sessionId: id,
  generationRequestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u),
  action: z.enum(['start', 'continue']), chapterIndex: index, sourceChapterId: id.optional(),
  chapterPlan: z.object({ totalChapters: z.number().int().min(1).max(20) }).strict().optional(),
  chapterContext: z.object({
    sessionSummary: z.string().optional(),
    recentWindow: z.array(ArenaStoryRecentWindowItemSchema).max(12), workingCombatants: combatants,
  }).strict(),
  seed: z.object({
    combatants, scenario: record.nullable().optional(),
    auxScenarios: z.array(record).max(ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity).optional(),
    materials: z.array(z.unknown()).max(ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity).optional(),
    adjudicationEvents: z.array(z.unknown()).max(ARENA_CANONICAL_RESOURCE_LIMITS.maxAdjudicationEvents).optional(),
    questionnaires: z.array(z.object({
      id: z.string().min(1), title: z.string().min(1), kind: z.enum(['magical-girl', 'canshou']),
      useLore: z.boolean().optional(), loreMarkdown: z.string().optional(),
    }).strict()).max(ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity).optional(),
    mode: z.enum(['classic', 'kizuna', 'daily', 'scenario']),
    storyLength: z.enum(['default', 'short', 'standard', 'detailed', 'long']),
    customStoryLength: z.string().optional(), language: z.string(),
    settings: z.object({
      readArenaHistory: z.boolean(), readArenaHistoryLimit: readLimit, isArenaHistoryUnlimited: z.boolean().optional(),
      writeArenaHistory: z.boolean(), readCurrentState: z.boolean(), writeCurrentState: z.boolean(),
      readNarrativeHistory: z.boolean(), readNarrativeHistoryLimit: readLimit, isNarrativeHistoryUnlimited: z.boolean().optional(),
      writeNarrativeHistory: z.boolean(),
    }).strict(),
  }).strict(),
  userGuidance: z.string().optional(),
  // Validated by the existing strict preset-only custom-provider authority before dispatch.
  customProvider: z.unknown().optional(),
}).strict().superRefine((value, context) => {
  const recent = value.chapterContext.recentWindow;
  const latest = recent.at(-1);
  if (new Set(recent.map((item) => item.chapterId)).size !== recent.length
    || recent.some((item, i) => i > 0 && item.chapterIndex <= recent[i - 1]!.chapterIndex)
    || (value.action === 'start'
      ? recent.length !== 0 || value.sourceChapterId !== undefined || value.chapterIndex !== 1
      : !latest || value.sourceChapterId !== latest.chapterId || value.chapterIndex !== latest.chapterIndex + 1)
    || value.chapterPlan && value.chapterIndex > value.chapterPlan.totalChapters) {
    context.addIssue({ code: 'custom', message: 'Inconsistent linear story context' });
  }
});
export type ArenaStoryCreateRequest = z.infer<typeof ArenaStoryCreateRequestSchema>;
