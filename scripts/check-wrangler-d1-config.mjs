import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WRANGLER_PATH = resolve(process.cwd(), 'wrangler.toml');
const PLACEHOLDER_PATTERN = /replace_with_[a-z0-9_]+/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEST_NAME_PATTERN = /test/i;

const readWranglerFile = () => {
  try {
    return readFileSync(WRANGLER_PATH, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[check:wrangler:d1] 读取 wrangler.toml 失败: ${message}`);
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

const parseD1Entries = (lines) => {
  const entries = [];
  const sectionPattern = /^\s*\[\[([^\]]+)\]\]\s*$/;
  const entryPattern = /^\s*(database_id|preview_database_id|database_name)\s*=\s*"([^"]*)"\s*$/;
  let currentSection = '';

  lines.forEach((line, index) => {
    const normalized = line.split('#')[0]?.trim() ?? '';
    if (!normalized) return;

    const sectionMatch = sectionPattern.exec(normalized);
    if (sectionMatch) {
      currentSection = sectionMatch[1]?.trim() ?? '';
      return;
    }

    const match = entryPattern.exec(normalized);
    if (!match) return;

    const key = match[1];
    const value = match[2]?.trim() ?? '';
    entries.push({
      key,
      value,
      section: currentSection,
      lineNumber: index + 1,
    });
  });

  return entries;
};

const validateEntries = (entries) => {
  const issues = [];
  const databaseIdEntries = entries.filter((entry) => entry.key === 'database_id' || entry.key === 'preview_database_id');
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

  if (databaseIdEntries.length === 0) {
    issues.push('未检测到 database_id / preview_database_id 配置。');
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

  const nonProductionIds = new Set(nonProductionDatabaseIdEntries.map((entry) => entry.value));
  for (const entry of productionDatabaseIdEntries) {
    if (nonProductionIds.has(entry.value)) {
      issues.push(
        `第 ${entry.lineNumber} 行的 production database_id 与 default/preview 复用同一 D1：${entry.value}`,
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
  const placeholderLines = findPlaceholderLines(lines);
  const entries = parseD1Entries(lines);
  const issues = validateEntries(entries);
  const databaseIdEntries = entries.filter((entry) => entry.key === 'database_id' || entry.key === 'preview_database_id');

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
