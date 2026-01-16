import type { MagicTavernMessage, MagicTavernSession, MagicTavernTachieAsset } from '@/lib/magic-tavern/types';

const DB_NAME = 'magic-tavern:v1';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

const ensureBrowser = () => {
  if (typeof window === 'undefined') {
    throw new Error('Magic Tavern 本地存储仅支持在浏览器端使用。');
  }
  if (!('indexedDB' in window)) {
    throw new Error('当前浏览器不支持 IndexedDB，无法使用魔法酒馆本地存储。');
  }
};

export const openMagicTavernDb = async (): Promise<IDBDatabase> => {
  ensureBrowser();

  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('sessions')) {
        const store = db.createObjectStore('sessions', { keyPath: 'id' });
        store.createIndex('by_updatedAt', 'updatedAt');
      }

      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id' });
        store.createIndex('by_sessionId', 'sessionId');
        store.createIndex('by_session_createdAt', ['sessionId', 'createdAt']);
      }

      if (!db.objectStoreNames.contains('tachieAssets')) {
        const store = db.createObjectStore('tachieAssets', { keyPath: 'id' });
        store.createIndex('by_sessionId', 'sessionId');
        store.createIndex('by_cacheKey', 'cacheKey');
        store.createIndex('by_roleId', 'roleId');
        store.createIndex('by_lastUsedAt', 'lastUsedAt');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开 IndexedDB 失败'));
  });

  return dbPromise;
};

export const putMagicTavernSession = async (session: MagicTavernSession): Promise<void> => {
  const db = await openMagicTavernDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['sessions'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('保存会话失败'));
    tx.onerror = () => reject(tx.error ?? new Error('保存会话失败'));
    tx.objectStore('sessions').put(session);
  });
};

export const getMagicTavernSession = async (sessionId: string): Promise<MagicTavernSession | null> => {
  const db = await openMagicTavernDb();
  return await new Promise<MagicTavernSession | null>((resolve, reject) => {
    const tx = db.transaction(['sessions'], 'readonly');
    tx.onabort = () => reject(tx.error ?? new Error('读取会话失败'));
    tx.onerror = () => reject(tx.error ?? new Error('读取会话失败'));
    const request = tx.objectStore('sessions').get(sessionId);
    request.onsuccess = () => resolve((request.result as MagicTavernSession | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('读取会话失败'));
  });
};

export const listMagicTavernSessions = async (options?: { limit?: number }): Promise<MagicTavernSession[]> => {
  const limit = typeof options?.limit === 'number' && Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : 50;
  const db = await openMagicTavernDb();
  return await new Promise<MagicTavernSession[]>((resolve, reject) => {
    const tx = db.transaction(['sessions'], 'readonly');
    tx.onabort = () => reject(tx.error ?? new Error('读取会话列表失败'));
    tx.onerror = () => reject(tx.error ?? new Error('读取会话列表失败'));

    const sessions: MagicTavernSession[] = [];
    const index = tx.objectStore('sessions').index('by_updatedAt');
    const request = index.openCursor(null, 'prev');

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(sessions);
        return;
      }
      sessions.push(cursor.value as MagicTavernSession);
      if (sessions.length >= limit) {
        resolve(sessions);
        return;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('读取会话列表失败'));
  });
};

export const deleteMagicTavernSession = async (sessionId: string): Promise<void> => {
  const db = await openMagicTavernDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['sessions', 'messages', 'tachieAssets'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('删除会话失败'));
    tx.onerror = () => reject(tx.error ?? new Error('删除会话失败'));

    tx.objectStore('sessions').delete(sessionId);

    const deleteByIndex = (store: IDBObjectStore, indexName: string) => {
      const index = store.index(indexName);
      const request = index.openCursor(IDBKeyRange.only(sessionId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => {
        try {
          tx.abort();
        } catch {
          // ignore
        }
      };
    };

    deleteByIndex(tx.objectStore('messages'), 'by_sessionId');
    deleteByIndex(tx.objectStore('tachieAssets'), 'by_sessionId');
  });
};

export const putMagicTavernMessage = async (message: MagicTavernMessage): Promise<void> => {
  const db = await openMagicTavernDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['messages'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('保存消息失败'));
    tx.onerror = () => reject(tx.error ?? new Error('保存消息失败'));
    tx.objectStore('messages').put(message);
  });
};

export const listMagicTavernMessages = async (sessionId: string): Promise<MagicTavernMessage[]> => {
  const db = await openMagicTavernDb();
  return await new Promise<MagicTavernMessage[]>((resolve, reject) => {
    const tx = db.transaction(['messages'], 'readonly');
    tx.onabort = () => reject(tx.error ?? new Error('读取消息失败'));
    tx.onerror = () => reject(tx.error ?? new Error('读取消息失败'));

    const messages: MagicTavernMessage[] = [];
    const index = tx.objectStore('messages').index('by_session_createdAt');
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
    const request = index.openCursor(range, 'next');

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(messages);
        return;
      }
      messages.push(cursor.value as MagicTavernMessage);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('读取消息失败'));
  });
};

export const putMagicTavernTachieAsset = async (asset: MagicTavernTachieAsset): Promise<void> => {
  const db = await openMagicTavernDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tachieAssets'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('保存立绘缓存失败'));
    tx.onerror = () => reject(tx.error ?? new Error('保存立绘缓存失败'));
    tx.objectStore('tachieAssets').put(asset);
  });
};

export const listMagicTavernTachieAssets = async (sessionId: string): Promise<MagicTavernTachieAsset[]> => {
  const db = await openMagicTavernDb();
  return await new Promise<MagicTavernTachieAsset[]>((resolve, reject) => {
    const tx = db.transaction(['tachieAssets'], 'readonly');
    tx.onabort = () => reject(tx.error ?? new Error('读取立绘缓存失败'));
    tx.onerror = () => reject(tx.error ?? new Error('读取立绘缓存失败'));

    const items: MagicTavernTachieAsset[] = [];
    const index = tx.objectStore('tachieAssets').index('by_sessionId');
    const request = index.openCursor(IDBKeyRange.only(sessionId), 'next');

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(items.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)));
        return;
      }
      items.push(cursor.value as MagicTavernTachieAsset);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('读取立绘缓存失败'));
  });
};

export const deleteMagicTavernTachieAsset = async (assetId: string): Promise<void> => {
  const db = await openMagicTavernDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tachieAssets'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('删除立绘缓存失败'));
    tx.onerror = () => reject(tx.error ?? new Error('删除立绘缓存失败'));
    tx.objectStore('tachieAssets').delete(assetId);
  });
};

export const deleteMagicTavernTachieAssets = async (sessionId: string): Promise<void> => {
  const db = await openMagicTavernDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tachieAssets'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('删除立绘缓存失败'));
    tx.onerror = () => reject(tx.error ?? new Error('删除立绘缓存失败'));

    const store = tx.objectStore('tachieAssets');
    const index = store.index('by_sessionId');
    const request = index.openCursor(IDBKeyRange.only(sessionId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => {
      try {
        tx.abort();
      } catch {
        // ignore
      }
    };
  });
};
