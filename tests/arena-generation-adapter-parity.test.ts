import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const routes = [
  { route: 'generate-stream', method: 'create' },
  { route: 'generation-requests/[generationRequestId]', method: 'lookup' },
  { route: 'generations/[generationId]/stream', method: 'resume' },
  { route: 'generations/[generationId]', method: 'status' },
  { route: 'generations/[generationId]/cancel', method: 'cancel' },
] as const;

describe('Arena generation adapter parity', () => {
  it.each(routes)('$route Next DR and Hono adapters delegate to the same service method', ({
    route,
    method,
  }) => {
    const nextSource = readFileSync(
      path.join(root, 'app/api/arena', route, 'handler.ts'),
      'utf8',
    );
    const honoSource = readFileSync(
      path.join(root, 'apps/api/src/adapters/arena', `${route}.ts`),
      'utf8',
    );

    expect(nextSource).toContain('getCloudflareDrArenaGenerationService()');
    expect(nextSource).toContain(`.${method}(`);
    expect(honoSource).toContain('registeredArenaGenerationService');
    expect(honoSource).toContain(`.${method}(`);
    expect(nextSource).not.toContain('generateWithStreamAI');
    expect(honoSource).not.toMatch(/app\/api|legacy/u);
  });

  it('both runtime compositions use the package-owned Node generation service', () => {
    const nextRuntime = readFileSync(
      path.join(root, 'app/api/arena/generation-runtime.ts'),
      'utf8',
    );
    const honoRuntime = readFileSync(
      path.join(root, 'apps/api/src/arena-generation/runtime.ts'),
      'utf8',
    );
    expect(nextRuntime).toContain('createNodeArenaGenerationService');
    expect(honoRuntime).toContain('createNodeArenaGenerationService');
    expect(nextRuntime).not.toContain('apps/api');
    expect(honoRuntime).not.toContain('app/api');
  });
});
