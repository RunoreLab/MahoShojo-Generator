// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getLocalLibraryRecord,
  LOCAL_LIBRARY_DB_NAME,
  LOCAL_LIBRARY_STORE_NAMES,
  openLocalLibraryDb,
  putLocalLibraryRecord,
  resetLocalLibraryDbConnection,
  runLocalLibraryTransaction,
} from '@/lib/local-library/db';
import { probeLocalLibraryStorage } from '@/lib/local-library/storage-probe';

let openedDatabase: IDBDatabase | null = null;

const deleteLocalLibraryDatabase = (): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_LIBRARY_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });

beforeEach(async () => {
  resetLocalLibraryDbConnection();
  await deleteLocalLibraryDatabase();
});

afterEach(() => {
  openedDatabase?.close();
  openedDatabase = null;
  resetLocalLibraryDbConnection();
});

describe('Web local library storage probe', () => {
  it('keeps the shared IndexedDB connection usable for a transaction after probing', async () => {
    await expect(probeLocalLibraryStorage()).resolves.toBeNull();
    openedDatabase = await openLocalLibraryDb();

    const marker = { key: 'probe-sentinel', value: 'usable', recordedAt: '2026-10-03T00:00:00.000Z' };
    await expect(
      runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.meta, 'readwrite', (transaction) =>
        putLocalLibraryRecord(transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.meta), marker),
      ),
    ).resolves.toBe(marker.key);

    await expect(
      runLocalLibraryTransaction(LOCAL_LIBRARY_STORE_NAMES.meta, 'readonly', (transaction) =>
        getLocalLibraryRecord<typeof marker>(transaction.objectStore(LOCAL_LIBRARY_STORE_NAMES.meta), marker.key),
      ),
    ).resolves.toEqual(marker);
  });
});
