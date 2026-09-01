export type ArenaReconciliationRetryCombatant = Readonly<{
  type: unknown;
  data: unknown;
  isValid?: boolean;
  isPreset?: boolean;
  filename?: unknown;
  sourceDataCardId?: unknown;
  dataCardId?: unknown;
  sourceDataCardUpdatedAt?: unknown;
  roomCombatantKey?: unknown;
  arenaRoomKey?: unknown;
  characterGuidance?: unknown;
}>;

const text = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

export const projectArenaReconciliationCombatants = (
  combatants: readonly ArenaReconciliationRetryCombatant[],
) => combatants.map((combatant) => ({
  type: combatant.type,
  data: combatant.data,
  isPreset: combatant.isPreset,
  ...(text(combatant.filename) ? { filename: text(combatant.filename) } : {}),
  ...(text(combatant.sourceDataCardId)
    ? { sourceDataCardId: text(combatant.sourceDataCardId) }
    : text(combatant.dataCardId)
    ? { dataCardId: text(combatant.dataCardId) }
    : {}),
  ...(text(combatant.roomCombatantKey) || text(combatant.arenaRoomKey)
    ? { roomCombatantKey: text(combatant.roomCombatantKey) ?? text(combatant.arenaRoomKey) }
    : {}),
}));

export const buildArenaReconciliationRetryPayload = async (
  generationId: string,
  combatants: readonly ArenaReconciliationRetryCombatant[],
) => ({
  generationId: generationId.trim(),
  combatants: projectArenaReconciliationCombatants(combatants),
});
