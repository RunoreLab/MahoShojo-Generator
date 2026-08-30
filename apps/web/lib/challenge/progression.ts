import { randomUUID } from '@/lib/crypto';
import { applyEffectPatchToRunState } from '@/lib/challenge/effect-patch';
import { advanceMapVisibility, generateChallengeMap } from '@/lib/challenge/map';
import { applyRewardOptionToWorldState, canApplyRewardOption, pickNegativeStatusToClear } from '@/lib/challenge/rewards';
import type {
  ChallengeCheckpointKind,
  ChallengeCheckpointRecord,
  ChallengeNodeRecord,
  ChallengeNodeType,
  ChallengeRunRecord,
  EncounterSnapshotV1,
  EventOptionV1,
  RewardOptionV1,
  RewardSelectionModeV1,
  RunStateV1,
  ShopOfferV1,
  WorldStateV1,
} from '@/lib/challenge/types';
import { ARENA_SHOP_OFFER_TEMPLATES } from '@/lib/challenge/worlds/arena/manual-content';

const nowTimestamp = (value?: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : Date.now());

const cloneWorldState = (worldState: WorldStateV1): WorldStateV1 => ({
  ...worldState,
  tracks: Object.fromEntries(
    Object.entries(worldState.tracks).map(([trackId, track]) => [trackId, { ...track }])
  ),
  temporaryStatuses: [...worldState.temporaryStatuses],
  runFlags: [...worldState.runFlags],
  persistentItemIds: [...worldState.persistentItemIds],
  consumableIds: [...worldState.consumableIds],
});

const appendRunFlag = (worldState: WorldStateV1, flag: string): WorldStateV1 => {
  if (worldState.runFlags.includes(flag)) return worldState;
  return {
    ...worldState,
    runFlags: [...worldState.runFlags, flag],
  };
};

const getCurrentNode = (runState: RunStateV1): { nodeType: ChallengeNodeType; layer: number; nodeId: string | null } => {
  const fallback = {
    nodeType: 'battle' as ChallengeNodeType,
    layer: 1,
    nodeId: runState.currentNodeId,
  };

  if (!runState.mapState || !runState.currentNodeId) return fallback;
  const node = runState.mapState.nodes.find((item) => item.nodeId === runState.currentNodeId);
  if (!node) return fallback;
  return {
    nodeType: node.nodeType,
    layer: node.layer,
    nodeId: node.nodeId,
  };
};

const buildCheckpoint = (runState: RunStateV1, kind: ChallengeCheckpointKind, createdAt: number): {
  nextRunState: RunStateV1;
  checkpoint: ChallengeCheckpointRecord;
} => {
  const nextRunState: RunStateV1 = {
    ...runState,
    checkpointSeq: runState.checkpointSeq + 1,
    updatedAt: createdAt,
  };

  return {
    nextRunState,
    checkpoint: {
      id: randomUUID(),
      runId: nextRunState.runId,
      seq: nextRunState.checkpointSeq,
      kind,
      snapshot: {
        runState: nextRunState,
        playerSnapshot: nextRunState.playerSnapshot,
        lastResolvedNodeId: nextRunState.currentNodeId,
        pendingRewardChoice: nextRunState.pendingRewardChoice,
      },
      createdAt,
    },
  };
};

const clampTrackValue = (current: number, amount: number, max: number | null): number => {
  const next = current + amount;
  if (typeof max === 'number' && Number.isFinite(max)) {
    return Math.min(max, Math.max(0, next));
  }
  return Math.max(0, next);
};

const applyTrackDeltas = (runState: RunStateV1, trackDeltas: Record<string, number>): RunStateV1 => {
  if (!runState.worldState) return runState;

  const worldState = cloneWorldState(runState.worldState);
  Object.entries(trackDeltas).forEach(([trackId, amount]) => {
    if (!worldState.tracks[trackId]) return;
    const track = worldState.tracks[trackId];
    worldState.tracks[trackId] = {
      ...track,
      current: clampTrackValue(track.current, amount, track.max),
    };
  });

  return {
    ...runState,
    worldState,
  };
};

const applyStatusChanges = (runState: RunStateV1, addStatuses: string[], removeStatuses: string[]): RunStateV1 => {
  if (!runState.worldState) return runState;

  const worldState = cloneWorldState(runState.worldState);
  removeStatuses.forEach((statusId) => {
    worldState.temporaryStatuses = worldState.temporaryStatuses.filter((item) => item !== statusId);
  });
  addStatuses.forEach((statusId) => {
    if (!worldState.temporaryStatuses.includes(statusId)) {
      worldState.temporaryStatuses.push(statusId);
    }
  });

  return {
    ...runState,
    worldState,
  };
};

