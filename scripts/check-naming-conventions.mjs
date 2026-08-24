#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const LEGACY_INCLUDE_DIRS = ['app', 'pages', 'components', 'lib'];
const WORKSPACE_INCLUDE_DIRS = ['apps', 'packages'];
const IGNORED_DIRECTORIES = new Set(['.next', '.open-next', 'build', 'coverage', 'dist', 'node_modules', 'out']);
const BLOCK_EXCLUDE_PREFIXES = [
  'lib/vendor/',
  'packages/hosted-runtime/src/node-runtime/vendor/',
];
const REPORT_ONLY_DIR_PREFIXES = ['lib/db/', 'lib/database/'];
const FILE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const MAX_BLOCK_REPORT_ITEMS = 80;
const MAX_REPORT_ONLY_ITEMS = 20;

const SNAKE_CASE_RE = /^[a-z][a-z0-9]*_[a-z0-9_]+$/;
const REPORT_ONLY_RULE_KINDS = new Set(['bracket', 'object-literal']);
const RULE_LABELS = new Map([
  ['dot', '点访问'],
  ['bracket', '方括号访问'],
  ['object-literal', '对象字面量写入'],
]);

const EXTERNAL_PROTOCOL_SNAKE_FIELDS = new Set([
  'arena_history',
  'current_state',
  'current_state_summary',
  'world_line_id',
  'native_allowed',
  'template_id',
  'first_mes',
  'mes_example',
  'system_prompt',
  'character_book',
  'character_version',
  'group_only_greetings',
  'alternate_greetings',
  'post_history_instructions',
  'scenario_type',
  'scenario_title',
  'generation_mode',
  'character_name',
  'character_guidance',
  'creator_notes',
  'magic_tea_party',
  'magic_tavern',
  'reasoning_tokens',
  'prompt_tokens',
  'completion_tokens',
  'cached_tokens',
  'total_tokens',
  'use_regex',
  'mask_word',
  'chat_metadata',
  'rules_json',
  'ref_json',
  'extra_json',
  // SillyTavern / Tavern Card 协议字段（外部格式，保留 snake_case）
  'user_name',
  'is_user',
  'is_system',
  'swipe_id',
  'send_date',
  'send_date_utc',
  'create_date',
  'created_at',
  'speaker_id',
  'speaker_name',
  'spec_version',
  'ms_export',
  // A.R.E.N.A / 升华叙事协议字段（历史记录与元数据）
  'user_guidance',
  'non_native_data_involved',
  'questionnaire_lore_used',
  'questionnaire_selection_count',
  'sublimation_count',
  'last_sublimation_at',
  // 外部工作流协议（ComfyUI / LibLib）
  'class_type',
  // SillyTavern Character Book / Lorebook 扩展字段
  'secondary_keys',
  'insertion_order',
  'exclude_recursion',
  'display_index',
  'outlet_name',
  'group_override',
  'group_weight',
  'prevent_recursion',
  'delay_until_recursion',
  'scan_depth',
  'match_whole_words',
  'use_group_scoring',
  'case_sensitive',
  'automation_id',
  'match_persona_description',
  'match_character_description',
  'match_character_personality',
  'match_character_depth_prompt',
  'match_scenario',
  'match_creator_notes',
  'ignore_budget',
]);

const toPosixPath = (value) => value.split(path.sep).join('/');

const isTargetFile = (relativePath) => {
  if (!relativePath) return false;
  const normalized = toPosixPath(relativePath);
  const ext = path.extname(normalized);
  if (!FILE_EXTS.has(ext)) return false;
  if (normalized.endsWith('.d.ts')) return false;
  for (const prefix of BLOCK_EXCLUDE_PREFIXES) {
    if (normalized.startsWith(prefix)) return false;
  }
  return true;
};

const collectFiles = (root, includeDirs) => {
  const files = [];

  const walk = (dirRelative) => {
    const fullDir = path.join(root, dirRelative);
    if (!fs.existsSync(fullDir)) return;

    const dirents = fs.readdirSync(fullDir, { withFileTypes: true });
    for (const dirent of dirents) {
      const nextRelative = toPosixPath(path.join(dirRelative, dirent.name));
      if (dirent.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(dirent.name)) continue;
        walk(nextRelative);
        continue;
      }

      if (dirent.isFile() && isTargetFile(nextRelative)) {
        files.push(nextRelative);
      }
    }
  };

  for (const includeDir of includeDirs) {
    walk(includeDir);
  }
  return files.sort();
};

