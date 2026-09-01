import { z } from './zod';

import {
  MAX_CHARACTER_GUIDANCE_LENGTH,
  MAX_CUSTOM_STORY_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_GLOBAL_GUIDANCE_LENGTH,
  MAX_LANGUAGE_LENGTH,
  MAX_OPAQUE_KEY_LENGTH,
  MAX_REASON_LENGTH,
  MAX_ROOM_MEMBERS,
} from './limits';

const nonEmptyTrimmedString = (max: number) => z.string().trim().min(1).max(max);

export const OpaqueKeySchema = nonEmptyTrimmedString(MAX_OPAQUE_KEY_LENGTH);
export const StableObjectKeySchema = z
  .string()
  .trim()
  .regex(/^(data-card|preset|host-local):.+$/)
  .max(MAX_OPAQUE_KEY_LENGTH);
export const HostLocalObjectKeySchema = StableObjectKeySchema.regex(/^host-local:.+$/);
export const HostLocalContentVersionSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const DisplayNameSchema = nonEmptyTrimmedString(MAX_DISPLAY_NAME_LENGTH);
export const GuidanceSchema = z.string().max(MAX_CHARACTER_GUIDANCE_LENGTH);
/** Canonical schema reused by SharedConfig.userGuidance and its proposal change. */
export const GlobalGuidanceSchema = z.string().max(MAX_GLOBAL_GUIDANCE_LENGTH);
export const LanguageSchema = nonEmptyTrimmedString(MAX_LANGUAGE_LENGTH);
export const IsoTimestampSchema = z.string().datetime({ offset: true });

export const DataCardKindSchema = z.enum(['character', 'scenario', 'material']);

export const DataCardRefSchema = z
  .object({
    id: nonEmptyTrimmedString(MAX_OPAQUE_KEY_LENGTH),
    kind: DataCardKindSchema,
    versionToken: nonEmptyTrimmedString(MAX_OPAQUE_KEY_LENGTH),
  })
  .strict();
export type DataCardRef = z.infer<typeof DataCardRefSchema>;

export const CharacterDataCardRefSchema = DataCardRefSchema.extend({
  kind: z.literal('character'),
});
export type CharacterDataCardRef = z.infer<typeof CharacterDataCardRefSchema>;

export const ScenarioDataCardRefSchema = DataCardRefSchema.extend({
  kind: z.literal('scenario'),
});
export type ScenarioDataCardRef = z.infer<typeof ScenarioDataCardRefSchema>;

export const MaterialDataCardRefSchema = DataCardRefSchema.extend({
  kind: z.literal('material'),
});
export type MaterialDataCardRef = z.infer<typeof MaterialDataCardRefSchema>;

export const CombatantTypeSchema = z.enum(['magical-girl', 'canshou', 'general-character']);
export type CombatantType = z.infer<typeof CombatantTypeSchema>;

export const HostLocalCombatantStubSchema = z
  .object({
    key: HostLocalObjectKeySchema,
    displayName: DisplayNameSchema,
    type: CombatantTypeSchema,
    source: z.literal('host-local'),
    contentVersion: HostLocalContentVersionSchema.optional(),
    characterGuidance: GuidanceSchema.optional(),
  })
  .strict();
export type HostLocalCombatantStub = z.infer<typeof HostLocalCombatantStubSchema>;

const HostLocalStubBaseSchema = z.object({
  key: HostLocalObjectKeySchema,
  displayName: DisplayNameSchema,
  source: z.literal('host-local'),
  contentVersion: HostLocalContentVersionSchema.optional(),
  guidance: GuidanceSchema.optional(),
});

export const HostLocalScenarioStubSchema = HostLocalStubBaseSchema.extend({
  type: z.literal('scenario'),
}).strict();
export type HostLocalScenarioStub = z.infer<typeof HostLocalScenarioStubSchema>;

export const HostLocalMaterialStubSchema = HostLocalStubBaseSchema.extend({
  type: z.literal('material'),
}).strict();
export type HostLocalMaterialStub = z.infer<typeof HostLocalMaterialStubSchema>;

export const ScenarioRefOrHostStubSchema = z.union([ScenarioDataCardRefSchema, HostLocalScenarioStubSchema]);
export type ScenarioRefOrHostStub = z.infer<typeof ScenarioRefOrHostStubSchema>;

export const MaterialRefOrHostStubSchema = z.union([MaterialDataCardRefSchema, HostLocalMaterialStubSchema]);
export type MaterialRefOrHostStub = z.infer<typeof MaterialRefOrHostStubSchema>;

export const CombatantRefOrHostStubSchema = z.union([CharacterDataCardRefSchema, HostLocalCombatantStubSchema]);
export type CombatantRefOrHostStub = z.infer<typeof CombatantRefOrHostStubSchema>;

export const BattleModeSchema = z.enum(['classic', 'kizuna', 'daily', 'scenario']);
export type BattleMode = z.infer<typeof BattleModeSchema>;

export const CustomStoryLengthSchema = z.string().regex(/^[1-9]\d*$/).max(MAX_CUSTOM_STORY_LENGTH);
export const StoryLengthSchema = z.enum(['default', 'short', 'standard', 'detailed', 'long']);
export type StoryLength = z.infer<typeof StoryLengthSchema>;

export const WireErrorMessageSchema = z.string().trim().min(1).max(MAX_ERROR_MESSAGE_LENGTH);
export const WireReasonSchema = z.string().trim().min(1).max(MAX_REASON_LENGTH);

export const ParticipantUserIdsSchema = z
  .array(z.number().int().nonnegative())
  .max(MAX_ROOM_MEMBERS)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'participant user ids must be unique' });
    }
  });
