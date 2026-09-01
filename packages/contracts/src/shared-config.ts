import { z } from 'zod';

import { ArenaContractError } from './errors';
import {
  MAX_ARENA_REFERENCE_ITEMS,
  MAX_COMBATANTS,
  MAX_HISTORY_LIMIT,
  MAX_OPAQUE_KEY_LENGTH,
} from './limits';
import {
  BattleModeSchema,
  CharacterDataCardRefSchema,
  DisplayNameSchema,
  GlobalGuidanceSchema,
  HostLocalCombatantStubSchema,
  HostLocalMaterialStubSchema,
  HostLocalScenarioStubSchema,
  LanguageSchema,
  MaterialDataCardRefSchema,
  ScenarioDataCardRefSchema,
  StoryLengthSchema,
  StableObjectKeySchema,
  CustomStoryLengthSchema,
  GuidanceSchema,
} from './primitives';

const nonEmptyKey = z.string().trim().min(1).max(MAX_OPAQUE_KEY_LENGTH);

export const SharedHistorySettingsSchema = z
  .object({
    readArenaHistory: z.boolean(),
    readArenaHistoryLimit: z.number().int().min(1).max(MAX_HISTORY_LIMIT),
    isArenaHistoryUnlimited: z.boolean(),
    writeArenaHistory: z.boolean(),
    readCurrentState: z.boolean(),
    writeCurrentState: z.boolean(),
    readNarrativeHistory: z.boolean(),
    readNarrativeHistoryLimit: z.number().int().min(1).max(MAX_HISTORY_LIMIT),
    isNarrativeHistoryUnlimited: z.boolean(),
    writeNarrativeHistory: z.boolean(),
  })
  .strict();
export type SharedHistorySettings = z.infer<typeof SharedHistorySettingsSchema>;

export const TeamAssignmentSchema = z
  .object({
    key: nonEmptyKey,
    displayName: DisplayNameSchema,
    combatantKeys: z.array(StableObjectKeySchema).max(MAX_COMBATANTS),
  })
  .strict();
export type TeamAssignment = z.infer<typeof TeamAssignmentSchema>;

const isOnlineKeyForRef = (key: string, id: string): boolean =>
  key === `data-card:${id}` || key === `preset:${id}`;

const isServerKnownPresetKey = (key: string): boolean => key.startsWith('preset:');

const OnlineCombatantEntrySchema = z
  .object({
    key: StableObjectKeySchema,
    ref: CharacterDataCardRefSchema,
    characterGuidance: GuidanceSchema.optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (!isOnlineKeyForRef(entry.key, entry.ref.id)) {
      context.addIssue({ code: 'custom', path: ['key'], message: 'online combatant key must identify its ref id' });
    }
  });

/** Host-local entries are the stub itself; only the stub key is canonical. */
export const CombatantEntrySchema = z.union([
  OnlineCombatantEntrySchema,
  HostLocalCombatantStubSchema,
]);
export type CombatantEntry = z.infer<typeof CombatantEntrySchema>;

export const ScenarioEntrySchema = z.union([
  z.object({ key: StableObjectKeySchema, ref: ScenarioDataCardRefSchema }).strict(),
  HostLocalScenarioStubSchema,
  z.null(),
]).superRefine((entry, context) => {
  if (!entry) return;
  if ('ref' in entry) {
    if (!isOnlineKeyForRef(entry.key, entry.ref.id)) {
      context.addIssue({ code: 'custom', path: ['key'], message: 'online scenario key must identify its ref id' });
    }
  }
});
export type ScenarioEntry = z.infer<typeof ScenarioEntrySchema>;

export const AuxiliaryScenarioEntrySchema = z.union([
  z.object({ key: StableObjectKeySchema, ref: ScenarioDataCardRefSchema }).strict(),
  HostLocalScenarioStubSchema,
]).superRefine((entry, context) => {
  if ('ref' in entry) {
    if (!isOnlineKeyForRef(entry.key, entry.ref.id)) {
      context.addIssue({ code: 'custom', path: ['key'], message: 'online auxiliary scenario key must identify its ref id' });
    }
  }
});
export type AuxiliaryScenarioEntry = z.infer<typeof AuxiliaryScenarioEntrySchema>;

