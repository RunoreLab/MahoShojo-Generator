import type { EnemySnapshotV1, StrengthTier } from '@/lib/challenge/types';
import { buildArenaBootstrapSnapshot } from '@/lib/challenge/worlds/arena/bootstrap';
import { getBundledPresetData } from '@/lib/pvp/preset-bundled';

type RankedArenaEntity = {
  entityType: 'data_card' | 'preset';
  entityId: string;
  displayName?: string | null;
  description?: string | null;
  rating?: number | null;
  tierLabel?: string | null;
};

type ArenaEnemySourceModeInput = 'online-first' | 'preset-only';
type ArenaEnemyResolvedSourceMode = 'remote' | 'preset-only';

type ArenaEnemyPoolEntry = EnemySnapshotV1 | unknown;

export type ResolveArenaEnemyCandidatesInput = {
  tier: StrengthTier;
  sourceMode: ArenaEnemySourceModeInput;
  runSeed?: string | null;
  limit?: number;
};

type ArenaEnemySourceDeps = {
  loadRankedEntities?: (input: {
    tier: StrengthTier;
    limit: number;
    runSeed?: string | null;
  }) => Promise<RankedArenaEntity[]>;
  loadPublicCardById?: (entityId: string) => Promise<unknown | null>;
  loadPresetById?: (entityId: string) => Promise<unknown | null> | unknown | null;
  loadPresetPool?: (input: { tier: StrengthTier; limit: number }) => Promise<ArenaEnemyPoolEntry[]> | ArenaEnemyPoolEntry[];
};

export type ResolveArenaEnemyCandidatesResult = {
  resolvedSourceMode: ArenaEnemyResolvedSourceMode;
  candidates: EnemySnapshotV1[];
};

export type SelectArenaEnemySnapshotInput = ResolveArenaEnemyCandidatesInput & {
  selectionSeed?: string | null;
};

export type SelectArenaEnemySnapshotResult = {
  resolvedSourceMode: ArenaEnemyResolvedSourceMode;
  enemySnapshot: EnemySnapshotV1;
};

const DEFAULT_CANDIDATE_LIMIT = 6;

