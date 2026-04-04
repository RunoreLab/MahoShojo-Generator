'use client';

import { useEffect, useMemo, useState } from 'react';

import { randomUUID } from '@/lib/crypto';
import {
  acceptBootstrapSnapshot,
  buildRestEncounterSnapshot,
  buildShopEncounterSnapshot,
  finalizeNodeResolution,
  resolveSystemNode,
} from '@/lib/challenge/progression';
import {
  deleteChallengeRunCascade,
  getChallengeRun,
  getLatestChallengeCheckpoint,
  getLatestChallengeNodeForRun,
  listChallengeRuns,
  putChallengeCheckpoint,
  putChallengeNode,
  putChallengeRun,
  updateChallengeRun,
} from '@/lib/challenge/storage';
import type {
  ChallengeNodeRecord,
  ChallengeNodeType,
  ChallengeRunRecord,
  EncounterSnapshotV1,
  EnemySnapshotV1,
  PlayerSnapshotV1,
  RunStateV1,
  WorldStateV1,
} from '@/lib/challenge/types';
import { getChallengeWorldPreset } from '@/lib/challenge/world-registry';
import { buildArenaBootstrapSnapshot } from '@/lib/challenge/worlds/arena/bootstrap';
import type { ChallengeRecommendedAction } from '@/components/challenge/NodeResolutionPanel';

export type ChallengeStage = 'lobby' | 'bootstrap' | 'map' | 'node' | 'summary';

type BootstrapDraft = {
  runId: string;
  snapshotSeed: string;
  sourceCard: unknown;
  playerSnapshot: PlayerSnapshotV1;
  initialWorldState: WorldStateV1;
  usedBootstrapReroll: boolean;
  startedAt: number;
};

const arenaDemoCard = {
  id: 'card-demo-mist-lamp',
  codename: '雾灯',
  magicalGirl: {
    codename: '雾灯',
  },
  magicConstruct: {
    name: '雾灯杖',
    description: '擅长中距离压制与空间整理。',
  },
  blooming: {
    powerLevel: 'leaf',
  },
  analysis: {
    personalityAnalysis: '克制谨慎，重视观察窗口。',
    abilityReasoning: '偏向中距离压制与节奏控制。',
    coreTraits: ['冷静', '谨慎'],
    predictionBasis: '长期独处与巡夜经验让她更擅长试探与拉扯。',
  },
  buildState: {
    primaryRuleId: 'arena-trpg-lite',
    rules: [
      {
        ruleId: 'arena-trpg-lite',
        version: '1.0.0',
        blockResults: {
          powerLevel: 'leaf',
          coreAttributes: {
            STR: 44,
            CON: 46,
            AGI: 40,
            MAG: 52,
            WILL: 48,
            PER: 32,
            CHM: 28,
          },
          specialties: ['magic-bullet', 'magic-shield'],
        },
        derived: {
          HP: 9,
          MP: 13,
          Radiance: 10,
        },
      },
    ],
  },
};

const arenaDemoCardText = JSON.stringify(arenaDemoCard, null, 2);

const arenaEnemyPool: Array<Pick<EnemySnapshotV1, 'displayName' | 'tags' | 'promptSummary'>> = [
  {
    displayName: '雪绒',
    tags: ['游击', '机动'],
    promptSummary: '善于高速游走与试探，偏爱寻找防线缝隙。',
  },
  {
    displayName: '鹅',
    tags: ['压制', '爆发'],
    promptSummary: '擅长在短时间内堆高压迫，逼人正面接战。',
  },
  {
    displayName: '镜砂',
    tags: ['控制', '观察'],
    promptSummary: '偏好延迟节奏与干扰判断，容易制造错位感。',
  },
  {
    displayName: '夜纱',
    tags: ['诱导', '诡计'],
    promptSummary: '喜欢用误导和假动作争取决定性先手。',
  },
];

const battleRecommendedActions: ChallengeRecommendedAction[] = [
  { id: 'advance-pressure', label: '前压试探', hint: '先主动争夺节奏，逼对手露出应对方式。' },
  { id: 'bait-counter', label: '诱导反制', hint: '让出一个小窗口，等对方先露破绽。' },
  { id: 'focus-barrier', label: '稳守蓄势', hint: '优先保住姿态，换取更稳定的下一个回合。' },
];

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const createChallengeRunRecord = (draft: BootstrapDraft): ChallengeRunRecord => ({
  id: draft.runId,
  worldPresetId: 'arena',
  status: 'bootstrapping',
  snapshotSeed: draft.snapshotSeed,
  runSeed: null,
  usedBootstrapReroll: draft.usedBootstrapReroll,
  playerSnapshot: draft.playerSnapshot,
  runState: null,
  currentStateDigest: null,
  currentNodeId: null,
  visitedNodeCount: 0,
  lastResolvedNodeId: null,
  lastCheckpointId: null,
  startedAt: draft.startedAt,
  updatedAt: draft.startedAt,
  finishedAt: null,
});

