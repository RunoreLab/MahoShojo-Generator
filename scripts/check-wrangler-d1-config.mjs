import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'comment-json';

const WRANGLER_PATH = resolve(process.cwd(), 'wrangler.jsonc');
const PLACEHOLDER_PATTERN = /replace_with_[a-z0-9_]+/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEST_NAME_PATTERN = /test/i;

const readWranglerFile = () => {
  try {
    return readFileSync(WRANGLER_PATH, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[check:wrangler:d1] 读取 wrangler.jsonc 失败: ${message}`);
  }
};

const buildLineIndex = (text) => text.split(/\r?\n/);

const findPlaceholderLines = (lines) => {
  const hits = [];
  lines.forEach((line, index) => {
    if (PLACEHOLDER_PATTERN.test(line)) {
      hits.push({ lineNumber: index + 1, line: line.trim() });
    }
  });
  return hits;
};

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const parseWranglerConfig = (content) => {
  try {
    const parsed = parse(content, undefined, true);
    if (!isObject(parsed)) {
      throw new Error('顶层配置不是对象');
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[check:wrangler:d1] 解析 wrangler.jsonc 失败: ${message}`);
  }
};

const findLineNumber = (lines, key, value) => {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`"${key}"\\s*:\\s*"${escapedValue}"`);
  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : 0;
};

const appendD1Entries = (entries, lines, section, databases) => {
  if (!Array.isArray(databases)) return;

  databases.forEach((database, index) => {
    if (!isObject(database)) return;

    for (const key of ['database_id', 'database_name']) {
      const rawValue = database[key];
      if (typeof rawValue !== 'string') continue;

      entries.push({
        key,
        value: rawValue.trim(),
        section,
        databaseIndex: index,
        lineNumber: findLineNumber(lines, key, rawValue) || index + 1,
      });
    }
  });
};

const parseD1Entries = (config, lines) => {
  const entries = [];

  appendD1Entries(entries, lines, 'd1_databases', config.d1_databases);

  if (isObject(config.env)) {
    for (const [envName, envConfig] of Object.entries(config.env)) {
      if (!isObject(envConfig)) continue;
      appendD1Entries(entries, lines, `env.${envName}.d1_databases`, envConfig.d1_databases);
    }
  }

  return entries;
};

const validateEntries = (entries) => {
  const issues = [];
  const databaseIdEntries = entries.filter((entry) => entry.key === 'database_id');
  const productionDatabaseIdEntries = entries.filter(
    (entry) => entry.section === 'env.production.d1_databases' && entry.key === 'database_id',
  );
  const nonProductionDatabaseIdEntries = entries.filter(
    (entry) =>
      (entry.section === 'd1_databases' || entry.section === 'env.preview.d1_databases') && entry.key === 'database_id',
  );
  const productionDatabaseNameEntries = entries.filter(
    (entry) => entry.section === 'env.production.d1_databases' && entry.key === 'database_name',
  );
  const findDatabaseNameEntry = (idEntry) =>
    entries.find(
      (entry) =>
        entry.section === idEntry.section &&
        entry.databaseIndex === idEntry.databaseIndex &&
        entry.key === 'database_name',
    );

  if (databaseIdEntries.length === 0) {
    issues.push('未检测到 database_id 配置。');
    return issues;
  }

  for (const entry of databaseIdEntries) {
    if (!entry.value) {
      issues.push(`第 ${entry.lineNumber} 行的 ${entry.key} 为空。`);
      continue;
    }

    if (PLACEHOLDER_PATTERN.test(entry.value)) {
      issues.push(`第 ${entry.lineNumber} 行的 ${entry.key} 仍为占位值：${entry.value}`);
      continue;
    }

    if (!UUID_PATTERN.test(entry.value)) {
      issues.push(`第 ${entry.lineNumber} 行的 ${entry.key} 不是合法 D1 UUID：${entry.value}`);
    }
  }

  if (productionDatabaseIdEntries.length === 0) {
    issues.push('未检测到 env.production.d1_databases.database_id 配置。');
  }

  const productionNameById = new Map(
    productionDatabaseIdEntries.map((entry) => [entry.value, findDatabaseNameEntry(entry)?.value ?? '']),
  );
  for (const entry of nonProductionDatabaseIdEntries) {
    const productionName = productionNameById.get(entry.value);
    if (!productionName) continue;

    const nonProductionName = findDatabaseNameEntry(entry)?.value ?? '';
    if (nonProductionName !== productionName) {
      issues.push(
        `第 ${entry.lineNumber} 行的 ${entry.section} 复用 production D1 ID，但 database_name 不一致：${nonProductionName || '(未配置)'} != ${productionName}`,
      );
    }
  }

  for (const entry of productionDatabaseNameEntries) {
    if (TEST_NAME_PATTERN.test(entry.value)) {
      issues.push(`第 ${entry.lineNumber} 行的 production database_name 疑似测试库命名：${entry.value}`);
    }
  }

  return issues;
};

const main = () => {
  const content = readWranglerFile();
  const lines = buildLineIndex(content);
  const config = parseWranglerConfig(content);
  const placeholderLines = findPlaceholderLines(lines);
  const entries = parseD1Entries(config, lines);
  const issues = validateEntries(entries);
  const databaseIdEntries = entries.filter((entry) => entry.key === 'database_id');

  for (const hit of placeholderLines) {
    issues.push(`第 ${hit.lineNumber} 行存在 replace_with_* 占位符：${hit.line}`);
  }

  if (issues.length > 0) {
    console.error('[check:wrangler:d1] 配置校验失败：');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[check:wrangler:d1] 通过，共检查 ${databaseIdEntries.length} 个 D1 ID 配置项。`);
};

main();
