import {
  importWebPackageArchive,
  stageLocalWebPackage,
  unpackWebPackageZip,
  type ResolvedWebPackage,
} from '@mahoshojo/web-package';
import type { WebPackageRef } from '@mahoshojo/contracts/web-package';

/**
 * 旧 Web 包缓存（`mahoshojo-web-package-cache:v1`）的读取桥。
 *
 * 这个库**不是**本地库。ADR-local-library-data-ownership §4 要求本地库使用独立
 * IndexedDB，旧缓存无上限、无 eviction、也没有任何用户可见的删除入口，把它原地
 * 升格等于把这些缺陷一并继承下来。因此这里只保留读取与清空，供一次性迁移使用；
 * 新的读写一律走 `@/lib/local-library/web-package-library`。
 */

export const LEGACY_WEB_PACKAGE_CACHE_DB_NAME = 'mahoshojo-web-package-cache:v1' as const;
const DB_VERSION = 1;
const STORE = 'archives';

export type WebPackageArchiveCacheEntry = {
  ref: WebPackageRef;
  archive: ArrayBuffer;
  cachedAt: number;
};

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const request = indexedDB.open(LEGACY_WEB_PACKAGE_CACHE_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'ref.digest' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开 Web 包缓存失败'));
  });

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });

const transactionToPromise = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
  });

/** 读取旧缓存的全部条目。失败时抛错，调用方据此保留旧数据而不是当作空库。 */
export const readAllWebPackageArchiveCache = async (): Promise<WebPackageArchiveCacheEntry[]> => {
  const db = await openDb();
  try {
    const transaction = db.transaction([STORE], 'readonly');
    const entries = await requestToPromise(transaction.objectStore(STORE).getAll() as IDBRequest<WebPackageArchiveCacheEntry[]>);
    await transactionToPromise(transaction);
    return entries ?? [];
  } finally {
    db.close();
  }
};

/** 迁移成功后清空旧表；读不到时返回 false，调用方据此保留旧数据。 */
export const drainWebPackageArchiveCache = async (): Promise<boolean> => {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const transaction = db.transaction([STORE], 'readwrite');
    transaction.objectStore(STORE).clear();
    await transactionToPromise(transaction);
    return true;
  } catch {
    return false;
  } finally {
    // 这条路径失败后会被下次挂载重试；漏掉 close 会让连接一直挂着。
    db?.close();
  }
};

export type LocalWebPackageImport = Readonly<{
  pkg: ResolvedWebPackage;
  /** 值得让用户看到的归一化与缺省填充。 */
  diagnostics: readonly string[];
}>;

/**
 * 导入用户提供的 ZIP；diagnostics 交给 UI 呈现，而不是静默吞掉。
 *
 * 只写 session staging。是否落本地库由调用方按用户偏好决定；这里不再无条件写旧缓存。
 */
export const importLocalWebPackageArchive = async (archive: Uint8Array): Promise<LocalWebPackageImport> => {
  const { pkg, diagnostics } = await importWebPackageArchive(archive);
  stageLocalWebPackage(pkg);
  return { pkg, diagnostics };
};

/** 校验一段 ZIP 字节是否确实是它自称的那个包；迁移时用来拒绝身份不符的行。 */
export const verifyCachedWebPackageArchive = async (
  entry: WebPackageArchiveCacheEntry,
): Promise<ResolvedWebPackage | null> => {
  try {
    const pkg = await unpackWebPackageZip(new Uint8Array(entry.archive));
    if (pkg.ref.digest !== entry.ref.digest) return null;
    return pkg;
  } catch {
    return null;
  }
};