const parseCardJsonInput = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) return arenaDemoCard;
  return JSON.parse(trimmed);
};

const getNodeById = (runState: RunStateV1, nodeId: string) => runState.mapState?.nodes.find((node) => node.nodeId === nodeId) ?? null;

export const getSelectableNodeIdsForMap = (runState: RunStateV1): string[] => {
  const mapState = runState.mapState;
  if (!mapState || runState.status !== 'in_progress') return [];

  const latestResolvedNode = [...mapState.nodes]
    .filter((node) => node.visibility === 'resolved')
    .sort((left, right) => right.layer - left.layer)[0];
  const sourceNodeId = latestResolvedNode?.nodeId ?? mapState.rootNodeId;

  return mapState.edges
    .filter((edge) => edge.fromNodeId === sourceNodeId)
    .map((edge) => edge.toNodeId);
};

const buildPlaceholderEnemy = (runState: RunStateV1, nodeType: ChallengeNodeType, nodeId: string): EnemySnapshotV1 => {
  const index = hashString(`${runState.runSeed ?? 'no-seed'}:${nodeId}:${nodeType}`) % arenaEnemyPool.length;
  const picked = arenaEnemyPool[index];
  return {
    version: 1,
    sourceType: 'preset',
    sourceId: `arena-placeholder:${picked.displayName}`,
    displayName: picked.displayName,
    strengthTier: nodeType === 'boss' ? 'boss' : nodeType === 'elite' ? 'elite' : 'common',
    combatProfile: {
      nodeType,
      suggestedPressure: nodeType === 'boss' ? 'high' : nodeType === 'elite' ? 'mid-high' : 'mid',
    },
    tags: [...picked.tags],
    promptSummary: picked.promptSummary,
  };
};

const buildEventEncounterSnapshot = (runState: RunStateV1, nodeId: string): EncounterSnapshotV1 => ({
  version: 1,
  nodeId,
  templateId: `arena-event-${nodeId}`,
  kind: 'event',
  inputMode: 'choice-only',
  enemySnapshot: null,
  rewardOptions: [],
  eventOptions: [
    {
      version: 1,
      optionId: `${nodeId}:survey`,
      label: '追踪异常波动',
      notePolicy: 'none',
      effectPatch: {
        version: 1,
        trackDeltas: { currency: 10, radiance: -4 },
        addStatuses: [],
        removeStatuses: [],
        rewardSelectionMode: 'none',
        rewardOptionIds: [],
      },
    },
    {
      version: 1,
      optionId: `${nodeId}:recover`,
      label: '绕行稳态整理',
      notePolicy: 'none',
      effectPatch: {
        version: 1,
        trackDeltas: { hp: 12 },
        addStatuses: [],
        removeStatuses: ['fatigued', 'shaken', 'exposed'],
        rewardSelectionMode: 'none',
        rewardOptionIds: [],
      },
    },
  ],
  shopOffers: [],
});

const buildBattleEncounterSnapshot = (
  runState: RunStateV1,
  nodeType: Extract<ChallengeNodeType, 'battle' | 'elite' | 'boss'>,
  nodeId: string
): EncounterSnapshotV1 => ({
  version: 1,
  nodeId,
  templateId: `arena-${nodeType}-${nodeId}`,
  kind: nodeType,
  inputMode: 'recommended-action-plus-free-intent',
  enemySnapshot: buildPlaceholderEnemy(runState, nodeType, nodeId),
  rewardOptions: [],
  eventOptions: [],
  shopOffers: [],
});

const buildEncounterForNode = (runState: RunStateV1, nodeId: string): EncounterSnapshotV1 => {
  const node = getNodeById(runState, nodeId);
  if (!node) {
    throw new Error(`CHALLENGE_NODE_NOT_FOUND:${nodeId}`);
  }

  const runStateWithCurrentNode = {
    ...runState,
    currentNodeId: nodeId,
  };

  switch (node.nodeType) {
    case 'rest':
      return buildRestEncounterSnapshot(runStateWithCurrentNode);
    case 'shop':
      return buildShopEncounterSnapshot(runStateWithCurrentNode);
    case 'event':
      return buildEventEncounterSnapshot(runStateWithCurrentNode, nodeId);
    case 'elite':
    case 'boss':
    case 'battle':
    default:
      return buildBattleEncounterSnapshot(runStateWithCurrentNode, node.nodeType as 'battle' | 'elite' | 'boss', nodeId);
  }
};

