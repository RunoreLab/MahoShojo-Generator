import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadApplicationEnvironmentWithRootFallback } from '@/config/load-root-env-fallback';

const ENV_KEYS = [
  'G25D_ENV_ROOT_ONLY',
  'G25D_ENV_APP_ONLY',
  'G25D_ENV_SHARED',
  'G25D_ENV_EXPLICIT',
] as const;

describe('G25D repository-root env compatibility fallback', () => {
  test('keeps explicit and app-local values above root-only fallback values', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'mahoshojo-g25d-env-'));
    const applicationDirectory = path.join(fixtureRoot, 'apps', 'web');
    await fsMkdir(applicationDirectory);

    await writeFile(
      path.join(fixtureRoot, '.env.test'),
      [
        'G25D_ENV_ROOT_ONLY=root-only',
        'G25D_ENV_SHARED=root-shared',
        'G25D_ENV_EXPLICIT=root-explicit',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(applicationDirectory, '.env.test'),
      [
        'G25D_ENV_APP_ONLY=app-only',
        'G25D_ENV_SHARED=app-shared',
        'G25D_ENV_EXPLICIT=app-explicit',
      ].join('\n'),
      'utf8',
    );

    const previousValues = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.G25D_ENV_EXPLICIT = 'process-explicit';

    try {
      loadApplicationEnvironmentWithRootFallback(applicationDirectory, fixtureRoot, false);

      expect(process.env.G25D_ENV_ROOT_ONLY).toBe('root-only');
      expect(process.env.G25D_ENV_APP_ONLY).toBe('app-only');
      expect(process.env.G25D_ENV_SHARED).toBe('app-shared');
      expect(process.env.G25D_ENV_EXPLICIT).toBe('process-explicit');
    } finally {
      for (const [key, value] of previousValues) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});

async function fsMkdir(directory: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });
}
