import {
  WEB_PACKAGE_INSTANCE_PREFIX,
  WEB_PACKAGE_SERVICE_WORKER_PATH,
  WEB_PACKAGE_SERVICE_WORKER_SCOPE,
  createWebPackageResourceResponse,
  parseWebPackageInstancePath,
} from '@mahoshojo/web-package';
import type { WebPackageInstanceRecord, WebPackageResourceFile, WebPackageResourceSnapshot } from './types';

const DB_NAME = 'mahoshojo-web-package-instances:v1';
const DB_VERSION = 1;
const STORE = 'instances';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'instanceId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('open instance db failed'));
  });

const readInstance = async (instanceId: string): Promise<WebPackageResourceSnapshot | null> => {
  try {
    const db = await openDb();
    const transaction = db.transaction([STORE], 'readonly');
    const record = await new Promise<WebPackageInstanceRecord | undefined>((resolve, reject) => {
      const request = transaction.objectStore(STORE).get(instanceId) as IDBRequest<WebPackageInstanceRecord | undefined>;
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('read instance failed'));
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('transaction failed'));
    });
    db.close();
    if (!record) return null;
    return {
      instanceId: record.instanceId,
      packageRef: record.packageRef,
      entry: record.entry,
      files: new Map<string, WebPackageResourceFile>(
        record.files.map((file) => [file.path, {
          mediaType: file.mediaType,
          bytes: new Uint8Array(file.bytes.slice(0)),
        }]),
      ),
    };
  } catch {
    return null;
  }
};

const notFound = (): Response => new Response('Not Found', {
  status: 404,
  headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  },
});

const handleRequest = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return fetch(request);
  if (!url.pathname.startsWith(WEB_PACKAGE_INSTANCE_PREFIX)) return fetch(request);
  const parsed = parseWebPackageInstancePath(url.pathname);
  if (!parsed) return notFound();
  const snapshot = await readInstance(parsed.instanceId);
  if (!snapshot) return notFound();
  return createWebPackageResourceResponse(snapshot, url.pathname);
};

type WorkerScope = {
  location: { origin: string };
  skipWaiting: () => Promise<void>;
  clients: { claim: () => Promise<void> };
  addEventListener: (type: 'install' | 'activate' | 'fetch', listener: (event: unknown) => void) => void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.addEventListener('install', () => {
  void workerScope.skipWaiting();
});

workerScope.addEventListener('activate', (event) => {
  (event as { waitUntil: (_promise: Promise<unknown>) => void }).waitUntil(workerScope.clients.claim());
});

workerScope.addEventListener('fetch', (event) => {
  const fetchEvent = event as {
    request: Request;
    respondWith: (_response: Response | Promise<Response>) => void;
  };
  if (fetchEvent.request.method !== 'GET') return;
  const url = new URL(fetchEvent.request.url);
  if (url.origin !== workerScope.location.origin) return;
  if (!url.pathname.startsWith(WEB_PACKAGE_INSTANCE_PREFIX)) return;
  fetchEvent.respondWith(handleRequest(fetchEvent.request));
});

// Keep path constants referenced for bundlers that tree-shake unused exports.
void WEB_PACKAGE_SERVICE_WORKER_PATH;
void WEB_PACKAGE_SERVICE_WORKER_SCOPE;