export const MaterialEntrySchema = z.union([
  z.object({ key: StableObjectKeySchema, ref: MaterialDataCardRefSchema }).strict(),
  HostLocalMaterialStubSchema,
]).superRefine((entry, context) => {
  if ('ref' in entry) {
    if (!isOnlineKeyForRef(entry.key, entry.ref.id)) {
      context.addIssue({ code: 'custom', path: ['key'], message: 'online material key must identify its ref id' });
    }
    if (isServerKnownPresetKey(entry.key)) {
      context.addIssue({ code: 'custom', path: ['key'], message: 'material preset is unsupported: server-known registry is unavailable' });
    }
  }
});
export type MaterialEntry = z.infer<typeof MaterialEntrySchema>;

export const ArenaRoomSharedConfigSchema = z
  .object({
    battleMode: BattleModeSchema,
    combatants: z.array(CombatantEntrySchema).max(MAX_COMBATANTS),
    teams: z.array(TeamAssignmentSchema).max(MAX_COMBATANTS),
    scenario: ScenarioEntrySchema,
    auxScenarios: z.array(AuxiliaryScenarioEntrySchema).max(MAX_ARENA_REFERENCE_ITEMS),
    materials: z.array(MaterialEntrySchema).max(MAX_ARENA_REFERENCE_ITEMS),
    userGuidance: GlobalGuidanceSchema,
    storyLength: StoryLengthSchema,
    customStoryLength: CustomStoryLengthSchema.nullable(),
    selectedLanguage: LanguageSchema,
    historySettings: SharedHistorySettingsSchema,
  })
  .strict()
  .superRefine((config, context) => {
    const validateUniqueKeys = (keys: readonly string[], path: string): void => {
      if (new Set(keys).size !== keys.length) {
        context.addIssue({ code: 'custom', path: [path], message: `${path} keys must be unique` });
      }
    };
    const combatantKeys = config.combatants.map((entry) => entry.key);
    const auxiliaryScenarioKeys = config.auxScenarios.map((entry) => entry.key);
    const materialKeys = config.materials.map((entry) => entry.key);
    const teamKeys = config.teams.map((team) => team.key);
    validateUniqueKeys(combatantKeys, 'combatants');
    validateUniqueKeys(auxiliaryScenarioKeys, 'auxScenarios');
    validateUniqueKeys(materialKeys, 'materials');
    validateUniqueKeys(teamKeys, 'teams');

    const referenceItemCount = config.auxScenarios.length + config.materials.length;
    if (referenceItemCount > MAX_ARENA_REFERENCE_ITEMS) {
      context.addIssue({
        code: 'custom',
        path: ['auxScenarios'],
        message: `auxScenarios and materials must contain at most ${MAX_ARENA_REFERENCE_ITEMS} references in total`,
      });
    }

    const knownCombatants = new Set(combatantKeys);
    const assignedCombatants = new Set<string>();
    config.teams.forEach((team, teamIndex) => {
      team.combatantKeys.forEach((combatantKey, combatantIndex) => {
        if (!knownCombatants.has(combatantKey)) {
          context.addIssue({ code: 'custom', path: ['teams', teamIndex, 'combatantKeys', combatantIndex], message: 'team references an unknown combatant' });
        }
        if (assignedCombatants.has(combatantKey)) {
          context.addIssue({ code: 'custom', path: ['teams', teamIndex, 'combatantKeys', combatantIndex], message: 'combatant cannot belong to multiple teams' });
        }
        assignedCombatants.add(combatantKey);
      });
    });
  });
export type ArenaRoomSharedConfig = z.infer<typeof ArenaRoomSharedConfigSchema>;

export const parseArenaRoomSharedConfig = (input: unknown): ArenaRoomSharedConfig => {
  try {
    return ArenaRoomSharedConfigSchema.parse(input);
  } catch (error) {
    throw new ArenaContractError('validation-failed', 'invalid Arena shared config', undefined, error);
  }
};