const findRewardOption = (rewardOptions: RewardOptionV1[] | undefined, rewardOptionId: string): RewardOptionV1 => {
  const rewardOption = rewardOptions?.find((item) => item.rewardOptionId === rewardOptionId);
  if (!rewardOption) {
    throw new Error(`CHALLENGE_REWARD_OPTION_NOT_FOUND:${rewardOptionId}`);
  }
  return rewardOption;
};

const determineSystemNodeStatus = (runState: RunStateV1): RunStateV1['status'] => {
  const hpTrack = runState.worldState?.tracks.hp;
  if (hpTrack && hpTrack.current <= 0) return 'failed';
  return 'in_progress';
};

const assertRewardSelectionShape = (input: {
  rewardSelectionMode: RewardSelectionModeV1;
  rewardOptionIds: string[];
}): void => {
  if (input.rewardSelectionMode === 'none') {
    if (input.rewardOptionIds.length !== 0) {
      throw new Error('CHALLENGE_REWARD_SELECTION_INVALID:none');
    }
    return;
  }

  if (input.rewardSelectionMode === 'auto' && input.rewardOptionIds.length !== 1) {
    throw new Error('CHALLENGE_REWARD_SELECTION_INVALID:auto');
  }
  if (input.rewardSelectionMode === 'choose-one' && input.rewardOptionIds.length !== 2) {
    throw new Error('CHALLENGE_REWARD_SELECTION_INVALID:choose-one');
  }
};

const advanceResolvedRunState = (
  runState: RunStateV1,
  input: {
    status: RunStateV1['status'];
    timestamp: number;
  }
): RunStateV1 => ({
  ...runState,
  status: input.status,
  pendingRewardChoice: input.status === 'in_progress' ? runState.pendingRewardChoice : null,
  mapState: runState.mapState && runState.currentNodeId ? advanceMapVisibility(runState.mapState, runState.currentNodeId) : runState.mapState,
  visitedNodeCount: runState.visitedNodeCount + 1,
  updatedAt: input.timestamp,
});

export const acceptBootstrapSnapshot = (
  bootstrapState: {
    runId: string;
    worldPresetId: 'arena';
    playerSnapshot: RunStateV1['playerSnapshot'];
    initialWorldState: WorldStateV1;
    usedBootstrapReroll: boolean;
    startedAt: number;
  },
  input: {
    snapshotSeed: string;
    createRunSeed?: () => string;
    now?: number;
  }
): {
  runState: RunStateV1;
  runRecordPatch: Partial<ChallengeRunRecord>;
  checkpoint: ChallengeCheckpointRecord;
} => {
  if (bootstrapState.playerSnapshot && bootstrapState.playerSnapshot.snapshotSeed !== input.snapshotSeed) {
    throw new Error('BOOTSTRAP_SNAPSHOT_SEED_MISMATCH');
  }

  const timestamp = nowTimestamp(input.now);
  const runSeed = typeof input.createRunSeed === 'function' ? input.createRunSeed() : randomUUID();
  const mapState = generateChallengeMap({ runSeed, worldPresetId: bootstrapState.worldPresetId });

  const pendingRunState: RunStateV1 = {
    version: 1,
    runId: bootstrapState.runId,
    worldPresetId: bootstrapState.worldPresetId,
    runSeed,
    status: 'in_progress',
    playerSnapshot: bootstrapState.playerSnapshot,
    worldState: cloneWorldState(bootstrapState.initialWorldState),
    mapState,
    pendingRewardChoice: null,
    currentNodeId: null,
    visitedNodeCount: 0,
    checkpointSeq: 0,
    usedBootstrapReroll: bootstrapState.usedBootstrapReroll,
    startedAt: bootstrapState.startedAt,
    updatedAt: timestamp,
  };

  const { nextRunState, checkpoint } = buildCheckpoint(pendingRunState, 'bootstrap_accepted', timestamp);

  return {
    runState: nextRunState,
    runRecordPatch: {
      status: 'in_progress',
      runSeed,
      playerSnapshot: bootstrapState.playerSnapshot,
      runState: nextRunState,
      currentStateDigest: null,
      currentNodeId: null,
      visitedNodeCount: 0,
      lastResolvedNodeId: null,
      updatedAt: timestamp,
    },
    checkpoint,
  };
};

