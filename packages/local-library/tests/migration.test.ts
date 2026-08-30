import {
  LocalCardMigrationError,
  migrateLocalCardRecord,
  resolveLocalCardMigrationPath,
  type LocalCardMigration,
} from '@mahoshojo/local-library/migration';

describe('local card migrations', () => {
  const migrations: LocalCardMigration[] = [
    {
      fromVersion: 1,
      toVersion: 2,
      migrate: (record) => ({ ...record, schemaVersion: 2, migratedOnce: true }),
    },
    {
      fromVersion: 2,
      toVersion: 3,
      migrate: (record) => ({ ...record, schemaVersion: 3, migratedTwice: true }),
    },
  ];

  it('resolves a contiguous monotonic path and applies it deterministically', () => {
    expect(resolveLocalCardMigrationPath(1, 3, migrations)).toEqual(migrations);

    const original = { id: 'local-card-1', schemaVersion: 1, title: '原始记录' };
    const migrated = migrateLocalCardRecord(original, 3, migrations);
    expect(migrated).toEqual({
      id: 'local-card-1',
      schemaVersion: 3,
      title: '原始记录',
      migratedOnce: true,
      migratedTwice: true,
    });
    expect(original).toEqual({ id: 'local-card-1', schemaVersion: 1, title: '原始记录' });
    expect(migrateLocalCardRecord(original, 3, migrations)).toEqual(migrated);
  });

  it('rejects downgrade, gaps, ambiguous steps, and a step with the wrong output version', () => {
    expect(() => resolveLocalCardMigrationPath(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1, []))
      .toThrow(LocalCardMigrationError);
    expect(() => resolveLocalCardMigrationPath(2, 1, migrations)).toThrow(LocalCardMigrationError);
    expect(() => resolveLocalCardMigrationPath(1, 3, migrations.slice(1))).toThrow(LocalCardMigrationError);
    expect(() => resolveLocalCardMigrationPath(1, 2, [migrations[0], migrations[0]])).toThrow(
      LocalCardMigrationError,
    );
    expect(() => migrateLocalCardRecord(
      { id: 'local-card-1', schemaVersion: 1 },
      2,
      [{ fromVersion: 1, toVersion: 2, migrate: (record) => record }],
    )).toThrow(LocalCardMigrationError);
    expect(() => resolveLocalCardMigrationPath(1, 2, [null] as unknown as LocalCardMigration[]))
      .toThrow(LocalCardMigrationError);
  });

  it('does not mutate the caller record when a migration fails', () => {
    const original = {
      id: 'local-card-1',
      schemaVersion: 1,
      nested: { value: 'preserve-me' },
    };

    expect(() => migrateLocalCardRecord(original, 2, [{
      fromVersion: 1,
      toVersion: 2,
      migrate: (record) => {
        (record.nested as { value: string }).value = 'mutated-clone';
        throw new Error('raw record content: preserve-me');
      },
    }])).toThrowError('local card migration failed');
    expect(original.nested.value).toBe('preserve-me');
  });
});
