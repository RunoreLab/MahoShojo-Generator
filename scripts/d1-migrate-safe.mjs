import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SPECIAL_MIGRATION_NAME = '0001_users_admin_flags.sql';
const WRANGLER_WORKSPACE = '@mahoshojo/web';

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

const parseJsonPayload = (stdout, stderr) => {
  const fullText = `${stdout ?? ''}\n${stderr ?? ''}`;
  const listStart = fullText.indexOf('[');
  const objectStart = fullText.indexOf('{');
  const candidates = [listStart, objectStart].filter((value) => value >= 0);
  if (candidates.length === 0) {
    throw new Error(`无法从 wrangler 输出中解析 JSON：\n${fullText}`.trim());
  }

  const start = Math.min(...candidates);
  const listEnd = fullText.lastIndexOf(']');
  const objectEnd = fullText.lastIndexOf('}');
  const end = Math.max(listEnd, objectEnd);
  if (end < start) {
    throw new Error(`wrangler JSON 输出不完整：\n${fullText}`.trim());
  }

  const candidate = fullText.slice(start, end + 1);
  return JSON.parse(candidate);
};

const normalizeWranglerResponse = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.results)) {
    return [payload];
  }
  throw new Error(`wrangler 返回结果格式不支持：${JSON.stringify(payload)}`);
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
    const errorOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(errorOutput || `wrangler 执行失败，退出码 ${result.status ?? 'unknown'}`);
  }

  const payload = parseJsonPayload(result.stdout, result.stderr);
  return normalizeWranglerResponse(payload);
};

const getRows = (response) => {
  const first = Array.isArray(response) ? response[0] : null;
  if (!first || typeof first !== 'object') return [];
  const results = first.results;
  if (!Array.isArray(results)) return [];
  return results;
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
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort(compareMigrations);

  if (files.length === 0) {
    throw new Error(`迁移目录为空：${migrationsDir}`);
  }

  return files;
};

const initMigrationTable = (options) => {
  executeSql(
    options,
    `CREATE TABLE IF NOT EXISTS d1_migrations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );`,
  );
};

const getAppliedMigrationNames = (options) => {
  const response = executeSql(options, 'SELECT name FROM d1_migrations ORDER BY id;');
  const rows = getRows(response);
  return new Set(
    rows
      .map((row) => (row && typeof row === 'object' ? row.name : null))
      .filter((name) => typeof name === 'string' && name.length > 0),
  );
};

const escapeSqlString = (value) => value.replace(/'/g, "''");

const appendMigrationRecord = (migrationName) =>
  `INSERT INTO d1_migrations (name) VALUES ('${escapeSqlString(migrationName)}')`;

const ensureUsersAdminColumnsFor0001 = (options, migrationName) => {
  const tableInfoResponse = executeSql(options, 'PRAGMA table_info(users);');
  const tableInfoRows = getRows(tableInfoResponse);
  if (tableInfoRows.length === 0) {
    throw new Error(
      `[db:migrate:safe] ${migrationName} 需要 users 表，但当前未找到 users。请先确认 0000 迁移是否已正确应用。`,
    );
  }

  const columnNames = new Set(
    tableInfoRows
      .map((row) => (row && typeof row === 'object' ? row.name : null))
      .filter((name) => typeof name === 'string' && name.length > 0),
  );

  const statements = [];
  if (!columnNames.has('is_admin')) {
    statements.push('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnNames.has('is_review_exempt')) {
    statements.push('ALTER TABLE users ADD COLUMN is_review_exempt INTEGER NOT NULL DEFAULT 0');
  }

  if (statements.length === 0) {
    console.log(`[db:migrate:safe] ${migrationName} 已满足（列已存在），仅补写迁移记录。`);
  } else {
    console.log(`[db:migrate:safe] ${migrationName} 缺失列 ${statements.length} 项，执行补齐。`);
  }

  statements.push(appendMigrationRecord(migrationName));
  executeSql(options, `${statements.join(';\n')};`);
};

const applyRegularMigration = (options, migrationFilePath, migrationName) => {
  const rawSql = readFileSync(migrationFilePath, 'utf8').trim();
  const statements = ['SELECT 1;'];
  if (rawSql.length > 0) {
    statements.push(rawSql.endsWith(';') ? rawSql : `${rawSql};`);
  }
  statements.push(`${appendMigrationRecord(migrationName)};`);
  executeSql(options, statements.join('\n'));
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const migrationsDir = resolve(process.cwd(), options.migrationsDir);
  const files = listMigrationFiles(migrationsDir);

  initMigrationTable(options);
  const appliedNames = getAppliedMigrationNames(options);

  let appliedCount = 0;
  for (const file of files) {
    if (appliedNames.has(file)) continue;

    const fullPath = resolve(migrationsDir, file);
    console.log(`[db:migrate:safe] applying ${file}`);

    if (file === SPECIAL_MIGRATION_NAME) {
      ensureUsersAdminColumnsFor0001(options, file);
    } else {
      applyRegularMigration(options, fullPath, file);
    }

    appliedNames.add(file);
    appliedCount += 1;
  }

  if (appliedCount === 0) {
    console.log('[db:migrate:safe] 没有待应用迁移。');
    return;
  }

  console.log(`[db:migrate:safe] 完成，新增应用迁移 ${appliedCount} 个。`);
};

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[db:migrate:safe] 失败: ${message}`);
  process.exitCode = 1;
}
