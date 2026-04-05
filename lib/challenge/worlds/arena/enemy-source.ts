import {
  type ChallengeResolvedSourceCardLite,
  type EnemySnapshotV1,
  type StrengthTier,
} from '@/lib/challenge/types';
import {
  isChallengeRenderableSourceCard,
} from '@/lib/challenge/source-card-renderability';
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

type RankedEntityWindowInput = {
  tier: StrengthTier;
  limit: number;
  offset: number;
  runSeed?: string | null;
};

type ArenaEnemySourceDeps = {
  loadRankedEntityWindow?: (input: RankedEntityWindowInput) => Promise<RankedArenaEntity[]>;
  loadPublicCardsByIds?: (ids: string[]) => Promise<Map<string, unknown>>;
  loadRankedEntities?: (input: {
    tier: StrengthTier;
    limit: number;
    runSeed?: string | null;
  }) => Promise<RankedArenaEntity[]>;
  loadPresetById?: (entityId: string) => Promise<unknown | null> | unknown | null;
  loadPresetPool?: (input: { tier: StrengthTier; limit: number }) => Promise<ArenaEnemyPoolEntry[]> | ArenaEnemyPoolEntry[];
};

export type ResolveArenaEnemyCandidatesResult = {
  resolvedSourceMode: ArenaEnemyResolvedSourceMode;
  candidates: EnemySnapshotV1[];
  resolvedSourceCardsById: Map<string, ChallengeResolvedSourceCardLite>;
};

export type SelectArenaEnemySnapshotInput = ResolveArenaEnemyCandidatesInput & {
  selectionSeed?: string | null;
};

export type SelectArenaEnemySnapshotResult = {
  resolvedSourceMode: ArenaEnemyResolvedSourceMode;
  enemySnapshot: EnemySnapshotV1;
  resolvedSourceCardLite: ChallengeResolvedSourceCardLite | null;
};

const DEFAULT_CANDIDATE_LIMIT = 6;
const DEFAULT_MINIMUM_REMOTE_CANDIDATES = 3;

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
    (item) => isRecord(item) && safeString(item.ruleId) === 'arena-trpg-lite',
  );
  if (isRecord(matchedBuildStateRule) && isRecord(matchedBuildStateRule.blockResults)) {
    return safeString(matchedBuildStateRule.blockResults.powerLevel);
  }

  const creationInputs = isRecord(card.creationInputs) ? card.creationInputs : null;
  const creationRules = Array.isArray(creationInputs?.buildRules) ? creationInputs.buildRules : [];
  const matchedCreationRule = creationRules.find(
    (item) => isRecord(item) && safeString(item.ruleId) === 'arena-trpg-lite',
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
  isRecord(value)
  && value.version === 1
  && (value.sourceType === 'preset' || value.sourceType === 'public-card' || value.sourceType === 'season-entity')
  && typeof value.sourceId === 'string'
  && typeof value.displayName === 'string'
  && (value.strengthTier === 'common' || value.strengthTier === 'elite' || value.strengthTier === 'boss');

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
  },
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
  const displayName = bootstrap.playerSnapshot.displayName
    || safeString(input.displayNameHint)
    || safeString(normalizedCard.codename)
    || input.sourceId;

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
      strengthTier,
    ),
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

const normalizePresetPool = async (
  entries: ArenaEnemyPoolEntry[],
  input: { targetTier: StrengthTier },
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
      const sourceId = safeString(cardPayload.id)
        || safeString(cardPayload.sourceId)
        || `arena-preset-${input.targetTier}-${index + 1}`;
      return normalizeArenaEnemySnapshot(cardPayload, {
        sourceType: 'preset',
        sourceId,
        targetTier: input.targetTier,
      });
    }),
  );

  return normalized.filter((candidate): candidate is EnemySnapshotV1 => candidate !== null);
};

type ResolvedSourceCardEnvelope = {
  lite: ChallengeResolvedSourceCardLite;
  payload: Record<string, unknown>;
};

const readSourceCardUpdatedAt = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  const updatedAt = value.updatedAt;
  if (typeof updatedAt === 'string') return updatedAt;
  const legacyUpdatedAt = value.updated_at;
  return typeof legacyUpdatedAt === 'string' ? legacyUpdatedAt : null;
};

