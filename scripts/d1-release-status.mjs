import { mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_AUTH_TABLES = [
  'ba_user',
  'ba_session',
  'ba_account',
  'ba_verification',
  'user_auth_links',
  'auth_password_reset_tokens',
  'auth_audit_logs',
];

const REQUIRED_USERS_COLUMNS = ['is_admin', 'is_review_exempt'];
const FORBIDDEN_REMOTE_MIGRATIONS = ['0014_arena_multiplayer_rooms.sql'];
const FORBIDDEN_REMOTE_TABLES = ['arena_multiplayer_rooms'];
const WRANGLER_WORKSPACE = '@mahoshojo/web';

export const findForbiddenRemoteMigrations = (migrationNames) =>
  migrationNames.filter((name) => FORBIDDEN_REMOTE_MIGRATIONS.includes(name));

export const findForbiddenRemoteTables = (tableNames) =>
  FORBIDDEN_REMOTE_TABLES.filter((name) => tableNames.has(name));

const parseArgs = (argv) => {
  const args = {
    database: null,
    env: null,
    config: null,
    local: false,
    remote: false,
    preview: false,
    persistTo: null,
    migrationsDir: 'drizzle',
    envFiles: [],
    requireReady: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case '--database':
        args.database = argv[index + 1] ?? null;
        index += 1;
        break;
      case '--env':
        args.env = argv[index + 1] ?? null;
        index += 1;
        break;
      case '--env-file':
        args.envFiles.push(argv[index + 1] ?? '');
        index += 1;
        break;
      case '--config':
        args.config = argv[index + 1] ?? null;
        index += 1;
        break;
      case '--persist-to':
        args.persistTo = argv[index + 1] ?? null;
        index += 1;
        break;
      case '--migrations-dir':
        args.migrationsDir = argv[index + 1] ?? 'drizzle';
        index += 1;
        break;
      case '--local':
        args.local = true;
        break;
      case '--remote':
        args.remote = true;
        break;
      case '--preview':
        args.preview = true;
        break;
      case '--require-ready':
        args.requireReady = true;
        break;
      default:
        throw new Error(`未知参数: ${token}`);
    }
  }

  if (!args.database) {
    throw new Error('缺少必填参数：--database <name-or-binding>');
  }

  if (args.local && args.remote) {
    throw new Error('参数冲突：--local 与 --remote 不能同时设置');
  }

  if (args.envFiles.some((value) => !value)) {
    throw new Error('--env-file 需要提供有效路径');
  }

  return args;
};

const findFirstCompleteJson = (text) => {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '[' && text[start] !== '{') continue;

    const closingStack = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === '[') {
        closingStack.push(']');
      } else if (character === '{') {
        closingStack.push('}');
      } else if (character === ']' || character === '}') {
        if (closingStack.pop() !== character) break;
        if (closingStack.length === 0) {
          try {
            return { found: true, value: JSON.parse(text.slice(start, index + 1)) };
          } catch {
            break;
          }
        }
      }
    }
  }
  return { found: false, value: null };
};

export const parseJsonPayload = (stdout, stderr) => {
  for (const channel of [stdout ?? '', stderr ?? '']) {
    const parsed = findFirstCompleteJson(channel);
    if (parsed.found) return parsed.value;
  }

  const fullText = `${stdout ?? ''}\n${stderr ?? ''}`;
  throw new Error(`无法从 wrangler 输出中解析 JSON：\n${fullText}`.trim());
};

const normalizeWranglerResponse = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.results)) {
    return [payload];
  }
  throw new Error(`wrangler 返回结果格式不支持：${JSON.stringify(payload)}`);
};

const getRows = (response) => {
  const first = Array.isArray(response) ? response[0] : null;
  if (!first || typeof first !== 'object') return [];
  const results = first.results;
  if (!Array.isArray(results)) return [];
  return results;
};

const toInt = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const buildWranglerCommandArgs = (options, sql) => {
  const args = ['--filter', WRANGLER_WORKSPACE, 'exec', 'wrangler', 'd1', 'execute', options.database];

  if (options.local) args.push('--local');
  if (options.remote) args.push('--remote');
  if (options.preview) args.push('--preview');
  if (options.persistTo) args.push('--persist-to', resolve(process.cwd(), options.persistTo));
  if (options.config) args.push('--config', resolve(process.cwd(), options.config));
  if (options.env) args.push('--env', options.env);
  for (const envFile of options.envFiles) {
    args.push('--env-file', resolve(process.cwd(), envFile));
  }

  args.push('--json', '--command', sql);
  return args;
};

