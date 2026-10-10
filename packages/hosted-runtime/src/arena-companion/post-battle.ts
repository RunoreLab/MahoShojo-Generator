import {
  getArenaPostBattleWorldLineIndices,
  projectArenaPostBattleCharacters,
} from '@mahoshojo/domain/arena-post-battle';
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

const token = (value: string): string => value.replace(/\s+/gu, '').toLocaleLowerCase();

const deterministicWorldLineId = async (
  generationId: string,
  index: number,
): Promise<string> => {
  const bytes = new TextEncoder().encode(`arena-world-line-v1\u0000${generationId}\u0000${index}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const combatantName = (data: Record<string, unknown>): string => (
  textOf(data.codename) || textOf(data.name)
);

export const createArenaPostBattleProjector = (
  options: ArenaPostBattleProjectorOptions,
) => async (
  input: ArenaCompanionProjectInput,
): Promise<Array<Record<string, unknown>>> => {
  const nowIso = Number.isFinite(Date.parse(input.occurredAt))
    ? new Date(input.occurredAt).toISOString()
    : (options.now?.() ?? new Date()).toISOString();
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
  const worldLineIds: Record<number, string> = {};
  for (const index of getArenaPostBattleWorldLineIndices(input)) {
    worldLineIds[index] = await deterministicWorldLineId(input.generationId, index);
  }
  const projections = projectArenaPostBattleCharacters({ ...input, occurredAt: nowIso }, {
    worldLineIds,
    nonNativeDataInvolved: anyNonNative,
  });
  const updated: Array<Record<string, unknown>> = [];
  for (const { combatantIndex, data } of projections) {
    const item = combatants[combatantIndex]!;
    if (item.native && !conflictingNames.has(token(item.name))) {
      const signature = await options.signatures.generateSignature(data);
      if (signature) data.signature = signature;
    }
    updated.push(data);
  }
  return updated;
};
