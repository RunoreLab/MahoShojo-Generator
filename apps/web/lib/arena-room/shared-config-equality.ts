import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalize(entry)]));
};

/** Authority integrity comparisons retain every observed version. */
export const areArenaRoomSharedConfigsExactlyEqual = (
  left: ArenaRoomSharedConfig | null,
  right: ArenaRoomSharedConfig | null,
): boolean => JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

const withoutOnlineVersion = <T extends { key: string } | null>(entry: T): unknown => {
  if (!entry || !('ref' in entry)) return entry;
  const ref = entry.ref as { id: string; kind: string; versionToken: string };
  if (entry.key !== `data-card:${ref.id}`) return entry;
  return { ...entry, ref: { ...ref, versionToken: '' } };
};

const semanticConfig = (config: ArenaRoomSharedConfig | null): unknown => config && ({
  ...config,
  combatants: config.combatants.map(withoutOnlineVersion),
  scenario: withoutOnlineVersion(config.scenario),
  auxScenarios: config.auxScenarios.map(withoutOnlineVersion),
  materials: config.materials.map(withoutOnlineVersion),
});

/** Online card versions are observations, not part of the user's configuration intent. */
export const areArenaRoomSharedConfigsSemanticallyEqual = (
  left: ArenaRoomSharedConfig | null,
  right: ArenaRoomSharedConfig | null,
): boolean => JSON.stringify(canonicalize(semanticConfig(left)))
  === JSON.stringify(canonicalize(semanticConfig(right)));
