import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  MAGICAL_GIRL_DETAILS_SCHEMA,
  buildUnsignedMagicalGirlDetailsCard,
  type MagicalGirlDetailsGenerationInput,
} from '@mahoshojo/ai-core/magical-girl-details-generation';
import {
  buildMagicalGirlDetailsStreamPrompt,
  createMagicalGirlDetailsGenerationConfig,
} from '../src/magical-girl-details-runtime-shared';
import { createGenerateMagicalGirlDetailsRuntime } from '../src/generate-magical-girl-details-runtime';

const legacy = JSON.parse(readFileSync(new URL('../../ai-core/fixtures/magical-girl-details-legacy.json', import.meta.url), 'utf8'));
const digest = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

describe('Hosted details shared core adapter', () => {
  it('复用迁移前 Prompt/schema 基线并仅由 Hosted 包装运行配置', () => {
    for (const fixture of legacy.cases as {
      input: MagicalGirlDetailsGenerationInput & { flowers: string };
      structuredPromptSha256: string;
      streamPromptSha256: string;
    }[]) {
      const context = { providerId: 'test' };
      const config = createMagicalGirlDetailsGenerationConfig(() => fixture.input.flowers, 'model', context);
      expect(config.schema).toBe(MAGICAL_GIRL_DETAILS_SCHEMA);
      expect(config.modelOverride).toBe('model');
      expect(config.generationSettingsContext).toBe(context);
      expect(digest(config.systemPrompt)).toBe(legacy.systemPromptSha256);
      expect(digest(config.promptBuilder(fixture.input))).toBe(fixture.structuredPromptSha256);
      expect(digest(buildMagicalGirlDetailsStreamPrompt({ ...fixture.input, questionnaireLore: fixture.input.loreText })))
        .toBe(fixture.streamPromptSha256);
    }
    const defaults = createMagicalGirlDetailsGenerationConfig(() => '', undefined, undefined);
    expect(defaults).not.toHaveProperty('modelOverride');
    expect(defaults).not.toHaveProperty('generationSettingsContext');
  });

  it('实际 Hosted service 对共享 fixture 构造同一 unsigned 角色卡', async () => {
    const fixture = legacy.cases[0].input as MagicalGirlDetailsGenerationInput & { flowers: string };
    const details = MAGICAL_GIRL_DETAILS_SCHEMA.parse({
      codename: '海棠',
      appearance: { outfit: '', accessories: '', colorScheme: '', overallLook: '' },
      magicConstruct: { name: '', form: '', basicAbilities: [], description: '' },
      wonderlandRule: { name: '', description: '', tendency: '', activation: '' },
      blooming: { name: '', evolvedAbilities: [], evolvedForm: '', evolvedOutfit: '', powerLevel: '' },
      analysis: { personalityAnalysis: '', abilityReasoning: '', coreTraits: [], predictionBasis: '', background: { belief: '', bonds: '' } },
    });
    let normalizedInput: MagicalGirlDetailsGenerationInput | undefined;
    const runtime = createGenerateMagicalGirlDetailsRuntime({
      presetIndex: { presets: [] },
      loadPreset: async () => null,
      loadDataCard: async () => null,
      getRandomFlowers: () => fixture.flowers,
      findProvider: () => null,
      resolveModel: () => ({ modelId: 'model' }),
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generateWithAI: async (input) => { normalizedInput = input; return details; },
      sign: async () => { throw new Error('unsigned flow must not sign'); },
      recordActivity: () => {},
      buildResponse: ({ data }) => Response.json(data),
      logInfo: () => {}, logWarn: () => {}, logError: () => {},
    });
    const response = await runtime.service(new Request('https://example.test/api/generate-magical-girl-details', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: fixture.answers, language: fixture.language }),
    }));
    expect(response.status).toBe(200);
    expect(normalizedInput).toBeDefined();
    expect(await response.json()).toEqual(buildUnsignedMagicalGirlDetailsCard(details, normalizedInput!.answers));
  });
});
