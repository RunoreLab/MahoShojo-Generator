import { randomUUID } from '@/lib/crypto';
import { openAiSessionDb, requestToPromise, transactionToPromise } from '@/lib/ai-session/storage';
import { AI_SESSION_STORE_NAMES } from '@/lib/ai-session/types';
import type {
  BattleStoryChapterListOptions,
  BattleStoryChapterRecord,
  BattleStoryDeterministicDigest,
  BattleStorySessionAction,
  BattleStorySessionListOptions,
  BattleStorySessionRecord,
} from '@/lib/ai-session/battle-story/types';

const DEFAULT_LIST_LIMIT = 50;

const normalizeLimit = (value: number | undefined, fallback = DEFAULT_LIST_LIMIT): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
};

const buildSessionRange = (sessionId: string): IDBKeyRange => {
  return IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
};

const readByCursor = async <T>(
  requestFactory: () => IDBRequest<IDBCursorWithValue | null>,
  options?: {
    limit?: number;
    filter?: (value: T) => boolean;
  }
): Promise<T[]> => {
  const limit = normalizeLimit(options?.limit);

  return await new Promise<T[]>((resolve, reject) => {
    const items: T[] = [];
    const request = requestFactory();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(items);
        return;
      }

      const value = cursor.value as T;
      const passed = typeof options?.filter === 'function' ? options.filter(value) : true;
      if (passed) {
        items.push(value);
      }

      if (items.length >= limit) {
        resolve(items);
        return;
      }

      cursor.continue();
    };

    request.onerror = () => reject(request.error ?? new Error('IndexedDB 游标读取失败'));
  });
};

export const createBattleStorySessionRecord = (input: {
  title: string;
  source: BattleStorySessionRecord['source'];
  seed: BattleStorySessionRecord['seed'];
  workingCombatants: unknown[];
  lastChapterInputCombatants?: unknown[];
  sessionSummary?: string;
  summaryMeta?: BattleStorySessionRecord['summaryMeta'];
  branchOf?: BattleStorySessionRecord['branchOf'];
}): BattleStorySessionRecord => {
  const now = Date.now();
  const title = (input.title ?? '').trim() || '未命名连续战报';

  return {
    id: randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    source: input.source,
    seed: input.seed,
    workingCombatants: Array.isArray(input.workingCombatants) ? input.workingCombatants : [],
    ...(Array.isArray(input.lastChapterInputCombatants)
      ? { lastChapterInputCombatants: input.lastChapterInputCombatants }
      : {}),
    ...(input.sessionSummary ? { sessionSummary: input.sessionSummary } : {}),
    ...(input.summaryMeta ? { summaryMeta: input.summaryMeta } : {}),
    ...(input.branchOf ? { branchOf: input.branchOf } : {}),
    lastChapterId: null,
    chapterCount: 0,
  };
};

export const createBattleStoryChapterRecord = (input: {
  sessionId: string;
  index: number;
  action: BattleStorySessionAction;
  title: string;
  markdown: string;
  reportJson: Record<string, unknown>;
  cardSnapshot?: BattleStoryChapterRecord['cardSnapshot'];
  deterministicDigest: BattleStoryDeterministicDigest;
  sourceChapterId?: string | null;
  generationId?: string | null;
}): BattleStoryChapterRecord => {
  return {
    id: randomUUID(),
    sessionId: input.sessionId,
    index: Math.max(1, Math.floor(input.index)),
    action: input.action,
    status: 'active',
    ...(input.sourceChapterId ? { sourceChapterId: input.sourceChapterId } : {}),
    ...(input.generationId ? { generationId: input.generationId } : {}),
    title: (input.title ?? '').trim() || input.deterministicDigest.chapterTitle || `第 ${input.index} 章`,
    markdown: input.markdown,
    reportJson: input.reportJson ?? {},
    ...(input.cardSnapshot ? { cardSnapshot: input.cardSnapshot } : {}),
    deterministicDigest: input.deterministicDigest,
    createdAt: Date.now(),
  };
};

export const putBattleStorySession = async (session: BattleStorySessionRecord): Promise<void> => {
  const db = await openAiSessionDb();
  const transaction = db.transaction([AI_SESSION_STORE_NAMES.battleStorySessions], 'readwrite');
  transaction.objectStore(AI_SESSION_STORE_NAMES.battleStorySessions).put(session);
  await transactionToPromise(transaction);
};

export const getBattleStorySession = async (sessionId: string): Promise<BattleStorySessionRecord | null> => {
  const db = await openAiSessionDb();
  const transaction = db.transaction([AI_SESSION_STORE_NAMES.battleStorySessions], 'readonly');
  const request = transaction.objectStore(AI_SESSION_STORE_NAMES.battleStorySessions).get(sessionId);
  const result = await requestToPromise(request);
  await transactionToPromise(transaction);
  return (result as BattleStorySessionRecord | undefined) ?? null;
};

