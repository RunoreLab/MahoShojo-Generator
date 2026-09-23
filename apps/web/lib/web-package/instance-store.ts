import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import type { WebPackageResourceFile, WebPackageResourceSnapshot } from '@mahoshojo/web-package';

const DB_NAME = 'mahoshojo-web-package-instances:v1';
const DB_VERSION = 1;
const STORE = 'instances';

export type WebPackageInstanceRecord = Readonly<{
  instanceId: string;
  packageRef: WebPackageRef;
  entry: string;
  createdAt: number;
  files: ReadonlyArray<Readonly<{ path: string; mediaType: string; bytes: ArrayBuffer }>>;
}>;

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
        db.createObjectStore(STORE, { keyPath: 'instanceId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开 Web 包实例库失败'));
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

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => (
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
);

export const serializeWebPackageResourceSnapshot = (snapshot: WebPackageResourceSnapshot): WebPackageInstanceRecord => ({
  instanceId: snapshot.instanceId,
  packageRef: { ...snapshot.packageRef },
  entry: snapshot.entry,
  createdAt: Date.now(),
  files: [...snapshot.files].map(([path, file]) => ({
    path,
    mediaType: file.mediaType,
    bytes: toArrayBuffer(file.bytes),
  })),
});

export const deserializeWebPackageInstanceRecord = (record: WebPackageInstanceRecord): WebPackageResourceSnapshot => ({
  instanceId: record.instanceId,
  packageRef: { ...record.packageRef },
  entry: record.entry,
  files: new Map<string, WebPackageResourceFile>(
    record.files.map((file) => [file.path, {
      mediaType: file.mediaType,
      bytes: new Uint8Array(file.bytes.slice(0)),
    }]),
  ),
});

export const putWebPackageInstance = async (snapshot: WebPackageResourceSnapshot): Promise<void> => {
  const db = await openDb();
  const transaction = db.transaction([STORE], 'readwrite');
  transaction.objectStore(STORE).put(serializeWebPackageResourceSnapshot(snapshot));
  await transactionToPromise(transaction);
  db.close();
};

export const readWebPackageInstance = async (instanceId: string): Promise<WebPackageResourceSnapshot | null> => {
  try {
    const db = await openDb();
    const transaction = db.transaction([STORE], 'readonly');
    const record = await requestToPromise(
      transaction.objectStore(STORE).get(instanceId) as IDBRequest<WebPackageInstanceRecord | undefined>,
    );
    await transactionToPromise(transaction);
    db.close();
    return record ? deserializeWebPackageInstanceRecord(record) : null;
  } catch {
    return null;
  }
};

export const deleteWebPackageInstance = async (instanceId: string): Promise<void> => {
  try {
    const db = await openDb();
    const transaction = db.transaction([STORE], 'readwrite');
    transaction.objectStore(STORE).delete(instanceId);
    await transactionToPromise(transaction);
    db.close();
  } catch {
    // Instance removal is best-effort (session storage only).
  }
};

/** Drop every stored instance that is not currently mounted, so reloads cannot accumulate full package copies. */
export const gcWebPackageInstances = async (keepInstanceIds: readonly string[]): Promise<void> => {
  try {
    const keep = new Set(keepInstanceIds);
    const db = await openDb();
    const transaction = db.transaction([STORE], 'readwrite');
    const store = transaction.objectStore(STORE);
    const all = await requestToPromise(store.getAllKeys() as IDBRequest<IDBValidKey[]>);
    for (const key of all) {
      if (typeof key === 'string' && !keep.has(key)) store.delete(key);
    }
    await transactionToPromise(transaction);
    db.close();
  } catch {
    // GC is best-effort; storage failures never block rendering.
  }
};

export const clearWebPackageInstances = async (): Promise<void> => {
  try {
    const db = await openDb();
    const transaction = db.transaction([STORE], 'readwrite');
    transaction.objectStore(STORE).clear();
    await transactionToPromise(transaction);
    db.close();
  } catch {
    // Clearing is best-effort.
  }
};
