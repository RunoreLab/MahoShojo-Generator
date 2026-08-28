import { z } from 'zod';

import { MAX_OPAQUE_KEY_LENGTH, MAX_PROPOSAL_BYTES, MAX_PROPOSAL_CHANGES } from './limits';
import {
  BattleModeSchema,
  CharacterDataCardRefSchema,
  CustomStoryLengthSchema,
  GuidanceSchema,
  GlobalGuidanceSchema,
  HostLocalCombatantStubSchema,
  HostLocalMaterialStubSchema,
  HostLocalScenarioStubSchema,
  MaterialDataCardRefSchema,
  OpaqueKeySchema,
  ScenarioDataCardRefSchema,
  StableObjectKeySchema,
  StoryLengthSchema,
} from './primitives';
import { ArenaContractError } from './errors';
import { SharedHistorySettingsSchema } from './shared-config';
import { PROPOSAL_VERSION } from './versions';
import { jsonUtf8ByteLength } from './wire-size';

const ChangeIdSchema = z.string().trim().min(1).max(MAX_OPAQUE_KEY_LENGTH);
const AtomicGroupIdSchema = z.string().trim().min(1).max(MAX_OPAQUE_KEY_LENGTH);

export const AbsentExpectedBaseSchema = z
  .object({
    kind: z.literal('absent'),
  })
  .strict();
export type AbsentExpectedBase = z.infer<typeof AbsentExpectedBaseSchema>;

export const ValueExpectedBaseSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({ kind: z.literal('value'), value: valueSchema }).strict();

export const PresentExpectedBaseSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({ kind: z.literal('present'), ref: valueSchema }).strict();

const ChangeMetadataSchema = z
  .object({
    changeId: ChangeIdSchema,
    dependsOn: z.array(ChangeIdSchema).max(MAX_PROPOSAL_CHANGES).optional(),
    atomicGroupId: AtomicGroupIdSchema.optional(),
  })
  .strict();

const change = <T extends z.ZodRawShape>(shape: T) => z.object(shape).merge(ChangeMetadataSchema).strict();

const CharacterRefSchema = CharacterDataCardRefSchema;
const ScenarioRefSchema = ScenarioDataCardRefSchema;
const MaterialRefSchema = MaterialDataCardRefSchema;
const CharacterValueSchema = z.union([CharacterRefSchema, HostLocalCombatantStubSchema]);
const CharacterPresentValueSchema = CharacterValueSchema;
const ScenarioValueSchema = z.union([ScenarioRefSchema, HostLocalScenarioStubSchema, z.null()]);
const ScenarioProposedValueSchema = z.union([ScenarioRefSchema, z.null()]);
const ScenarioPresentValueSchema = z.union([ScenarioRefSchema, HostLocalScenarioStubSchema]);
const MaterialPresentValueSchema = z.union([MaterialRefSchema, HostLocalMaterialStubSchema]);

const targetKeyMatchesExpectedRef = (targetKey: string, expectedRef: unknown): boolean => {
  if (!expectedRef || typeof expectedRef !== 'object' || Array.isArray(expectedRef)) return false;
  const value = expectedRef as Record<string, unknown>;
  if (typeof value.key === 'string') return targetKey === value.key;
  if (typeof value.id === 'string') {
    return targetKey === `data-card:${value.id}` || targetKey === `preset:${value.id}`;
  }
  return false;
};

export const RefExpectedBaseSchema = z
  .object({ kind: z.literal('ref'), ref: ScenarioValueSchema })
  .strict();

export const AddCombatantChangeSchema = change({
  type: z.literal('addCombatant'),
  ref: CharacterRefSchema,
  expectedBase: AbsentExpectedBaseSchema,
});

export const RemoveCombatantChangeSchema = change({
  type: z.literal('removeCombatant'),
  combatantKey: StableObjectKeySchema,
  expectedBase: PresentExpectedBaseSchema(CharacterPresentValueSchema),
}).superRefine((change, context) => {
  if (!targetKeyMatchesExpectedRef(change.combatantKey, change.expectedBase.ref)) {
    context.addIssue({ code: 'custom', path: ['expectedBase', 'ref'], message: 'expectedBase.ref identity must match combatantKey' });
  }
});

