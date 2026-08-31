import { z } from 'zod';

import {
  MAX_AUX_SCENARIOS,
  MAX_COMBATANTS,
  MAX_MATERIALS,
  MAX_OPAQUE_KEY_LENGTH,
  MAX_PROPOSAL_BYTES,
  MAX_PROPOSAL_CHANGES,
} from './limits';
import {
  BattleModeSchema,
  CharacterDataCardRefSchema,
  CustomStoryLengthSchema,
  DisplayNameSchema,
  GuidanceSchema,
  GlobalGuidanceSchema,
  HostLocalCombatantStubSchema,
  HostLocalMaterialStubSchema,
  HostLocalScenarioStubSchema,
  MaterialDataCardRefSchema,
  LanguageSchema,
  OpaqueKeySchema,
  ScenarioDataCardRefSchema,
  StableObjectKeySchema,
  StoryLengthSchema,
} from './primitives';
import { ArenaContractError } from './errors';
import { SharedHistorySettingsSchema, TeamAssignmentSchema } from './shared-config';
import { PROPOSAL_VERSION } from './versions';
import { jsonUtf8ByteLength } from './wire-size';

const ChangeIdSchema = z.string().trim().min(1).max(MAX_OPAQUE_KEY_LENGTH);
const AtomicGroupIdSchema = z.string().trim().min(1).max(MAX_OPAQUE_KEY_LENGTH);

/** Proposal IDs are reused as canonical URL path segments by resolve/withdraw. */
export const ArenaProposalIdSchema = OpaqueKeySchema.refine(
  (value) => value !== '.' && value !== '..',
  { message: 'proposalId must be addressable as one URL path segment' },
);

export const AbsentExpectedBaseSchema = z
  .object({
    kind: z.literal('absent'),
  })
  .strict();
export type AbsentExpectedBase = z.infer<typeof AbsentExpectedBaseSchema>;

export const ValueExpectedBaseSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({ kind: z.literal('value'), value: valueSchema }).strict();

export const PresentExpectedBaseSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({ kind: z.literal('present'), ref: valueSchema, key: StableObjectKeySchema.optional() }).strict();

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

const targetKeyMatchesExpectedBase = (
  targetKey: string,
  expectedBase: { key?: string; ref: unknown },
): boolean => expectedBase.key === undefined
  ? !targetKey.startsWith('preset:') && targetKeyMatchesExpectedRef(targetKey, expectedBase.ref)
  : targetKey === expectedBase.key && targetKeyMatchesExpectedRef(targetKey, expectedBase.ref);

const proposalRefKeyMatches = (
  key: string | undefined,
  ref: { id: string },
  allowPreset: boolean,
): boolean => key === undefined
  ? true
  : (key === `data-card:${ref.id}` || (allowPreset && key === `preset:${ref.id}`));

const proposalRefKeyRefinement = <T extends { key?: string; ref?: { id: string } | null }>(
  change: T,
  context: z.RefinementCtx,
  allowPreset: boolean,
): void => {
  if (change.ref === undefined || change.ref === null) {
    if (change.key !== undefined) {
      context.addIssue({ code: 'custom', path: ['key'], message: 'null/absent ref cannot carry a namespace key' });
    }
    return;
  }
  if (!proposalRefKeyMatches(change.key, change.ref, allowPreset)) {
    context.addIssue({ code: 'custom', path: ['key'], message: 'proposal key must identify its ref namespace and id' });
  }
};

export const RefExpectedBaseSchema = z
  .object({ kind: z.literal('ref'), ref: ScenarioValueSchema, key: StableObjectKeySchema.optional() })
  .strict();

export const AddCombatantChangeSchema = change({
  type: z.literal('addCombatant'),
  key: StableObjectKeySchema.optional(),
  ref: CharacterRefSchema,
  expectedBase: AbsentExpectedBaseSchema,
}).superRefine((value, context) => proposalRefKeyRefinement(value, context, true));

export const RemoveCombatantChangeSchema = change({
  type: z.literal('removeCombatant'),
  combatantKey: StableObjectKeySchema,
  expectedBase: PresentExpectedBaseSchema(CharacterPresentValueSchema),
}).superRefine((change, context) => {
  if (!targetKeyMatchesExpectedBase(change.combatantKey, change.expectedBase)) {
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

export const AddTeamChangeSchema = change({
  type: z.literal('addTeam'),
  teamKey: OpaqueKeySchema,
  displayName: DisplayNameSchema,
  expectedBase: AbsentExpectedBaseSchema,
});

export const RemoveTeamChangeSchema = change({
  type: z.literal('removeTeam'),
  teamKey: OpaqueKeySchema,
  expectedBase: PresentExpectedBaseSchema(TeamAssignmentSchema),
}).superRefine((change, context) => {
  if (change.teamKey !== change.expectedBase.ref.key) {
    context.addIssue({ code: 'custom', path: ['expectedBase', 'ref', 'key'], message: 'expectedBase.ref identity must match teamKey' });
  }
});

export const RenameTeamChangeSchema = change({
  type: z.literal('renameTeam'),
  teamKey: OpaqueKeySchema,
  value: DisplayNameSchema,
  expectedBase: ValueExpectedBaseSchema(DisplayNameSchema),
});

const exactOrderSchema = (keySchema: z.ZodType<string>, maximum: number, minimum = 0) => (
  z.array(keySchema).min(minimum).max(maximum)
);

const validateExactReorder = (
  reorder: Readonly<{
    value: readonly string[];
    expectedBase: Readonly<{ value: readonly string[] }>;
  }>,
  context: z.RefinementCtx,
): void => {
  const proposed = reorder.value;
  const expected = reorder.expectedBase.value;
  if (new Set(proposed).size !== proposed.length) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'ordered keys must be unique' });
  }
  if (new Set(expected).size !== expected.length) {
    context.addIssue({ code: 'custom', path: ['expectedBase', 'value'], message: 'expected ordered keys must be unique' });
  }
  const expectedSet = new Set(expected);
  if (proposed.length !== expected.length || proposed.some((key) => !expectedSet.has(key))) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'proposed and expected orders must contain the exact same keys' });
  }
  if (proposed.length === expected.length && proposed.every((key, index) => key === expected[index])) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'reorder must change key order' });
  }
};

