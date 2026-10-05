import { describe, expect, it, vi } from 'vitest';
import { createDrizzleDb } from '../src/db/drizzle';
import { users } from '../src/db/schema';

const makeClient = () => {
  const statement = { bind: vi.fn(), raw: vi.fn(async () => []) };
  statement.bind.mockReturnValue(statement);
  return {
    prepare: vi.fn(() => statement),
    batch: vi.fn(),
    exec: vi.fn(),
    statement,
  };
};

describe('hosted Drizzle factory', () => {
  it('rejects missing and incomplete clients without discovering an environment', () => {
    for (const client of [undefined, null, {}, { prepare: () => {} }]) {
      expect(() => createDrizzleDb(client)).toThrow('缺少 prepare/batch/exec');
    }
  });

  it('keeps interleaved requests bound to their explicitly supplied clients', async () => {
    const first = makeClient();
    const second = makeClient();
    const firstDb = createDrizzleDb(first);
    const secondDb = createDrizzleDb(second);

    await firstDb.select({ id: users.id }).from(users).all();
    await secondDb.select({ id: users.id }).from(users).all();
    await firstDb.select({ id: users.id }).from(users).all();

    expect(first.prepare).toHaveBeenCalledTimes(2);
    expect(second.prepare).toHaveBeenCalledTimes(1);
    expect(first.statement.raw).toHaveBeenCalledTimes(2);
    expect(second.statement.raw).toHaveBeenCalledTimes(1);
  });
});
