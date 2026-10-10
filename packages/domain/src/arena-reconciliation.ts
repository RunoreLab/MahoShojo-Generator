/**
 * 当前卡片的对账请求投影。稳定身份只是交给服务器的匹配线索，不授予原生性或写回权限；
 * generation owner、冻结 roster/effect、验签和签名始终由服务器裁决。
 */
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

/**
 * 应用服务器已对账的结果，不在客户端重新按名称或生成时位置匹配角色。
 * combatantIndex 是本次请求中可读角色数组的下标；宿主必须先确认请求上下文仍有效。
 * 随机占位符不占这个下标，未返回的角色保持原样。这里不验证签名，也不保存任何数据。
 */
export const applyArenaReconciliationUpdates = <TCombatant extends object>(
  combatants: readonly TCombatant[],
  updates: readonly unknown[],
): { combatants: TCombatant[]; updatedCombatants: Record<string, unknown>[] } => {
  const indexedUpdates = updates.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const entry = value as {
      combatantIndex?: unknown;
      data?: unknown;
      isNative?: unknown;
    };
    return typeof entry.combatantIndex === 'number'
      && Number.isSafeInteger(entry.combatantIndex)
      && entry.combatantIndex >= 0
      && entry.data
      && typeof entry.data === 'object'
      && !Array.isArray(entry.data)
      ? [{
        combatantIndex: entry.combatantIndex,
        data: entry.data as Record<string, unknown>,
        isNative: entry.isNative === true,
      }]
      : [];
  });
  const updateByIndex = new Map(indexedUpdates.map((entry) => [entry.combatantIndex, entry]));
  let readableCombatantIndex = 0;
  return {
    updatedCombatants: indexedUpdates.map((entry) => entry.data),
    combatants: combatants.map((combatant) => {
      if (!('data' in combatant)) return combatant;
      const updated = updateByIndex.get(readableCombatantIndex);
      readableCombatantIndex += 1;
      return updated
        ? { ...combatant, data: updated.data, isValid: updated.isNative }
        : combatant;
    }),
  };
};
