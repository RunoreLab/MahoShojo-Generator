import { inferTemplateId } from './data-cards';

export type ArenaPostBattleImpact = Readonly<{
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
}>;

export type ArenaPostBattleProjectionInput = Readonly<{
  combatants: readonly unknown[];
  report: Readonly<Record<string, unknown>>;
  impacts: readonly ArenaPostBattleImpact[];
  userGuidance: string | null;
  scenario: Readonly<Record<string, unknown>> | null;
  writeArenaHistory: boolean;
  writeCurrentState: boolean;
  generationId: string;
  occurredAt: string;
}>;

export type ArenaPostBattleCharacterProjection = Readonly<{
  combatantIndex: number;
  data: Record<string, unknown>;
}>;

const recordOf = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);
const textOf = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const token = (value: string): string => value.replace(/\s+/gu, '').toLocaleLowerCase();
const matchesAppliedRevision = (record: Record<string, unknown> | null, generationId: string): boolean => (
  textOf(record?.['generation_id']) === generationId
);

const combatantsOf = (values: readonly unknown[]) => values.flatMap((value, index) => {
  const combatant = recordOf(value);
  const data = recordOf(combatant?.data);
  const name = textOf(data?.codename) || textOf(data?.name);
  return combatant && data && name ? [{ combatant, data, name, index }] : [];
});

const historyOf = (data: Record<string, unknown>, generationId: string) => {
  const history = recordOf(data.arena_history);
  const entries = Array.isArray(history?.entries)
    ? history.entries.flatMap((entry) => recordOf(entry) ? [recordOf(entry)!] : [])
    : [];
  return {
    history,
    entries,
    attributes: recordOf(history?.attributes) ?? {},
    alreadyApplied: entries.some((entry) => matchesAppliedRevision(recordOf(entry.metadata), generationId)),
  };
};

/** The host supplies stable IDs only where the old projector would create one. IDs confer no trust. */
export const getArenaPostBattleWorldLineIndices = (
  input: Pick<ArenaPostBattleProjectionInput, 'combatants' | 'generationId' | 'writeArenaHistory'>,
): number[] => {
  if (!input.writeArenaHistory) return [];
  return combatantsOf(input.combatants).flatMap(({ data, index }) => {
    const history = historyOf(data, input.generationId);
    return !history.alreadyApplied && !textOf(history.attributes.world_line_id) ? [index] : [];
  });
};

/**
 * Pure character effects, not the full narrative-history card or a persistence operation.
 * The caller owns completion eligibility, fixed time/IDs and any verified native assessment.
 * Hosted may sign the result afterwards; client callers must use the unsigned candidate adapter.
 */
export const projectArenaPostBattleCharacters = (
  input: ArenaPostBattleProjectionInput,
  context: Readonly<{
    worldLineIds: Readonly<Record<number, string>>;
    nonNativeDataInvolved: boolean;
  }>,
): ArenaPostBattleCharacterProjection[] => {
  const valid = combatantsOf(input.combatants);
  const participants = valid.map((item) => item.name);
  const officialReport = recordOf(input.report.officialReport);
  const winner = textOf(officialReport?.winner);
  const headline = textOf(input.report.headline) || '未命名战报';
  const reportMode = textOf(input.report.mode) || 'classic';
  const scenarioTitle = textOf(input.scenario?.title) || textOf(input.scenario?.name) || null;
  const impactByName = new Map(input.impacts.map((impact) => [token(impact.characterName), impact]));
  const updated: ArenaPostBattleCharacterProjection[] = [];

  for (const item of valid) {
    // Preserve the existing JSON document projection rather than normalizing through a card schema.
    const data = JSON.parse(JSON.stringify(item.data)) as Record<string, unknown>;
    if (!textOf(data.templateId)) data.templateId = inferTemplateId(data);
    let didMutate = false;
    const impact = impactByName.get(token(item.name));

    if (input.writeArenaHistory) {
      const { history, entries, attributes, alreadyApplied } = historyOf(data, input.generationId);
      if (!alreadyApplied) {
        const worldLineId = textOf(attributes.world_line_id) || context.worldLineIds[item.index];
        if (!worldLineId) throw new Error('Missing fixed Arena world-line ID');
        const lastId = entries.reduce((maximum, entry) => (
          typeof entry.id === 'number' && Number.isFinite(entry.id)
            ? Math.max(maximum, Math.floor(entry.id))
            : maximum
        ), 0);
        const guidance = textOf(item.combatant.characterGuidance).slice(0, 100);
        data.arena_history = {
          ...(history ?? {}),
          attributes: {
            ...attributes,
            world_line_id: worldLineId,
            created_at: textOf(attributes.created_at) || input.occurredAt,
            updated_at: input.occurredAt,
            sublimation_count: typeof attributes.sublimation_count === 'number'
              ? attributes.sublimation_count : 0,
            last_sublimation_at: attributes.last_sublimation_at ?? null,
          },
          entries: [...entries, {
            id: lastId + 1,
            type: reportMode,
            title: headline,
            participants,
            winner,
            impact: impact?.impact || '在此次事件中获得了成长。',
            metadata: {
              user_guidance: input.userGuidance,
              ...(guidance ? { character_guidance: guidance } : {}),
              scenario_title: scenarioTitle,
              non_native_data_involved: context.nonNativeDataInvolved,
              generation_id: input.generationId,
            },
          }],
        };
        didMutate = true;
      }
    }

    if (input.writeCurrentState && textOf(impact?.currentStateSummary)) {
      const existingState = recordOf(data.current_state);
      if (!matchesAppliedRevision(existingState, input.generationId)) {
        data.current_state = {
          ...(existingState ?? {}),
          summary: textOf(impact?.currentStateSummary),
          updated_at: input.occurredAt,
          generation_id: input.generationId,
        };
        didMutate = true;
      }
    }

    if (!didMutate) continue;
    delete data.signature;
    updated.push({ combatantIndex: item.index, data });
  }
  return updated;
};
