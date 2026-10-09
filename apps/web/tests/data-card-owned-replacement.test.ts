import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { getOwnedReplacementVersion, readOwnedReplacementSnapshot, replaceOwnedDataCardAtomically } from '@/lib/db/repositories/data-card-owned-replacement';
import * as schema from '@/lib/db/schema';

let sqlite: Database;
let db: AppDrizzleDb;
const pending = () => sqlite.exec(`INSERT INTO data_card_updates VALUES ('p','c',7,'待审名',NULL,'{"pending":1}',NULL,'same-second')`);
const read = () => readOwnedReplacementSnapshot(db, 'c', 7);
beforeEach(() => {
  sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;
  sqlite.exec(`CREATE TABLE data_cards (
    id TEXT PRIMARY KEY,user_id INTEGER,type TEXT,name TEXT,description TEXT,data TEXT,
    is_public INTEGER,review_status TEXT,updated_at TEXT,deleted_at TEXT,favorite_count INTEGER,usage_count INTEGER);
    CREATE TABLE data_card_updates (id TEXT PRIMARY KEY,data_card_id TEXT UNIQUE,user_id INTEGER,name TEXT,description TEXT,data TEXT,created_at TEXT,updated_at TEXT);
    INSERT INTO data_cards VALUES ('c',7,'character','名称',NULL,'{"old":1}',0,'pending','same-second',NULL,0,0);`);
});
afterEach(() => sqlite.close());

