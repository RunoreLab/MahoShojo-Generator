import { isBinaryPayload } from '@mahoshojo/local-library/web-package-record';

/**
 * Web 本地库存储（ADR-local-library-data-ownership §4 / LIB-002）。
 *
 * 独立 IndexedDB，不复用 AI session DB、公开卡 cache、rank cache 或 localStorage。
 * 记录契约与仓储端口来自 `@mahoshojo/local-library`；本模块只负责把那些
 * runtime-neutral 的形状落到浏览器的实际存储上。
 */

export const LOCAL_LIBRARY_DB_NAME = 'mahoshojo-local-library' as const;
export const LOCAL_LIBRARY_DB_VERSION = 1;

export const LOCAL_LIBRARY_STORE_NAMES = {
  dataCards: 'data-cards',
  webPackages: 'web-packages',
  webPackageArchives: 'web-package-archives',
  meta: 'meta',
} as const;

export type LocalLibraryStoreName =
  (typeof LOCAL_LIBRARY_STORE_NAMES)[keyof typeof LOCAL_LIBRARY_STORE_NAMES];

export const LOCAL_LIBRARY_INDEX_NAMES = {
  byUpdatedAt: 'by_updatedAt',
  byCardType: 'by_cardType',
  byDigest: 'by_digest',
} as const;

/** IndexedDB 版本号即本地库 schema 版本；升级时由它触发 `onupgradeneeded`。 */
export const LOCAL_LIBRARY_SCHEMA_VERSION: number = LOCAL_LIBRARY_DB_VERSION;

export const LOCAL_LIBRARY_META_KEYS = {
  schemaVersion: 'schemaVersion',
  legacyWebPackageCacheMigratedAt: 'legacyWebPackageCacheMigratedAt',
} as const;

export const LocalLibraryUnavailableError = class extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalLibraryUnavailableError';
  }
};

const assertBrowserStorage = (): void => {
  if (typeof window === 'undefined') {
    throw new LocalLibraryUnavailableError('本地库仅支持在浏览器端使用。');
  }
  if (typeof window.indexedDB === 'undefined') {
    throw new LocalLibraryUnavailableError('当前浏览器不支持 IndexedDB，无法使用本地库。');
  }
};

let dbPromise: Promise<IDBDatabase> | null = null;

const openLocalLibraryDbInternal = (): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(LOCAL_LIBRARY_DB_NAME, LOCAL_LIBRARY_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(LOCAL_LIBRARY_STORE_NAMES.dataCards)) {
        const store = db.createObjectStore(LOCAL_LIBRARY_STORE_NAMES.dataCards, { keyPath: 'id' });
        // 复合键让分页在 updatedAt 并列时仍然有确定顺序；纯 updatedAt 索引会让同一毫秒
        // 写入的记录在翻页时可能重复或漏掉。
        store.createIndex(LOCAL_LIBRARY_INDEX_NAMES.byUpdatedAt, ['updatedAt', 'id']);
        store.createIndex(LOCAL_LIBRARY_INDEX_NAMES.byCardType, 'cardType');
      }

      if (!db.objectStoreNames.contains(LOCAL_LIBRARY_STORE_NAMES.webPackages)) {
        const store = db.createObjectStore(LOCAL_LIBRARY_STORE_NAMES.webPackages, { keyPath: 'id' });
        store.createIndex(LOCAL_LIBRARY_INDEX_NAMES.byUpdatedAt, ['updatedAt', 'id']);
        store.createIndex(LOCAL_LIBRARY_INDEX_NAMES.byDigest, 'contentDigest', { unique: true });
      }

      // ZIP 字节与记录分表：列表查询不必反序列化包内容。
      if (!db.objectStoreNames.contains(LOCAL_LIBRARY_STORE_NAMES.webPackageArchives)) {
        db.createObjectStore(LOCAL_LIBRARY_STORE_NAMES.webPackageArchives, { keyPath: 'digest' });
      }

      if (!db.objectStoreNames.contains(LOCAL_LIBRARY_STORE_NAMES.meta)) {
        db.createObjectStore(LOCAL_LIBRARY_STORE_NAMES.meta, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // 另一个标签页升级 schema 时必须让本连接放手，否则它会永久阻塞后续 upgrade。
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new LocalLibraryUnavailableError('无法打开本地库数据库。'));
    request.onblocked = () =>
      reject(new LocalLibraryUnavailableError('本地库数据库被其他标签页占用，请关闭其它页面后重试。'));
  });

