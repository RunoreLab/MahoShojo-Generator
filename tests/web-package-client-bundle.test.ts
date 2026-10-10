import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('真实 Web 包 frame 的 client bundle 边界', () => {
  it('客户端只带 runner 路径，不导入服务端 composer 或 Desktop transport 政策', async () => {
    const result = await build({
      absWorkingDir: root,
      entryPoints: ['apps/web/components/arena/components/WebPackageFrame.tsx'],
      tsconfig: 'apps/web/tsconfig.json',
      bundle: true,
      write: false,
      metafile: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      jsx: 'automatic',
      minify: true,
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const code = result.outputFiles.map((file) => file.text).join('\n');
    const desktopOrigins = code.match(/maho-webpkg:\/\/localhost|http:\/\/maho-webpkg\.localhost/gu) ?? [];
    expect(desktopOrigins).toEqual([]);
    expect(code).toContain('/__web-package__/runner');
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some((path) => path.endsWith('/web-package/runner-client.ts'))).toBe(true);
    for (const path of [
      'apps/web/lib/web-package/runner.ts',
      'apps/web/lib/security/browser-headers.ts',
      'packages/web-package/src/execution-policy.ts',
      'packages/web-package/src/desktop-execution-policy.ts',
    ]) {
      expect(inputs.some((input) => input.endsWith(path)), path).toBe(false);
    }
  });
});
