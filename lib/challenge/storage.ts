import { openAiSessionDb, requestToPromise, transactionToPromise } from '@/lib/ai-session/storage';
import { AI_SESSION_STORE_NAMES } from '@/lib/ai-session/types';
import type {
  ChallengeCheckpointRecord,
  ChallengeNodeRecord,
  ChallengeRunRecord,
  ChallengeUnlockRecord,
} from '@/lib/challenge/types';

const DEFAULT_LIST_LIMIT = 50;

const normalizeLimit = (value: number | undefined, fallback = DEFAULT_LIST_LIMIT): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
};

export const openChallengeDb = openAiSessionDb;

const putChallengeRecord = async <T>(storeName: string, record: T): Promise<void> => {
  const db = await openChallengeDb();
  const transaction = db.transaction([storeName], 'readwrite');
  transaction.objectStore(storeName).put(record);
  await transactionToPromise(transaction);
};

export const putChallengeRun = async (record: ChallengeRunRecord): Promise<void> => {
  await putChallengeRecord(AI_SESSION_STORE_NAMES.challengeRuns, record);
};

export const putChallengeNode = async (record: ChallengeNodeRecord): Promise<void> => {
  await putChallengeRecord(AI_SESSION_STORE_NAMES.challengeNodes, record);
};

export const putChallengeCheckpoint = async (record: ChallengeCheckpointRecord): Promise<void> => {
  await putChallengeRecord(AI_SESSION_STORE_NAMES.challengeCheckpoints, record);
};

export const putChallengeUnlock = async (record: ChallengeUnlockRecord): Promise<void> => {
  await putChallengeRecord(AI_SESSION_STORE_NAMES.challengeUnlocks, record);
};

export const getChallengeRun = async (runId: string): Promise<ChallengeRunRecord | null> => {
  const db = await openChallengeDb();
  const transaction = db.transaction([AI_SESSION_STORE_NAMES.challengeRuns], 'readonly');
  const request = transaction.objectStore(AI_SESSION_STORE_NAMES.challengeRuns).get(runId);
  const result = await requestToPromise(request);
  await transactionToPromise(transaction);
  return (result as ChallengeRunRecord | undefined) ?? null;
};

export const updateChallengeRun = async (
  runId: string,
  updater: (current: ChallengeRunRecord) => ChallengeRunRecord
): Promise<ChallengeRunRecord> => {
  const db = await openChallengeDb();

  return await new Promise<ChallengeRunRecord>((resolve, reject) => {
    let settled = false;
    let nextRecord: ChallengeRunRecord | null = null;
    const transaction = db.transaction([AI_SESSION_STORE_NAMES.challengeRuns], 'readwrite');
    const store = transaction.objectStore(AI_SESSION_STORE_NAMES.challengeRuns);
    const request = store.get(runId);

    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('更新 challenge run 失败'));
    };

    const resolveOnce = (record: ChallengeRunRecord): void => {
      if (settled) return;
      settled = true;
      resolve(record);
    };

    transaction.oncomplete = () => {
      if (!nextRecord) {
        rejectOnce(new Error('更新 challenge run 失败'));
        return;
      }
      resolveOnce(nextRecord);
    };
    transaction.onabort = () => rejectOnce(transaction.error ?? new Error('更新 challenge run 失败'));
    transaction.onerror = () => rejectOnce(transaction.error ?? new Error('更新 challenge run 失败'));

    request.onsuccess = () => {
      const current = request.result as ChallengeRunRecord | undefined;
      if (!current) {
        rejectOnce(new Error(`未找到 challenge run: ${runId}`));
        try {
          transaction.abort();
        } catch {
          // ignore transaction abort races after manual reject
        }
        return;
      }

      try {
        nextRecord = updater(current);
        if (nextRecord.id !== runId) {
          throw new Error('challenge run id 不允许变更');
        }
        store.put(nextRecord);
      } catch (error) {
        rejectOnce(error);
        try {
          transaction.abort();
        } catch {
          // ignore transaction abort races after thrown updater/put
        }
      }
    };

    request.onerror = () => rejectOnce(request.error ?? new Error('读取 challenge run 失败'));
  });
};

export const listChallengeRuns = async (options?: {
  limit?: number;
  status?: ChallengeRunRecord['status'];
}): Promise<ChallengeRunRecord[]> => {
  const db = await openChallengeDb();
  const transaction = db.transaction([AI_SESSION_STORE_NAMES.challengeRuns], 'readonly');
  const store = transaction.objectStore(AI_SESSION_STORE_NAMES.challengeRuns);
  const limit = normalizeLimit(options?.limit);

  const runs = await new Promise<ChallengeRunRecord[]>((resolve, reject) => {
    const items: ChallengeRunRecord[] = [];
    const request = options?.status
      ? store.index('by_status_updatedAt').openCursor(IDBKeyRange.bound([options.status, 0], [options.status, Number.MAX_SAFE_INTEGER]), 'prev')
      : store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(items);
        return;
      }

      const value = cursor.value as ChallengeRunRecord;
      items.push(value);
      cursor.continue();
    };

    request.onerror = () => reject(request.error ?? new Error('读取 challenge runs 失败'));
  });

  await transactionToPromise(transaction);

  return runs
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
};

const deleteByCursor = async (
  index: IDBIndex,
  range: IDBKeyRange,
): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(range, 'next');

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      cursor.delete();
      cursor.continue();
    };

    request.onerror = () => reject(request.error ?? new Error('IndexedDB 游标删除失败'));
  });

export const deleteChallengeRunCascade = async (runId: string): Promise<void> => {
  const db = await openChallengeDb();
  const transaction = db.transaction(
    [
      AI_SESSION_STORE_NAMES.challengeRuns,
      AI_SESSION_STORE_NAMES.challengeNodes,
      AI_SESSION_STORE_NAMES.challengeCheckpoints,
      AI_SESSION_STORE_NAMES.challengeUnlocks,
    ],
    'readwrite'
  );

  const runStore = transaction.objectStore(AI_SESSION_STORE_NAMES.challengeRuns);
  const nodeIndex = transaction.objectStore(AI_SESSION_STORE_NAMES.challengeNodes).index('by_run_visitIndex');
  const checkpointIndex = transaction.objectStore(AI_SESSION_STORE_NAMES.challengeCheckpoints).index('by_run_seq');
  const unlockIndex = transaction.objectStore(AI_SESSION_STORE_NAMES.challengeUnlocks).index('by_run_createdAt');

  await Promise.all([
    deleteByCursor(nodeIndex, IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER])),
    deleteByCursor(checkpointIndex, IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER])),
    deleteByCursor(unlockIndex, IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER])),
  ]);

  runStore.delete(runId);
  await transactionToPromise(transaction);
};