const normalizeLine = (line) => line.trim().replace(/\s+/g, ' ').slice(0, 220);

const buildSignature = ({ path: filePath, field, kind, normalizedLine }) =>
  `${filePath}::${field}::${kind}::${normalizedLine}`;

const getScriptKind = (filePath) => {
  const ext = path.extname(filePath);
  switch (ext) {
    case '.ts':
      return ts.ScriptKind.TS;
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.js':
      return ts.ScriptKind.JS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.mjs':
      return ts.ScriptKind.JS;
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.Unknown;
  }
};

const isSnakeField = (field) => SNAKE_CASE_RE.test(field);

const isReportOnlyPath = (filePath, workspaceOnly) => (
  (workspaceOnly && filePath.startsWith('apps/'))
  || REPORT_ONLY_DIR_PREFIXES.some((prefix) => filePath.startsWith(prefix))
);

const shouldSkipField = (field) => EXTERNAL_PROTOCOL_SNAKE_FIELDS.has(field);

const classifyScope = (filePath, kind, workspaceOnly) => {
  if (isReportOnlyPath(filePath, workspaceOnly)) return 'report-only';
  if (REPORT_ONLY_RULE_KINDS.has(kind)) return 'report-only';
  return 'block';
};

const createEntry = ({ file, sourceFile, lines, field, kind, node, workspaceOnly }) => {
  if (!field || !isSnakeField(field) || shouldSkipField(field)) return null;

  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const line = position.line + 1;
  const rawLine = lines[position.line] ?? '';
  const normalizedLine = normalizeLine(rawLine);
  const entry = {
    path: file,
    line,
    column: position.character + 1,
    field,
    kind,
    scope: classifyScope(file, kind, workspaceOnly),
    normalizedLine,
  };
  return {
    ...entry,
    signature: buildSignature(entry),
  };
};

const tryGetComputedStringName = (nameNode) => {
  if (!ts.isComputedPropertyName(nameNode)) return null;
  const expression = nameNode.expression;
  if (ts.isStringLiteralLike(expression)) return expression.text;
  return null;
};

const getObjectLiteralKey = (nameNode) => {
  if (ts.isIdentifier(nameNode)) return nameNode.text;
  if (ts.isStringLiteralLike(nameNode)) return nameNode.text;
  return tryGetComputedStringName(nameNode);
};

const collectViolations = (root, workspaceOnly) => {
  const rows = [];
  const includeDirs = workspaceOnly ? WORKSPACE_INCLUDE_DIRS : LEGACY_INCLUDE_DIRS;
  const files = collectFiles(root, includeDirs);

  for (const file of files) {
    const absolutePath = path.join(root, file);
    const text = fs.readFileSync(absolutePath, 'utf8');
    const lines = text.split(/\r?\n/);
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      getScriptKind(file),
    );

    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node)) {
        const field = node.name.text;
        const entry = createEntry({
          file,
          sourceFile,
          lines,
          field,
          kind: 'dot',
          node: node.name,
          workspaceOnly,
        });
        if (entry) rows.push(entry);
      }

      if (ts.isElementAccessExpression(node)) {
        const arg = node.argumentExpression;
        if (arg && ts.isStringLiteralLike(arg)) {
          const field = arg.text;
          const entry = createEntry({
            file,
            sourceFile,
            lines,
            field,
            kind: 'bracket',
            node: arg,
            workspaceOnly,
          });
          if (entry) rows.push(entry);
        }
      }

      if (ts.isPropertyAssignment(node)) {
        const field = getObjectLiteralKey(node.name);
        const entry = createEntry({
          file,
          sourceFile,
          lines,
          field,
          kind: 'object-literal',
          node: node.name,
          workspaceOnly,
        });
        if (entry) rows.push(entry);
      }

      if (ts.isShorthandPropertyAssignment(node)) {
        const field = node.name.text;
        const entry = createEntry({
          file,
          sourceFile,
          lines,
          field,
          kind: 'object-literal',
          node: node.name,
          workspaceOnly,
        });
        if (entry) rows.push(entry);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return rows;
};