const getDefaultOptionId = (encounter: EncounterSnapshotV1): string => {
  if (encounter.kind === 'shop') return '';
  const enabledEventOption = encounter.eventOptions.find((option) => !option.disabled);
  return enabledEventOption?.optionId ?? '';
};

const buildNodeSummaryText = (input: {
  encounter: EncounterSnapshotV1;
  outcomeLabel: string;
  storyText: string;
}): string => {
  if (input.encounter.enemySnapshot) {
    return `${input.encounter.enemySnapshot.displayName}：${input.outcomeLabel}。${input.storyText}`;
  }
  return `${getChallengeWorldPreset('arena').title} · ${input.outcomeLabel}。${input.storyText}`;
};

const clearCurrentNodeForMap = (runState: RunStateV1): RunStateV1 => {
  if (runState.status !== 'in_progress') return runState;
  return {
    ...runState,
    currentNodeId: null,
  };
};

const buildFinishedSummaryText = (runState: RunStateV1, latestStoryText: string): string => {
  const playerName = runState.playerSnapshot?.displayName ?? '这位挑战者';
  const hp = runState.worldState?.tracks.hp.current ?? 0;
  const radiance = runState.worldState?.tracks.radiance.current ?? 0;

  if (runState.status === 'completed') {
    return `${playerName}成功完成了整轮挑战。${latestStoryText} 终局时保留生命 ${hp}、光辉 ${radiance}。`;
  }

  return `${playerName}在本轮挑战中倒下。${latestStoryText} 失败前共推进 ${runState.visitedNodeCount} 个节点，剩余光辉 ${radiance}。`;
};

const buildSystemStoryText = (encounter: EncounterSnapshotV1, selectedOptionId: string): string => {
  if (encounter.kind === 'shop') {
    const offer = encounter.shopOffers.find((item) => item.offerId === selectedOptionId);
    return offer ? `你在商店完成了采购：${offer.reward.label}。` : '你暂时保留晶尘，没有进行购买。';
  }

  const option = encounter.eventOptions.find((item) => item.optionId === selectedOptionId);
  if (option) {
    return `你选择了“${option.label}”，系统按既定规则完成了本地结算。`;
  }
  return '本节点按照默认系统逻辑完成了结算。';
};

const buildBattleResolution = (
  runState: RunStateV1,
  encounter: EncounterSnapshotV1,
  selectedRecommendedActionId: string,
  note: string
) => {
  const noteText = note.trim();
  const enemyName = encounter.enemySnapshot?.displayName ?? '未知对手';
  const playerName = runState.playerSnapshot?.displayName ?? '挑战者';
  let score = 1;

  const strengthTier = runState.playerSnapshot?.strengthTier;
  if (strengthTier === 'elite') score += 1;
  if (strengthTier === 'boss') score += 2;

  if (encounter.kind === 'elite') score -= 1;
  if (encounter.kind === 'boss') score -= 2;

  if (selectedRecommendedActionId === 'bait-counter') score += 1;
  if (selectedRecommendedActionId === 'focus-barrier' && encounter.kind === 'boss') score += 1;
  if (selectedRecommendedActionId === 'advance-pressure' && encounter.kind === 'boss') score -= 1;

  if (noteText.includes('观察') || noteText.includes('诱导') || noteText.includes('睡眠') || noteText.includes('试探')) {
    score += 1;
  }
  if (noteText.includes('硬拼') || noteText.includes('鲁莽') || noteText.includes('正面强冲')) {
    score -= 1;
  }
  if ((runState.playerSnapshot?.tags ?? []).includes('谨慎') && selectedRecommendedActionId === 'bait-counter') {
    score += 1;
  }

  const outcome: 'victory' | 'costly_victory' | 'defeat' =
    score >= 2 ? 'victory' : score >= 0 ? 'costly_victory' : 'defeat';

  const deltasByKind = {
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
  } as const;

  const deltas = deltasByKind[encounter.kind as 'battle' | 'elite' | 'boss'][outcome];
  const actionLabel = battleRecommendedActions.find((item) => item.id === selectedRecommendedActionId)?.label ?? '临场应对';
  const storyText =
    outcome === 'defeat'
      ? `${playerName}尝试以“${actionLabel}”压住${enemyName}的节奏，但在拉扯中逐渐失去稳定性，最终被对手抓住空档击溃。`
      : `${playerName}以“${actionLabel}”作为主轴应对${enemyName}，${noteText ? `并补上“${noteText}”这一临场判断，` : ''}最终${outcome === 'victory' ? '稳稳夺下了胜势' : '以较大代价拿下了胜利'}。`;

  return {
    adjudication: {
      outcome,
      trackDeltas: deltas,
      addStatuses: outcome === 'costly_victory' ? ['fatigued'] : outcome === 'defeat' ? ['shaken'] : [],
      removeStatuses: selectedRecommendedActionId === 'focus-barrier' ? ['exposed'] : [],
      rewardSelectionMode: 'none' as const,
      rewardOptionIds: [],
    },
    storyText,
    summaryText: buildNodeSummaryText({
      encounter,
      outcomeLabel: outcome === 'defeat' ? '败退' : outcome === 'victory' ? '顺利取胜' : '险胜',
      storyText,
    }),
  };
};

