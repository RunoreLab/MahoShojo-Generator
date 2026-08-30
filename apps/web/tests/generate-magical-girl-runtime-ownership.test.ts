import { readFileSync } from 'node:fs';

import * as packageRuntime from '@mahoshojo/hosted-runtime/generate-magical-girl-runtime';
import * as domainMainColor from '@mahoshojo/domain/main-color';
import { defaultGenerateMagicalGirlService } from '@mahoshojo/hosted-runtime/node-runtime/default-services';
import { appRouteHandler as nextHandler } from '@/app/api/generate-magical-girl/handler';
import * as legacyRuntime from '@/lib/hosted-api/generate-magical-girl';
import * as legacyMainColor from '@/lib/main-color';

describe('generate magical girl runtime ownership', () => {
  test('package 唯一持有 schema，Next 绑定 package default service', () => {
    expect(packageRuntime.MAGICAL_GIRL_GENERATION_CONFIG.schema)
      .toBe(packageRuntime.MAGICAL_GIRL_GENERATION_SCHEMA);
    expect('MagicalGirlGenerationSchema' in legacyRuntime).toBe(false);
    expect('defaultGenerateMagicalGirlRuntime' in legacyRuntime).toBe(false);
    expect(nextHandler).toBe(legacyRuntime.defaultGenerateMagicalGirlService);
    expect(defaultGenerateMagicalGirlService)
      .toBe(legacyRuntime.defaultGenerateMagicalGirlService);
  });

  test('root main-color 复用 domain canonical identity', () => {
    expect(legacyMainColor.MainColor).toBe(domainMainColor.MainColor);
    expect(legacyMainColor.MAIN_COLOR_KEYS).toBe(domainMainColor.MAIN_COLOR_KEYS);
    expect(legacyMainColor.COLOR_GRADIENTS).toBe(domainMainColor.COLOR_GRADIENTS);
    expect(legacyMainColor.getMainColorGradient).toBe(domainMainColor.getMainColorGradient);
  });

  test('package 源码不回连 root/app/runtime framework 或环境变量', () => {
    const source = readFileSync(
      new URL(
        '../../../packages/hosted-runtime/src/generate-magical-girl-runtime.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(source).not.toMatch(/from\s+['"]@\//);
    expect(source).not.toMatch(/from\s+['"](?:next|hono)(?:\/|['"])/);
    expect(source).not.toMatch(/process\.env|cloudflare|app\/|server\//i);
    expect(source).not.toMatch(/configure|globalThis/);
  });

  test('root adapter 不再定义 schema 或 prompt', () => {
    const source = readFileSync(
      new URL('../lib/hosted-api/generate-magical-girl.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/z\.object|promptBuilder\s*:|systemPrompt\s*:/);
    expect(source).not.toContain('createDefaultGenerateMagicalGirlService');
  });

  test('NamePage 从 framework-neutral contract 导入 wire type', () => {
    const source = readFileSync(
      new URL('../components/creation/NamePage.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain("from '@mahoshojo/hosted-api/generate-magical-girl'");
    expect(source).toContain('COLOR_GRADIENTS as gradientColors');
    expect(source).not.toMatch(/const\s+gradientColors\s*=/);
    expect(source).not.toMatch(/app\/api\/generate-magical-girl\/handler/);
    expect(source).not.toMatch(/@mahoshojo\/hosted-runtime/);
  });
});
