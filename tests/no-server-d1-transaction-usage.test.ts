import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@typescript-eslint/typescript-estree';

type TransactionViolation = {
  filePath: string;
  line: number;
  column: number;
  snippet: string;
};

const repoRoot = process.cwd();
const sourceRoots = ['app', 'components', 'lib', 'pages', 'scripts'];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const allowedTransactionFiles = new Set([
  // 仅允许浏览器端 IndexedDB 存储模块使用 transaction。
  'lib/magic-tea-party/storage.ts',
  'lib/ai-session/battle-story/storage.ts',
  'lib/challenge/storage.ts',
]);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeRelativePath = (filePath: string): string => filePath.split(path.sep).join('/');

const shouldScanFile = (relativePath: string): boolean => {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized.startsWith('tests/')) return false;
  if (normalized.includes('/__tests__/')) return false;
  if (normalized.includes('/node_modules/')) return false;
  if (normalized.includes('/.next/')) return false;
  return sourceExtensions.has(path.extname(normalized));
};

const collectSourceFiles = async (relativeDir: string): Promise<string[]> => {
  const absoluteDir = path.join(repoRoot, relativeDir);
  try {
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectSourceFiles(relativePath)));
        continue;
      }
      if (entry.isFile() && shouldScanFile(relativePath)) {
        files.push(normalizeRelativePath(relativePath));
      }
    }

    return files;
  } catch {
    return [];
  }
};

const getMemberPropertyName = (node: Record<string, unknown>): string | null => {
  const property = node.property;
  const computed = node.computed === true;

  if (!computed && isObjectRecord(property) && property.type === 'Identifier' && typeof property.name === 'string') {
    return property.name;
  }

  if (computed && isObjectRecord(property) && property.type === 'Literal' && typeof property.value === 'string') {
    return property.value;
  }

  return null;
};

const getCalleeMemberExpression = (callee: unknown): Record<string, unknown> | null => {
  if (!isObjectRecord(callee)) return null;
  if (callee.type === 'MemberExpression') return callee;
  if (callee.type === 'ChainExpression' && isObjectRecord(callee.expression) && callee.expression.type === 'MemberExpression') {
    return callee.expression;
  }
  return null;
};

const visitNode = (node: unknown, visitor: (node: Record<string, unknown>) => void): void => {
  if (!isObjectRecord(node)) return;
  visitor(node);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      value.forEach((item) => visitNode(item, visitor));
      continue;
    }
    visitNode(value, visitor);
  }
};

const findTransactionViolations = (filePath: string, sourceText: string): TransactionViolation[] => {
  const extension = path.extname(filePath).toLowerCase();
  const enableJsx = extension === '.tsx' || extension === '.jsx';
  const ast = parse(sourceText, {
    filePath,
    loc: true,
    range: true,
    jsx: enableJsx,
    comment: false,
    sourceType: 'module',
  });

  const violations: TransactionViolation[] = [];

  visitNode(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const memberExpression = getCalleeMemberExpression(node.callee);
    if (!memberExpression) return;

    if (getMemberPropertyName(memberExpression) !== 'transaction') return;

    const loc = isObjectRecord(node.loc) && isObjectRecord(node.loc.start) ? node.loc.start : null;
    const range = Array.isArray(node.range) ? node.range : null;
    const start = typeof range?.[0] === 'number' ? range[0] : 0;
    const end = typeof range?.[1] === 'number' ? range[1] : Math.min(sourceText.length, start + 120);
    const snippet = sourceText
      .slice(start, end)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)[0] ?? '.transaction(...)';

    violations.push({
      filePath,
      line: typeof loc?.line === 'number' ? loc.line : 1,
      column: typeof loc?.column === 'number' ? loc.column + 1 : 1,
      snippet,
    });
  });

  return violations;
};

describe('server D1 transaction guard', () => {
  test('除显式白名单外，源码中不允许再出现 .transaction() 调用', async () => {
    const sourceFiles = (
      await Promise.all(sourceRoots.map((relativeDir) => collectSourceFiles(relativeDir)))
    ).flat();

    const violations: TransactionViolation[] = [];

    for (const filePath of sourceFiles) {
      if (allowedTransactionFiles.has(filePath)) continue;
      const absolutePath = path.join(repoRoot, filePath);
      const sourceText = await readFile(absolutePath, 'utf8');
      if (!sourceText.includes('.transaction')) continue;
      violations.push(...findTransactionViolations(filePath, sourceText));
    }

    const message = violations
      .map((item) => `- ${item.filePath}:${item.line}:${item.column} -> ${item.snippet}`)
      .join('\n');

    expect(
      violations,
      message ||
        '检测通过：未在服务端源码中发现新的 .transaction() 调用；如需新增显式例外，请先评估是否为浏览器 IndexedDB 场景。',
    ).toEqual([]);
  });
});
