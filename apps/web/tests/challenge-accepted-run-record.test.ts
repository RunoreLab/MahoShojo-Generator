import { describe, expect, test } from 'vitest';

import { createAcceptedChallengeRunRecord } from '@/lib/challenge/run-record';
import type { ChallengeRunRecord } from '@/lib/challenge/types';

const baseRecord: ChallengeRunRecord = {
  id: 'run-1',
  worldPresetId: 'arena',
  status: 'bootstrapping',
  snapshotSeed: 'snapshot-1',
  runSeed: null,
  usedBootstrapReroll: true,
  playerSnapshot: { version: 1 },
  runState: null,
  currentStateDigest: null,
  currentNodeId: null,
  visitedNodeCount: 0,
  lastResolvedNodeId: null,
  lastCheckpointId: null,
  startedAt: 100,
  updatedAt: 100,
  finishedAt: null,
};

describe('Challenge accepted bootstrap run record', () => {
  test('按 base、accepted patch、checkpoint 顺序合并且不修改输入', () => {
    const patch: Partial<ChallengeRunRecord> = {
      status: 'in_progress',
      runSeed: 'run-seed-1',
      runState: { checkpointSeq: 1 },
      updatedAt: 120,
    };

    const result = createAcceptedChallengeRunRecord(
      baseRecord,
      patch,
      'checkpoint-1',
    );

    expect(result).toEqual({
      ...baseRecord,
      ...patch,
      lastCheckpointId: 'checkpoint-1',
    });
    expect(result).not.toBe(baseRecord);
    expect(baseRecord.status).toBe('bootstrapping');
    expect(baseRecord.lastCheckpointId).toBeNull();
  });
});