const readDraftPlayerInput = (
  value: unknown,
  encounter: EncounterSnapshotV1,
): {
  note: string;
  selectedOptionId: string;
  selectedRecommendedActionId: string;
} => {
  const fallback = {
    note: '',
    selectedOptionId: getDefaultOptionId(encounter),
    selectedRecommendedActionId: battleRecommendedActions[0]?.id ?? '',
  };

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  return {
    note: typeof record.note === 'string' ? record.note : fallback.note,
    selectedOptionId: typeof record.optionId === 'string' ? record.optionId : fallback.selectedOptionId,
    selectedRecommendedActionId:
      typeof record.recommendedActionId === 'string'
        ? record.recommendedActionId
        : fallback.selectedRecommendedActionId,
  };
};

export const deriveChallengeResumeState = (input: {
  runRecord: ChallengeRunRecord;
  latestCheckpoint: Awaited<ReturnType<typeof getLatestChallengeCheckpoint>>;
  latestNodeRecord: Awaited<ReturnType<typeof getLatestChallengeNodeForRun>>;
}): {
  stage: ChallengeStage;
  runState: RunStateV1 | null;
  currentEncounter: EncounterSnapshotV1 | null;
  nodeViewMode: 'input' | 'result';
  note: string;
  selectedOptionId: string;
  selectedRecommendedActionId: string;
  latestNodeSummary: string;
  summaryText: string;
  activeNodeRecord: ChallengeNodeRecord | null;
} => {
  const checkpointRunState = (input.latestCheckpoint?.snapshot.runState as RunStateV1 | null) ?? null;
  const storedRunState = (input.runRecord.runState as RunStateV1 | null) ?? null;
  const effectiveRunState = checkpointRunState ?? storedRunState;

  if (!effectiveRunState) {
    return {
      stage: 'lobby',
      runState: null,
      currentEncounter: null,
      nodeViewMode: 'input',
      note: '',
      selectedOptionId: '',
      selectedRecommendedActionId: battleRecommendedActions[0]?.id ?? '',
      latestNodeSummary: '',
      summaryText: '',
      activeNodeRecord: null,
    };
  }

  if (
    input.latestNodeRecord?.status === 'entered'
    && input.latestNodeRecord.encounterSnapshot
  ) {
    const encounter = input.latestNodeRecord.encounterSnapshot as EncounterSnapshotV1;
    const playerInput = readDraftPlayerInput(input.latestNodeRecord.playerInput, encounter);

    return {
      stage: 'node',
      runState: {
        ...effectiveRunState,
        currentNodeId: input.latestNodeRecord.nodeId,
      },
      currentEncounter: encounter,
      nodeViewMode: 'input',
      note: playerInput.note,
      selectedOptionId: playerInput.selectedOptionId,
      selectedRecommendedActionId: playerInput.selectedRecommendedActionId,
      latestNodeSummary: `已恢复至 ${input.latestNodeRecord.nodeId} 的待结算节点。`,
      summaryText: '',
      activeNodeRecord: input.latestNodeRecord,
    };
  }

  if (effectiveRunState.status === 'completed' || effectiveRunState.status === 'failed') {
    return {
      stage: 'summary',
      runState: effectiveRunState,
      currentEncounter: null,
      nodeViewMode: 'result',
      note: '',
      selectedOptionId: '',
      selectedRecommendedActionId: battleRecommendedActions[0]?.id ?? '',
      latestNodeSummary: `已恢复本地挑战：上次推进到 ${input.runRecord.lastResolvedNodeId ?? '终局'}。`,
      summaryText: buildFinishedSummaryText(effectiveRunState, '你重新回顾了这一轮的最终记录。'),
      activeNodeRecord: null,
    };
  }

  if (effectiveRunState.currentNodeId && (!input.latestCheckpoint || input.latestCheckpoint.kind === 'bootstrap_accepted')) {
    const encounter = buildEncounterForNode(effectiveRunState, effectiveRunState.currentNodeId);
    const playerInput = readDraftPlayerInput(null, encounter);

    return {
      stage: 'node',
      runState: effectiveRunState,
      currentEncounter: encounter,
      nodeViewMode: 'input',
      note: playerInput.note,
      selectedOptionId: playerInput.selectedOptionId,
      selectedRecommendedActionId: playerInput.selectedRecommendedActionId,
      latestNodeSummary: `已恢复至 ${effectiveRunState.currentNodeId} 的待结算节点。`,
      summaryText: '',
      activeNodeRecord: null,
    };
  }

  const normalizedRunState = clearCurrentNodeForMap(effectiveRunState);
  return {
    stage: 'map',
    runState: normalizedRunState,
    currentEncounter: null,
    nodeViewMode: 'input',
    note: '',
    selectedOptionId: '',
    selectedRecommendedActionId: battleRecommendedActions[0]?.id ?? '',
    latestNodeSummary: `已恢复本地挑战：上次推进到 ${input.latestCheckpoint?.snapshot.lastResolvedNodeId ?? input.runRecord.lastResolvedNodeId ?? '起点前'}。`,
    summaryText: '',
    activeNodeRecord: null,
  };
};