const readSourceCardName = (entityId: string, raw: Record<string, unknown>, payload: Record<string, unknown>): string =>
  safeString(raw.name)
  || safeString(payload.name)
  || safeString(payload.codename)
  || safeString(raw.id)
  || safeString(payload.id)
  || entityId;

const buildResolvedSourceCardEnvelope = (
  entityId: string,
  input: unknown,
): ResolvedSourceCardEnvelope | null => {
  const payload = unwrapArenaCardPayload(input);
  if (!payload) return null;

  const raw = isRecord(input) ? input : payload;
  const rawData = raw.data;
  const serializedData = typeof rawData === 'string' ? rawData : JSON.stringify(payload);
  if (!serializedData) return null;

  return {
    lite: {
      id: safeString(raw.id) || entityId,
      name: readSourceCardName(entityId, raw, payload),
      data: serializedData,
      updatedAt: readSourceCardUpdatedAt(raw),
    },
    payload,
  };
};

const getFirstWindowLimit = (limit: number): number => Math.min(Math.max(limit * 3, 12), 18);

const getSecondWindowLimit = (limit: number): number => Math.min(Math.max(limit * 2, 6), 12);

const getMinimumRemoteCandidateCount = (): number => DEFAULT_MINIMUM_REMOTE_CANDIDATES;

const getLoadRankedEntityWindow = (
  deps: ArenaEnemySourceDeps,
): ArenaEnemySourceDeps['loadRankedEntityWindow'] | null => {
  if (deps.loadRankedEntityWindow) return deps.loadRankedEntityWindow;
  if (!deps.loadRankedEntities) return null;

  return async ({ tier, limit, offset, runSeed }) => {
    if (offset > 0) return [];
    return deps.loadRankedEntities?.({ tier, limit, runSeed }) ?? [];
  };
};

const getLoadPublicCardsByIds = (
  deps: ArenaEnemySourceDeps,
): ((ids: string[]) => Promise<Map<string, ResolvedSourceCardEnvelope>>) | null => {
  if (!deps.loadPublicCardsByIds) return null;

  return async (ids) => {
    const rawMap = await deps.loadPublicCardsByIds?.(ids);
    const normalized = new Map<string, ResolvedSourceCardEnvelope>();
    rawMap?.forEach((value, key) => {
      const envelope = buildResolvedSourceCardEnvelope(key, value);
      if (envelope) normalized.set(key, envelope);
    });
    return normalized;
  };
};

const resolveRemoteArenaCandidates = async (
  input: ResolveArenaEnemyCandidatesInput,
  deps: ArenaEnemySourceDeps,
  limit: number,
): Promise<{
  candidates: EnemySnapshotV1[];
  resolvedSourceCardsById: Map<string, ChallengeResolvedSourceCardLite>;
}> => {
  const loadRankedEntityWindow = getLoadRankedEntityWindow(deps);
  if (!loadRankedEntityWindow) {
    return {
      candidates: [],
      resolvedSourceCardsById: new Map(),
    };
  }

  const loadPublicCardsByIds = getLoadPublicCardsByIds(deps);
  const resolvedSourceCardsById = new Map<string, ChallengeResolvedSourceCardLite>();
  const remoteCandidates: EnemySnapshotV1[] = [];
  const windowConfigs = [
    { limit: getFirstWindowLimit(limit), offset: 0 },
    { limit: getSecondWindowLimit(limit), offset: getFirstWindowLimit(limit) },
  ];

  for (const [index, windowConfig] of windowConfigs.entries()) {
    if (index > 0 && dedupeEnemySnapshots(remoteCandidates).length >= limit) {
      break;
    }

    const rankedEntities = await loadRankedEntityWindow({
      tier: input.tier,
      limit: windowConfig.limit,
      offset: windowConfig.offset,
      runSeed: input.runSeed,
    });

    if (!Array.isArray(rankedEntities) || rankedEntities.length === 0) {
      continue;
    }

    const presetEntities = rankedEntities.filter((entity) => entity.entityType === 'preset');
    const dataCardEntities = rankedEntities.filter((entity) => entity.entityType === 'data_card');
    const presetsById = new Map<string, unknown>();

    await Promise.all(
      presetEntities.map(async (entity) => {
        const preset = await (deps.loadPresetById ?? loadDefaultPresetById)(entity.entityId);
        if (preset) presetsById.set(entity.entityId, preset);
      }),
    );

    const dataCardIds = Array.from(new Set(dataCardEntities.map((entity) => entity.entityId).filter(Boolean)));
    const envelopesById =
      loadPublicCardsByIds && dataCardIds.length > 0
        ? await loadPublicCardsByIds(dataCardIds)
        : new Map<string, ResolvedSourceCardEnvelope>();

    for (const entity of rankedEntities) {
      if (entity.entityType === 'preset') {
        const preset = presetsById.get(entity.entityId);
        if (!preset) continue;
        const snapshot = normalizeArenaEnemySnapshot(preset, {
          sourceType: 'preset',
          sourceId: entity.entityId,
          targetTier: input.tier,
          displayNameHint: entity.displayName,
        });
        if (snapshot) remoteCandidates.push(snapshot);
        continue;
      }

      const envelope = envelopesById.get(entity.entityId);
      if (!envelope) continue;
      if (!isChallengeRenderableSourceCard(envelope.payload)) continue;

      const snapshot = normalizeArenaEnemySnapshot(envelope.payload, {
        sourceType: 'public-card',
        sourceId: entity.entityId,
        targetTier: input.tier,
        displayNameHint: entity.displayName,
      });
      if (!snapshot) continue;

      remoteCandidates.push(snapshot);
      resolvedSourceCardsById.set(entity.entityId, envelope.lite);
    }
  }

  return {
    candidates: dedupeEnemySnapshots(remoteCandidates).slice(0, limit),
    resolvedSourceCardsById,
  };
};

