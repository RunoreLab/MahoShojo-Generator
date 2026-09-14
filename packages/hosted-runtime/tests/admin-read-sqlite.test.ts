import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_RESOURCES, AdminQuerySchema } from '@mahoshojo/contracts/admin';
import { readAdminResource, type AdminReadDatabase } from '../src/admin/read-models';
import { adminActionVersion } from '../src/admin/actions/core';

type SQLite = { exec(_sql: string): void; close(): void; prepare(_sql: string): {
  all(..._values: unknown[]): Record<string, unknown>[];
  get(..._values: unknown[]): Record<string, unknown>;
} };
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (_name: string) => SQLite };
const opened: SQLite[] = [];
afterEach(() => opened.splice(0).forEach((db) => db.close()));

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  opened.push(sqlite);
  for (const path of ['../../../apps/web/lib/database/schema.sql', '../../../drizzle/0000_auth_domain_bootstrap.sql', '../../../drizzle/0013_ai_channel_availability.sql']) {
    sqlite.exec(readFileSync(new URL(path, import.meta.url), 'utf8'));
  }
  sqlite.exec("INSERT INTO users (id, username, email, auth_key) VALUES (1, 'one', 'private@example.com', 'secret'), (2, 'two', 'private2@example.com', 'secret2')");
  const db: AdminReadDatabase = { prepare(sql) {
    let bound: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) { bound = values; return statement; },
      async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...bound) as T[] }; },
    };
    return statement;
  } };
  return { db, sqlite };
}

describe('Admin reads against current SQLite schema', () => {
  it('executes every list and detail projection without any writes', async () => {
    const { db, sqlite } = setup();
    const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
    for (const resource of ADMIN_RESOURCES) {
      const response = await readAdminResource(db, resource, AdminQuerySchema.parse({}));
      expect(Array.isArray(response.items), resource).toBe(true);
      if (resource !== 'dashboard') await readAdminResource(db, resource, AdminQuerySchema.parse({ id: '1' }));
    }
    expect(sqlite.prepare('SELECT total_changes() AS n').get().n).toBe(before);
  });
  it('keeps numeric cursor ordering stable when a newer user arrives between pages', async () => {
    const { db, sqlite } = setup();
    const first = await readAdminResource(db, 'users', AdminQuerySchema.parse({ limit: 1 }));
    expect(first.items[0].id).toBe(2);
    sqlite.exec("INSERT INTO users (id, username, email, auth_key) VALUES (3, 'three', 'private3@example.com', 'secret3')");
    const second = await readAdminResource(db, 'users', AdminQuerySchema.parse({ limit: 1, cursor: first.nextCursor }));
    expect(second.items.map((item) => item.id)).toEqual([1]);
    expect(second.nextCursor).toBeNull();
    expect(JSON.stringify(first)).not.toMatch(/private|secret|auth_key|email/);
  });
  it('escapes search wildcards instead of expanding the requested scope', async () => {
    const { db } = setup();
    const response = await readAdminResource(db, 'users', AdminQuerySchema.parse({ q: '%' }));
    expect(response.items).toEqual([]);
  });
  it('preserves -1, 0 and 1 through native SQLite and filters by the same raw value', async () => {
    const { db, sqlite } = setup();
    for (const value of [-1, 0, 1]) sqlite.exec(`INSERT INTO data_cards (id,user_id,type,name,data,is_public) VALUES ('card${value}',1,'character','name','{}',${value})`);
    for (const value of [-1, 0, 1]) {
      const response = await readAdminResource(db, 'data-cards', AdminQuerySchema.parse({ visibility: value }));
      expect(response.items.map((row) => row.is_public)).toEqual([value]);
    }
  });
  it('never exposes bearer redemption codes in records or cursors', async () => {
    const { db, sqlite } = setup();
    sqlite.exec("INSERT INTO redemption_codes (code,slot_count) VALUES ('redeem-secret-one',2),('redeem-secret-two',3)");
    const response = await readAdminResource(db, 'redemption-codes', AdminQuerySchema.parse({ limit: 1 }));
    expect(response.nextCursor).not.toBeNull();
    expect(decodeURIComponent(JSON.stringify(response))).not.toContain('redeem-secret');
    const detail=await readAdminResource(db,'redemption-codes',AdminQuerySchema.parse({id:'1'}));
    expect(detail.items[0].expectedVersion).toBe(await adminActionVersion('redemption-codes',sqlite.prepare('SELECT rowid,code,slot_count,created_at FROM redemption_codes WHERE rowid=1').get()));
    expect(JSON.stringify(detail)).not.toMatch(/redeem-secret|__version/);
  });
});