export const buildRestEncounterSnapshot = (runState: RunStateV1): EncounterSnapshotV1 => {
  const negativeStatus = pickNegativeStatusToClear(runState.worldState?.temporaryStatuses ?? [], null);
  const nodeId = runState.currentNodeId ?? 'rest-node';

  const eventOptions: EventOptionV1[] = [
    {
      version: 1,
      optionId: 'rest-heal',
      label: '静养',
      notePolicy: 'none',
      effectPatch: {
        version: 1,
        trackDeltas: { hp: 20 },
        addStatuses: [],
        removeStatuses: [],
        rewardSelectionMode: 'none',
        rewardOptionIds: [],
      },
    },
    {
      version: 1,
      optionId: 'rest-tune',
      label: '调律',
      notePolicy: 'none',
      effectPatch: {
        version: 1,
        trackDeltas: { radiance: 20 },
        addStatuses: [],
        removeStatuses: [],
        rewardSelectionMode: 'none',
        rewardOptionIds: [],
      },
    },
    {
      version: 1,
      optionId: 'rest-clear-negative',
      label: '稳态整理',
      notePolicy: 'none',
      disabled: !negativeStatus,
      effectPatch: {
        version: 1,
        trackDeltas: {},
        addStatuses: [],
        removeStatuses: negativeStatus ? [negativeStatus] : [],
        rewardSelectionMode: 'none',
        rewardOptionIds: [],
      },
    },
  ];

  return {
    version: 1,
    nodeId,
    templateId: 'arena-rest-basic',
    kind: 'rest',
    inputMode: 'choice-only',
    enemySnapshot: null,
    rewardOptions: [],
    eventOptions,
    shopOffers: [],
  };
};

export const buildShopEncounterSnapshot = (runState: RunStateV1): EncounterSnapshotV1 => {
  const nodeId = runState.currentNodeId ?? 'shop-node';
  const worldState = runState.worldState;
  const shopOffers: ShopOfferV1[] = ARENA_SHOP_OFFER_TEMPLATES.map((offer) => {
    const disabledByCurrency = !worldState || worldState.tracks.currency.current < offer.price;
    const disabledByReward = !worldState || !canApplyRewardOption(worldState, offer.reward);
    return {
      ...offer,
      reward: {
        ...offer.reward,
        payload: { ...offer.reward.payload },
      },
      disabled: disabledByCurrency || disabledByReward,
    };
  });

  return {
    version: 1,
    nodeId,
    templateId: 'arena-shop-basic',
    kind: 'shop',
    inputMode: 'choice-only',
    enemySnapshot: null,
    rewardOptions: [],
    eventOptions: [],
    shopOffers,
  };
};

export const setPendingRewardChoiceFromEnvelope = (
  runState: RunStateV1,
  envelope: {
    rewardSelectionMode: RewardSelectionModeV1;
    rewardOptionIds: string[];
    sourceNodeId: string;
  }
): RunStateV1 => {
  assertRewardSelectionShape(envelope);

  if (envelope.rewardSelectionMode === 'none' || envelope.rewardOptionIds.length === 0) {
    return {
      ...runState,
      pendingRewardChoice: null,
    };
  }

  return {
    ...runState,
    pendingRewardChoice: {
      selectionMode: envelope.rewardSelectionMode,
      rewardOptionIds: [...envelope.rewardOptionIds],
      sourceNodeId: envelope.sourceNodeId,
    },
  };
};

export const applySelectedRewardOption = (
  runState: RunStateV1,
  rewardOption: RewardOptionV1
): {
  nextRunState: RunStateV1;
  checkpointKind: ChallengeCheckpointKind;
  checkpoint: ChallengeCheckpointRecord;
  runRecordPatch: Record<string, unknown>;
} => {
  const timestamp = Date.now();
  const worldState = runState.worldState ? applyRewardOptionToWorldState(runState.worldState, rewardOption) : null;
  const rewardAppliedState: RunStateV1 = {
    ...runState,
    worldState,
    pendingRewardChoice: null,
    updatedAt: timestamp,
  };
  const { nextRunState, checkpoint } = buildCheckpoint(rewardAppliedState, 'reward_applied', timestamp);

  return {
    nextRunState,
    checkpointKind: 'reward_applied',
    checkpoint,
    runRecordPatch: {
      runState: nextRunState,
      updatedAt: timestamp,
      currentStateDigest: null,
    },
  };
};