const CombatantOrderSchema = exactOrderSchema(StableObjectKeySchema, MAX_COMBATANTS, 1);
const TeamOrderSchema = exactOrderSchema(OpaqueKeySchema, MAX_COMBATANTS);
const TeamCombatantOrderSchema = exactOrderSchema(StableObjectKeySchema, MAX_COMBATANTS);
const AuxScenarioOrderSchema = exactOrderSchema(StableObjectKeySchema, MAX_AUX_SCENARIOS);
const MaterialOrderSchema = exactOrderSchema(StableObjectKeySchema, MAX_MATERIALS);

export const ReorderCombatantsChangeSchema = change({
  type: z.literal('reorderCombatants'),
  value: CombatantOrderSchema,
  expectedBase: ValueExpectedBaseSchema(CombatantOrderSchema),
}).superRefine(validateExactReorder);

export const ReorderTeamsChangeSchema = change({
  type: z.literal('reorderTeams'),
  value: TeamOrderSchema,
  expectedBase: ValueExpectedBaseSchema(TeamOrderSchema),
}).superRefine(validateExactReorder);

export const ReorderTeamCombatantsChangeSchema = change({
  type: z.literal('reorderTeamCombatants'),
  teamKey: OpaqueKeySchema,
  value: TeamCombatantOrderSchema,
  expectedBase: ValueExpectedBaseSchema(TeamCombatantOrderSchema),
}).superRefine(validateExactReorder);

export const ReorderAuxScenariosChangeSchema = change({
  type: z.literal('reorderAuxScenarios'),
  value: AuxScenarioOrderSchema,
  expectedBase: ValueExpectedBaseSchema(AuxScenarioOrderSchema),
}).superRefine(validateExactReorder);

export const ReorderMaterialsChangeSchema = change({
  type: z.literal('reorderMaterials'),
  value: MaterialOrderSchema,
  expectedBase: ValueExpectedBaseSchema(MaterialOrderSchema),
}).superRefine(validateExactReorder);

export const SetBattleModeChangeSchema = change({
  type: z.literal('setBattleMode'),
  value: BattleModeSchema,
  expectedBase: ValueExpectedBaseSchema(BattleModeSchema),
});

export const SetSelectedLanguageChangeSchema = change({
  type: z.literal('setSelectedLanguage'),
  value: LanguageSchema,
  expectedBase: ValueExpectedBaseSchema(LanguageSchema),
});

export const SetScenarioChangeSchema = change({
  type: z.literal('setScenario'),
  key: StableObjectKeySchema.optional(),
  ref: ScenarioProposedValueSchema,
  expectedBase: RefExpectedBaseSchema,
}).superRefine((value, context) => {
  proposalRefKeyRefinement(value, context, true);
  if (value.expectedBase.key !== undefined && !targetKeyMatchesExpectedRef(
    value.expectedBase.key,
    value.expectedBase.ref,
  )) {
    context.addIssue({ code: 'custom', path: ['expectedBase', 'key'], message: 'expectedBase.key must identify its ref id' });
  }
});

export const AddAuxScenarioChangeSchema = change({
  type: z.literal('addAuxScenario'),
  key: StableObjectKeySchema.optional(),
  ref: ScenarioRefSchema,
  expectedBase: AbsentExpectedBaseSchema,
}).superRefine((value, context) => proposalRefKeyRefinement(value, context, true));

export const RemoveAuxScenarioChangeSchema = change({
  type: z.literal('removeAuxScenario'),
  scenarioKey: StableObjectKeySchema,
  expectedBase: PresentExpectedBaseSchema(ScenarioPresentValueSchema),
}).superRefine((change, context) => {
  if (!targetKeyMatchesExpectedBase(change.scenarioKey, change.expectedBase)) {
    context.addIssue({ code: 'custom', path: ['expectedBase', 'ref'], message: 'expectedBase.ref identity must match scenarioKey' });
  }
});

export const AddMaterialChangeSchema = change({
  type: z.literal('addMaterial'),
  key: StableObjectKeySchema.optional(),
  ref: MaterialRefSchema,
  expectedBase: AbsentExpectedBaseSchema,
}).superRefine((value, context) => proposalRefKeyRefinement(value, context, false));

export const RemoveMaterialChangeSchema = change({
  type: z.literal('removeMaterial'),
  materialKey: StableObjectKeySchema,
  expectedBase: PresentExpectedBaseSchema(MaterialPresentValueSchema),
}).superRefine((change, context) => {
  if (!targetKeyMatchesExpectedBase(change.materialKey, change.expectedBase)) {
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
  AddTeamChangeSchema,
  RemoveTeamChangeSchema,
  RenameTeamChangeSchema,
  ReorderCombatantsChangeSchema,
  ReorderTeamsChangeSchema,
  ReorderTeamCombatantsChangeSchema,
  ReorderAuxScenariosChangeSchema,
  ReorderMaterialsChangeSchema,
  SetBattleModeChangeSchema,
  SetSelectedLanguageChangeSchema,
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
    proposalId: ArenaProposalIdSchema,
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
