import { beforeEach, describe, expect, test } from 'vitest';
import '@/tests/helpers/fake-indexeddb';

import { __resetAiSessionDbForTest, requestToPromise, transactionToPromise } from '@/lib/ai-session/storage';
import {
  deleteChallengeRunCascade,
  getChallengeRun,
  getLatestChallengeCheckpoint,
  getLatestChallengeNodeForRun,
  listChallengeRuns,
  openChallengeDb,
  putChallengeCheckpoint,
  putChallengeNode,
  putChallengeRun,
  putChallengeUnlock,
  updateChallengeRun,
} from '@/lib/challenge/storage';
import { AI_SESSION_DB_NAME, AI_SESSION_STORE_NAMES } from '@/lib/ai-session/types';

describe('challenge storage', () => {
  beforeEach(async () => {
    await __resetAiSessionDbForTest();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(AI_SESSION_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
      request.onblocked = () => resolve();
    });
  });

  test('创建 challenge stores 并按 updatedAt 倒序读取 runs', async () => {
    const db = await openChallengeDb();
    expect(db.objectStoreNames.contains('challenge_runs')).toBe(true);
    expect(db.objectStoreNames.contains('challenge_nodes')).toBe(true);
    expect(db.objectStoreNames.contains('challenge_checkpoints')).toBe(true);
    expect(db.objectStoreNames.contains('challenge_unlocks')).toBe(true);
    expect(db.objectStoreNames.contains(AI_SESSION_STORE_NAMES.publicCardCache)).toBe(true);

    const runStore = db.transaction('challenge_runs', 'readonly').objectStore('challenge_runs');
    const nodeStore = db.transaction('challenge_nodes', 'readonly').objectStore('challenge_nodes');
    const checkpointStore = db.transaction('challenge_checkpoints', 'readonly').objectStore('challenge_checkpoints');
    const unlockStore = db.transaction('challenge_unlocks', 'readonly').objectStore('challenge_unlocks');
    const publicCardCacheStore = db.transaction(AI_SESSION_STORE_NAMES.publicCardCache, 'readonly')
      .objectStore(AI_SESSION_STORE_NAMES.publicCardCache);

    expect(runStore.keyPath).toBe('id');
    expect(runStore.indexNames.contains('by_status_updatedAt')).toBe(true);
    expect(runStore.indexNames.contains('by_world_startedAt')).toBe(true);
    expect(runStore.index('by_status_updatedAt').keyPath).toEqual(['status', 'updatedAt']);
    expect(runStore.index('by_world_startedAt').keyPath).toEqual(['worldPresetId', 'startedAt']);
    expect(nodeStore.index('by_run_visitIndex').unique).toBe(true);
    expect(checkpointStore.index('by_run_seq').unique).toBe(true);
    expect(unlockStore.index('by_unlock_key').unique).toBe(true);
    expect(publicCardCacheStore.indexNames.contains('by_expiresAt')).toBe(true);
    expect(publicCardCacheStore.indexNames.contains('by_lastAccessedAt')).toBe(true);
    expect(publicCardCacheStore.indexNames.contains('by_cacheKind_lastAccessedAt')).toBe(true);

    await putChallengeRun({
      id: 'run-1',
      worldPresetId: 'arena',
      status: 'in_progress',
      snapshotSeed: 'snap-1',
      runSeed: 'run-seed-1',
      usedBootstrapReroll: false,
      playerSnapshot: null,
      runState: null,
      currentStateDigest: null,
      currentNodeId: null,
      visitedNodeCount: 0,
      lastResolvedNodeId: null,
      lastCheckpointId: null,
      startedAt: 100,
      updatedAt: 20,
      finishedAt: null,
    });
    await putChallengeRun({
      id: 'run-2',
      worldPresetId: 'arena',
      status: 'failed',
      snapshotSeed: 'snap-2',
      runSeed: 'run-seed-2',
      usedBootstrapReroll: true,
      playerSnapshot: null,
      runState: null,
      currentStateDigest: null,
      currentNodeId: null,
      visitedNodeCount: 3,
      lastResolvedNodeId: 'node-3',
      lastCheckpointId: 'checkpoint-3',
      startedAt: 90,
      updatedAt: 10,
      finishedAt: 30,
    });
    await putChallengeRun({
      id: 'run-2b',
      worldPresetId: 'arena',
      status: 'failed',
      snapshotSeed: 'snap-2b',
      runSeed: 'run-seed-2b',
      usedBootstrapReroll: false,
      playerSnapshot: null,
      runState: null,
      currentStateDigest: null,
      currentNodeId: null,
      visitedNodeCount: 4,
      lastResolvedNodeId: 'node-4',
      lastCheckpointId: 'checkpoint-4',
      startedAt: 95,
      updatedAt: 40,
      finishedAt: 41,
    });

    const runs = await listChallengeRuns({ limit: 2 });
    const failedRuns = await listChallengeRuns({ status: 'failed', limit: 2 });

    expect(runs.map((run) => run.id)).toEqual(['run-2b', 'run-1']);
    expect(failedRuns.map((run) => run.id)).toEqual(['run-2b', 'run-2']);
  });

  test('updateChallengeRun 会更新记录并可重新读取', async () => {
    await putChallengeRun({
      id: 'run-3',
      worldPresetId: 'arena',
      status: 'bootstrapping',
      snapshotSeed: 'snap-3',
      runSeed: null,
      usedBootstrapReroll: false,
      playerSnapshot: null,
      runState: null,
      currentStateDigest: null,
      currentNodeId: null,
      visitedNodeCount: 0,
      lastResolvedNodeId: null,
      lastCheckpointId: null,
      startedAt: 1,
      updatedAt: 2,
      finishedAt: null,
    });

    const next = await updateChallengeRun('run-3', (current) => ({
      ...current,
      status: 'in_progress',
      runSeed: 'run-seed-3',
      updatedAt: 99,
    }));
    const stored = await getChallengeRun('run-3');

    expect(next.status).toBe('in_progress');
    expect(next.runSeed).toBe('run-seed-3');
    expect(stored?.updatedAt).toBe(99);
  });

  test('updateChallengeRun 不允许修改目标 run 的 id', async () => {
    await putChallengeRun({
      id: 'run-immutable',
      worldPresetId: 'arena',
      status: 'in_progress',
      snapshotSeed: 'snap-immutable',
      runSeed: 'run-seed-immutable',
      usedBootstrapReroll: false,
      playerSnapshot: null,
      runState: null,
      currentStateDigest: null,
      currentNodeId: null,
      visitedNodeCount: 1,
      lastResolvedNodeId: null,
      lastCheckpointId: null,
      startedAt: 11,
      updatedAt: 22,
      finishedAt: null,
    });

    await expect(
      updateChallengeRun('run-immutable', (current) => ({
        ...current,
        id: 'run-immutable-next',
      }))
    ).rejects.toThrow('challenge run id 不允许变更');

    const currentRecord = await getChallengeRun('run-immutable');
    const wrongRecord = await getChallengeRun('run-immutable-next');

    expect(currentRecord?.id).toBe('run-immutable');
    expect(wrongRecord).toBeNull();
  });

  test('updateChallengeRun 在事务 abort 时应 reject 并保持原记录', async () => {
    await putChallengeRun({
      id: 'run-abort',
      worldPresetId: 'arena',
      status: 'in_progress',
      snapshotSeed: 'snap-abort',
      runSeed: 'run-seed-abort',
      usedBootstrapReroll: false,
      playerSnapshot: null,
      runState: null,
      currentStateDigest: null,
      currentNodeId: null,
      visitedNodeCount: 1,
      lastResolvedNodeId: 'node-abort',
      lastCheckpointId: 'checkpoint-abort',
      startedAt: 10,
      updatedAt: 20,
      finishedAt: null,
    });

    const db = await openChallengeDb();
    const originalTransaction = db.transaction.bind(db);

    Object.defineProperty(db, 'transaction', {
      configurable: true,
      value: ((...args: Parameters<IDBDatabase['transaction']>) => {
        const transaction = originalTransaction(...args);
        const [storeNames, mode] = args;
        const targetStores = Array.isArray(storeNames) ? storeNames : [storeNames];

        if (!targetStores.includes(AI_SESSION_STORE_NAMES.challengeRuns) || mode !== 'readwrite') {
          return transaction;
        }

        const originalObjectStore = transaction.objectStore.bind(transaction);
        Object.defineProperty(transaction, 'objectStore', {
          configurable: true,
          value: ((...storeArgs: Parameters<IDBTransaction['objectStore']>) => {
            const store = originalObjectStore(...storeArgs);
            if (storeArgs[0] !== AI_SESSION_STORE_NAMES.challengeRuns) {
              return store;
            }

            const originalPut = store.put.bind(store);
            Object.defineProperty(store, 'put', {
              configurable: true,
              value: ((value: unknown, key?: IDBValidKey) => {
                const request = typeof key === 'undefined' ? originalPut(value) : originalPut(value, key);
                queueMicrotask(() => {
                  try {
                    transaction.abort();
                  } catch {
                    // ignore abort timing races in test hook
                  }
                });
                return request;
              }) as typeof store.put,
            });

            return store;
          }) as typeof transaction.objectStore,
        });

        return transaction;
      }) as typeof db.transaction,
    });

    try {
      await expect(
        updateChallengeRun('run-abort', (current) => ({
          ...current,
          updatedAt: 200,
        }))
      ).rejects.toThrow('更新 challenge run 失败');
    } finally {
      Object.defineProperty(db, 'transaction', {
        configurable: true,
        value: originalTransaction,
      });
    }

    const stored = await getChallengeRun('run-abort');
    expect(stored?.updatedAt).toBe(20);
  });

  test('putChallengeNode、putChallengeCheckpoint 与 putChallengeUnlock 会写入对应 stores', async () => {
    await putChallengeNode({
      id: 'node-record-1',
      runId: 'run-5',
      nodeId: 'node-5',
      visitIndex: 1,
      nodeType: 'battle',
      status: 'entered',
      encounterSnapshot: { enemyIds: ['enemy-a'] },
      playerInput: null,
      resolverEnvelope: null,
      adjudicationResultDigest: null,
      storyText: null,
      createdAt: 1,
      resolvedAt: null,
    });
    await putChallengeCheckpoint({
      id: 'checkpoint-record-1',
      runId: 'run-5',
      seq: 1,
      kind: 'node_resolved',
      snapshot: {
        runState: { mapState: { currentNodeId: 'node-5' } },
        playerSnapshot: null,
        lastResolvedNodeId: 'node-5',
        pendingRewardChoice: null,
      },
      createdAt: 2,
    });
    await putChallengeUnlock({
      id: 'unlock-record-1',
      runId: 'run-5',
      worldPresetId: 'arena',
      unlockType: 'enemy-log',
      unlockKey: 'enemy:a',
      title: '敌人档案',
      description: '记录首个挑战敌人',
      sourceNodeId: 'node-5',
      createdAt: 3,
    });

    const db = await openChallengeDb();
    const readTx = db.transaction(
      [
        AI_SESSION_STORE_NAMES.challengeNodes,
        AI_SESSION_STORE_NAMES.challengeCheckpoints,
        AI_SESSION_STORE_NAMES.challengeUnlocks,
      ],
      'readonly'
    );

    const nodeRecord = await requestToPromise(readTx.objectStore(AI_SESSION_STORE_NAMES.challengeNodes).get('node-record-1'));
    const checkpointRecord = await requestToPromise(
      readTx.objectStore(AI_SESSION_STORE_NAMES.challengeCheckpoints).get('checkpoint-record-1')
    );
    const unlockRecord = await requestToPromise(readTx.objectStore(AI_SESSION_STORE_NAMES.challengeUnlocks).get('unlock-record-1'));
    await transactionToPromise(readTx);

    expect(nodeRecord).toMatchObject({ runId: 'run-5', status: 'entered' });
    expect(checkpointRecord).toMatchObject({ runId: 'run-5', kind: 'node_resolved' });
    expect(unlockRecord).toMatchObject({ runId: 'run-5', unlockType: 'enemy-log' });
  });

  test('getLatestChallengeCheckpoint 与 getLatestChallengeNodeForRun 会返回同 run 的最新记录', async () => {
    await putChallengeCheckpoint({
      id: 'checkpoint-old',
      runId: 'run-latest',
      seq: 1,
      kind: 'bootstrap_accepted',
      snapshot: {
        runState: null,
        playerSnapshot: null,
        lastResolvedNodeId: null,
      },
      createdAt: 10,
    });
    await putChallengeCheckpoint({
      id: 'checkpoint-new',
      runId: 'run-latest',
      seq: 2,
      kind: 'node_resolved',
      snapshot: {
        runState: null,
        playerSnapshot: null,
        lastResolvedNodeId: 'L1-N1',
      },
      createdAt: 20,
    });
    await putChallengeNode({
      id: 'node-old',
      runId: 'run-latest',
      nodeId: 'L1-N1',
      visitIndex: 1,
      nodeType: 'battle',
      status: 'entered',
      encounterSnapshot: null,
      playerInput: null,
      resolverEnvelope: null,
      adjudicationResultDigest: null,
      storyText: null,
      createdAt: 11,
      resolvedAt: null,
    });
    await putChallengeNode({
      id: 'node-new',
      runId: 'run-latest',
      nodeId: 'L1-N1',
      visitIndex: 2,
      nodeType: 'event',
      status: 'entered',
      encounterSnapshot: null,
      playerInput: null,
      resolverEnvelope: null,
      adjudicationResultDigest: null,
      storyText: null,
      createdAt: 21,
      resolvedAt: null,
    });

    const latestCheckpoint = await getLatestChallengeCheckpoint('run-latest');
    const latestNode = await getLatestChallengeNodeForRun('run-latest');

    expect(latestCheckpoint?.id).toBe('checkpoint-new');
    expect(latestCheckpoint?.seq).toBe(2);
    expect(latestNode?.id).toBe('node-new');
    expect(latestNode?.visitIndex).toBe(2);
  });

  test('deleteChallengeRunCascade 会删除 run 及其关联 node/checkpoint，但保留长期解锁', async () => {
    await putChallengeRun({
      id: 'run-4',
      worldPresetId: 'arena',
      status: 'failed',
      snapshotSeed: 'snap-4',
      runSeed: 'run-seed-4',
      usedBootstrapReroll: false,
      playerSnapshot: null,
      runState: null,
      currentStateDigest: null,
      currentNodeId: null,
      visitedNodeCount: 2,
      lastResolvedNodeId: 'node-2',
      lastCheckpointId: 'checkpoint-2',
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
    });

    await putChallengeNode({
      id: 'node-record-1',
      runId: 'run-4',
      nodeId: 'node-2',
      visitIndex: 1,
      nodeType: 'battle',
      status: 'resolved',
      encounterSnapshot: { enemyIds: ['enemy-b'] },
      playerInput: 'attack',
      resolverEnvelope: null,
      adjudicationResultDigest: 'digest-1',
      storyText: 'resolved',
      createdAt: 1,
      resolvedAt: 2,
    });
    await putChallengeCheckpoint({
      id: 'checkpoint-record-1',
      runId: 'run-4',
      seq: 1,
      kind: 'node_resolved',
      snapshot: {
        runState: { mapState: { currentNodeId: 'node-2' } },
        playerSnapshot: null,
        lastResolvedNodeId: 'node-2',
        pendingRewardChoice: null,
      },
      createdAt: 2,
    });
    await putChallengeUnlock({
      id: 'unlock-record-1',
      runId: 'run-4',
      worldPresetId: 'arena',
      unlockType: 'enemy-log',
      unlockKey: 'enemy:a',
      title: '敌人档案',
      description: '击败了敌人 a',
      sourceNodeId: 'node-2',
      createdAt: 3,
    });

    const db = await openChallengeDb();

    await deleteChallengeRunCascade('run-4');

    const readTx = db.transaction(
      [
        AI_SESSION_STORE_NAMES.challengeRuns,
        AI_SESSION_STORE_NAMES.challengeNodes,
        AI_SESSION_STORE_NAMES.challengeCheckpoints,
        AI_SESSION_STORE_NAMES.challengeUnlocks,
      ],
      'readonly'
    );

    const runRecord = await requestToPromise(readTx.objectStore(AI_SESSION_STORE_NAMES.challengeRuns).get('run-4'));
    const nodeCount = await requestToPromise(readTx.objectStore(AI_SESSION_STORE_NAMES.challengeNodes).count());
    const checkpointCount = await requestToPromise(readTx.objectStore(AI_SESSION_STORE_NAMES.challengeCheckpoints).count());
    const unlockCount = await requestToPromise(readTx.objectStore(AI_SESSION_STORE_NAMES.challengeUnlocks).count());
    await transactionToPromise(readTx);

    expect(runRecord).toBeUndefined();
    expect(nodeCount).toBe(0);
    expect(checkpointCount).toBe(0);
    expect(unlockCount).toBe(1);
  });

  test('deleteChallengeRunCascade 会在首个 await 前排队 run 删除请求，避免事务失活', async () => {
    await putChallengeRun({
      id: 'run-delete-order',
      worldPresetId: 'arena',
      status: 'failed',
      snapshotSeed: 'snap-delete-order',
      runSeed: 'run-seed-delete-order',
      usedBootstrapReroll: false,
      playerSnapshot: null,
      runState: null,
      currentStateDigest: null,
      currentNodeId: null,
      visitedNodeCount: 0,
      lastResolvedNodeId: null,
      lastCheckpointId: null,
      startedAt: 10,
      updatedAt: 20,
      finishedAt: 30,
    });

    const db = await openChallengeDb();
    const originalTransaction = db.transaction.bind(db);

    Object.defineProperty(db, 'transaction', {
      configurable: true,
      value: ((...args: Parameters<IDBDatabase['transaction']>) => {
        const transaction = originalTransaction(...args);
        const [storeNames, mode] = args;
        const targetStores = Array.isArray(storeNames) ? storeNames : [storeNames];
        const isChallengeDeleteTransaction =
          mode === 'readwrite'
          && targetStores.includes(AI_SESSION_STORE_NAMES.challengeRuns)
          && targetStores.includes(AI_SESSION_STORE_NAMES.challengeNodes)
          && targetStores.includes(AI_SESSION_STORE_NAMES.challengeCheckpoints);

        if (!isChallengeDeleteTransaction) {
          return transaction;
        }

        let becameInactive = false;
        queueMicrotask(() => {
          becameInactive = true;
        });

        const originalObjectStore = transaction.objectStore.bind(transaction);
        Object.defineProperty(transaction, 'objectStore', {
          configurable: true,
          value: ((...storeArgs: Parameters<IDBTransaction['objectStore']>) => {
            const store = originalObjectStore(...storeArgs);
            if (storeArgs[0] !== AI_SESSION_STORE_NAMES.challengeRuns) {
              return store;
            }

            const originalDelete = store.delete.bind(store);
            Object.defineProperty(store, 'delete', {
              configurable: true,
              value: ((key: IDBValidKey) => {
                if (becameInactive) {
                  throw new DOMException('Transaction is inactive', 'TransactionInactiveError');
                }
                return originalDelete(key);
              }) as typeof store.delete,
            });

            return store;
          }) as typeof transaction.objectStore,
        });

        return transaction;
      }) as typeof db.transaction,
    });

    try {
      await deleteChallengeRunCascade('run-delete-order');
    } finally {
      Object.defineProperty(db, 'transaction', {
        configurable: true,
        value: originalTransaction,
      });
    }

    const deleted = await getChallengeRun('run-delete-order');
    expect(deleted).toBeNull();
  });
});