export const updateBattleStorySession = async (
  sessionId: string,
  updater: (session: BattleStorySessionRecord) => BattleStorySessionRecord
): Promise<BattleStorySessionRecord> => {
  const db = await openAiSessionDb();

  return await new Promise<BattleStorySessionRecord>((resolve, reject) => {
    const transaction = db.transaction([AI_SESSION_STORE_NAMES.battleStorySessions], 'readwrite');
    const store = transaction.objectStore(AI_SESSION_STORE_NAMES.battleStorySessions);
    const request = store.get(sessionId);

    transaction.oncomplete = () => undefined;
    transaction.onabort = () => reject(transaction.error ?? new Error('更新 battle story session 失败'));
    transaction.onerror = () => reject(transaction.error ?? new Error('更新 battle story session 失败'));

    request.onsuccess = () => {
      const current = request.result as BattleStorySessionRecord | undefined;
      if (!current) {
        reject(new Error(`未找到 battle story session: ${sessionId}`));
        return;
      }

      const next = updater(current);
      store.put(next);
      resolve(next);
    };

    request.onerror = () => reject(request.error ?? new Error('读取 battle story session 失败'));
  });
};

export const listBattleStorySessions = async (options?: BattleStorySessionListOptions): Promise<BattleStorySessionRecord[]> => {
  const db = await openAiSessionDb();
  const transaction = db.transaction([AI_SESSION_STORE_NAMES.battleStorySessions], 'readonly');
  const store = transaction.objectStore(AI_SESSION_STORE_NAMES.battleStorySessions);
  const direction = options?.direction ?? 'prev';

  const requestFactory = () => {
    if (options?.branchSessionId) {
      const index = store.index('by_branch_session');
      return index.openCursor(IDBKeyRange.only(options.branchSessionId), direction);
    }
    return store.index('by_updatedAt').openCursor(null, direction);
  };

  const result = await readByCursor<BattleStorySessionRecord>(requestFactory, {
    limit: options?.limit,
    filter: (value) => {
      if (options?.includeArchived) return true;
      return typeof value.archivedAt !== 'number';
    },
  });
  await transactionToPromise(transaction);
  return result;
};

export const putBattleStoryChapter = async (chapter: BattleStoryChapterRecord): Promise<void> => {
  const db = await openAiSessionDb();
  const transaction = db.transaction([AI_SESSION_STORE_NAMES.battleStoryChapters], 'readwrite');
  transaction.objectStore(AI_SESSION_STORE_NAMES.battleStoryChapters).put(chapter);
  await transactionToPromise(transaction);
};

export const getBattleStoryChapter = async (chapterId: string): Promise<BattleStoryChapterRecord | null> => {
  const db = await openAiSessionDb();
  const transaction = db.transaction([AI_SESSION_STORE_NAMES.battleStoryChapters], 'readonly');
  const request = transaction.objectStore(AI_SESSION_STORE_NAMES.battleStoryChapters).get(chapterId);
  const result = await requestToPromise(request);
  await transactionToPromise(transaction);
  return (result as BattleStoryChapterRecord | undefined) ?? null;
};

export const listBattleStoryChaptersBySession = async (
  sessionId: string,
  options?: BattleStoryChapterListOptions
): Promise<BattleStoryChapterRecord[]> => {
  const db = await openAiSessionDb();
  const transaction = db.transaction([AI_SESSION_STORE_NAMES.battleStoryChapters], 'readonly');
  const store = transaction.objectStore(AI_SESSION_STORE_NAMES.battleStoryChapters);
  const direction = options?.direction ?? 'next';
  const query = buildSessionRange(sessionId);

  const result = await readByCursor<BattleStoryChapterRecord>(
    () => store.index('by_session_index').openCursor(query, direction),
    {
      limit: options?.limit,
      filter: (value) => {
        if (options?.includeSuperseded) return true;
        return value.status !== 'superseded';
      },
    }
  );

  await transactionToPromise(transaction);
  return result;
};

export const getBattleStoryLatestActiveChapter = async (
  sessionId: string
): Promise<BattleStoryChapterRecord | null> => {
  const items = await listBattleStoryChaptersBySession(sessionId, {
    limit: 1,
    direction: 'prev',
    includeSuperseded: false,
  });
  return items[0] ?? null;
};

export const markBattleStoryChapterSuperseded = async (input: {
  chapterId: string;
  supersededByChapterId: string;
}): Promise<BattleStoryChapterRecord> => {
  const db = await openAiSessionDb();

  return await new Promise<BattleStoryChapterRecord>((resolve, reject) => {
    const transaction = db.transaction([AI_SESSION_STORE_NAMES.battleStoryChapters], 'readwrite');
    const store = transaction.objectStore(AI_SESSION_STORE_NAMES.battleStoryChapters);
    const request = store.get(input.chapterId);

    transaction.onabort = () => reject(transaction.error ?? new Error('标记 superseded 失败'));
    transaction.onerror = () => reject(transaction.error ?? new Error('标记 superseded 失败'));

    request.onsuccess = () => {
      const current = request.result as BattleStoryChapterRecord | undefined;
      if (!current) {
        reject(new Error(`未找到 battle story chapter: ${input.chapterId}`));
        return;
      }

      const next: BattleStoryChapterRecord = {
        ...current,
        status: 'superseded',
        supersededByChapterId: input.supersededByChapterId,
      };

      const putRequest = store.put(next);
      putRequest.onsuccess = () => resolve(next);
      putRequest.onerror = () => reject(putRequest.error ?? new Error('写入 superseded chapter 失败'));
    };

    request.onerror = () => reject(request.error ?? new Error('读取 battle story chapter 失败'));
  });
};
