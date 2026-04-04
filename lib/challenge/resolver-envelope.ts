import type {
  ChallengeNodeType,
  EncounterSnapshotV1,
  RewardSelectionModeV1,
  RunStateV1,
} from '@/lib/challenge/types';
import type { ChallengeAdjudicationOutcome, ChallengeAdjudicationResultV1 } from '@/lib/challenge/stream-meta';

type SupportedAiNodeType = Extract<ChallengeNodeType, 'battle' | 'elite' | 'boss' | 'event'>;

export type ChallengePlayerInputV1 = {
  recommendedActionId?: string;
  optionId?: string;
  note?: string;
};

export type ChallengeTrackDeltaRangeV1 = {
  trackId: string;
  min: number;
  max: number;
};

export type ChallengeResolverEnvelopeV1 = {
  version: 1;
  worldPresetId: string;
  nodeId: string;
  nodeType: SupportedAiNodeType;
  outcomeSet: ChallengeAdjudicationOutcome[];
  recommendedOutcome: ChallengeAdjudicationOutcome;
  trackDeltaRanges: ChallengeTrackDeltaRangeV1[];
  allowedAddStatuses: string[];
  allowedRemoveStatuses: string[];
  rewardSelectionMode: RewardSelectionModeV1;
  rewardOptionIds: string[];
  forbiddenFlags: Array<'one_shot' | 'full_restore' | 'free_persistent_item' | 'out_of_band_status'>;
};

type ProgressionAdjudicationV1 = {
  outcome: ChallengeAdjudicationOutcome;
  trackDeltas: Record<string, number>;
  addStatuses: string[];
  removeStatuses: string[];
  rewardSelectionMode: RewardSelectionModeV1;
  rewardOptionIds: string[];
  summary: string;
};

const ARENA_STATUS_ALLOWLIST = ['fatigued', 'exposed', 'shaken'] as const;

const TRACK_RANGE_PRESETS: Record<
  SupportedAiNodeType,
  Record<string, { min: number; max: number }>
> = {
  battle: {
    hp: { min: -40, max: 0 },
    radiance: { min: -18, max: 0 },
    currency: { min: 0, max: 18 },
  },
  elite: {
    hp: { min: -55, max: 0 },
    radiance: { min: -25, max: 0 },
    currency: { min: 0, max: 26 },
  },
  boss: {
    hp: { min: -80, max: 0 },
    radiance: { min: -32, max: 0 },
    currency: { min: 0, max: 40 },
  },
  event: {
    hp: { min: -20, max: 0 },
    radiance: { min: -18, max: 10 },
    currency: { min: -10, max: 20 },
  },
};

const FALLBACK_DELTAS: Record<
  Extract<SupportedAiNodeType, 'battle' | 'elite' | 'boss'>,
  Record<ChallengeAdjudicationOutcome, Record<string, number>>
> = {
  battle: {
    victory: { hp: -10, radiance: -8, currency: 10 },
    costly_victory: { hp: -18, radiance: -12, currency: 14 },
    defeat: { hp: -40, radiance: -18, currency: 0 },
  },
  elite: {
    victory: { hp: -16, radiance: -12, currency: 18 },
    costly_victory: { hp: -25, radiance: -18, currency: 22 },
    defeat: { hp: -55, radiance: -25, currency: 0 },
  },
  boss: {
    victory: { hp: -24, radiance: -20, currency: 30 },
    costly_victory: { hp: -32, radiance: -24, currency: 36 },
    defeat: { hp: -80, radiance: -32, currency: 0 },
  },
};

const isSupportedAiNodeType = (value: ChallengeNodeType): value is SupportedAiNodeType => {
  return value === 'battle' || value === 'elite' || value === 'boss' || value === 'event';
};

