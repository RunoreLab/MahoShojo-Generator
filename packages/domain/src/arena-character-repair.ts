export const MAX_ARENA_CHARACTER_REPAIR_TEXT_CODE_POINTS = 2_000;

export type ArenaCharacterRepairField = 'impact' | 'currentStateSummary';

export type ArenaCharacterRepairPatch = Readonly<{
  combatantIndex: number;
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
}>;

export type ArenaCharacterRepairHistoryEntryInput = Readonly<{
  type: string;
  title: string;
  participants: readonly string[];
  winner: string;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type ArenaCharacterRepairIssue = Readonly<{
  combatantIndex: number;
  field: ArenaCharacterRepairField | 'target' | 'patch';
  message: string;
}>;

export type ArenaCharacterRepairFailureReason =
  | 'invalid-repair-patch'
  | 'generation-effect-not-found'
  | 'ambiguous-generation-effect';

type JsonRecord = Record<string, any>;

export type PatchGenerationCharacterEffectResult =
  | Readonly<{
    ok: true;
    status: 'updated' | 'no-op';
    characterData: JsonRecord;
    createdFields: readonly ArenaCharacterRepairField[];
  }>
  | Readonly<{
    ok: false;
    reason: ArenaCharacterRepairFailureReason;
    issues: readonly ArenaCharacterRepairIssue[];
  }>;

export type ArenaRepairCombatant = JsonRecord & {
  data: JsonRecord;
  isValid?: boolean;
  isPreset?: boolean;
  isNative?: boolean;
};

export type ApplyUnsignedPostBattleRepairResult<TCombatant extends ArenaRepairCombatant> =
  | Readonly<{
    ok: true;
    status: 'updated' | 'no-op';
    combatants: TCombatant[];
    updatedCharacters: JsonRecord[];
    changedCombatantIndices: number[];
    createdEffects: Array<Readonly<{
      combatantIndex: number;
      fields: readonly ArenaCharacterRepairField[];
    }>>;
  }>
  | Readonly<{
    ok: false;
    reason: ArenaCharacterRepairFailureReason;
    issues: readonly ArenaCharacterRepairIssue[];
  }>;

const recordOf = (value: unknown): JsonRecord | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
);

const clone = <T>(value: T): T => structuredClone(value);

const displayNameOf = (data: JsonRecord): string => {
  const codename = typeof data.codename === 'string' ? data.codename.trim() : '';
  if (codename) return codename;
  return typeof data.name === 'string' ? data.name.trim() : '';
};

const normalizeRepairText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (Array.from(normalized).length > MAX_ARENA_CHARACTER_REPAIR_TEXT_CODE_POINTS) return null;
  return normalized;
};

const issue = (
  patch: ArenaCharacterRepairPatch,
  field: ArenaCharacterRepairIssue['field'],
  message: string,
): ArenaCharacterRepairIssue => ({
  combatantIndex: patch.combatantIndex,
  field,
  message,
});

const failure = (
  reason: ArenaCharacterRepairFailureReason,
  issues: readonly ArenaCharacterRepairIssue[],
) => ({ ok: false, reason, issues }) as const;

const maxNumericEntryId = (entries: readonly unknown[]): number => entries.reduce<number>((maximum, entry) => {
  const id = recordOf(entry)?.id;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > maximum ? id : maximum;
}, 0);

const validatePatchShape = (
  patch: ArenaCharacterRepairPatch,
): readonly ArenaCharacterRepairIssue[] => {
  const issues: ArenaCharacterRepairIssue[] = [];
  if (!Number.isSafeInteger(patch.combatantIndex) || patch.combatantIndex < 0) {
    issues.push(issue(patch, 'target', 'combatantIndex 必须是非负安全整数'));
  }
  if (typeof patch.characterName !== 'string' || !patch.characterName.trim()) {
    issues.push(issue(patch, 'target', 'characterName 不能为空'));
  }
  if (patch.impact === undefined && patch.currentStateSummary === undefined) {
    issues.push(issue(patch, 'patch', 'repair patch 至少包含一个可修改字段'));
  }
  if (patch.impact !== undefined && normalizeRepairText(patch.impact) === null) {
    issues.push(issue(patch, 'impact', 'impact 必须是长度不超过 2000 字符的非空文本'));
  }
  if (
    patch.currentStateSummary !== undefined
    && normalizeRepairText(patch.currentStateSummary) === null
  ) {
    issues.push(issue(
      patch,
      'currentStateSummary',
      'currentStateSummary 必须是长度不超过 2000 字符的非空文本',
    ));
  }
  return issues;
};