export function useChallengeController() {
  const worldPreset = getChallengeWorldPreset('arena');
  const [stage, setStage] = useState<ChallengeStage>('lobby');
  const [recentRuns, setRecentRuns] = useState<ChallengeRunRecord[]>([]);
  const [isLoadingRecentRuns, setIsLoadingRecentRuns] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [cardJsonText, setCardJsonText] = useState(arenaDemoCardText);
  const [bootstrapDraft, setBootstrapDraft] = useState<BootstrapDraft | null>(null);
  const [activeRunRecord, setActiveRunRecord] = useState<ChallengeRunRecord | null>(null);
  const [activeNodeRecord, setActiveNodeRecord] = useState<ChallengeNodeRecord | null>(null);
  const [runState, setRunState] = useState<RunStateV1 | null>(null);
  const [currentEncounter, setCurrentEncounter] = useState<EncounterSnapshotV1 | null>(null);
  const [nodeViewMode, setNodeViewMode] = useState<'input' | 'result'>('input');
  const [note, setNote] = useState('');
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const [selectedRecommendedActionId, setSelectedRecommendedActionId] = useState(battleRecommendedActions[0]?.id ?? '');
  const [latestStoryText, setLatestStoryText] = useState('');
  const [latestNodeSummary, setLatestNodeSummary] = useState('');
  const [summaryText, setSummaryText] = useState('');

  const refreshRecentRuns = async (): Promise<void> => {
    setIsLoadingRecentRuns(true);
    try {
      const runs = await listChallengeRuns({ limit: 8 });
      setRecentRuns(runs);
    } catch (storageError) {
      setError(storageError instanceof Error ? storageError.message : '读取本地挑战存档失败。');
    } finally {
      setIsLoadingRecentRuns(false);
    }
  };

  useEffect(() => {
    void refreshRecentRuns();
  }, []);

  const recommendedActions = useMemo(
    () => (currentEncounter && ['battle', 'elite', 'boss'].includes(currentEncounter.kind) ? battleRecommendedActions : []),
    [currentEncounter]
  );

  useEffect(() => {
    if (stage !== 'node' || nodeViewMode !== 'input' || !activeNodeRecord) return;

    const currentDraft = readDraftPlayerInput(activeNodeRecord.playerInput, activeNodeRecord.encounterSnapshot as EncounterSnapshotV1);
    if (
      currentDraft.note === note
      && currentDraft.selectedOptionId === selectedOptionId
      && currentDraft.selectedRecommendedActionId === selectedRecommendedActionId
    ) {
      return;
    }

    const handle = window.setTimeout(() => {
      const nextNodeRecord: ChallengeNodeRecord = {
        ...activeNodeRecord,
        playerInput: {
          recommendedActionId: selectedRecommendedActionId,
          optionId: selectedOptionId,
          note,
        },
      };

      void putChallengeNode(nextNodeRecord).then(() => {
        setActiveNodeRecord(nextNodeRecord);
      }).catch(() => {
        // draft sync failure should not block local typing
      });
    }, 120);

    return () => window.clearTimeout(handle);
  }, [
    activeNodeRecord?.id,
    activeNodeRecord,
    nodeViewMode,
    note,
    selectedOptionId,
    selectedRecommendedActionId,
    stage,
  ]);

  const resetNodeStageState = (): void => {
    setCurrentEncounter(null);
    setActiveNodeRecord(null);
    setNodeViewMode('input');
    setNote('');
    setSelectedOptionId('');
    setSelectedRecommendedActionId(battleRecommendedActions[0]?.id ?? '');
    setLatestStoryText('');
  };

  const loadDemoCard = (): void => {
    setCardJsonText(arenaDemoCardText);
    setInputError(null);
  };

  const prepareChallenge = async (): Promise<void> => {
    setError(null);
    setInputError(null);
    setIsBusy(true);
    try {
      const sourceCard = parseCardJsonInput(cardJsonText);
      const snapshotSeed = randomUUID();
      const startedAt = Date.now();
      const snapshot = buildArenaBootstrapSnapshot(sourceCard, { snapshotSeed });
      const draft: BootstrapDraft = {
        runId: randomUUID(),
        snapshotSeed,
        sourceCard,
        playerSnapshot: snapshot.playerSnapshot,
        initialWorldState: snapshot.initialWorldState,
        usedBootstrapReroll: false,
        startedAt,
      };

      setBootstrapDraft(draft);
      setActiveRunRecord(null);
      setActiveNodeRecord(null);
      setRunState(null);
      setStage('bootstrap');
    } catch (prepareError) {
      if (prepareError instanceof SyntaxError) {
        setInputError('角色卡 JSON 解析失败，请检查格式后重试。');
      } else {
        setError(prepareError instanceof Error ? prepareError.message : '生成竞技场快照失败。');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const rerollBootstrap = async (): Promise<void> => {
    if (!bootstrapDraft || bootstrapDraft.usedBootstrapReroll) return;
    setError(null);
    setIsBusy(true);
    try {
      const snapshotSeed = randomUUID();
      const snapshot = buildArenaBootstrapSnapshot(bootstrapDraft.sourceCard, { snapshotSeed });
      const nextDraft: BootstrapDraft = {
        ...bootstrapDraft,
        snapshotSeed,
        playerSnapshot: snapshot.playerSnapshot,
        initialWorldState: snapshot.initialWorldState,
        usedBootstrapReroll: true,
      };

      setBootstrapDraft(nextDraft);
    } catch (rerollError) {
      setError(rerollError instanceof Error ? rerollError.message : '免费重掷失败。');
    } finally {
      setIsBusy(false);
    }
  };

  const acceptBootstrap = async (): Promise<void> => {
    if (!bootstrapDraft) return;
    setError(null);
    setIsBusy(true);
    try {
      const accepted = acceptBootstrapSnapshot(
        {
          runId: bootstrapDraft.runId,
          worldPresetId: 'arena',
          playerSnapshot: bootstrapDraft.playerSnapshot,
          initialWorldState: bootstrapDraft.initialWorldState,
          usedBootstrapReroll: bootstrapDraft.usedBootstrapReroll,
          startedAt: bootstrapDraft.startedAt,
        },
        {
          snapshotSeed: bootstrapDraft.snapshotSeed,
        }
      );

      const nextRecord: ChallengeRunRecord = {
        ...createChallengeRunRecord(bootstrapDraft),
        ...accepted.runRecordPatch,
        status: 'in_progress',
        runSeed: accepted.runState.runSeed,
        usedBootstrapReroll: bootstrapDraft.usedBootstrapReroll,
        playerSnapshot: bootstrapDraft.playerSnapshot,
        runState: accepted.runState,
        currentNodeId: accepted.runState.currentNodeId,
        visitedNodeCount: accepted.runState.visitedNodeCount,
        lastResolvedNodeId: null,
        lastCheckpointId: accepted.checkpoint.id,
        updatedAt: accepted.runState.updatedAt,
        finishedAt: null,
      };

      await putChallengeCheckpoint(accepted.checkpoint);
      await putChallengeRun(nextRecord);

      setActiveRunRecord(nextRecord);
      setRunState(accepted.runState);
      setBootstrapDraft(null);
      setLatestNodeSummary('地图已冻结，可以从第一层开始规划路线。');
      setStage('map');
      await refreshRecentRuns();
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : '接受快照失败。');
    } finally {
      setIsBusy(false);
    }
  };

  const cancelBootstrap = async (): Promise<void> => {
    setBootstrapDraft(null);
    setActiveRunRecord(null);
    setActiveNodeRecord(null);
    setRunState(null);
    setStage('lobby');
  };

  const resumeRun = async (runId: string): Promise<void> => {
    setError(null);
    setIsBusy(true);
    try {
      const storedRun = await getChallengeRun(runId);
      if (!storedRun) {
        throw new Error('未找到对应的挑战存档。');
      }
      const latestCheckpoint = await getLatestChallengeCheckpoint(runId);
      const latestNodeRecord = await getLatestChallengeNodeForRun(runId);
      const resumeState = deriveChallengeResumeState({
        runRecord: storedRun,
        latestCheckpoint,
        latestNodeRecord,
      });

      if (!resumeState.runState) {
        throw new Error('当前存档尚未进入可恢复阶段。');
      }

      setActiveRunRecord(storedRun);
      setRunState(resumeState.runState);
      setCurrentEncounter(resumeState.currentEncounter);
      setActiveNodeRecord(resumeState.activeNodeRecord);
      setNodeViewMode(resumeState.nodeViewMode);
      setLatestStoryText('');
      setNote(resumeState.note);
      setSelectedOptionId(resumeState.selectedOptionId);
      setSelectedRecommendedActionId(resumeState.selectedRecommendedActionId);
      setLatestNodeSummary(resumeState.latestNodeSummary);
      setSummaryText(resumeState.summaryText);
      setStage(resumeState.stage);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : '恢复挑战失败。');
    } finally {
      setIsBusy(false);
    }
  };

  const deleteRun = async (runId: string): Promise<void> => {
    setError(null);
    try {
      await deleteChallengeRunCascade(runId);
      if (activeRunRecord?.id === runId) {
        setActiveRunRecord(null);
        setRunState(null);
        setBootstrapDraft(null);
        resetNodeStageState();
        setSummaryText('');
        setStage('lobby');
      }
      await refreshRecentRuns();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除本地挑战记录失败。');
    }
  };

  const enterNode = async (nodeId: string): Promise<void> => {
    if (!runState || !activeRunRecord) return;
    setError(null);
    setIsBusy(true);
    try {
      if (!getSelectableNodeIdsForMap(runState).includes(nodeId)) {
        throw new Error('当前节点不在可推进路径上。');
      }

      const nextRunState: RunStateV1 = {
        ...runState,
        currentNodeId: nodeId,
        updatedAt: Date.now(),
      };
      const encounter = buildEncounterForNode(nextRunState, nodeId);
      const nextSelectedOptionId = getDefaultOptionId(encounter);
      const nextSelectedRecommendedActionId = battleRecommendedActions[0]?.id ?? '';
      const enteredNodeRecord: ChallengeNodeRecord = {
        id: randomUUID(),
        runId: activeRunRecord.id,
        nodeId,
        visitIndex: runState.visitedNodeCount + 1,
        nodeType: encounter.kind,
        status: 'entered',
        encounterSnapshot: encounter,
        playerInput: {
          recommendedActionId: nextSelectedRecommendedActionId,
          optionId: nextSelectedOptionId,
          note: '',
        },
        resolverEnvelope: null,
        adjudicationResultDigest: null,
        storyText: null,
        createdAt: Date.now(),
        resolvedAt: null,
      };

      await putChallengeNode(enteredNodeRecord);
      const nextRecord = await updateChallengeRun(activeRunRecord.id, (current) => ({
        ...current,
        runState: nextRunState,
        currentNodeId: nodeId,
        updatedAt: Date.now(),
      }));

      setActiveRunRecord(nextRecord);
      setActiveNodeRecord(enteredNodeRecord);
      setRunState(nextRunState);
      setCurrentEncounter(encounter);
      setNodeViewMode('input');
      setSelectedOptionId(nextSelectedOptionId);
      setSelectedRecommendedActionId(nextSelectedRecommendedActionId);
      setNote('');
      setLatestStoryText('');
      setStage('node');
      await refreshRecentRuns();
    } catch (enterError) {
      setError(enterError instanceof Error ? enterError.message : '进入节点失败。');
    } finally {
      setIsBusy(false);
    }
  };

  const persistResolvedNode = async (input: {
    encounter: EncounterSnapshotV1;
    nodeRecord: ChallengeNodeRecord;
    nextRunState: RunStateV1;
    checkpoints: Awaited<ReturnType<typeof finalizeNodeResolution>>['checkpoints'];
    runRecordPatch: Record<string, unknown>;
    storyText: string;
  }): Promise<void> => {
    if (!activeRunRecord) return;

    await putChallengeNode(input.nodeRecord);
    for (const checkpoint of input.checkpoints) {
      await putChallengeCheckpoint(checkpoint);
    }

    const lastCheckpointId = input.checkpoints.at(-1)?.id ?? activeRunRecord.lastCheckpointId;
    const finishedAtValue =
      input.nextRunState.status === 'completed' || input.nextRunState.status === 'failed'
        ? (typeof input.runRecordPatch.finishedAt === 'number' ? input.runRecordPatch.finishedAt : Date.now())
        : null;

    const nextRecord = await updateChallengeRun(activeRunRecord.id, (current) => ({
      ...current,
      ...input.runRecordPatch,
      status: input.nextRunState.status,
      runState: input.nextRunState,
      currentNodeId: input.nextRunState.currentNodeId,
      visitedNodeCount: input.nextRunState.visitedNodeCount,
      lastCheckpointId,
      finishedAt: finishedAtValue,
      updatedAt: Date.now(),
    }));

    setActiveRunRecord(nextRecord);
    setRunState(input.nextRunState);
  };

  const resolveCurrentNode = async (): Promise<void> => {
    if (!runState || !currentEncounter || !activeRunRecord) return;
    setError(null);
    setIsResolving(true);

    try {
      const baseNodeRecord: ChallengeNodeRecord = {
        id: activeNodeRecord?.id ?? randomUUID(),
        runId: activeRunRecord.id,
        nodeId: currentEncounter.nodeId,
        visitIndex: activeNodeRecord?.visitIndex ?? runState.visitedNodeCount + 1,
        nodeType: activeNodeRecord?.nodeType ?? currentEncounter.kind,
        status: 'resolved',
        encounterSnapshot: currentEncounter,
        playerInput: {
          recommendedActionId: selectedRecommendedActionId,
          optionId: selectedOptionId,
          note,
        },
        resolverEnvelope: null,
        adjudicationResultDigest: null,
        storyText: null,
        createdAt: activeNodeRecord?.createdAt ?? Date.now(),
        resolvedAt: Date.now(),
      };

      if (currentEncounter.kind === 'battle' || currentEncounter.kind === 'elite' || currentEncounter.kind === 'boss') {
        const resolution = buildBattleResolution(runState, currentEncounter, selectedRecommendedActionId, note);
        const result = finalizeNodeResolution(runState, resolution.adjudication);
        const nextRunState = clearCurrentNodeForMap(result.nextRunState);
        const nodeRecord: ChallengeNodeRecord = {
          ...baseNodeRecord,
          storyText: resolution.storyText,
        };

        await persistResolvedNode({
          encounter: currentEncounter,
          nodeRecord,
          nextRunState,
          checkpoints: result.checkpoints,
          runRecordPatch: result.runRecordPatch,
          storyText: resolution.storyText,
        });

        setLatestStoryText(resolution.storyText);
        setLatestNodeSummary(resolution.summaryText);
        setActiveNodeRecord(null);

        if (nextRunState.status === 'completed' || nextRunState.status === 'failed') {
          setSummaryText(buildFinishedSummaryText(nextRunState, resolution.storyText));
          resetNodeStageState();
          setStage('summary');
        } else {
          setNodeViewMode('result');
        }
      } else {
        const result = resolveSystemNode(runState, {
          encounter: currentEncounter,
          eventOptionId: currentEncounter.kind === 'shop' ? undefined : selectedOptionId,
          shopOfferId: currentEncounter.kind === 'shop' ? selectedOptionId || null : undefined,
        });
        const nextRunState = clearCurrentNodeForMap(result.nextRunState);
        const storyText = buildSystemStoryText(currentEncounter, selectedOptionId);
        const nodeRecord: ChallengeNodeRecord = {
          ...baseNodeRecord,
          storyText,
        };

        await persistResolvedNode({
          encounter: currentEncounter,
          nodeRecord,
          nextRunState,
          checkpoints: result.checkpoints,
          runRecordPatch: result.runRecordPatch,
          storyText,
        });

        setLatestStoryText(storyText);
        setLatestNodeSummary(
          buildNodeSummaryText({
            encounter: currentEncounter,
            outcomeLabel: '系统结算完成',
            storyText,
          })
        );
        setActiveNodeRecord(null);

        if (nextRunState.status === 'failed') {
          setSummaryText(buildFinishedSummaryText(nextRunState, storyText));
          resetNodeStageState();
          setStage('summary');
        } else {
          setNodeViewMode('result');
        }
      }

      await refreshRecentRuns();
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : '节点结算失败。');
    } finally {
      setIsResolving(false);
    }
  };

  const backToMap = (): void => {
    resetNodeStageState();
    setStage('map');
  };

  const backToLobby = (): void => {
    setActiveRunRecord(null);
    setActiveNodeRecord(null);
    setRunState(null);
    setBootstrapDraft(null);
    resetNodeStageState();
    setSummaryText('');
    setStage('lobby');
    void refreshRecentRuns();
  };

  return {
    stage,
    worldTitle: worldPreset.title,
    error,
    inputError,
    recentRuns,
    isLoadingRecentRuns,
    isBusy,
    isResolving,
    cardJsonText,
    bootstrapDraft,
    runState,
    currentEncounter,
    nodeViewMode,
    note,
    selectedOptionId,
    selectedRecommendedActionId,
    latestStoryText,
    latestNodeSummary,
    summaryText,
    recommendedActions,
    setCardJsonText,
    setNote,
    setSelectedOptionId,
    setSelectedRecommendedActionId,
    loadDemoCard,
    prepareChallenge,
    rerollBootstrap,
    acceptBootstrap,
    cancelBootstrap,
    resumeRun,
    deleteRun,
    enterNode,
    resolveCurrentNode,
    backToMap,
    backToLobby,
  };
}
