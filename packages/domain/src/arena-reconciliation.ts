const sortCanonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortCanonical((value as Record<string, unknown>)[key])]),
  );
};

const recordOf = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

export const projectArenaCombatantBaseRevision = (value: unknown): unknown => {
  const combatant = recordOf(value);
  if (!combatant) return null;
  return {
    type: typeof combatant.type === 'string' ? combatant.type : null,
    data: recordOf(combatant.data),
    isNative: combatant.isNative === true,
    isPreset: combatant.isPreset === true,
    characterGuidance: typeof combatant.characterGuidance === 'string'
      ? combatant.characterGuidance
      : null,
  };
};

export const hashArenaCombatantBaseRevision = async (
  combatants: readonly unknown[],
): Promise<string> => {
  const canonical = JSON.stringify(sortCanonical(
    combatants.map(projectArenaCombatantBaseRevision),
  ));
  const bytes = new TextEncoder().encode(`arena-card-base-revision-v1\u0000${canonical}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
};
