import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 从 `exports` 派生入口清单，而不是手写。
 *
 * 手写清单会随新子路径漏改，而漏掉的那一个恰好是**唯一没被门禁覆盖的新入口**——门禁因此
 * 看起来是绿的，实际对新入口零约束。`./web-package-record` 就这样漏过一轮。
 */
const publicEntrypoints = (): readonly string[] => {
  const manifest = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
    name?: string;
    exports?: Record<string, unknown>;
  };
  const packageName = manifest.name ?? '@mahoshojo/local-library';
  return Object.keys(manifest.exports ?? {}).map((subpath) =>
    subpath === '.' ? packageName : `${packageName}/${subpath.replace(/^\.\//u, '')}`,
  );
};

describe('local-library public entrypoints', () => {
  const entrypoints = publicEntrypoints();

  it('discovers every declared export subpath', () => {
    // 自身就是门禁的一部分：若 exports 解析不出子路径，下面的 it.each 会静默零用例通过。
    expect(entrypoints).toContain('@mahoshojo/local-library');
    expect(entrypoints).toContain('@mahoshojo/local-library/digest');
  });

  it.each(entrypoints)('bundles %s for Node, browser, and neutral targets', async (entrypoint) => {
    for (const platform of ['node', 'browser', 'neutral'] as const) {
      const result = await build({
        absWorkingDir: process.cwd(),
        bundle: true,
        write: false,
        metafile: true,
        platform,
        format: 'esm',
        stdin: {
          contents: `import * as publicApi from '${entrypoint}'; export { publicApi };`,
          loader: 'ts',
          resolveDir: process.cwd(),
          sourcefile: `local-library-${platform}.ts`,
        },
      });

      const inputs = Object.keys(result.metafile?.inputs ?? {});
      expect(inputs.some((input) => /(?:^|\/)(?:react|next|hono|drizzle-orm|better-sqlite3)(?:\/|$)/u.test(input))).toBe(false);
      expect(result.outputFiles[0]?.text ?? '').not.toMatch(/process\.env|indexedDB|localStorage|navigator\./u);
    }
  });
});