describe('owned replacement real SQLite CAS', () => {
  test('single direct statement replaces content and preserves current metadata', async () => {
    const snapshot = (await read())!;
    expect(await replaceOwnedDataCardAtomically(db, snapshot, '{"new":1}', false)).toBe(true);
    expect(sqlite.prepare('SELECT name,description,data,is_public FROM data_cards').get()).toEqual({ name: '名称', description: null, data: '{"new":1}', is_public: 0 });
    expect(await replaceOwnedDataCardAtomically(db, snapshot, '{"stale":1}', false)).toBe(false);
  });
  test('pending absent insert and present update preserve main metadata, not old pending metadata', async () => {
    const first = (await read())!;
    expect(await replaceOwnedDataCardAtomically(db, first, '{"new":1}', true)).toBe(true);
    expect(await replaceOwnedDataCardAtomically(db, first, '{"stale":1}', true)).toBe(false);
    const second = (await read())!;
    expect(second.pending_id).not.toBeNull();
    expect(await replaceOwnedDataCardAtomically(db, second, '{"newer":1}', true)).toBe(true);
    expect(sqlite.prepare('SELECT name,description,data FROM data_card_updates').get()).toEqual({ name: '名称', description: null, data: '{"newer":1}' });
    expect(sqlite.prepare('SELECT data FROM data_cards').get()).toEqual({ data: '{"old":1}' });
  });
  test.each([
    `UPDATE data_cards SET data='{"other":1}'`,
    `UPDATE data_cards SET name='另一个名'`,
    `UPDATE data_cards SET description=''`,
    `UPDATE data_cards SET user_id=8`,
    `UPDATE data_cards SET type='scenario'`,
    `UPDATE data_cards SET is_public=-1`,
    `UPDATE data_cards SET review_status='approved'`,
    `UPDATE data_cards SET deleted_at='deleted'`,
    `DELETE FROM data_cards`,
    `INSERT INTO data_card_updates VALUES ('p','c',7,NULL,NULL,'{}',NULL,NULL)`,
  ])('same-second main/pending change cannot be overwritten: %s', async (mutation) => {
    const snapshot = (await read())!;
    sqlite.exec(mutation);
    const before = sqlite.prepare('SELECT * FROM data_cards').all();
    const beforePending = sqlite.prepare('SELECT * FROM data_card_updates').all();
    expect(await replaceOwnedDataCardAtomically(db, snapshot, '{"stale":1}', false)).toBe(false);
    expect(await replaceOwnedDataCardAtomically(db, snapshot, '{"stale":1}', true)).toBe(false);
    expect(sqlite.prepare('SELECT * FROM data_cards').all()).toEqual(before);
    expect(sqlite.prepare('SELECT * FROM data_card_updates').all()).toEqual(beforePending);
  });
  test.each([
    `DELETE FROM data_card_updates`,
    `UPDATE data_card_updates SET data='{"other":1}'`,
    `UPDATE data_card_updates SET description=''`,
    `UPDATE data_card_updates SET name=NULL`,
    `UPDATE data_card_updates SET user_id=8`,
    `UPDATE data_card_updates SET created_at='other'`,
    `UPDATE data_card_updates SET id='other'`,
  ])('existing pending snapshot is checked within actual upsert: %s', async (mutation) => {
    pending(); const snapshot = (await read())!;
    sqlite.exec(mutation);
    expect(await replaceOwnedDataCardAtomically(db, snapshot, '{"stale":1}', true)).toBe(false);
    expect(await replaceOwnedDataCardAtomically(db, snapshot, '{"stale":1}', false)).toBe(false);
  });
  test('version covers real values including pending but not engagement counters', async () => {
    const first = await getOwnedReplacementVersion((await read())!);
    sqlite.exec('UPDATE data_cards SET usage_count=10');
    expect(await getOwnedReplacementVersion((await read())!)).toBe(first);
    sqlite.exec(`UPDATE data_cards SET data='{"sameSecond":true}'`);
    const second = await getOwnedReplacementVersion((await read())!);
    expect(second).not.toBe(first); expect(second).toMatch(/^[a-f0-9]{64}$/);
    pending(); expect(await getOwnedReplacementVersion((await read())!)).not.toBe(second);
  });
  test('does not expose another owner or deleted target', async () => {
    expect(await readOwnedReplacementSnapshot(db, 'c', 8)).toBeNull();
    sqlite.exec(`UPDATE data_cards SET deleted_at='deleted'`); expect(await read()).toBeNull();
  });
  test('constraint failure rolls back the entire statement', async () => {
    const snapshot = (await read())!;
    sqlite.exec(`CREATE TRIGGER fail_content BEFORE UPDATE ON data_cards BEGIN SELECT RAISE(ABORT, 'failed'); END;`);
    await expect(replaceOwnedDataCardAtomically(db, snapshot, '{"new":1}', false)).rejects.toThrow();
    expect((await read())!.data).toBe(snapshot.data);
  });
  test('actual D1 Drizzle adapter consumes single bounded statement and RETURNING rows', async () => {
    const queries: Array<{ text: string; count: number }> = [];
    const d1 = drizzleD1({ prepare: (text: string) => ({ bind: (...params: unknown[]) => ({
      all: async () => { queries.push({ text, count: params.length }); return { success: true, results: sqlite.prepare(text).all(...params) }; },
    }) }) } as never, { schema });
    const snapshot = (await readOwnedReplacementSnapshot(d1, 'c', 7))!;
    queries.length = 0;
    expect(await replaceOwnedDataCardAtomically(d1, snapshot, '{"d1":true}', true)).toBe(true);
    expect(queries).toHaveLength(1); expect(queries[0].count).toBeLessThan(100); expect(queries[0].text.length).toBeLessThan(100_000);
    const pendingSnapshot = (await readOwnedReplacementSnapshot(d1, 'c', 7))!;
    queries.length = 0;
    expect(await replaceOwnedDataCardAtomically(d1, pendingSnapshot, '{"d1":2}', true)).toBe(true);
    expect(queries).toHaveLength(1); expect(queries[0].count).toBeLessThan(100);
  });
  test.each([false, true])('two independent SQLite connections claiming one snapshot: pending=%s', async (pendingReview) => {
    const dir = mkdtempSync(join(tmpdir(), 'owned-cas-'));
    const path = join(dir, 'race.sqlite'); writeFileSync(path, sqlite.serialize());
    const left = new Database(path); const right = new Database(path);
    try {
      const firstDb = drizzle(left, { schema }) as unknown as AppDrizzleDb;
      const secondDb = drizzle(right, { schema }) as unknown as AppDrizzleDb;
      const [first, second] = await Promise.all([readOwnedReplacementSnapshot(firstDb, 'c', 7), readOwnedReplacementSnapshot(secondDb, 'c', 7)]);
      const outcomes = await Promise.all([replaceOwnedDataCardAtomically(firstDb, first!, '{"first":1}', pendingReview), replaceOwnedDataCardAtomically(secondDb, second!, '{"second":1}', pendingReview)]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      const final = (await readOwnedReplacementSnapshot(firstDb, 'c', 7))!;
      expect(pendingReview ? final.pending_data : final.data).toBe('{"first":1}');
    } finally { left.close(); right.close(); rmSync(dir, { recursive: true }); }
  });

});