export const resolveArenaEnemyCandidates = async (
  input: ResolveArenaEnemyCandidatesInput,
  deps: ArenaEnemySourceDeps = {},
): Promise<ResolveArenaEnemyCandidatesResult> => {
  const limit = Math.max(1, Math.min(12, Math.floor(input.limit ?? DEFAULT_CANDIDATE_LIMIT)));

  if (input.sourceMode !== 'preset-only') {
    try {
      const remoteResult = await resolveRemoteArenaCandidates(input, deps, limit);
      const safeRemoteCandidates = remoteResult.candidates.filter(
        (candidate) =>
          candidate.sourceType !== 'public-card' || remoteResult.resolvedSourceCardsById.has(candidate.sourceId),
      );
      if (safeRemoteCandidates.length >= getMinimumRemoteCandidateCount()) {
        return {
          resolvedSourceMode: 'remote',
          candidates: safeRemoteCandidates,
          resolvedSourceCardsById: remoteResult.resolvedSourceCardsById,
        };
      }
    } catch {
      // keep preset-only fallback behavior
    }
  }

  const presetEntries = await (deps.loadPresetPool ?? loadDefaultPresetPool)({
    tier: input.tier,
    limit,
  });
  const presetCandidates = dedupeEnemySnapshots(
    await normalizePresetPool(Array.isArray(presetEntries) ? presetEntries : [], {
      targetTier: input.tier,
    }),
  ).slice(0, limit);

  return {
    resolvedSourceMode: 'preset-only',
    candidates: presetCandidates,
    resolvedSourceCardsById: new Map(),
  };
};

export const selectArenaEnemySnapshot = async (
  input: SelectArenaEnemySnapshotInput,
  deps: ArenaEnemySourceDeps = {},
): Promise<SelectArenaEnemySnapshotResult> => {
  const result = await resolveArenaEnemyCandidates(input, deps);
  const seed = safeString(input.selectionSeed) || safeString(input.runSeed) || `arena:${input.tier}`;
  const startIndex = hashStringToUint32(seed) % result.candidates.length;
  const candidate = Array.from({ length: result.candidates.length }, (_, index) => {
    const nextIndex = (startIndex + index) % result.candidates.length;
    return result.candidates[nextIndex];
  }).find(
    (item) => item && (item.sourceType !== 'public-card' || result.resolvedSourceCardsById.has(item.sourceId)),
  );

  if (!candidate) {
    throw new Error(`ARENA_ENEMY_CANDIDATE_NOT_FOUND:${input.tier}`);
  }

  return {
    resolvedSourceMode: result.resolvedSourceMode,
    enemySnapshot: candidate,
    resolvedSourceCardLite: candidate.sourceType === 'public-card'
      ? (result.resolvedSourceCardsById.get(candidate.sourceId) ?? null)
      : null,
  };
};