const normalizeStatuses = (items: string[]) =>
  Array.from(
    new Set(
      items
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  );

const resolveRewardSelectionMode = (encounter: EncounterSnapshotV1): RewardSelectionModeV1 => {
  if (encounter.rewardOptions.length === 0) return 'none';
  if (encounter.rewardOptions.length === 1) return 'auto';
  if (encounter.rewardOptions.length === 2) return 'choose-one';
  throw new Error('CHALLENGE_REWARD_OPTIONS_UNSUPPORTED');
};

const inferRecommendedOutcome = (
  runState: RunStateV1,
  encounter: EncounterSnapshotV1,
  playerInput: ChallengePlayerInputV1
): ChallengeAdjudicationOutcome => {
  if (encounter.kind === 'event') return 'costly_victory';

  let score = 1;
  const strengthTier = runState.playerSnapshot?.strengthTier;
  if (strengthTier === 'elite') score += 1;
  if (strengthTier === 'boss') score += 2;

  if (encounter.kind === 'elite') score -= 1;
  if (encounter.kind === 'boss') score -= 2;

  if (playerInput.recommendedActionId === 'bait-counter') score += 1;
  if (playerInput.recommendedActionId === 'focus-barrier' && encounter.kind === 'boss') score += 1;
  if (playerInput.recommendedActionId === 'advance-pressure' && encounter.kind === 'boss') score -= 1;

  const note = playerInput.note?.trim() ?? '';
  if (/(观察|诱导|睡眠|试探|稳住|节奏)/.test(note)) score += 1;
  if (/(硬拼|鲁莽|正面强冲|蛮冲)/.test(note)) score -= 1;

  if ((runState.playerSnapshot?.tags ?? []).includes('谨慎') && playerInput.recommendedActionId === 'bait-counter') {
    score += 1;
  }

  if (score >= 2) return 'victory';
  if (score >= 0) return 'costly_victory';
  return 'defeat';
};

const resolveTrackDeltaRanges = (
  runState: RunStateV1,
  nodeType: SupportedAiNodeType
): ChallengeTrackDeltaRangeV1[] => {
  const presets = TRACK_RANGE_PRESETS[nodeType];
  const tracks = runState.worldState?.tracks ?? {};

  return Object.keys(tracks).map((trackId) => {
    const preset = presets[trackId];
    if (preset) {
      return {
        trackId,
        min: preset.min,
        max: preset.max,
      };
    }

    return {
      trackId,
      min: 0,
      max: 0,
    };
  });
};

const buildFallbackSummary = (input: {
  playerName: string;
  enemyName: string;
  outcome: ChallengeAdjudicationOutcome;
}): string => {
  if (input.outcome === 'victory') {
    return `${input.playerName}在与${input.enemyName}的交锋中稳住节奏，顺利拿下胜势。`;
  }
  if (input.outcome === 'costly_victory') {
    return `${input.playerName}虽然付出了明显代价，但仍在与${input.enemyName}的对抗中完成了收束。`;
  }
  return `${input.playerName}在与${input.enemyName}的对抗中失手，被迫吞下败局。`;
};

const buildFallbackStory = (input: {
  playerName: string;
  enemyName: string;
  actionLabel: string;
  note: string;
  outcome: ChallengeAdjudicationOutcome;
}): string => {
  if (input.outcome === 'defeat') {
    return `${input.playerName}尝试以“${input.actionLabel}”应对${input.enemyName}，${input.note ? `也试图贯彻“${input.note}”这一临场构想，` : ''}但在关键交换中还是被对手抓住了空档，只能吞下这场败局。`;
  }

  const ending =
    input.outcome === 'victory'
      ? '最终稳稳抢下了胜势。'
      : '最终以不小的代价完成了反制。';

  return `${input.playerName}围绕“${input.actionLabel}”组织本轮攻防，${input.note ? `并将“${input.note}”落实为临场处理，` : ''}在节奏几次拉扯后${ending}`;
};

export const buildChallengeResolverEnvelope = (input: {
  runState: RunStateV1;
  encounter: EncounterSnapshotV1;
  playerInput: ChallengePlayerInputV1;
}): ChallengeResolverEnvelopeV1 => {
  if (!isSupportedAiNodeType(input.encounter.kind)) {
    throw new Error('CHALLENGE_RESOLVER_ENVELOPE_UNSUPPORTED_NODE');
  }

  const rewardSelectionMode = resolveRewardSelectionMode(input.encounter);
  const rewardOptionIds = input.encounter.rewardOptions.map((item) => item.rewardOptionId);

  return {
    version: 1,
    worldPresetId: input.runState.worldPresetId,
    nodeId: input.encounter.nodeId,
    nodeType: input.encounter.kind,
    outcomeSet: ['victory', 'costly_victory', 'defeat'],
    recommendedOutcome: inferRecommendedOutcome(input.runState, input.encounter, input.playerInput),
    trackDeltaRanges: resolveTrackDeltaRanges(input.runState, input.encounter.kind),
    allowedAddStatuses: [...ARENA_STATUS_ALLOWLIST],
    allowedRemoveStatuses: normalizeStatuses([
      ...ARENA_STATUS_ALLOWLIST,
      ...(input.runState.worldState?.temporaryStatuses ?? []),
    ]),
    rewardSelectionMode,
    rewardOptionIds,
    forbiddenFlags: ['one_shot', 'full_restore', 'free_persistent_item', 'out_of_band_status'],
  };
};

export const validateAdjudicationAgainstEnvelope = (
  envelope: ChallengeResolverEnvelopeV1,
  adjudication: ChallengeAdjudicationResultV1
): ProgressionAdjudicationV1 => {
  if (!envelope.outcomeSet.includes(adjudication.outcome)) {
    throw new Error('裁定 outcome 超出 envelope');
  }

  const trackRangeMap = new Map(envelope.trackDeltaRanges.map((item) => [item.trackId, item]));
  for (const [trackId, delta] of Object.entries(adjudication.trackDeltas ?? {})) {
    const range = trackRangeMap.get(trackId);
    if (!range || delta < range.min || delta > range.max) {
      throw new Error(`裁定 trackDeltas.${trackId} 超出 envelope`);
    }
  }

  const allowedAddStatuses = new Set(envelope.allowedAddStatuses);
  for (const statusId of adjudication.addStatuses ?? []) {
    if (!allowedAddStatuses.has(statusId)) {
      throw new Error(`裁定 addStatuses.${statusId} 超出 envelope`);
    }
  }

  const allowedRemoveStatuses = new Set(envelope.allowedRemoveStatuses);
  for (const statusId of adjudication.removeStatuses ?? []) {
    if (!allowedRemoveStatuses.has(statusId)) {
      throw new Error(`裁定 removeStatuses.${statusId} 超出 envelope`);
    }
  }

  if (envelope.rewardSelectionMode === 'auto') {
    if (envelope.rewardOptionIds.length !== 1 || adjudication.rewardOptionId !== envelope.rewardOptionIds[0]) {
      throw new Error('裁定 rewardOptionId 超出 envelope');
    }
  } else if (adjudication.rewardOptionId !== null) {
    throw new Error('裁定 rewardOptionId 超出 envelope');
  }

  return {
    outcome: adjudication.outcome,
    trackDeltas: Object.fromEntries(
      Object.entries(adjudication.trackDeltas ?? {}).map(([trackId, delta]) => [trackId, Math.trunc(delta)])
    ),
    addStatuses: normalizeStatuses(adjudication.addStatuses ?? []),
    removeStatuses: normalizeStatuses(adjudication.removeStatuses ?? []),
    rewardSelectionMode: envelope.rewardSelectionMode,
    rewardOptionIds:
      envelope.rewardSelectionMode === 'none'
        ? []
        : [...envelope.rewardOptionIds],
    summary: adjudication.summary.trim(),
  };
};

export const buildSystemFallbackResolution = (input: {
  runState: RunStateV1;
  encounter: EncounterSnapshotV1;
  playerInput: ChallengePlayerInputV1;
  resolverEnvelope: ChallengeResolverEnvelopeV1;
}): {
  storyMarkdown: string;
  adjudication: ChallengeAdjudicationResultV1;
} => {
  const supportedNodeType = input.encounter.kind === 'event' ? 'battle' : input.encounter.kind;
  const outcome = inferRecommendedOutcome(input.runState, input.encounter, input.playerInput);
  const deltas =
    FALLBACK_DELTAS[supportedNodeType as keyof typeof FALLBACK_DELTAS]?.[outcome]
    ?? FALLBACK_DELTAS.battle.costly_victory;

  const actionLabel = input.playerInput.recommendedActionId?.trim() || '临场应对';
  const playerName = input.runState.playerSnapshot?.displayName ?? '挑战者';
  const enemyName = input.encounter.enemySnapshot?.displayName ?? '当前对手';
  const note = input.playerInput.note?.trim() ?? '';

  const addStatuses =
    outcome === 'costly_victory'
      ? ['fatigued']
      : outcome === 'defeat'
        ? ['shaken']
        : [];
  const removeStatuses = actionLabel === 'focus-barrier' ? ['exposed'] : [];

  const rewardOptionId =
    input.resolverEnvelope.rewardSelectionMode === 'auto'
      ? input.resolverEnvelope.rewardOptionIds[0] ?? null
      : null;

  return {
    storyMarkdown: buildFallbackStory({
      playerName,
      enemyName,
      actionLabel,
      note,
      outcome,
    }),
    adjudication: {
      outcome,
      trackDeltas: deltas,
      addStatuses,
      removeStatuses,
      rewardOptionId,
      summary: buildFallbackSummary({
        playerName,
        enemyName,
        outcome,
      }),
    },
  };
};