export const writeRunFlagsAfterNode = (
  runState: RunStateV1,
  input: {
    enemySourceMode?: 'preset-only' | 'remote';
    nodeType: ChallengeNodeType;
    layer: number;
    outcome: 'victory' | 'costly_victory' | 'defeat';
  }
): RunStateV1 => {
  if (!runState.worldState) return runState;
  let worldState = cloneWorldState(runState.worldState);

  if (input.enemySourceMode === 'preset-only') {
    worldState = appendRunFlag(worldState, 'preset_only_enemy_mode');
  }
  if (input.nodeType === 'elite' && input.outcome !== 'defeat') {
    worldState = appendRunFlag(worldState, 'elite_defeated');
  }
  if (worldState.runFlags.includes('elite_defeated') && input.layer >= 7) {
    worldState = appendRunFlag(worldState, 'boss_gate_unlocked');
  }

  return {
    ...runState,
    worldState,
  };
};

export const finalizeNodeResolution = (
  runState: RunStateV1,
  adjudication: {
    outcome: 'victory' | 'costly_victory' | 'defeat';
    trackDeltas: Record<string, number>;
    addStatuses: string[];
    removeStatuses: string[];
    rewardSelectionMode: RewardSelectionModeV1;
    rewardOptionIds: string[];
    rewardOptions?: RewardOptionV1[];
  }
): {
  nextRunState: RunStateV1;
  checkpoints: ChallengeCheckpointRecord[];
  nodeRecordPatch: Partial<ChallengeNodeRecord>;
  runRecordPatch: Record<string, unknown>;
} => {
  const timestamp = Date.now();
  const { nodeType, layer, nodeId } = getCurrentNode(runState);
  let nextRunState = applyTrackDeltas(runState, adjudication.trackDeltas);
  nextRunState = applyStatusChanges(nextRunState, adjudication.addStatuses, adjudication.removeStatuses);
  nextRunState = writeRunFlagsAfterNode(nextRunState, {
    nodeType,
    layer,
    outcome: adjudication.outcome,
  });

  const hpTrack = nextRunState.worldState?.tracks.hp;
  const status =
    nodeType === 'boss' && (adjudication.outcome === 'victory' || adjudication.outcome === 'costly_victory')
      ? 'completed'
      : adjudication.outcome === 'defeat' || (hpTrack ? hpTrack.current <= 0 : false)
        ? 'failed'
        : 'in_progress';

  nextRunState = advanceResolvedRunState(
    setPendingRewardChoiceFromEnvelope(nextRunState, {
      rewardSelectionMode: status === 'in_progress' ? adjudication.rewardSelectionMode : 'none',
      rewardOptionIds: status === 'in_progress' ? adjudication.rewardOptionIds : [],
      sourceNodeId: nodeId ?? 'unknown-node',
    }),
    { status, timestamp }
  );

  const checkpoints: ChallengeCheckpointRecord[] = [];
  let checkpointResult = buildCheckpoint(nextRunState, 'node_resolved', timestamp);
  nextRunState = checkpointResult.nextRunState;
  checkpoints.push(checkpointResult.checkpoint);

  if (status === 'in_progress' && adjudication.rewardSelectionMode === 'auto' && adjudication.rewardOptionIds.length > 0) {
    const rewardOption = findRewardOption(adjudication.rewardOptions, adjudication.rewardOptionIds[0]);
    const rewardAppliedResult = applySelectedRewardOption(nextRunState, rewardOption);
    nextRunState = rewardAppliedResult.nextRunState;
    checkpoints.push(rewardAppliedResult.checkpoint);
  }

  if (status === 'failed' || status === 'completed') {
    checkpointResult = buildCheckpoint(
      {
        ...nextRunState,
        pendingRewardChoice: null,
      },
      'finished',
      timestamp
    );
    nextRunState = checkpointResult.nextRunState;
    checkpoints.push(checkpointResult.checkpoint);
  }

  return {
    nextRunState,
    checkpoints,
    nodeRecordPatch: {
      nodeId: nodeId ?? 'unknown-node',
      nodeType,
      status: 'resolved',
      encounterSnapshot: null,
      adjudicationResultDigest: null,
      storyText: null,
      resolvedAt: timestamp,
    },
    runRecordPatch: {
      status,
      runState: nextRunState,
      updatedAt: timestamp,
      currentStateDigest: null,
      lastResolvedNodeId: nodeId,
      visitedNodeCount: nextRunState.visitedNodeCount,
      finishedAt: status === 'failed' || status === 'completed' ? timestamp : null,
    },
  };
};