export const SetCharacterGuidanceChangeSchema = change({
  type: z.literal('setCharacterGuidance'),
  combatantKey: StableObjectKeySchema,
  value: GuidanceSchema.nullable(),
  expectedBase: ValueExpectedBaseSchema(GuidanceSchema.nullable()),
});

export const AssignTeamChangeSchema = change({
  type: z.literal('assignTeam'),
  combatantKey: StableObjectKeySchema,
  teamKey: OpaqueKeySchema.nullable(),
  expectedBase: ValueExpectedBaseSchema(OpaqueKeySchema.nullable()),
});

export const SetBattleModeChangeSchema = change({
  type: z.literal('setBattleMode'),
  value: BattleModeSchema,
  expectedBase: ValueExpectedBaseSchema(BattleModeSchema),
});

export const SetScenarioChangeSchema = change({
  type: z.literal('setScenario'),
  ref: ScenarioProposedValueSchema,
  expectedBase: RefExpectedBaseSchema,
});

export const AddAuxScenarioChangeSchema = change({
  type: z.literal('addAuxScenario'),
  ref: ScenarioRefSchema,
  expectedBase: AbsentExpectedBaseSchema,
});

export const RemoveAuxScenarioChangeSchema = change({
  type: z.literal('removeAuxScenario'),
  scenarioKey: StableObjectKeySchema,
  expectedBase: PresentExpectedBaseSchema(ScenarioPresentValueSchema),
}).superRefine((change, context) => {
  if (!targetKeyMatchesExpectedRef(change.scenarioKey, change.expectedBase.ref)) {
    context.addIssue({ code: 'custom', path: ['expectedBase', 'ref'], message: 'expectedBase.ref identity must match scenarioKey' });
  }
});

export const AddMaterialChangeSchema = change({
  type: z.literal('addMaterial'),
  ref: MaterialRefSchema,
  expectedBase: AbsentExpectedBaseSchema,
});

export const RemoveMaterialChangeSchema = change({
  type: z.literal('removeMaterial'),
  materialKey: StableObjectKeySchema,
  expectedBase: PresentExpectedBaseSchema(MaterialPresentValueSchema),
}).superRefine((change, context) => {
  if (!targetKeyMatchesExpectedRef(change.materialKey, change.expectedBase.ref)) {
    context.addIssue({ code: 'custom', path: ['expectedBase', 'ref'], message: 'expectedBase.ref identity must match materialKey' });
  }
});

export const SetUserGuidanceChangeSchema = change({
  type: z.literal('setUserGuidance'),
  value: GlobalGuidanceSchema,
  expectedBase: ValueExpectedBaseSchema(GlobalGuidanceSchema),
});

const StoryLengthValueSchema = z.object({
  storyLength: StoryLengthSchema,
  customStoryLength: CustomStoryLengthSchema.nullable(),
}).strict();

export const SetStoryLengthChangeSchema = change({
  type: z.literal('setStoryLength'),
  value: StoryLengthSchema,
  customStoryLength: CustomStoryLengthSchema.nullable().optional(),
  expectedBase: ValueExpectedBaseSchema(StoryLengthValueSchema),
});

export const SetHistorySettingsChangeSchema = change({
  type: z.literal('setHistorySettings'),
  value: SharedHistorySettingsSchema,
  expectedBase: ValueExpectedBaseSchema(SharedHistorySettingsSchema),
});

export const ArenaProposalChangeSchema = z.discriminatedUnion('type', [
  AddCombatantChangeSchema,
  RemoveCombatantChangeSchema,
  SetCharacterGuidanceChangeSchema,
  AssignTeamChangeSchema,
  SetBattleModeChangeSchema,
  SetScenarioChangeSchema,
  AddAuxScenarioChangeSchema,
  RemoveAuxScenarioChangeSchema,
  AddMaterialChangeSchema,
  RemoveMaterialChangeSchema,
  SetUserGuidanceChangeSchema,
  SetStoryLengthChangeSchema,
  SetHistorySettingsChangeSchema,
]);
export type ArenaProposalChange = z.infer<typeof ArenaProposalChangeSchema>;

