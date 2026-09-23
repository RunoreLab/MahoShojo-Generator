import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { packWebPackageZip, resolveWebPackage, stageLocalWebPackage, unpackWebPackageZip, type ResolvedWebPackage } from '@mahoshojo/web-package';

const DB_NAME = 'mahoshojo-web-package-cache:v1';
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
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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

/** Best-effort optional cache: failures never block session staging or selection. */
export const putWebPackageArchiveCache = async (pkg: ResolvedWebPackage): Promise<boolean> => {
  try {
    const archive = await packWebPackageZip(pkg);
    const buffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength);
    const db = await openDb();
    const transaction = db.transaction([STORE], 'readwrite');
    transaction.objectStore(STORE).put({
      ref: { ...pkg.ref },
      archive: buffer,
      cachedAt: Date.now(),
    } satisfies WebPackageArchiveCacheEntry);
    await transactionToPromise(transaction);
    db.close();
    return true;
  } catch {
    return false;
  }
};

export const readWebPackageArchiveCache = async (digest: string): Promise<WebPackageArchiveCacheEntry | null> => {
  try {
    const db = await openDb();
    const transaction = db.transaction([STORE], 'readonly');
    const result = await requestToPromise(transaction.objectStore(STORE).get(digest) as IDBRequest<WebPackageArchiveCacheEntry | undefined>);
    await transactionToPromise(transaction);
    db.close();
    return result ?? null;
  } catch {
    return null;
  }
};

export const deleteWebPackageArchiveCache = async (digest: string): Promise<void> => {
  try {
    const db = await openDb();
    const transaction = db.transaction([STORE], 'readwrite');
    transaction.objectStore(STORE).delete(digest);
    await transactionToPromise(transaction);
    db.close();
  } catch {
    // Cache removal is best-effort.
  }
};

/** Current-session staging from optional cache; integrity always re-runs unpack/verify. */
export const hydrateWebPackageSessionFromCache = async (): Promise<number> => {
  try {
    const db = await openDb();
    const transaction = db.transaction([STORE], 'readonly');
    const entries = await requestToPromise(transaction.objectStore(STORE).getAll() as IDBRequest<WebPackageArchiveCacheEntry[]>);
    await transactionToPromise(transaction);
    db.close();
    let staged = 0;
    for (const entry of entries ?? []) {
      try {
        const pkg = await unpackWebPackageZip(new Uint8Array(entry.archive));
        if (pkg.ref.digest !== entry.ref.digest) continue;
        stageLocalWebPackage(pkg);
        staged += 1;
      } catch {
        // Drop corrupted cache rows silently; user can re-import.
      }
    }
    return staged;
  } catch {
    return 0;
  }
};

export const importLocalWebPackageArchive = async (archive: Uint8Array): Promise<ResolvedWebPackage> => {
  const pkg = await unpackWebPackageZip(archive);
  stageLocalWebPackage(pkg);
  void putWebPackageArchiveCache(pkg);
  return pkg;
};

export const resolveSelectedWebPackage = (ref: WebPackageRef | null | undefined): Promise<ResolvedWebPackage> => {
  if (!ref) return Promise.reject(new Error('未选择 Web 包'));
  return resolveWebPackage(ref);
};
