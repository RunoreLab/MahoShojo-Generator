import { readFileSync } from 'node:fs';

import * as domainGameCard from '@mahoshojo/domain/game-card';
import * as packageRuntime from '@mahoshojo/hosted-runtime/generate-game-card-runtime';
import { handler as nextHandler } from '@/app/api/generate-game-card/handler';
import * as rootGameCardConfig from '@/lib/game-card/config';
import * as legacyRuntime from '@/lib/hosted-api/generate-game-card';
import * as rootGameCardSchema from '@/lib/schemas/game-card';
import { POST as honoHandler } from '@/server/adapters/generate-game-card';

describe('generate game card runtime ownership', () => {
  test('domain 持有 canonical schema/config identity', () => {
    expect(rootGameCardSchema.GameCardFaceDataSchema)
      .toBe(domainGameCard.GameCardFaceDataSchema);
    expect(rootGameCardConfig.gameCardGenerationConfig)
      .toBe(domainGameCard.GAME_CARD_GENERATION_CONFIG);
  });

  test('hosted-runtime 持有唯一 composition，Next/Hono 绑定同一 singleton', () => {
    expect(nextHandler).toBe(legacyRuntime.defaultGenerateGameCardService);
    expect(honoHandler).toBe(legacyRuntime.defaultGenerateGameCardService);
    expect('createDefaultGenerateGameCardService' in legacyRuntime).toBe(false);
    expect('defaultGenerateGameCardRuntime' in legacyRuntime).toBe(false);
    expect('resolveCustomProviderRuntime' in packageRuntime).toBe(false);
    expect(packageRuntime.GAME_CARD_ACTION_TYPE).toBe('free_generate');
  });

  test('package 源码不回连 root/app/runtime framework 或全局配置', () => {
    const runtimeSource = readFileSync(
      new URL('../packages/hosted-runtime/src/generate-game-card-runtime.ts', import.meta.url),
      'utf8',
    );
    const providerSource = readFileSync(
      new URL('../packages/hosted-runtime/src/custom-provider-runtime.ts', import.meta.url),
      'utf8',
    );
    for (const source of [runtimeSource, providerSource]) {
      expect(source).not.toMatch(/from\s+['"]@\//);
      expect(source).not.toMatch(/from\s+['"](?:next|hono)(?:\/|['"])/);
      expect(source).not.toMatch(/process\.env|cloudflare|app\/|server\//i);
      expect(source).not.toMatch(/configure|globalThis|\bset[A-Z]\w*Runtime/);
      expect(source).not.toMatch(/signature|\bsign\s*[:(]/i);
    }
  });

  test('root adapter 不再定义 schema/prompt 或无消费者过渡 factory', () => {
    const runtimeSource = readFileSync(
      new URL('../lib/hosted-api/generate-game-card.ts', import.meta.url),
      'utf8',
    );
    const schemaSource = readFileSync(
      new URL('../lib/schemas/game-card.ts', import.meta.url),
      'utf8',
    );
    const configSource = readFileSync(
      new URL('../lib/game-card/config.ts', import.meta.url),
      'utf8',
    );
    expect(runtimeSource).not.toMatch(/createDefaultGenerateGameCardService|z\.object/);
    expect(runtimeSource).not.toMatch(/const\s+resolveProviderOptions/);
    expect(schemaSource).toContain("from '@mahoshojo/domain/game-card'");
    expect(configSource).toContain("from '@mahoshojo/domain/game-card'");
  });
});