export const ArenaProposalStatusSchema = z.enum([
  'draft',
  'submitted',
  'partially_accepted',
  'accepted',
  'rejected',
  'withdrawn',
  'stale',
]);
export type ArenaProposalStatus = z.infer<typeof ArenaProposalStatusSchema>;

export const ArenaProposalChangesSchema = z
  .array(ArenaProposalChangeSchema)
  .min(1)
  .max(MAX_PROPOSAL_CHANGES)
  .superRefine((changes, context) => {
    const ids = changes.map((item) => item.changeId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: [], message: 'changeId values must be unique' });
    }
    const idSet = new Set(ids);
    changes.forEach((item, index) => {
      const dependencies = item.dependsOn ?? [];
      if (new Set(dependencies).size !== dependencies.length) {
        context.addIssue({ code: 'custom', path: [index, 'dependsOn'], message: 'dependsOn values must be unique' });
      }
      dependencies.forEach((dependency) => {
        if (!idSet.has(dependency)) {
          context.addIssue({ code: 'custom', path: [index, 'dependsOn'], message: 'dependsOn must reference a change in this proposal' });
        }
        if (dependency === item.changeId) {
          context.addIssue({ code: 'custom', path: [index, 'dependsOn'], message: 'a change cannot depend on itself' });
        }
      });
    });

    const graph = new Map<string, readonly string[]>();
    changes.forEach((item) => graph.set(item.changeId, item.dependsOn ?? []));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (changeId: string, path: readonly string[]): void => {
      if (visiting.has(changeId)) {
        context.addIssue({ code: 'custom', path: [], message: `dependsOn cycle detected: ${[...path, changeId].join(' -> ')}` });
        return;
      }
      if (visited.has(changeId)) return;
      visiting.add(changeId);
      for (const dependency of graph.get(changeId) ?? []) {
        if (graph.has(dependency)) visit(dependency, [...path, changeId]);
      }
      visiting.delete(changeId);
      visited.add(changeId);
    };
    for (const changeId of graph.keys()) visit(changeId, []);
  });

export const ArenaProposalSchema = z
  .object({
    proposalVersion: z.literal(PROPOSAL_VERSION),
    proposalId: OpaqueKeySchema,
    roomId: OpaqueKeySchema,
    authorUserId: OpaqueKeySchema,
    baseRevision: z.number().int().nonnegative(),
    status: ArenaProposalStatusSchema,
    changes: ArenaProposalChangesSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (jsonUtf8ByteLength(proposal) > MAX_PROPOSAL_BYTES) {
      context.addIssue({ code: 'custom', path: [], message: 'payload-too-large' });
    }
  });
export type ArenaProposal = z.infer<typeof ArenaProposalSchema>;

/** Local drafts never cross the room protocol boundary. */
export const RoomStoredArenaProposalSchema = ArenaProposalSchema.refine(
  (proposal) => proposal.status !== 'draft',
  { path: ['status'], message: 'room-stored proposals cannot be drafts' },
);

/** A proposal.submitted event always introduces a pending proposal. */
export const SubmittedArenaProposalSchema = ArenaProposalSchema.refine(
  (proposal) => proposal.status === 'submitted',
  { path: ['status'], message: 'submitted proposal status must be submitted' },
);

/** proposal.resolved records only terminal lifecycle states. */
export const ResolvedArenaProposalStatusSchema = z.enum([
  'partially_accepted',
  'accepted',
  'rejected',
  'withdrawn',
  'stale',
]);
export type ResolvedArenaProposalStatus = z.infer<typeof ResolvedArenaProposalStatusSchema>;

export const parseArenaProposal = (input: unknown): ArenaProposal => {
  if (jsonUtf8ByteLength(input) > MAX_PROPOSAL_BYTES) {
    throw new ArenaContractError('payload-too-large');
  }
  try {
    return ArenaProposalSchema.parse(input);
  } catch (error) {
    throw new ArenaContractError('validation-failed', 'invalid Arena proposal', undefined, error);
  }
};
