import { describe, expect, it } from 'vitest';
import { AdminQuerySchema } from '@mahoshojo/contracts/admin';
import { readAdminResource, type AdminReadDatabase } from '../src/admin/read-models';

function database(rows: Record<string, unknown>[] = []) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db: AdminReadDatabase = { prepare(sql) {
    const call = { sql, values: [] as unknown[] }; calls.push(call);
    const statement = { bind(...values: unknown[]) { call.values = values; return statement; },
      async all<T>() { return { success: true, results: rows as T[] }; } };
    return statement;
  } };
  return { db, calls };
}

describe('Admin read projections', () => {
  it('binds search, excludes sensitive columns and strips unexpected returned fields', async () => {
    const { db, calls } = database([{ id: 7, username: 'hello', auth_key: 'secret', email: 'private@example.com' }]);
    const result = await readAdminResource(db, 'users', AdminQuerySchema.parse({ q: "%' OR 1=1 --" }));
    expect(calls[0].sql).not.toMatch(/auth_key|registration_ip|email|SELECT\s+\*/i);
    expect(calls[0].sql).not.toContain("OR 1=1");
    expect(calls[0].values).toContain("%\\%' OR 1=1 --%");
    expect(result.items[0]).not.toHaveProperty('auth_key');
    expect(result.items[0]).not.toHaveProperty('email');
  });
  it('uses keyset pagination, binds cursor, and does not return the extra row', async () => {
    const first = database([{ id: 3 }, { id: 2 }]);
    const page = await readAdminResource(first.db, 'users', AdminQuerySchema.parse({ limit: 1 }));
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const second = database([{ id: 2 }]);
    await readAdminResource(second.db, 'users', AdminQuerySchema.parse({ limit: 1, cursor: page.nextCursor }));
    expect(second.calls[0].sql).toContain('id < ?');
    expect(second.calls[0].values).toContain(3);
    await expect(readAdminResource(second.db, 'data-cards', AdminQuerySchema.parse({ cursor: page.nextCursor }))).rejects.toThrow('cursor');
  });
  it('preserves all three visibility values and only returns content on detail', async () => {
    const { db, calls } = database([{ id: 'a', is_public: -1, data: 'private' }]);
    const list = await readAdminResource(db, 'data-cards', AdminQuerySchema.parse({ visibility: -1 }));
    expect(calls[0].sql).toContain('CAST(is_public AS INTEGER)');
    expect(calls[0].values).toContain(-1);
    expect(list.items[0].is_public).toBe(-1);
    expect(list.items[0]).not.toHaveProperty('data');
    const detail = await readAdminResource(db, 'data-cards', AdminQuerySchema.parse({ id: 'a' }));
    expect(detail.items[0].data).toBe('private');
  });
  it('does not turn failed queries into empty data', async () => {
    const db: AdminReadDatabase = { prepare() { const stmt = { bind() { return stmt; }, async all<T>() { return { success: false, results: [] as T[], error: 'no such table' }; } }; return stmt; } };
    await expect(readAdminResource(db, 'users', AdminQuerySchema.parse({}))).rejects.toThrow();
  });
  it('rejects unsupported filters rather than silently ignoring intent', async () => {
    const { db, calls } = database();
    await expect(readAdminResource(db, 'users', AdminQuerySchema.parse({ visibility: 1 }))).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('rejects malformed or filter-mismatched cursors before SQL execution', async () => {
    const first = database([{ id: 3 }, { id: 2 }]);
    const response = await readAdminResource(first.db, 'users', AdminQuerySchema.parse({ limit: 1, q: 'name' }));
    const second = database();
    for (const cursor of ['%', encodeURIComponent('[1,"wrong",3]'), response.nextCursor]) {
      await expect(readAdminResource(second.db, 'users', AdminQuerySchema.parse({ cursor }))).rejects.toThrow('cursor');
    }
    expect(second.calls).toHaveLength(0);
  });
  it('fails closed on unexpected stored visibility', async () => {
    const { db } = database([{ id: 'card', is_public: 2 }]);
    await expect(readAdminResource(db, 'data-cards', AdminQuerySchema.parse({}))).rejects.toThrow('ADMIN_INVALID_READ_RESULT');
  });
});