export const patchGenerationCharacterEffect = (input: Readonly<{
  characterData: JsonRecord;
  generationId: string;
  patch: ArenaCharacterRepairPatch;
  nowISO: string;
  allowCreateMissingEffects?: boolean;
  createHistoryEntry?: ArenaCharacterRepairHistoryEntryInput;
}>): PatchGenerationCharacterEffectResult => {
  const { patch } = input;
  const shapeIssues = validatePatchShape(patch);
  const generationId = typeof input.generationId === 'string' ? input.generationId.trim() : '';
  const nowISO = typeof input.nowISO === 'string' ? input.nowISO.trim() : '';
  if (!generationId) {
    return failure('invalid-repair-patch', [issue(patch, 'patch', 'generationId 不能为空')]);
  }
  if (!nowISO || !Number.isFinite(Date.parse(nowISO))) {
    return failure('invalid-repair-patch', [issue(patch, 'patch', 'nowISO 必须是有效时间')]);
  }
  if (shapeIssues.length > 0) return failure('invalid-repair-patch', shapeIssues);

  const characterData = clone(input.characterData);
  const requestedImpact = patch.impact === undefined ? null : normalizeRepairText(patch.impact);
  const requestedState = patch.currentStateSummary === undefined
    ? null
    : normalizeRepairText(patch.currentStateSummary);
  const allowCreate = input.allowCreateMissingEffects === true;
  const availabilityIssues: ArenaCharacterRepairIssue[] = [];
  let failureReason: ArenaCharacterRepairFailureReason = 'generation-effect-not-found';

  const history = recordOf(characterData.arena_history);
  const historyEntries = Array.isArray(history?.entries) ? history.entries : [];
  const matchingHistoryIndices = requestedImpact === null
    ? []
    : historyEntries.reduce<number[]>((indices, entry, index) => {
      if (recordOf(recordOf(entry)?.metadata)?.['generation_id'] === generationId) indices.push(index);
      return indices;
    }, []);

  if (requestedImpact !== null) {
    if (matchingHistoryIndices.length > 1) {
      failureReason = 'ambiguous-generation-effect';
      availabilityIssues.push(issue(patch, 'impact', '同一 generation 存在多条历战记录'));
    } else if (
      matchingHistoryIndices.length === 0
      && (!allowCreate || !input.createHistoryEntry)
    ) {
      availabilityIssues.push(issue(patch, 'impact', '未找到本次 generation 的历战记录'));
    }
  }

  const currentState = recordOf(characterData.current_state);
  if (
    requestedState !== null
    && currentState?.['generation_id'] !== generationId
    && (!allowCreate || currentState !== null)
  ) {
    availabilityIssues.push(issue(patch, 'currentStateSummary', '未找到本次 generation 的当前状态'));
  }

  if (availabilityIssues.length > 0) return failure(failureReason, availabilityIssues);

  const createdFields: ArenaCharacterRepairField[] = [];
  let changed = false;

  if (requestedImpact !== null) {
    if (matchingHistoryIndices.length === 1) {
      const targetIndex = matchingHistoryIndices[0]!;
      const previousEntry = recordOf(historyEntries[targetIndex])!;
      if (previousEntry.impact !== requestedImpact) {
        historyEntries[targetIndex] = { ...previousEntry, impact: requestedImpact };
        if (history) {
          const attributes = recordOf(history.attributes) ?? {};
          history.attributes = { ...attributes, updated_at: nowISO };
          history.entries = historyEntries;
          characterData.arena_history = history;
        }
        changed = true;
      }
    } else {
      const context = input.createHistoryEntry!;
      const nextHistory = history ?? { attributes: {}, entries: [] };
      const entries = Array.isArray(nextHistory.entries) ? nextHistory.entries : [];
      const metadata = {
        ...(context.metadata ?? {}),
        generation_id: generationId,
      };
      entries.push({
        id: maxNumericEntryId(entries) + 1,
        type: context.type,
        title: context.title,
        participants: [...context.participants],
        winner: context.winner,
        impact: requestedImpact,
        metadata,
      });
      const attributes = recordOf(nextHistory.attributes) ?? {};
      nextHistory.attributes = { ...attributes, updated_at: nowISO };
      nextHistory.entries = entries;
      characterData.arena_history = nextHistory;
      createdFields.push('impact');
      changed = true;
    }
  }

  if (requestedState !== null) {
    if (currentState?.['generation_id'] === generationId) {
      if (currentState.summary !== requestedState) {
        characterData.current_state = {
          ...currentState,
          summary: requestedState,
          updated_at: nowISO,
        };
        changed = true;
      }
    } else {
      characterData.current_state = {
        summary: requestedState,
        fields: [],
        generation_id: generationId,
        updated_at: nowISO,
      };
      createdFields.push('currentStateSummary');
      changed = true;
    }
  }

  return {
    ok: true,
    status: changed ? 'updated' : 'no-op',
    characterData,
    createdFields,
  };
};

