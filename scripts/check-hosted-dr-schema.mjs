import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const failures = [];

const argumentValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} 缺少路径参数`);
  return path.isAbsolute(value) ? value : path.join(repositoryRoot, value);
};

const configPath = argumentValue(
  '--config',
  path.join(repositoryRoot, 'config/hosted-dr-schema.json'),
);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const requireEvidence = process.argv.includes('--require-evidence');

const fail = (message) => failures.push(message);
const isRecord = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

if (config.schemaVersion !== 1) fail('schemaVersion 必须为 1');
if (config.status !== 'external-baseline-required') {
  fail('schema status 必须保持 external-baseline-required');
}
if (config.authority !== 'd1') fail('schema authority 必须为 d1');
if (
  !isRecord(config.migrationPolicy)
  || config.migrationPolicy.status !== 'unchanged-for-g25e2'
  || config.migrationPolicy.directory !== 'drizzle'
) {
  fail('G25E-2 不得修改既有 D1 migration');
}
if (
  !isRecord(config.physicalProbe)
  || config.physicalProbe.status !== 'deferred'
  || config.physicalProbe.requires !== 'isolated-preview-d1'
  || config.physicalProbe.activation !== 'require-external-evidence'
) {
  fail('physical D1 probe 必须显式 deferred，并要求 isolated-preview-d1 evidence');
}

const sources = Array.isArray(config.sources) ? config.sources : [];
if (sources.length === 0) fail('schema sources 不得为空');
const sourceContents = new Map();
for (const source of sources) {
  if (!isRecord(source) || !isNonEmptyString(source.path)) {
    fail('schema source 必须声明 path');
    continue;
  }
  if (!['drizzle-source', 'sql-snapshot'].includes(source.kind)) {
    fail(`${source.path}: schema source kind 非法`);
    continue;
  }
  const sourcePath = path.join(repositoryRoot, source.path);
  if (!existsSync(sourcePath)) {
    fail(`schema source 不存在: ${source.path}`);
    continue;
  }
  sourceContents.set(source.path, { ...source, source: readFileSync(sourcePath, 'utf8') });
}

const requiredTables = Array.isArray(config.requiredTables) ? config.requiredTables : [];
if (requiredTables.length === 0) fail('requiredTables 不得为空');
for (const table of requiredTables) {
  if (!isRecord(table) || !isNonEmptyString(table.name) || !Array.isArray(table.columns)) {
    fail('requiredTables entry 必须声明 name/columns');
    continue;
  }
  const tableName = escapeRegExp(table.name);
  for (const { path: sourcePath, kind, source } of sourceContents.values()) {
    let tableBlock = null;
    if (kind === 'sql-snapshot') {
      tableBlock = source.match(new RegExp(
        `CREATE TABLE IF NOT EXISTS\\s+${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`,
        'u',
      ))?.[1] ?? null;
    } else {
      const tableStart = source.search(new RegExp(
        `sqliteTable\\(\\s*['"]${tableName}['"]\\s*,\\s*\\{`,
        'u',
      ));
      if (tableStart >= 0) {
        const tableEnd = source.indexOf('\n});', tableStart);
        tableBlock = source.slice(tableStart, tableEnd >= 0 ? tableEnd : undefined);
      }
    }
    if (!tableBlock) {
      fail(`${sourcePath}: 缺少 schema table ${table.name}`);
      continue;
    }
    for (const column of table.columns) {
      if (!isNonEmptyString(column)) {
        fail(`${table.name}: column 名称非法`);
        continue;
      }
      const columnPattern = kind === 'sql-snapshot'
        ? new RegExp(`^\\s*${escapeRegExp(column)}\\s+`, 'mu')
        : new RegExp(`['"]${escapeRegExp(column)}['"]\\s*\\)`, 'u');
      if (!columnPattern.test(tableBlock)) {
        fail(`${sourcePath}: ${table.name} 缺少 column ${column}`);
      }
    }
  }
}

const evidencePath = path.join(repositoryRoot, config.physicalProbe?.evidencePath ?? '');
if (requireEvidence || existsSync(evidencePath)) {
  if (!existsSync(evidencePath)) {
    fail(`physical D1 evidence 不存在: ${config.physicalProbe?.evidencePath}`);
  } else {
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    if (
      !isRecord(evidence)
      || evidence.schemaVersion !== 1
      || evidence.authority !== 'd1'
      || evidence.environment !== 'preview'
      || evidence.provider !== 'cloudflare-d1-binding'
      || typeof evidence.databaseId !== 'string'
      || !evidence.databaseId.trim()
      || typeof evidence.verifiedAt !== 'string'
      || Number.isNaN(Date.parse(evidence.verifiedAt))
      || !Array.isArray(evidence.tables)
      || evidence.tables.length === 0
    ) {
      fail('physical D1 evidence schema 非法');
    }
  }
}

if (failures.length > 0) {
  console.error('Hosted DR schema check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

if (existsSync(evidencePath)) {
  console.log(`Hosted DR schema baseline OK; physical D1 evidence loaded: ${config.physicalProbe.evidencePath}`);
} else {
  console.log(
    'Hosted DR schema baseline OK; physical D1 probe DEFERRED '
    + '(requires isolated-preview-d1 evidence).',
  );
}
