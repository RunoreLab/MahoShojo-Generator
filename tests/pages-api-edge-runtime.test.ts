import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';

const repoRoot = process.cwd();

const listTsFiles = (dir: string): string[] => {
  return readdirSync(dir)
    .flatMap((entry) => {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) return listTsFiles(fullPath);
      return fullPath.endsWith('.ts') ? [fullPath] : [];
    });
};

const usesWebResponseApi = (source: string): boolean => {
  return source.includes('new Response(') || source.includes('Promise<Response>') || source.includes('return json(');
};

describe('pages/api Web Response adapter', () => {
  test('Web Response 风格的 Pages API 必须通过 withPagesApiResponse 适配 Pages API res', () => {
    const missing = listTsFiles(join(repoRoot, 'pages/api'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return usesWebResponseApi(source) && !/export\s+default\s+withPagesApiResponse\(/.test(source);
      })
      .map((file) => relative(repoRoot, file));

    expect(missing).toEqual([]);
  });
});