export const resolveSystemNode = (
  runState: RunStateV1,
  input: {
    encounter: EncounterSnapshotV1;
    eventOptionId?: string;
    shopOfferId?: string | null;
  }
): {
  nextRunState: RunStateV1;
  checkpoints: ChallengeCheckpointRecord[];
  checkpointKind: ChallengeCheckpointKind;
  nodeRecordPatch: Partial<ChallengeNodeRecord>;
  runRecordPatch: Record<string, unknown>;
} => {
  const timestamp = Date.now();
  let nextRunState = runState;
  let shouldCreateRewardCheckpoint = false;

  nextRunState = {
    ...nextRunState,
    currentNodeId: nextRunState.currentNodeId ?? input.encounter.nodeId,
  };

  if (input.encounter.kind === 'rest' || input.encounter.kind === 'event') {
    const selectedOption = input.encounter.eventOptions.find((item) => item.optionId === input.eventOptionId);
    if (selectedOption && !selectedOption.disabled) {
      nextRunState = applyEffectPatchToRunState(runState, selectedOption.effectPatch, {
        sourceNodeId: input.encounter.nodeId,
      });
    }
  }

  if (input.encounter.kind === 'shop' && input.shopOfferId) {
    const selectedOffer = input.encounter.shopOffers.find((item) => item.offerId === input.shopOfferId);
    if (selectedOffer && !selectedOffer.disabled && nextRunState.worldState) {
      const worldState = cloneWorldState(nextRunState.worldState);
      worldState.tracks.currency = {
        ...worldState.tracks.currency,
        current: clampTrackValue(worldState.tracks.currency.current, -selectedOffer.price, worldState.tracks.currency.max),
      };
      nextRunState = {
        ...nextRunState,
        worldState: applyRewardOptionToWorldState(worldState, selectedOffer.reward),
        pendingRewardChoice: null,
      };
      shouldCreateRewardCheckpoint = true;
    }
  }

  const status = determineSystemNodeStatus(nextRunState);
  nextRunState = advanceResolvedRunState(
    {
      ...nextRunState,
      pendingRewardChoice: status === 'in_progress' ? nextRunState.pendingRewardChoice : null,
    },
    { status, timestamp }
  );

  const checkpoints: ChallengeCheckpointRecord[] = [];
  let checkpointResult = buildCheckpoint(nextRunState, 'node_resolved', timestamp);
  nextRunState = checkpointResult.nextRunState;
  checkpoints.push(checkpointResult.checkpoint);

  if (
    status === 'in_progress' &&
    nextRunState.pendingRewardChoice?.selectionMode === 'auto' &&
    nextRunState.pendingRewardChoice.rewardOptionIds.length > 0
  ) {
    const rewardOption = findRewardOption(
      input.encounter.rewardOptions,
      nextRunState.pendingRewardChoice.rewardOptionIds[0]
    );
    const rewardAppliedResult = applySelectedRewardOption(nextRunState, rewardOption);
    nextRunState = rewardAppliedResult.nextRunState;
    checkpoints.push(rewardAppliedResult.checkpoint);
  } else if (shouldCreateRewardCheckpoint) {
    checkpointResult = buildCheckpoint(nextRunState, 'reward_applied', timestamp);
    nextRunState = checkpointResult.nextRunState;
    checkpoints.push(checkpointResult.checkpoint);
  }

  if (status === 'failed') {
    checkpointResult = buildCheckpoint(
      {
        ...nextRunState,
        pendingRewardChoice: null,
      },
      'finished',
      timestamp
    );
    nextRunState = checkpointResult.nextRunState;
    checkpoints.push(checkpointResult.checkpoint);
  }

  return {
    nextRunState,
    checkpoints,
    checkpointKind: 'node_resolved',
    nodeRecordPatch: {
      nodeId: nextRunState.currentNodeId ?? input.encounter.nodeId,
      nodeType: input.encounter.kind,
      status: 'resolved',
      encounterSnapshot: input.encounter,
      resolvedAt: timestamp,
    },
    runRecordPatch: {
      status: nextRunState.status,
      runState: nextRunState,
      updatedAt: timestamp,
      currentStateDigest: null,
      lastResolvedNodeId: nextRunState.currentNodeId ?? input.encounter.nodeId,
      visitedNodeCount: nextRunState.visitedNodeCount,
      finishedAt: nextRunState.status === 'failed' ? timestamp : null,
    },
  };
};
