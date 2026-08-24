import { readFileSync } from 'node:fs';

import * as aiCoreGameCard from '@mahoshojo/ai-core/game-card-generation';
import * as contractsGameCard from '@mahoshojo/contracts/game-card';
import * as packageRuntime from '@mahoshojo/hosted-runtime/generate-game-card-runtime';
import { handler as nextHandler } from '@/app/api/generate-game-card/handler';
import * as rootGameCardConfig from '@/lib/game-card/config';
import * as gameCardPresentation from '@/lib/game-card/presentation';
import * as legacyRuntime from '@/lib/hosted-api/generate-game-card';
import * as rootGameCardSchema from '@/lib/schemas/game-card';
import { POST as honoHandler } from '@/server/adapters/generate-game-card';

describe('generate game card runtime ownership', () => {
  test('contracts 与 ai-core 分别持有 canonical schema/config identity', () => {
    expect(rootGameCardSchema.GameCardFaceDataSchema)
      .toBe(contractsGameCard.GameCardFaceDataSchema);
    expect(rootGameCardConfig.gameCardGenerationConfig)
      .toBe(aiCoreGameCard.GAME_CARD_GENERATION_CONFIG);
    expect(rootGameCardSchema.GAME_CARD_SYSTEM_PROMPT)
      .toBe(aiCoreGameCard.GAME_CARD_SYSTEM_PROMPT);
    expect(rootGameCardSchema.buildGameCardGenerationPrompt)
      .toBe(aiCoreGameCard.buildGameCardGenerationPrompt);
    expect(rootGameCardSchema.GAME_CARD_GENERATION_CONFIG)
      .toBe(aiCoreGameCard.GAME_CARD_GENERATION_CONFIG);
    expect(rootGameCardSchema.RARITY_LABELS).toBe(gameCardPresentation.RARITY_LABELS);
    expect(rootGameCardSchema.CARD_TYPE_LABELS).toBe(gameCardPresentation.CARD_TYPE_LABELS);
    expect(rootGameCardSchema.ELEMENT_LABELS).toBe(gameCardPresentation.ELEMENT_LABELS);
    expect(rootGameCardSchema.RARITY_COLORS).toBe(gameCardPresentation.RARITY_COLORS);
    expect(rootGameCardSchema.ELEMENT_COLORS).toBe(gameCardPresentation.ELEMENT_COLORS);
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
    const domainSource = readFileSync(
      new URL('../packages/domain/src/game-card.ts', import.meta.url),
      'utf8',
    );
    const presentationSource = readFileSync(
      new URL('../lib/game-card/presentation.ts', import.meta.url),
      'utf8',
    );
    expect(runtimeSource).not.toMatch(/createDefaultGenerateGameCardService|z\.object/);
    expect(runtimeSource).not.toMatch(/const\s+resolveProviderOptions/);
    expect(schemaSource).toContain("from '@mahoshojo/contracts/game-card'");
    expect(schemaSource).toContain("from '@mahoshojo/domain/game-card'");
    expect(configSource).toContain("from '@mahoshojo/ai-core/game-card-generation'");
    expect(domainSource).not.toMatch(
      /GAME_CARD_SYSTEM_PROMPT|GameCardGenerationConfig|RARITY_LABELS|CARD_TYPE_LABELS|ELEMENT_LABELS|RARITY_COLORS|ELEMENT_COLORS/,
    );
    expect(presentationSource).toMatch(/RARITY_LABELS|RARITY_COLORS|ELEMENT_COLORS/);
  });
});
