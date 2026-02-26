import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WRANGLER_PATH = resolve(process.cwd(), 'wrangler.toml');
const PLACEHOLDER_PATTERN = /replace_with_[a-z0-9_]+/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

const parseDatabaseIdEntries = (lines) => {
  const entries = [];
  const entryPattern = /^\s*(database_id|preview_database_id)\s*=\s*"([^"]*)"\s*$/;

  lines.forEach((line, index) => {
    const normalized = line.split('#')[0]?.trim() ?? '';
    if (!normalized) return;

    const match = entryPattern.exec(normalized);
    if (!match) return;

    const key = match[1];
    const value = match[2]?.trim() ?? '';
    entries.push({
      key,
      value,
      lineNumber: index + 1,
    });
  });

  return entries;
};

const validateEntries = (entries) => {
  const issues = [];

  if (entries.length === 0) {
    issues.push('未检测到 database_id / preview_database_id 配置。');
    return issues;
  }

  for (const entry of entries) {
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

  return issues;
};

const main = () => {
  const content = readWranglerFile();
  const lines = buildLineIndex(content);
  const placeholderLines = findPlaceholderLines(lines);
  const entries = parseDatabaseIdEntries(lines);
  const issues = validateEntries(entries);

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

  console.log(`[check:wrangler:d1] 通过，共检查 ${entries.length} 个 D1 ID 配置项。`);
};

main();