const clearCanonicalIdentity = (record: JsonRecord): void => {
  delete record.signature;
  delete record.sourceDataCardId;
  delete record.sourceDataCardUpdatedAt;
  delete record.arenaRoomKey;
  delete record.adjudicationSourceKey;
  delete record.isNative;
  delete record.isPreset;
  delete record.isValid;
};

export const stripCharacterTrust = <TCombatant extends ArenaRepairCombatant>(
  combatant: TCombatant,
): TCombatant => {
  const stripped = clone(combatant);
  clearCanonicalIdentity(stripped);
  stripped.isValid = false;
  stripped.isPreset = false;
  if ('isNative' in combatant) stripped.isNative = false;

  const data = recordOf(stripped.data) ?? {};
  clearCanonicalIdentity(data);
  const metadata = recordOf(data.metadata);
  if (metadata) {
    delete metadata.signature;
    data.metadata = metadata;
  }
  stripped.data = data;
  return stripped;
};

export const applyUnsignedPostBattleRepair = <TCombatant extends ArenaRepairCombatant>(input: Readonly<{
  combatants: readonly TCombatant[];
  generationId: string;
  patches: readonly ArenaCharacterRepairPatch[];
  nowISO: string;
  allowCreateMissingEffects?: boolean;
  createHistoryEntry?: ArenaCharacterRepairHistoryEntryInput;
}>): ApplyUnsignedPostBattleRepairResult<TCombatant> => {
  if (!Array.isArray(input.patches) || input.patches.length === 0) {
    return failure('invalid-repair-patch', [{
      combatantIndex: -1,
      field: 'patch',
      message: '至少需要一个 repair patch',
    }]);
  }

  const targetIssues: ArenaCharacterRepairIssue[] = [];
  const seenIndices = new Set<number>();
  for (const patch of input.patches) {
    targetIssues.push(...validatePatchShape(patch));
    if (seenIndices.has(patch.combatantIndex)) {
      targetIssues.push(issue(patch, 'target', '同一 combatantIndex 不能重复出现'));
    }
    seenIndices.add(patch.combatantIndex);
    const combatant = input.combatants[patch.combatantIndex];
    const data = recordOf(combatant?.data);
    if (!data) {
      targetIssues.push(issue(patch, 'target', 'combatantIndex 不存在或角色数据无效'));
      continue;
    }
    if (displayNameOf(data) !== patch.characterName.trim()) {
      targetIssues.push(issue(patch, 'target', 'characterName 与 combatantIndex 指向的角色不一致'));
    }
  }
  if (targetIssues.length > 0) return failure('invalid-repair-patch', targetIssues);

  const projected = new Map<number, Extract<PatchGenerationCharacterEffectResult, { ok: true }>>();
  const patchFailures: Extract<
    PatchGenerationCharacterEffectResult,
    { ok: false }
  >[] = [];
  for (const patch of input.patches) {
    const result = patchGenerationCharacterEffect({
      characterData: input.combatants[patch.combatantIndex]!.data,
      generationId: input.generationId,
      patch,
      nowISO: input.nowISO,
      allowCreateMissingEffects: input.allowCreateMissingEffects,
      createHistoryEntry: input.createHistoryEntry,
    });
    if (!result.ok) patchFailures.push(result);
    else projected.set(patch.combatantIndex, result);
  }
  if (patchFailures.length > 0) {
    const reason = patchFailures.some((result) => result.reason === 'ambiguous-generation-effect')
      ? 'ambiguous-generation-effect'
      : patchFailures.some((result) => result.reason === 'invalid-repair-patch')
        ? 'invalid-repair-patch'
        : 'generation-effect-not-found';
    return failure(reason, patchFailures.flatMap((result) => result.issues));
  }

  const combatants = [...input.combatants];
  const updatedCharacters: JsonRecord[] = [];
  const changedCombatantIndices: number[] = [];
  const createdEffects: Array<{
    combatantIndex: number;
    fields: readonly ArenaCharacterRepairField[];
  }> = [];

  for (const patch of input.patches) {
    const result = projected.get(patch.combatantIndex)!;
    if (result.status === 'no-op') continue;
    const repaired = stripCharacterTrust({
      ...input.combatants[patch.combatantIndex]!,
      data: result.characterData,
    } as TCombatant);
    combatants[patch.combatantIndex] = repaired;
    updatedCharacters.push(repaired.data);
    changedCombatantIndices.push(patch.combatantIndex);
    if (result.createdFields.length > 0) {
      createdEffects.push({
        combatantIndex: patch.combatantIndex,
        fields: result.createdFields,
      });
    }
  }

  return {
    ok: true,
    status: changedCombatantIndices.length > 0 ? 'updated' : 'no-op',
    combatants,
    updatedCharacters,
    changedCombatantIndices,
    createdEffects,
  };
};
