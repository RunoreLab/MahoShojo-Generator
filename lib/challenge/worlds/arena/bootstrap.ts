import type { PlayerSnapshotV1, StrengthTier, WorldStateV1, WorldTrackValueV1 } from '@/lib/challenge/types';
import { ARENA_BOOTSTRAP_STARTING_CURRENCY } from '@/lib/challenge/worlds/arena/manual-content';

type ArenaBootstrapSnapshot = {
  playerSnapshot: PlayerSnapshotV1;
  initialWorldState: WorldStateV1;
};

const DEFAULT_HP_TRACK: WorldTrackValueV1 = { current: 100, max: 100 };
const DEFAULT_RADIANCE_TRACK: WorldTrackValueV1 = { current: 60, max: 100 };
const DEFAULT_CURRENCY_TRACK: WorldTrackValueV1 = { current: ARENA_BOOTSTRAP_STARTING_CURRENCY, max: null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const getArenaRuleSnapshot = (card: unknown): Record<string, unknown> | null => {
  if (!isRecord(card)) return null;

  const buildState = isRecord(card.buildState) ? card.buildState : null;
  const buildStateRules = Array.isArray(buildState?.rules) ? buildState.rules : [];
  const matchedBuildStateRule = buildStateRules.find(
    (item) => isRecord(item) && safeString(item.ruleId) === 'arena-trpg-lite'
  );
  if (isRecord(matchedBuildStateRule)) return matchedBuildStateRule;

  const creationInputs = isRecord(card.creationInputs) ? card.creationInputs : null;
  const creationRules = Array.isArray(creationInputs?.buildRules) ? creationInputs.buildRules : [];
  const matchedCreationRule = creationRules.find(
    (item) => isRecord(item) && safeString(item.ruleId) === 'arena-trpg-lite'
  );
  return isRecord(matchedCreationRule) ? matchedCreationRule : null;
};

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getDisplayName = (card: unknown): string => {
  if (!isRecord(card)) return '未命名角色';
  const candidates = [
    card.displayName,
    card.codename,
    card.name,
    isRecord(card.magicalGirl) ? card.magicalGirl.codename : null,
  ];

  for (const candidate of candidates) {
    const normalized = safeString(candidate);
    if (normalized) return normalized;
  }
  return '未命名角色';
};

const getSourceType = (card: unknown): PlayerSnapshotV1['sourceType'] => {
  if (!isRecord(card)) return 'local-card';
  if (card.isPreset === true) return 'preset';
  if (safeString(card.sourceType) === 'public-card') return 'public-card';
  return 'local-card';
};

const getSourceId = (card: unknown, displayName: string): string => {
  if (!isRecord(card)) return displayName;
  return safeString(card.id) || safeString(card.sourceId) || displayName;
};

const getStrengthTier = (card: unknown, ruleSnapshot: Record<string, unknown> | null): StrengthTier => {
  const powerLevelFromRule = safeString(isRecord(ruleSnapshot?.blockResults) ? ruleSnapshot?.blockResults.powerLevel : '');
  const powerLevelFromCard =
    isRecord(card) && isRecord(card.blooming) ? safeString(card.blooming.powerLevel) : '';
  const powerLevel = powerLevelFromRule || powerLevelFromCard;

  switch (powerLevel) {
    case 'gemScepter':
    case 'unlimited':
      return 'boss';
    case 'bud':
    case 'flower':
      return 'elite';
    default:
      return 'common';
  }
};

const buildBaseTrackSnapshot = (ruleSnapshot: Record<string, unknown> | null): Record<string, WorldTrackValueV1> => {
  const derived = isRecord(ruleSnapshot?.derived) ? ruleSnapshot.derived : null;
  const derivedHp = asFiniteNumber(derived?.HP);
  const derivedRadiance = asFiniteNumber(derived?.Radiance);

  const hpMax = derivedHp === null ? DEFAULT_HP_TRACK.max ?? DEFAULT_HP_TRACK.current : clamp(derivedHp * 10, 60, 180);
  const radianceMax =
    derivedRadiance === null
      ? DEFAULT_RADIANCE_TRACK.max ?? DEFAULT_RADIANCE_TRACK.current
      : clamp(derivedRadiance * 10, 40, 140);

  return {
    hp: { current: hpMax, max: hpMax },
    radiance: { current: radianceMax, max: radianceMax },
    currency: { ...DEFAULT_CURRENCY_TRACK },
  };
};

const buildCombatProfile = (ruleSnapshot: Record<string, unknown> | null): Record<string, unknown> => {
  if (!ruleSnapshot) return {};
  return {
    powerLevel: isRecord(ruleSnapshot.blockResults) ? ruleSnapshot.blockResults.powerLevel : null,
    coreAttributes: isRecord(ruleSnapshot.blockResults) ? ruleSnapshot.blockResults.coreAttributes ?? {} : {},
    specialties: isRecord(ruleSnapshot.blockResults) ? ruleSnapshot.blockResults.specialties ?? [] : [],
    derived: isRecord(ruleSnapshot.derived) ? ruleSnapshot.derived : {},
  };
};

const buildTags = (card: unknown, strengthTier: StrengthTier, ruleSnapshot: Record<string, unknown> | null): string[] => {
  const tags = new Set<string>([strengthTier]);

  if (isRecord(card) && isRecord(card.analysis) && Array.isArray(card.analysis.coreTraits)) {
    card.analysis.coreTraits
      .map((item) => safeString(item))
      .filter(Boolean)
      .forEach((item) => tags.add(item));
  }

  const specialties =
    isRecord(ruleSnapshot?.blockResults) && Array.isArray(ruleSnapshot.blockResults.specialties)
      ? ruleSnapshot.blockResults.specialties
      : [];
  specialties
    .map((item) => safeString(item))
    .filter(Boolean)
    .forEach((item) => tags.add(item));

  return Array.from(tags);
};

const buildPromptSummary = (card: unknown, displayName: string, strengthTier: StrengthTier): string => {
  const sections: string[] = [`${displayName}的竞技场挑战快照`, `强度档：${strengthTier}`];
  if (isRecord(card) && isRecord(card.analysis)) {
    const personality = safeString(card.analysis.personalityAnalysis);
    const abilityReasoning = safeString(card.analysis.abilityReasoning);
    const predictionBasis = safeString(card.analysis.predictionBasis);
    if (personality) sections.push(`性格：${personality}`);
    if (abilityReasoning) sections.push(`战斗倾向：${abilityReasoning}`);
    if (predictionBasis) sections.push(`补充依据：${predictionBasis}`);
  }
  if (isRecord(card) && isRecord(card.magicConstruct)) {
    const description = safeString(card.magicConstruct.description);
    if (description) sections.push(`魔装：${description}`);
  }
  return sections.join('；');
};

export const buildArenaBootstrapSnapshot = (
  card: unknown,
  input: { snapshotSeed: string }
): ArenaBootstrapSnapshot => {
  const displayName = getDisplayName(card);
  const ruleSnapshot = getArenaRuleSnapshot(card);
  const baseTrackSnapshot = buildBaseTrackSnapshot(ruleSnapshot);
  const strengthTier = getStrengthTier(card, ruleSnapshot);

  const playerSnapshot: PlayerSnapshotV1 = {
    version: 1,
    sourceType: getSourceType(card),
    sourceId: getSourceId(card, displayName),
    displayName,
    snapshotSeed: safeString(input.snapshotSeed) || 'snapshot-seed',
    strengthTier,
    baseTrackSnapshot,
    combatProfile: buildCombatProfile(ruleSnapshot),
    tags: buildTags(card, strengthTier, ruleSnapshot),
    promptSummary: buildPromptSummary(card, displayName, strengthTier),
  };

  return {
    playerSnapshot,
    initialWorldState: {
      version: 1,
      schemaId: 'arena-v1',
      tracks: {
        hp: { ...baseTrackSnapshot.hp },
        radiance: { ...baseTrackSnapshot.radiance },
        currency: { ...baseTrackSnapshot.currency },
      },
      temporaryStatuses: [],
      runFlags: [],
      persistentItemIds: [],
      consumableIds: [],
    },
  };
};
