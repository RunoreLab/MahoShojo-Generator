import { inferTemplateId } from '@mahoshojo/domain/data-cards';
import type { SignatureService } from '../signature';
import type {
  ArenaCompanionProjectInput,
} from './service';

export type ArenaPostBattleProjectorOptions = {
  signatures: SignatureService;
  now?(): Date;
};

const recordOf = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const textOf = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const cloneRecord = (value: Record<string, unknown>): Record<string, unknown> => (
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>
);

const token = (value: string): string => value.replace(/\s+/gu, '').toLocaleLowerCase();

const scenarioTitle = (scenario: Record<string, unknown> | null): string | null => (
  textOf(scenario?.title) || textOf(scenario?.name) || null
);

const deterministicWorldLineId = async (
  generationId: string,
  index: number,
): Promise<string> => {
  const bytes = new TextEncoder().encode(`arena-world-line-v1\u0000${generationId}\u0000${index}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const matchesAppliedRevision = (
  record: Record<string, unknown> | null,
  generationId: string,
  baseRevisionHash: string | null,
): boolean => {
  if (textOf(record?.generation_id) !== generationId) return false;
  const appliedBase = textOf(record?.base_revision_hash);
  return !baseRevisionHash || !appliedBase || appliedBase === baseRevisionHash;
};

const combatantName = (data: Record<string, unknown>): string => (
  textOf(data.codename) || textOf(data.name)
);

export const createArenaPostBattleProjector = (
  options: ArenaPostBattleProjectorOptions,
) => async (
  input: ArenaCompanionProjectInput,
): Promise<Array<Record<string, unknown>>> => {
  const nowIso = (options.now?.() ?? new Date()).toISOString();
  const combatants = await Promise.all(input.combatants.map(async (value, index) => {
    const combatant = recordOf(value);
    const sourceData = recordOf(combatant?.data);
    if (!combatant || !sourceData) return null;
    return {
      index,
      combatant,
      sourceData,
      name: combatantName(sourceData),
      native: await options.signatures.verifySignature(sourceData),
    };
  }));
  const valid = combatants.filter((value): value is NonNullable<typeof value> => (
    Boolean(value?.name)
  ));
  const nativeByName = new Map<string, Set<boolean>>();
  for (const item of valid) {
    const key = token(item.name);
    const states = nativeByName.get(key) ?? new Set<boolean>();
    states.add(item.native);
    nativeByName.set(key, states);
  }
  const conflictingNames = new Set(
    [...nativeByName.entries()].filter(([, states]) => states.size > 1).map(([name]) => name),
  );
  const scenarioNative = input.scenario
    ? await options.signatures.verifySignature(input.scenario)
    : true;
  const reportMode = textOf(input.report.mode) || 'classic';
  const anyNonNative = valid.some((item) => !item.native || conflictingNames.has(token(item.name)))
    || (reportMode === 'scenario' && !scenarioNative);
  const participantNames = valid.map((item) => item.name);
  const officialReport = recordOf(input.report.officialReport);
  const winner = textOf(officialReport?.winner);
  const headline = textOf(input.report.headline) || '未命名战报';
  const impactByName = new Map(input.impacts.map((impact) => [token(impact.characterName), impact]));
  const updated: Array<Record<string, unknown>> = [];

  for (const item of valid) {
    const data = cloneRecord(item.sourceData);
    if (!textOf(data.templateId)) data.templateId = inferTemplateId(data);
    let didMutate = false;
    const impact = impactByName.get(token(item.name));

    if (input.writeArenaHistory) {
      const existingHistory = recordOf(data.arena_history);
      const existingEntries = Array.isArray(existingHistory?.entries)
        ? existingHistory.entries.flatMap((entry) => recordOf(entry) ? [recordOf(entry)!] : [])
        : [];
      const alreadyApplied = existingEntries.some((entry) => matchesAppliedRevision(
        recordOf(entry.metadata),
        input.generationId,
        input.baseRevisionHash,
      ));
      if (!alreadyApplied) {
        const existingAttributes = recordOf(existingHistory?.attributes) ?? {};
        const lastId = existingEntries.reduce((maximum, entry) => (
          typeof entry.id === 'number' && Number.isFinite(entry.id)
            ? Math.max(maximum, Math.floor(entry.id))
            : maximum
        ), 0);
        const guidance = textOf(item.combatant.characterGuidance).slice(0, 100);
        const attributes = {
          ...existingAttributes,
          world_line_id: textOf(existingAttributes.world_line_id)
            || await deterministicWorldLineId(input.generationId, item.index),
          created_at: textOf(existingAttributes.created_at) || nowIso,
          updated_at: nowIso,
          sublimation_count: typeof existingAttributes.sublimation_count === 'number'
            ? existingAttributes.sublimation_count
            : 0,
          last_sublimation_at: existingAttributes.last_sublimation_at ?? null,
        };
        data.arena_history = {
          ...(existingHistory ?? {}),
          attributes,
          entries: [...existingEntries, {
            id: lastId + 1,
            type: reportMode,
            title: headline,
            participants: participantNames,
            winner,
            impact: impact?.impact || '在此次事件中获得了成长。',
            metadata: {
              user_guidance: input.userGuidance,
              ...(guidance ? { character_guidance: guidance } : {}),
              scenario_title: scenarioTitle(input.scenario),
              non_native_data_involved: anyNonNative,
              generation_id: input.generationId,
              ...(input.baseRevisionHash ? { base_revision_hash: input.baseRevisionHash } : {}),
            },
          }],
        };
        didMutate = true;
      }
    }

    if (input.writeCurrentState && textOf(impact?.currentStateSummary)) {
      const existingState = recordOf(data.current_state);
      if (!matchesAppliedRevision(existingState, input.generationId, input.baseRevisionHash)) {
        data.current_state = {
          ...(existingState ?? {}),
          summary: textOf(impact?.currentStateSummary),
          updated_at: nowIso,
          generation_id: input.generationId,
          ...(input.baseRevisionHash ? { base_revision_hash: input.baseRevisionHash } : {}),
        };
        didMutate = true;
      }
    }

    if (!didMutate) continue;
    delete data.signature;
    if (item.native && !conflictingNames.has(token(item.name))) {
      const signature = await options.signatures.generateSignature(data);
      if (signature) data.signature = signature;
    }
    updated.push(data);
  }
  return updated;
};
