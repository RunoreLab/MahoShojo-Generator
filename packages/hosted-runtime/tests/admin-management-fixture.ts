import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { AdminDatabase, AdminPreparedStatement } from '../src/admin/database';
import { bootstrapAdminPrincipal } from '../src/admin/principals';

type SQLite = { exec(_sql: string): void; close(): void; prepare(_sql: string): {
  all(..._values: unknown[]): Record<string, unknown>[];
  get(..._values: unknown[]): Record<string, unknown> | undefined;
  run(..._values: unknown[]): { changes: number };
} };
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (_name: string) => SQLite };
export async function adminManagementFixture(capabilities: string[]) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['../../../apps/web/lib/database/schema.sql', '../../../drizzle/0000_auth_domain_bootstrap.sql', '../../../drizzle/0013_ai_channel_availability.sql', '../../../drizzle/0014_admin_foundation.sql', '../../../drizzle/0015_admin_actor_attribution.sql', '../../../drizzle/0016_admin_object_tombstones.sql']) {
    sqlite.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
  }
  const db: AdminDatabase = {
    prepare(sql) { let values: unknown[] = []; const stmt: AdminPreparedStatement = {
      bind(...bound) { values = bound; return stmt; },
      async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...values) as T[] }; },
      async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
      async run() { return { success: true, results: [], meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
    }; return stmt; },
    async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
  };
  await bootstrapAdminPrincipal(db, { id: 'operator', verifiedIdentity: { issuer: 'https://fixture.cloudflareaccess.com', subject: 'operator', kind: 'human' },
    capabilities, allowedCapabilities: capabilities, requestId: 'bootstrap', reason: '测试管理员', operatorSafeRef: 'local-test' });
  return { sqlite, db, context: { principalId: 'operator', requestId: 'request', authnContextSafeRef: 'verified-access' } };
}
