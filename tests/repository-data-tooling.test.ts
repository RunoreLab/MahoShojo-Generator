import { readFileSync } from 'node:fs';
import path from 'node:path';

const rootDirectory = process.cwd();
const read = (relativePath: string): string =>
  readFileSync(path.join(rootDirectory, relativePath), 'utf8');

describe('G25D repository data tooling ownership', () => {
  test.each([
    'scripts/d1-migrate-safe.mjs',
    'scripts/d1-release-status.mjs',
  ])('%s uses the app-owned pinned Wrangler without network fallback', (scriptPath) => {
    const source = read(scriptPath);

    expect(source).toContain("spawnSync('pnpm'");
    expect(source).toContain("'--filter', WRANGLER_WORKSPACE, 'exec', 'wrangler'");
    expect(source).toContain("const WRANGLER_WORKSPACE = '@mahoshojo/web';");
    expect(source).not.toContain("spawnSync('npx'");
    expect(source).not.toContain("'--yes'");
  });

  test('root backfill compatibility proxy loads app env before root fallback', () => {
    const source = read('apps/web/scripts/backfill-user-auth-links.ts');

    expect(source).toContain("new URL('../', import.meta.url)");
    expect(source).toContain("new URL('../../../', import.meta.url)");
    expect(source).toContain(
      'loadApplicationEnvironmentWithRootFallback(applicationDirectory, repositoryRoot, true);',
    );
  });
});
