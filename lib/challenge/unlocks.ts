import { randomUUID } from '@/lib/crypto';
import {
  getChallengeUnlockByKey,
  listChallengeUnlocksByWorld as listChallengeUnlocksByWorldFromStorage,
  putChallengeUnlock,
} from '@/lib/challenge/storage';
import type { ChallengeNodeRecord, ChallengeUnlockRecord, RunStateV1 } from '@/lib/challenge/types';
import {
  getArenaStartingActionOptionMeta,
  getArenaStartingPersistentItemMeta,
} from '@/lib/challenge/worlds/arena/manual-content';

type GrantChallengeUnlocksInput = {
  runId: string;
  worldPresetId: string;
  runState: RunStateV1;
  nodeRecord?: ChallengeNodeRecord | null;
  now?: number;
  createId?: () => string;
};

type UnlockCandidate = Omit<ChallengeUnlockRecord, 'id' | 'runId' | 'createdAt'>;

const createTimestamp = (value: number | undefined, offset: number): number => {
  const base = typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
  return base + offset;
};

const buildArenaUnlockCandidates = (input: GrantChallengeUnlocksInput): UnlockCandidate[] => {
  const candidates: UnlockCandidate[] = [];
  const encounter = input.nodeRecord?.encounterSnapshot;
  const enemy = encounter?.enemySnapshot;

  if (enemy?.sourceId) {
    candidates.push({
      worldPresetId: 'arena',
      unlockType: 'enemy-log',
      unlockKey: `arena.enemy_log.${enemy.sourceId}`,
      title: `敌人记录：${enemy.displayName}`,
      description: `记录了${enemy.displayName}的基础战斗印象。`,
      sourceNodeId: input.nodeRecord?.nodeId ?? null,
    });
  }

  if (encounter?.kind === 'event') {
    const eventLabel = encounter.eventOptions[0]?.label?.trim() || encounter.templateId;
    candidates.push({
      worldPresetId: 'arena',
      unlockType: 'event-log',
      unlockKey: `arena.event_log.${encounter.templateId}`,
      title: `事件记录：${eventLabel}`,
      description: '记录了一次特殊事件的处理经验。',
      sourceNodeId: input.nodeRecord?.nodeId ?? null,
    });
  }

  if (input.runState.status === 'failed') {
    const meta = getArenaStartingActionOptionMeta('moon-slice');
    if (meta) {
      candidates.push({
        worldPresetId: 'arena',
        unlockType: 'start-action-option',
        unlockKey: 'arena.start_action_option.moon-slice',
        title: `起始动作：${meta.title}`,
        description: '首次失败后解锁的起始动作候选。',
        sourceNodeId: null,
      });
    }
  }

  if (input.runState.worldState?.runFlags.includes('elite_defeated')) {
    const meta = getArenaStartingActionOptionMeta('guard-weave');
    if (meta) {
      candidates.push({
        worldPresetId: 'arena',
        unlockType: 'start-action-option',
        unlockKey: 'arena.start_action_option.guard-weave',
        title: `起始动作：${meta.title}`,
        description: '首次击败精英后解锁的起始动作候选。',
        sourceNodeId: null,
      });
    }
  }

  if (input.runState.status === 'completed') {
    const meta = getArenaStartingPersistentItemMeta('starlit-ribbon');
    if (meta) {
      candidates.push({
        worldPresetId: 'arena',
        unlockType: 'start-persistent-item-option',
        unlockKey: 'arena.start_persistent_item_option.starlit-ribbon',
        title: `起始奇物：${meta.title}`,
        description: '首次通关后解锁的起始奇物候选。',
        sourceNodeId: null,
      });
    }
  }

  return candidates;
};

const grantUnlockIfAbsent = async (
  input: UnlockCandidate & {
    runId: string;
    createdAt: number;
    createId: () => string;
  }
): Promise<ChallengeUnlockRecord | null> => {
  const existing = await getChallengeUnlockByKey({
    worldPresetId: input.worldPresetId,
    unlockType: input.unlockType,
    unlockKey: input.unlockKey,
  });
  if (existing) return null;

  const record: ChallengeUnlockRecord = {
    id: input.createId(),
    worldPresetId: input.worldPresetId,
    runId: input.runId,
    unlockType: input.unlockType,
    unlockKey: input.unlockKey,
    title: input.title,
    description: input.description,
    sourceNodeId: input.sourceNodeId,
    createdAt: input.createdAt,
  };

  try {
    await putChallengeUnlock(record);
    return record;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/constraint/i.test(message) || /key already exists/i.test(message)) {
      return null;
    }
    throw error;
  }
};

export const grantChallengeUnlocks = async (input: GrantChallengeUnlocksInput): Promise<ChallengeUnlockRecord[]> => {
  if (input.worldPresetId !== 'arena') return [];

  const candidates = buildArenaUnlockCandidates(input);
  const created: ChallengeUnlockRecord[] = [];
  const createId = input.createId ?? randomUUID;

  for (const [index, candidate] of candidates.entries()) {
    const record = await grantUnlockIfAbsent({
      ...candidate,
      runId: input.runId,
      createdAt: createTimestamp(input.now, index),
      createId,
    });
    if (record) created.push(record);
  }

  return created.sort((left, right) => right.createdAt - left.createdAt);
};

export const listChallengeUnlocksByWorld = async (
  worldPresetId: string,
  options?: { limit?: number }
): Promise<ChallengeUnlockRecord[]> => {
  return await listChallengeUnlocksByWorldFromStorage(worldPresetId, options);
};
