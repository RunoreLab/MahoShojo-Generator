import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';

const repoRoot = process.cwd();

const listTsFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((entry) => {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) return listTsFiles(fullPath);
      return fullPath.endsWith('.ts') ? [fullPath] : [];
    });
};

const allowedRouteExports = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'config',
  'dynamic',
  'dynamicParams',
  'fetchCache',
  'maxDuration',
  'preferredRegion',
  'revalidate',
  'runtime',
]);

const namedExportPattern = /export\s+(?:async\s+)?(?:const|function|let|var)\s+([A-Za-z_$][\w$]*)/g;

describe('App Router API migration guard', () => {
  test('生产 API 不应继续放在 pages/api', () => {
    const pagesApiFiles = listTsFiles(join(repoRoot, 'pages/api'))
      .map((file) => relative(repoRoot, file));

    expect(pagesApiFiles).toEqual([]);
  });

  test('app/api route.ts 只导出 Next.js Route Handler 允许的接口', () => {
    const invalidExports = listTsFiles(join(repoRoot, 'app/api'))
      .filter((file) => file.endsWith('/route.ts'))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return Array.from(source.matchAll(namedExportPattern))
          .map((match) => match[1]!)
          .filter((name) => !allowedRouteExports.has(name))
          .map((name) => `${relative(repoRoot, file)}:${name}`);
      });

    expect(invalidExports).toEqual([]);
  });
});
