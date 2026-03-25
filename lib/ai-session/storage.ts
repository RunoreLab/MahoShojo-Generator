import { AI_SESSION_DB_NAME, AI_SESSION_DB_VERSION, AI_SESSION_STORE_NAMES } from '@/lib/ai-session/types';

let dbPromise: Promise<IDBDatabase> | null = null;

const ensureBrowserStorage = (): void => {
  if (typeof window === 'undefined') {
    throw new Error('AI 会话本地存储仅支持在浏览器端使用。');
  }
  if (!('indexedDB' in window)) {
    throw new Error('当前浏览器不支持 IndexedDB，无法使用 AI 会话本地存储。');
  }
};

const openAiSessionDbInternal = (): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(AI_SESSION_DB_NAME, AI_SESSION_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(AI_SESSION_STORE_NAMES.battleStorySessions)) {
        const store = db.createObjectStore(AI_SESSION_STORE_NAMES.battleStorySessions, { keyPath: 'id' });
        store.createIndex('by_updatedAt', 'updatedAt');
        store.createIndex('by_branch_session', 'branchOf.sessionId');
      }

      if (!db.objectStoreNames.contains(AI_SESSION_STORE_NAMES.battleStoryChapters)) {
        const store = db.createObjectStore(AI_SESSION_STORE_NAMES.battleStoryChapters, { keyPath: 'id' });
        store.createIndex('by_session_index', ['sessionId', 'index']);
        store.createIndex('by_session_createdAt', ['sessionId', 'createdAt']);
        store.createIndex('by_sourceChapterId', 'sourceChapterId');
      }

      if (!db.objectStoreNames.contains(AI_SESSION_STORE_NAMES.battleStoryCheckpoints)) {
        const store = db.createObjectStore(AI_SESSION_STORE_NAMES.battleStoryCheckpoints, { keyPath: 'id' });
        store.createIndex('by_session_boundary', ['sessionId', 'boundaryIndex'], { unique: true });
        store.createIndex('by_session_createdAt', ['sessionId', 'createdAt']);
      }

      if (!db.objectStoreNames.contains(AI_SESSION_STORE_NAMES.cardEditSessions)) {
        const store = db.createObjectStore(AI_SESSION_STORE_NAMES.cardEditSessions, { keyPath: 'id' });
        store.createIndex('by_updatedAt', 'updatedAt');
        store.createIndex('by_template_updatedAt', ['template', 'updatedAt']);
      }

      if (!db.objectStoreNames.contains(AI_SESSION_STORE_NAMES.cardEditCheckpoints)) {
        const store = db.createObjectStore(AI_SESSION_STORE_NAMES.cardEditCheckpoints, { keyPath: 'id' });
        store.createIndex('by_session_createdAt', ['sessionId', 'createdAt']);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开 AI 会话 IndexedDB 失败'));
  });

export const openAiSessionDb = async (): Promise<IDBDatabase> => {
  ensureBrowserStorage();

  if (dbPromise) return dbPromise;

  dbPromise = openAiSessionDbInternal();
  return dbPromise;
};

export const requestToPromise = async <T>(request: IDBRequest<T>): Promise<T> =>
  await new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });

export const transactionToPromise = async (transaction: IDBTransaction): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
  });
