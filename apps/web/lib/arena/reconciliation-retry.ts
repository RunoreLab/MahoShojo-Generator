import { hashArenaCombatantBaseRevision } from '@mahoshojo/domain/arena-reconciliation';

export type ArenaReconciliationRetryCombatant = Readonly<{
  type: unknown;
  data: unknown;
  isValid?: boolean;
  isPreset?: boolean;
  characterGuidance?: unknown;
}>;

export const projectArenaReconciliationCombatants = (
  combatants: readonly ArenaReconciliationRetryCombatant[],
) => combatants.map((combatant) => ({
  type: combatant.type,
  data: combatant.data,
  isNative: combatant.isValid === true,
  isPreset: combatant.isPreset,
  characterGuidance: typeof combatant.characterGuidance === 'string'
    ? combatant.characterGuidance
    : null,
}));

export const buildArenaReconciliationRetryPayload = async (
  generationId: string,
  combatants: readonly ArenaReconciliationRetryCombatant[],
) => {
  const projectedCombatants = projectArenaReconciliationCombatants(combatants);
  return {
    generationId: generationId.trim(),
    baseRevisionHash: await hashArenaCombatantBaseRevision(projectedCombatants),
    combatants: projectedCombatants,
  };
};