/** IndexedDB 不可用时降级为不可用错误，而不是让调用方拿到未处理的 DOMException。 */
export const openLocalLibraryDb = async (): Promise<IDBDatabase> => {
  assertBrowserStorage();
  dbPromise ??= openLocalLibraryDbInternal().catch((error: unknown) => {
    dbPromise = null;
    throw error instanceof Error ? error : new LocalLibraryUnavailableError('无法打开本地库数据库。');
  });
  return dbPromise;
};

/** 测试与“用户要求彻底忘记本地库”场景使用；正常路径不应调用。 */
export const resetLocalLibraryDbConnection = (): void => {
  dbPromise = null;
};

const promisifyRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败。'));
  });

export const runLocalLibraryTransaction = async <T>(
  stores: LocalLibraryStoreName | LocalLibraryStoreName[],
  mode: IDBTransactionMode,
  body: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> => {
  const db = await openLocalLibraryDb();
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(stores, mode);
    } catch (error) {
      reject(error);
      return;
    }
    let result: T;
    let settled = false;
    transaction.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    transaction.onerror = () => {
      if (!settled) {
        settled = true;
        reject(transaction.error ?? new Error('本地库事务失败。'));
      }
    };
    transaction.onabort = () => {
      if (!settled) {
        settled = true;
        reject(transaction.error ?? new Error('本地库事务已中止。'));
      }
    };
    void (async () => {
      try {
        result = await body(transaction);
      } catch (error) {
        settled = true;
        try {
          transaction.abort();
        } catch {
          // 事务可能已因请求失败而结束；原始错误更有诊断价值。
        }
        reject(error);
      }
    })();
  });
};

export const getLocalLibraryRecord = <T>(
  store: IDBObjectStore | IDBIndex,
  key: IDBValidKey,
): Promise<T | undefined> => promisifyRequest(store.get(key) as IDBRequest<T | undefined>);

export const getAllLocalLibraryRecords = <T>(
  store: IDBObjectStore | IDBIndex,
  query?: IDBValidKey | IDBKeyRange | null,
): Promise<T[]> => promisifyRequest(store.getAll(query) as IDBRequest<T[]>);

export const putLocalLibraryRecord = <T>(store: IDBObjectStore, value: T): Promise<IDBValidKey> =>
  promisifyRequest(store.put(value as unknown as Record<string, unknown>));

export const deleteLocalLibraryRecord = (store: IDBObjectStore, key: IDBValidKey): Promise<undefined> =>
  promisifyRequest(store.delete(key) as IDBRequest<undefined>);

/**
 * 记录契约要求 `createdAt <= updatedAt <= deletedAt`。系统时钟回拨（用户改时间、
 * NTP 校正）会让 `new Date()` 落在 createdAt 之前，于是软删会写出一条自身非法的行。
 * 这里把写入时间抬到既有 updatedAt 之上：tombstone 仍然是单调的，也不会撒谎。
 */
export const monotonicNowIso = (previousUpdatedAt: string | undefined): string => {
  const now = new Date().toISOString();
  if (previousUpdatedAt === undefined) return now;
  return Date.parse(now) < Date.parse(previousUpdatedAt) ? previousUpdatedAt : now;
};

/**
 * 契约的 `isBinaryPayload` 与这里的读取必须用同一条判定。
 * 分成两份的话，收紧契约不会传导到实现，或者反过来出现"schema 通过但读不出来"。
 */
export const toStoredBytes = (value: unknown): Uint8Array | null => {
  if (!isBinaryPayload(value)) return null;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength);
  }
  try {
    return new Uint8Array(value);
  } catch {
    return null;
  }
};

/** 精确切片：传入的视图可能来自更大的底层缓冲，直接持久化会把整块内存一起写进去。 */
export const toDetachedArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};
