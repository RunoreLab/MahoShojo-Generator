import {
  assertCompletedBattleStoryCommit,
  captureBattleStoryCommitExpected,
  createBattleStoryCommitReceipt,
  digestBattleStoryCommitValue,
  freezeBattleStoryCommit,
  type BattleStoryCommitReceipt,
  type BattleStoryCompletedCommit,
} from '@mahoshojo/domain/arena-story-commit';
import { openAiSessionDb, requestToPromise, transactionToPromise } from '@/lib/ai-session/storage';
import { AI_SESSION_STORE_NAMES } from '@/lib/ai-session/types';
import type { BattleStoryChapterCardSnapshot, BattleStoryChapterRecord, BattleStoryCheckpointRecord, BattleStorySessionRecord } from './types';

export type WebBattleStoryCompletedCommit = BattleStoryCompletedCommit<BattleStorySessionRecord, BattleStoryChapterCardSnapshot>;
/** The writer has proved this attempt did not commit (preflight failure or transaction abort). */
export class BattleStoryCommitNotSavedError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : '章节尚未保存，请重试保存或导出。');
    this.name = 'BattleStoryCommitNotSavedError';
  }
}
export class BattleStoryCommitConflictError extends BattleStoryCommitNotSavedError {
  constructor(message = '会话已发生变化，本章尚未保存。请导出本章后重新选择会话。') {
    super(new Error(message)); this.name = 'BattleStoryCommitConflictError';
  }
}

type StoredChapter = BattleStoryChapterRecord & { commitReceipt?: BattleStoryCommitReceipt };
const readReceipt = (chapter: StoredChapter | undefined, operationId: string): BattleStoryCommitReceipt | null => {
  const receipt = chapter?.commitReceipt;
  return receipt?.version === 1 && receipt.operationId === operationId && receipt.chapterId === chapter?.id
    && receipt.chapterId === operationId && receipt.sessionId === chapter?.sessionId ? receipt : null;
};

export const getBattleStoryOperationReceipt = async (operationId: string): Promise<BattleStoryCommitReceipt | null> => {
  const db = await openAiSessionDb();
  const transaction = db.transaction(AI_SESSION_STORE_NAMES.battleStoryChapters, 'readonly');
  const completed = transactionToPromise(transaction);
  const [chapter] = await Promise.all([
    requestToPromise(transaction.objectStore(AI_SESSION_STORE_NAMES.battleStoryChapters).get(operationId)), completed,
  ]);
  return readReceipt(chapter as StoredChapter | undefined, operationId);
};

/** One transaction owns validation, CAS, receipt and all three records. Never resolve at request success. */
export const commitCompletedBattleStoryChapter = async (
  input: WebBattleStoryCompletedCommit,
): Promise<BattleStoryCommitReceipt> => {
  let commit: WebBattleStoryCompletedCommit;
  let receipt: BattleStoryCommitReceipt;
  let db: IDBDatabase;
  try {
    commit = freezeBattleStoryCommit(input);
    assertCompletedBattleStoryCommit(commit);
    receipt = createBattleStoryCommitReceipt(commit);
    db = await openAiSessionDb();
  } catch (error) { throw new BattleStoryCommitNotSavedError(error); }
  return await new Promise<BattleStoryCommitReceipt>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction([
        AI_SESSION_STORE_NAMES.battleStorySessions,
        AI_SESSION_STORE_NAMES.battleStoryChapters,
        AI_SESSION_STORE_NAMES.battleStoryCheckpoints,
      ], 'readwrite');
    } catch (error) { reject(new BattleStoryCommitNotSavedError(error)); return; }
    const sessions = transaction.objectStore(AI_SESSION_STORE_NAMES.battleStorySessions);
    const chapters = transaction.objectStore(AI_SESSION_STORE_NAMES.battleStoryChapters);
    const checkpoints = transaction.objectStore(AI_SESSION_STORE_NAMES.battleStoryCheckpoints);
    let failure: unknown;
    let result: BattleStoryCommitReceipt | undefined;
    const abort = (error: unknown) => {
      failure = error;
      transaction.abort();
    };
    transaction.oncomplete = () => result ? resolve(result) : reject(new Error('章节事务没有提交回执'));
    transaction.onabort = () => reject(new BattleStoryCommitNotSavedError(failure ?? transaction.error ?? new Error('章节保存事务已回滚，请重试保存。')));
    transaction.onerror = () => { failure ??= transaction.error; };
    const existingRequest = chapters.get(commit.operationId);
    existingRequest.onsuccess = () => {
      try {
        const existing = existingRequest.result as StoredChapter | undefined;
        if (existing) {
          const previous = readReceipt(existing, commit.operationId);
          if (!previous || previous.contentDigest !== receipt.contentDigest) {
            throw new BattleStoryCommitConflictError('同一保存操作对应的章节内容不一致，未覆盖原记录。');
          }
          // Even a later append or rewrite can make CAS stale. A proven receipt still wins.
          result = previous;
          return;
        }
        const sessionRequest = sessions.get(commit.session.id);
        sessionRequest.onsuccess = () => {
          try {
            const current = sessionRequest.result as BattleStorySessionRecord | undefined;
            if (commit.action === 'start' ? Boolean(current) : !current) throw new BattleStoryCommitConflictError();
            const activeChapters: BattleStoryChapterRecord[] = [];
            const cursorRequest = chapters.index('by_session_index').openCursor(IDBKeyRange.bound(
              [commit.session.id, 0], [commit.session.id, Number.MAX_SAFE_INTEGER],
            ));
            cursorRequest.onsuccess = () => {
              try {
                const cursor = cursorRequest.result;
                if (cursor) {
                  if ((cursor.value as BattleStoryChapterRecord).status !== 'superseded') activeChapters.push(cursor.value);
                  cursor.continue();
                  return;
                }
                if (commit.action === 'start' && activeChapters.length) throw new BattleStoryCommitConflictError();
                const expected = commit.expected;
                const checkpointRequest = checkpoints.index('by_session_boundary').get([
                  commit.session.id, expected?.checkpointBoundary ?? 0,
                ]);
                checkpointRequest.onsuccess = () => {
                  try {
                    const checkpoint = (checkpointRequest.result as BattleStoryCheckpointRecord | undefined) ?? null;
                    if (expected && current) {
                      const actual = captureBattleStoryCommitExpected({ session: current, chapters: activeChapters, checkpoint });
                      if (digestBattleStoryCommitValue(actual) !== digestBattleStoryCommitValue(expected)) {
                        throw new BattleStoryCommitConflictError();
                      }
                    } else if (checkpoint) throw new BattleStoryCommitConflictError();
                    // add (not put) also prevents accidental overwrite of colliding record IDs/unique boundaries.
                    sessions.put(commit.session);
                    chapters.add({ ...commit.chapter, commitReceipt: receipt });
                    for (const record of commit.checkpoints) checkpoints.add(record);
                    result = receipt;
                  } catch (error) { abort(error); }
                };
              } catch (error) { abort(error); }
            };
          } catch (error) { abort(error); }
        };
      } catch (error) { abort(error); }
    };
  });
};
