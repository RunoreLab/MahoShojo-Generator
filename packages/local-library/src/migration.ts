import { SafeJsonValueSchema, type JsonValue } from '@mahoshojo/contracts/json-value';

export type LocalCardMigrationRecord = Record<string, JsonValue> & {
  schemaVersion: number;
};

export interface LocalCardMigration {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(_record: LocalCardMigrationRecord): unknown;
}

export type LocalCardMigrationErrorCode =
  | 'invalid-version'
  | 'downgrade-not-supported'
  | 'invalid-step'
  | 'ambiguous-step'
  | 'missing-step'
  | 'invalid-record'
  | 'step-failed'
  | 'invalid-step-output';

export class LocalCardMigrationError extends Error {
  readonly code: LocalCardMigrationErrorCode;

  constructor(code: LocalCardMigrationErrorCode) {
    super(code === 'step-failed' ? 'local card migration failed' : `local card migration error: ${code}`);
    this.name = 'LocalCardMigrationError';
    this.code = code;
  }
}

const isPositiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

export const resolveLocalCardMigrationPath = (
  currentVersion: number,
  targetVersion: number,
  migrations: readonly LocalCardMigration[],
): LocalCardMigration[] => {
  if (!isPositiveInteger(currentVersion) || !isPositiveInteger(targetVersion)) {
    throw new LocalCardMigrationError('invalid-version');
  }
  if (targetVersion < currentVersion) {
    throw new LocalCardMigrationError('downgrade-not-supported');
  }

  const bySourceVersion = new Map<number, LocalCardMigration>();
  for (const migration of migrations) {
    if (
      migration === null ||
      typeof migration !== 'object' ||
      !isPositiveInteger(migration.fromVersion) ||
      !isPositiveInteger(migration.toVersion) ||
      migration.toVersion !== migration.fromVersion + 1
    ) {
      throw new LocalCardMigrationError('invalid-step');
    }
    if (bySourceVersion.has(migration.fromVersion)) {
      throw new LocalCardMigrationError('ambiguous-step');
    }
    bySourceVersion.set(migration.fromVersion, migration);
  }

  const path: LocalCardMigration[] = [];
  for (let version = currentVersion; version < targetVersion; version += 1) {
    const migration = bySourceVersion.get(version);
    if (migration === undefined) {
      throw new LocalCardMigrationError('missing-step');
    }
    path.push(migration);
  }
  return path;
};

const readMigrationRecord = (input: unknown): LocalCardMigrationRecord => {
  const parsed = SafeJsonValueSchema.safeParse(input);
  if (
    !parsed.success ||
    typeof parsed.data !== 'object' ||
    parsed.data === null ||
    Array.isArray(parsed.data) ||
    !isPositiveInteger((parsed.data as Record<string, JsonValue>).schemaVersion as number)
  ) {
    throw new LocalCardMigrationError('invalid-record');
  }
  return parsed.data as LocalCardMigrationRecord;
};

const cloneMigrationRecord = (record: LocalCardMigrationRecord): LocalCardMigrationRecord =>
  JSON.parse(JSON.stringify(record)) as LocalCardMigrationRecord;

export const migrateLocalCardRecord = (
  input: unknown,
  targetVersion: number,
  migrations: readonly LocalCardMigration[],
): LocalCardMigrationRecord => {
  const source = readMigrationRecord(input);
  const path = resolveLocalCardMigrationPath(source.schemaVersion, targetVersion, migrations);
  let current = cloneMigrationRecord(source);

  for (const migration of path) {
    let output: unknown;
    try {
      output = migration.migrate(current);
    } catch {
      throw new LocalCardMigrationError('step-failed');
    }

    try {
      current = readMigrationRecord(output);
    } catch {
      throw new LocalCardMigrationError('invalid-step-output');
    }
    if (current.schemaVersion !== migration.toVersion) {
      throw new LocalCardMigrationError('invalid-step-output');
    }
  }

  return current;
};
