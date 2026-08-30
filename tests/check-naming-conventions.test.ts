import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkNamingConventions } from '../scripts/check-naming-conventions.mjs';

const temporaryRoots: string[] = [];

async function createFixture(files: Record<string, string>): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'mahoshojo-naming-'));
  temporaryRoots.push(rootDir);
  await Promise.all(Object.entries(files).map(async ([relativePath, contents]) => {
    const targetPath = path.join(rootDir, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, contents, 'utf8');
  }));
  return rootDir;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true })));
});

describe('workspace naming ratchet', () => {
  it('blocks new package dot-access violations and scans apps without reading legacy or generated trees', async () => {
    const rootDir = await createFixture({
      'packages/example/src/index.ts': 'const value = {} as any; void value.internal_name;\n',
      'packages/example/node_modules/generated/index.ts': 'const value = {} as any; void value.generated_name;\n',
      'apps/web/src/index.ts': 'const value = {} as any; void value.migrated_name;\n',
      'lib/legacy.ts': 'const value = {} as any; void value.legacy_name;\n',
    });

    const result = checkNamingConventions(rootDir, { workspaceOnly: true });
    const blockingPaths = result.blockingViolations.map((violation) => violation.path);
    const reportOnlyPaths = result.reportOnlyViolations.map((violation) => violation.path);
    const allFields = [...result.blockingViolations, ...result.reportOnlyViolations]
      .map((violation) => violation.field);

    expect(blockingPaths).toContain('packages/example/src/index.ts');
    expect(reportOnlyPaths).toContain('apps/web/src/index.ts');
    expect(allFields).toContain('internal_name');
    expect(allFields).toContain('migrated_name');
    expect(allFields).not.toContain('generated_name');
    expect(allFields).not.toContain('legacy_name');
  });

  it('keeps app migration findings report-only until an app baseline is established', async () => {
    const rootDir = await createFixture({
      'apps/web/src/index.ts': 'const value = {} as any; void value.migrated_name;\n',
      'lib/legacy.ts': 'const value = {} as any; void value.legacy_name;\n',
    });

    const result = checkNamingConventions(rootDir, { workspaceOnly: true });
    const reportOnlyFields = result.reportOnlyViolations.map((violation) => violation.field);

    expect(result.blockingViolations).toEqual([]);
    expect(result.reportOnlyViolations).toEqual([
      expect.objectContaining({ path: 'apps/web/src/index.ts', field: 'migrated_name', scope: 'report-only' }),
    ]);
    expect(reportOnlyFields).not.toContain('legacy_name');
  });

  it('keeps the relocated Web baseline in strict scans instead of passing on retired root paths', async () => {
    const rootDir = await createFixture({
      'apps/web/lib/runtime.ts': 'const value = {} as any; void value.internal_name;\n',
      'apps/web/lib/db/row.ts': 'const value = {} as any; void value.database_name;\n',
      'lib/retired.ts': 'const value = {} as any; void value.retired_name;\n',
    });

    const result = checkNamingConventions(rootDir);

    expect(result.blockingViolations).toEqual([
      expect.objectContaining({ path: 'apps/web/lib/runtime.ts', field: 'internal_name', scope: 'block' }),
    ]);
    expect(result.reportOnlyViolations).toEqual([
      expect.objectContaining({ path: 'apps/web/lib/db/row.ts', field: 'database_name', scope: 'report-only' }),
    ]);
  });

  it('does not rewrite canonical third-party code in the hosted-runtime vendor boundary', async () => {
    const rootDir = await createFixture({
      'packages/hosted-runtime/src/node-runtime/vendor/upstream.mjs': [
        'const node = { m_values: {} };',
        'void node.m_values;',
      ].join('\n'),
      'packages/hosted-runtime/src/runtime.ts': 'const value = {} as any; void value.internal_name;\n',
    });

    const result = checkNamingConventions(rootDir, { workspaceOnly: true });
    const allFields = [...result.blockingViolations, ...result.reportOnlyViolations]
      .map((violation) => violation.field);

    expect(allFields).not.toContain('m_values');
    expect(allFields).toContain('internal_name');
  });
});