const groupBySignature = (rows) => {
  const map = new Map();
  for (const row of rows) {
    const existing = map.get(row.signature);
    if (existing) {
      existing.count += 1;
      if (existing.samples.length < 3) {
        existing.samples.push({ path: row.path, line: row.line, column: row.column });
      }
      continue;
    }

    map.set(row.signature, {
      signature: row.signature,
      path: row.path,
      field: row.field,
      kind: row.kind,
      scope: row.scope,
      normalizedLine: row.normalizedLine,
      count: 1,
      samples: [{ path: row.path, line: row.line, column: row.column }],
    });
  }
  return map;
};

const sortEntries = (entries) => {
  return [...entries].sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.field !== b.field) return a.field.localeCompare(b.field);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.normalizedLine.localeCompare(b.normalizedLine);
  });
};

const buildRuleStats = (entries) => {
  const ruleCounts = new Map();
  for (const entry of entries) {
    ruleCounts.set(entry.kind, (ruleCounts.get(entry.kind) ?? 0) + 1);
  }
  const parts = [];
  for (const key of ['dot', 'bracket', 'object-literal']) {
    const count = ruleCounts.get(key);
    if (!count) continue;
    parts.push(`${RULE_LABELS.get(key)}: ${count}`);
  }
  return parts.join('，');
};

const printViolations = (entries, title, maxItems) => {
  const sorted = [...entries].sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.field !== b.field) return a.field.localeCompare(b.field);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.normalizedLine.localeCompare(b.normalizedLine);
  });

  const stats = buildRuleStats(sorted);
  const head = stats ? `${title}（共 ${sorted.length} 条，${stats}）` : `${title}（共 ${sorted.length} 条）`;
  console.error(head);
  for (const entry of sorted.slice(0, maxItems)) {
    const sample = entry.samples[0];
    const where = sample ? `${sample.path}:${sample.line}:${sample.column}` : entry.path;
    const ruleLabel = RULE_LABELS.get(entry.kind) ?? entry.kind;
    console.error(`- ${where}  字段: ${entry.field}  规则: ${ruleLabel}`);
    console.error(`  代码: ${entry.normalizedLine}`);
  }
  if (sorted.length > maxItems) {
    console.error(`... 其余 ${sorted.length - maxItems} 条省略`);
  }
};

export const checkNamingConventions = (
  root = process.cwd(),
  { workspaceOnly = false } = {},
) => {
  const rows = collectViolations(path.resolve(root), workspaceOnly);
  const currentMap = groupBySignature(rows);
  const violations = sortEntries([...currentMap.values()]);
  const blockingViolations = violations.filter((row) => row.scope === 'block');
  const reportOnlyViolations = violations.filter((row) => row.scope === 'report-only');
  return { blockingViolations, reportOnlyViolations };
};

const main = () => {
  const args = new Set(process.argv.slice(2));
  const reportOnly = args.has('--report-only');
  const workspaceOnly = args.has('--workspace-only');
  const { blockingViolations, reportOnlyViolations } = checkNamingConventions(
    process.cwd(),
    { workspaceOnly },
  );

  if (blockingViolations.length > 0) {
    printViolations(blockingViolations, '[check:naming] 检测到 snake_case 违规（阻断）', MAX_BLOCK_REPORT_ITEMS);
    if (reportOnlyViolations.length > 0) {
      printViolations(
        reportOnlyViolations,
        '[check:naming] 附加审计（report-only，不阻断）',
        MAX_REPORT_ONLY_ITEMS,
      );
    }
    console.error('[check:naming] 请将字段统一为 camelCase；外部协议字段若需保留 snake_case，请先补适配层。');
    if (reportOnly) {
      console.error('[check:naming] report-only 模式：本次不阻断。');
      process.exit(0);
    }
    process.exitCode = 1;
    return;
  }

  if (reportOnlyViolations.length > 0) {
    printViolations(
      reportOnlyViolations,
      '[check:naming] 审计发现（report-only，不阻断）',
      MAX_REPORT_ONLY_ITEMS,
    );
    console.log('[check:naming] 通过（仅存在 report-only 审计项）。');
    process.exit(0);
  }

  console.log('[check:naming] 通过（未发现 snake_case 命名违规）。');
};

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile && pathToFileURL(invokedFile).href === pathToFileURL(currentFile).href) {
  main();
}