const executeSql = (options, sql) => {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || resolve(process.cwd(), '.home/.config');
  mkdirSync(xdgConfigHome, { recursive: true });

  const commandArgs = buildWranglerCommandArgs(options, sql);
  const result = spawnSync('pnpm', commandArgs, {
    encoding: 'utf8',
    env: {
      ...process.env,
      XDG_CONFIG_HOME: xdgConfigHome,
    },
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(output || `wrangler 执行失败，退出码 ${result.status ?? 'unknown'}`);
  }

  const payload = parseJsonPayload(result.stdout, result.stderr);
  return normalizeWranglerResponse(payload);
};

const compareMigrations = (left, right) => {
  const leftNo = Number.parseInt(left.split('_')[0] ?? '', 10);
  const rightNo = Number.parseInt(right.split('_')[0] ?? '', 10);
  if (Number.isFinite(leftNo) && Number.isFinite(rightNo) && leftNo !== rightNo) {
    return leftNo - rightNo;
  }
  return left.localeCompare(right);
};

const listMigrationFiles = (migrationsDir) => {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort(compareMigrations);
};

const quotedSqlList = (values) => values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ');

const getD1MigrationNames = (options) => {
  const existsRows = getRows(
    executeSql(
      options,
      "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations';",
    ),
  );
  const existsCount = toInt((existsRows[0] ?? {}).cnt);
  if (existsCount <= 0) {
    return [];
  }

  const migrationRows = getRows(executeSql(options, 'SELECT name FROM d1_migrations ORDER BY id;'));
  return migrationRows
    .map((row) => (row && typeof row === 'object' ? row.name : null))
    .filter((value) => typeof value === 'string' && value.length > 0);
};

const getAuthTables = (options) => {
  const sql = `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${quotedSqlList(REQUIRED_AUTH_TABLES)}) ORDER BY name;`;
  const rows = getRows(executeSql(options, sql));
  return new Set(
    rows
      .map((row) => (row && typeof row === 'object' ? row.name : null))
      .filter((value) => typeof value === 'string' && value.length > 0),
  );
};

const getForbiddenRemoteTables = (options) => {
  const sql = `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${quotedSqlList(FORBIDDEN_REMOTE_TABLES)}) ORDER BY name;`;
  const rows = getRows(executeSql(options, sql));
  return new Set(
    rows
      .map((row) => (row && typeof row === 'object' ? row.name : null))
      .filter((value) => typeof value === 'string' && value.length > 0),
  );
};

const getUsersColumns = (options) => {
  const rows = getRows(executeSql(options, 'PRAGMA table_info(users);'));
  return new Set(
    rows
      .map((row) => (row && typeof row === 'object' ? row.name : null))
      .filter((value) => typeof value === 'string' && value.length > 0),
  );
};

const getUserStats = (options) => {
  const totalsRows = getRows(
    executeSql(
      options,
      "SELECT COUNT(*) AS total_users, SUM(CASE WHEN email IS NULL OR trim(email) = '' THEN 1 ELSE 0 END) AS users_without_email, SUM(CASE WHEN username IS NULL OR trim(username) = '' THEN 1 ELSE 0 END) AS users_without_username FROM users;",
    ),
  );
  const duplicateEmailRows = getRows(
    executeSql(
      options,
      "SELECT COUNT(*) AS duplicate_email_groups FROM (SELECT lower(trim(email)) AS email_key, COUNT(*) AS c FROM users WHERE email IS NOT NULL AND trim(email) <> '' GROUP BY lower(trim(email)) HAVING c > 1);",
    ),
  );
  const duplicateUsernameRows = getRows(
    executeSql(
      options,
      "SELECT COUNT(*) AS duplicate_username_groups FROM (SELECT lower(trim(username)) AS username_key, COUNT(*) AS c FROM users WHERE username IS NOT NULL AND trim(username) <> '' GROUP BY lower(trim(username)) HAVING c > 1);",
    ),
  );

  return {
    totalUsers: toInt((totalsRows[0] ?? {}).total_users),
    usersWithoutEmail: toInt((totalsRows[0] ?? {}).users_without_email),
    usersWithoutUsername: toInt((totalsRows[0] ?? {}).users_without_username),
    duplicateEmailGroups: toInt((duplicateEmailRows[0] ?? {}).duplicate_email_groups),
    duplicateUsernameGroups: toInt((duplicateUsernameRows[0] ?? {}).duplicate_username_groups),
  };
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const migrationsDir = resolve(process.cwd(), options.migrationsDir);
  const localMigrations = listMigrationFiles(migrationsDir);
  const appliedMigrations = getD1MigrationNames(options);

  const localMigrationSet = new Set(localMigrations);
  const appliedMigrationSet = new Set(appliedMigrations);

  const pendingMigrations = localMigrations.filter((name) => !appliedMigrationSet.has(name));
  const unknownAppliedMigrations = appliedMigrations.filter((name) => !localMigrationSet.has(name));
  const enforcesRemoteSchemaGate = options.remote || options.preview;
  const forbiddenRemoteMigrations = enforcesRemoteSchemaGate
    ? findForbiddenRemoteMigrations(appliedMigrations)
    : [];
  const forbiddenRemoteTables = enforcesRemoteSchemaGate
    ? findForbiddenRemoteTables(getForbiddenRemoteTables(options))
    : [];

  const authTables = getAuthTables(options);
  const missingAuthTables = REQUIRED_AUTH_TABLES.filter((name) => !authTables.has(name));

  const usersColumns = getUsersColumns(options);
  const missingUsersColumns = REQUIRED_USERS_COLUMNS.filter((name) => !usersColumns.has(name));

  const userStats = getUserStats(options);

  const mode = options.remote ? 'remote' : options.local ? 'local' : 'default';
  console.log(
    `[db:status] 目标：database=${options.database}, env=${options.env ?? '(default)'}, mode=${mode}, preview=${options.preview ? 'true' : 'false'}`,
  );
  console.log(`[db:status] 本地迁移文件：${localMigrations.length} 个`);
  console.log(`[db:status] 远端已登记迁移：${appliedMigrations.length} 个`);
  console.log(`[db:status] 待应用迁移：${pendingMigrations.length} 个`);
  if (pendingMigrations.length > 0) {
    for (const name of pendingMigrations) {
      console.log(`  - ${name}`);
    }
  }

  console.log(`[db:status] 仅在远端存在的历史迁移记录：${unknownAppliedMigrations.length} 个`);
  if (unknownAppliedMigrations.length > 0) {
    for (const name of unknownAppliedMigrations) {
      console.log(`  - ${name}`);
    }
  }

  if (enforcesRemoteSchemaGate) {
    console.log(
      `[db:status] Redis-only 禁止迁移记录：${forbiddenRemoteMigrations.length} 个`,
    );
    console.log(`[db:status] Redis-only 禁止表：${forbiddenRemoteTables.length} 个`);
  }

  console.log(`[db:status] Auth 关键表覆盖：${REQUIRED_AUTH_TABLES.length - missingAuthTables.length}/${REQUIRED_AUTH_TABLES.length}`);
  if (missingAuthTables.length > 0) {
    console.log(`[db:status] 缺失 Auth 表：${missingAuthTables.join(', ')}`);
  }

  console.log(`[db:status] users 关键列覆盖：${REQUIRED_USERS_COLUMNS.length - missingUsersColumns.length}/${REQUIRED_USERS_COLUMNS.length}`);
  if (missingUsersColumns.length > 0) {
    console.log(`[db:status] 缺失 users 列：${missingUsersColumns.join(', ')}`);
  }

  console.log(
    `[db:status] users 基线：total=${userStats.totalUsers}, no_email=${userStats.usersWithoutEmail}, no_username=${userStats.usersWithoutUsername}, dup_email_groups=${userStats.duplicateEmailGroups}, dup_username_groups=${userStats.duplicateUsernameGroups}`,
  );

  if (!options.requireReady) {
    return;
  }

  const failures = [];
  if (pendingMigrations.length > 0) {
    failures.push(`仍有待应用迁移 ${pendingMigrations.length} 个`);
  }
  if (missingAuthTables.length > 0) {
    failures.push(`缺失 Auth 表：${missingAuthTables.join(', ')}`);
  }
  if (missingUsersColumns.length > 0) {
    failures.push(`缺失 users 列：${missingUsersColumns.join(', ')}`);
  }
  if (forbiddenRemoteMigrations.length > 0) {
    failures.push(`存在 Redis-only 禁止迁移记录：${forbiddenRemoteMigrations.join(', ')}`);
  }
  if (forbiddenRemoteTables.length > 0) {
    failures.push(`存在 Redis-only 禁止表：${forbiddenRemoteTables.join(', ')}`);
  }

  if (failures.length > 0) {
    console.error('[db:status] require-ready 失败：');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[db:status] require-ready 通过：数据库已满足 Auth + ORM + Redis-only 上线要求。');
};

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedFile && pathToFileURL(invokedFile).href === pathToFileURL(currentFile).href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[db:status] 失败: ${message}`);
    process.exitCode = 1;
  }
}