const DEFAULT_PRESET_POOL_IDS: Record<StrengthTier, string[]> = {
  common: ['M02_white_rose.json', 'M03_little_brocade.json', 'M06_sparrow.json', 'M90_goose.json'],
  elite: ['M01_centaurea.json', 'M04_boxue.json', 'M07_margaret.json', 'M11_sunflower.json'],
  boss: ['M12_greatness_in_simplicity.json', 'M13_greatness_in_complexity.json', 'M15_centaurea_in_heart.json', 'M90_goose.json'],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const readPowerLevel = (card: Record<string, unknown>): string => {
  const buildState = isRecord(card.buildState) ? card.buildState : null;
  const buildStateRules = Array.isArray(buildState?.rules) ? buildState.rules : [];
  const matchedBuildStateRule = buildStateRules.find(
    (item) => isRecord(item) && safeString(item.ruleId) === 'arena-trpg-lite'
  );
  if (isRecord(matchedBuildStateRule) && isRecord(matchedBuildStateRule.blockResults)) {
    return safeString(matchedBuildStateRule.blockResults.powerLevel);
  }

  const creationInputs = isRecord(card.creationInputs) ? card.creationInputs : null;
  const creationRules = Array.isArray(creationInputs?.buildRules) ? creationInputs.buildRules : [];
  const matchedCreationRule = creationRules.find(
    (item) => isRecord(item) && safeString(item.ruleId) === 'arena-trpg-lite'
  );
  if (isRecord(matchedCreationRule) && isRecord(matchedCreationRule.blockResults)) {
    return safeString(matchedCreationRule.blockResults.powerLevel);
  }

  return isRecord(card.blooming) ? safeString(card.blooming.powerLevel) : '';
};

const deriveStrengthTierFromPowerLevel = (powerLevel: string): StrengthTier | null => {
  switch (powerLevel) {
    case 'gemScepter':
    case 'unlimited':
      return 'boss';
    case 'bud':
    case 'flower':
      return 'elite';
    case 'seed':
    case 'leaf':
      return 'common';
    default:
      return null;
  }
};

const unwrapArenaCardPayload = (input: unknown): Record<string, unknown> | null => {
  if (!isRecord(input)) return null;

  const rawData = input.data;
  if (typeof rawData === 'string') {
    try {
      const parsed = JSON.parse(rawData);
      if (!isRecord(parsed)) return null;
      return {
        ...parsed,
        id: safeString(input.id) || safeString(parsed.id),
        sourceId: safeString(input.id) || safeString(parsed.sourceId),
        sourceType: safeString(parsed.sourceType) || 'public-card',
      };
    } catch {
      return null;
    }
  }

  if (isRecord(rawData)) {
    return {
      ...rawData,
      id: safeString(input.id) || safeString(rawData.id),
      sourceId: safeString(input.id) || safeString(rawData.sourceId),
      sourceType: safeString(rawData.sourceType) || 'public-card',
    };
  }

  return input;
};

const isEnemySnapshot = (value: unknown): value is EnemySnapshotV1 =>
  isRecord(value) &&
  value.version === 1 &&
  (value.sourceType === 'preset' || value.sourceType === 'public-card' || value.sourceType === 'season-entity') &&
  typeof value.sourceId === 'string' &&
  typeof value.displayName === 'string' &&
  (value.strengthTier === 'common' || value.strengthTier === 'elite' || value.strengthTier === 'boss');

const rebuildTierTagList = (tags: string[], strengthTier: StrengthTier): string[] => {
  const filtered = tags.filter((tag) => tag !== 'common' && tag !== 'elite' && tag !== 'boss');
  return Array.from(new Set([strengthTier, ...filtered]));
};

const normalizePromptSummaryTier = (promptSummary: string, sourceTier: StrengthTier, targetTier: StrengthTier): string => {
  if (sourceTier === targetTier) return promptSummary;
  return promptSummary.replace(`强度档：${sourceTier}`, `强度档：${targetTier}`);
};

const normalizeArenaEnemySnapshot = (
  raw: unknown,
  input: {
    sourceType: EnemySnapshotV1['sourceType'];
    sourceId: string;
    targetTier: StrengthTier;
    displayNameHint?: string | null;
  }
): EnemySnapshotV1 | null => {
  if (isEnemySnapshot(raw)) {
    const nextPromptSummary = normalizePromptSummaryTier(raw.promptSummary, raw.strengthTier, input.targetTier);
    if (raw.strengthTier === input.targetTier && nextPromptSummary === raw.promptSummary) {
      return raw;
    }

    return {
      ...raw,
      strengthTier: input.targetTier,
      tags: rebuildTierTagList(raw.tags, input.targetTier),
      promptSummary: nextPromptSummary,
    };
  }

  const cardPayload = unwrapArenaCardPayload(raw);
  if (!cardPayload) return null;

  const normalizedCard: Record<string, unknown> = {
    ...cardPayload,
    id: input.sourceId || safeString(cardPayload.id),
    sourceId: input.sourceId || safeString(cardPayload.sourceId),
    sourceType: input.sourceType,
    isPreset: input.sourceType === 'preset' ? true : cardPayload.isPreset === true,
  };

  const bootstrap = buildArenaBootstrapSnapshot(normalizedCard, {
    snapshotSeed: `challenge-enemy:${input.sourceId || safeString(normalizedCard.id) || 'unknown'}`,
  });
  const strengthTier = input.targetTier;
  const displayName = bootstrap.playerSnapshot.displayName || safeString(input.displayNameHint) || safeString(normalizedCard.codename) || input.sourceId;

  return {
    version: 1,
    sourceType: input.sourceType,
    sourceId: input.sourceId || displayName,
    displayName,
    strengthTier,
    combatProfile: bootstrap.playerSnapshot.combatProfile,
    tags: rebuildTierTagList(bootstrap.playerSnapshot.tags, strengthTier),
    promptSummary: normalizePromptSummaryTier(
      bootstrap.playerSnapshot.promptSummary,
      deriveStrengthTierFromPowerLevel(readPowerLevel(normalizedCard)) ?? bootstrap.playerSnapshot.strengthTier,
      strengthTier
    ),
  };
};

const buildSeasonEntitySnapshot = (
  entity: RankedArenaEntity,
  targetTier: StrengthTier
): EnemySnapshotV1 | null => {
  const displayName = safeString(entity.displayName);
  const sourceId = safeString(entity.entityId);
  if (!displayName || !sourceId) return null;

  const promptParts = [`${displayName}的赛季对手快照`, `强度档：${targetTier}`];
  if (typeof entity.rating === 'number' && Number.isFinite(entity.rating)) {
    promptParts.push(`排位分：${entity.rating}`);
  }
  const tierLabel = safeString(entity.tierLabel);
  if (tierLabel) promptParts.push(`排位段：${tierLabel}`);
  const description = safeString(entity.description);
  if (description) promptParts.push(`简介：${description}`);

  return {
    version: 1,
    sourceType: 'season-entity',
    sourceId,
    displayName,
    strengthTier: targetTier,
    combatProfile: {},
    tags: [targetTier, 'season-ranked'],
    promptSummary: promptParts.join('；'),
  };
};

const dedupeEnemySnapshots = (candidates: EnemySnapshotV1[]): EnemySnapshotV1[] => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.sourceType}:${candidate.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const hashStringToUint32 = (input: string): number => {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
};

const loadDefaultPresetById = async (entityId: string): Promise<unknown | null> => {
  const preset = getBundledPresetData(entityId);
  if (!isRecord(preset)) return null;
  return {
    ...preset,
    id: entityId,
    sourceId: entityId,
    sourceType: 'preset',
    isPreset: true,
  };
};

const loadDefaultPresetPool = async (input: { tier: StrengthTier; limit: number }): Promise<ArenaEnemyPoolEntry[]> => {
  const presetIds = DEFAULT_PRESET_POOL_IDS[input.tier] ?? [];
  const pool: ArenaEnemyPoolEntry[] = [];

  for (const presetId of presetIds.slice(0, input.limit)) {
    const preset = await loadDefaultPresetById(presetId);
    if (preset) pool.push(preset);
  }

  return pool;
};

const normalizeRankedEntity = async (
  entity: RankedArenaEntity,
  input: { targetTier: StrengthTier; loadPublicCardById?: ArenaEnemySourceDeps['loadPublicCardById']; loadPresetById?: ArenaEnemySourceDeps['loadPresetById'] }
): Promise<EnemySnapshotV1 | null> => {
  if (entity.entityType === 'data_card') {
    const card = input.loadPublicCardById ? await input.loadPublicCardById(entity.entityId) : null;
    if (card) {
      return normalizeArenaEnemySnapshot(card, {
        sourceType: 'public-card',
        sourceId: entity.entityId,
        targetTier: input.targetTier,
        displayNameHint: entity.displayName,
      });
    }
    return buildSeasonEntitySnapshot(entity, input.targetTier);
  }

  const preset = input.loadPresetById ? await input.loadPresetById(entity.entityId) : null;
  if (preset) {
    return normalizeArenaEnemySnapshot(preset, {
      sourceType: 'preset',
      sourceId: entity.entityId,
      targetTier: input.targetTier,
      displayNameHint: entity.displayName,
    });
  }

  return buildSeasonEntitySnapshot(entity, input.targetTier);
};

const normalizePresetPool = async (
  entries: ArenaEnemyPoolEntry[],
  input: { targetTier: StrengthTier }
): Promise<EnemySnapshotV1[]> => {
  const normalized = await Promise.all(
    entries.map(async (entry, index) => {
      if (isEnemySnapshot(entry)) {
        return normalizeArenaEnemySnapshot(entry, {
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          targetTier: input.targetTier,
          displayNameHint: entry.displayName,
        });
      }

      const cardPayload = unwrapArenaCardPayload(entry);
      if (!cardPayload) return null;
      const sourceId = safeString(cardPayload.id) || safeString(cardPayload.sourceId) || `arena-preset-${input.targetTier}-${index + 1}`;
      return normalizeArenaEnemySnapshot(cardPayload, {
        sourceType: cardPayload.isPreset === true ? 'preset' : 'preset',
        sourceId,
        targetTier: input.targetTier,
      });
    })
  );

  return normalized.filter((candidate): candidate is EnemySnapshotV1 => candidate !== null);
};

export const resolveArenaEnemyCandidates = async (
  input: ResolveArenaEnemyCandidatesInput,
  deps: ArenaEnemySourceDeps = {}
): Promise<ResolveArenaEnemyCandidatesResult> => {
  const limit = Math.max(1, Math.min(12, Math.floor(input.limit ?? DEFAULT_CANDIDATE_LIMIT)));

  if (input.sourceMode !== 'preset-only' && deps.loadRankedEntities) {
    try {
      const rankedEntities = await deps.loadRankedEntities({
        tier: input.tier,
        limit,
        runSeed: input.runSeed,
      });

      const remoteCandidates = (
        await Promise.all(
          rankedEntities.map((entity) =>
            normalizeRankedEntity(entity, {
              targetTier: input.tier,
              loadPublicCardById: deps.loadPublicCardById,
              loadPresetById: deps.loadPresetById ?? loadDefaultPresetById,
            })
          )
        )
      ).filter((candidate): candidate is EnemySnapshotV1 => candidate !== null);

      const dedupedRemoteCandidates = dedupeEnemySnapshots(remoteCandidates).slice(0, limit);
      if (dedupedRemoteCandidates.length > 0) {
        return {
          resolvedSourceMode: 'remote',
          candidates: dedupedRemoteCandidates,
        };
      }
    } catch {}
  }

  const presetEntries = await (deps.loadPresetPool ?? loadDefaultPresetPool)({
    tier: input.tier,
    limit,
  });
  const presetCandidates = dedupeEnemySnapshots(
    await normalizePresetPool(Array.isArray(presetEntries) ? presetEntries : [], {
      targetTier: input.tier,
    })
  ).slice(0, limit);

  return {
    resolvedSourceMode: 'preset-only',
    candidates: presetCandidates,
  };
};

export const selectArenaEnemySnapshot = async (
  input: SelectArenaEnemySnapshotInput,
  deps: ArenaEnemySourceDeps = {}
): Promise<SelectArenaEnemySnapshotResult> => {
  const result = await resolveArenaEnemyCandidates(input, deps);
  const seed = safeString(input.selectionSeed) || safeString(input.runSeed) || `arena:${input.tier}`;
  const candidate = result.candidates[hashStringToUint32(seed) % result.candidates.length];

  if (!candidate) {
    throw new Error(`ARENA_ENEMY_CANDIDATE_NOT_FOUND:${input.tier}`);
  }

  return {
    resolvedSourceMode: result.resolvedSourceMode,
    enemySnapshot: candidate,
  };
};
