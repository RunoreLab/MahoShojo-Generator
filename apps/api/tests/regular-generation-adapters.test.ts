import { describe, expect, it } from 'vitest';

import {
  defaultGenerateCanshouService,
  defaultGenerateCanshouStreamService,
  defaultGenerateCreatorService,
  defaultGenerateCreatorStreamService,
  defaultGenerateFreeService,
  defaultGenerateFreeStreamService,
  defaultGenerateGameCardService,
  defaultGenerateMagicalGirlService,
  defaultGenerateMagicalGirlDetailsService,
  defaultGenerateMagicalGirlDetailsStreamService,
  defaultGenerateScenarioService,
  defaultGenerateScenarioStreamService,
  defaultGenerateSublimationService,
  defaultGenerateSublimationStreamService,
} from '@mahoshojo/hosted-runtime/node-runtime/default-services';
import { POST as honoCreator } from '#/adapters/creator/generate';
import { POST as honoCreatorStream } from '#/adapters/creator/generate-stream';
import { POST as honoCanshou } from '#/adapters/generate-canshou';
import { POST as honoCanshouStream } from '#/adapters/generate-canshou-stream';
import { POST as honoFree } from '#/adapters/generate-free';
import { POST as honoFreeStream } from '#/adapters/generate-free-stream';
import { POST as honoGameCard } from '#/adapters/generate-game-card';
import { POST as honoMagicalGirl } from '#/adapters/generate-magical-girl';
import {
  POST as honoMagicalGirlDetails,
  hostedService as honoMagicalGirlDetailsCore,
} from '#/adapters/generate-magical-girl-details';
import {
  POST as honoMagicalGirlDetailsStream,
  hostedService as honoMagicalGirlDetailsStreamCore,
} from '#/adapters/generate-magical-girl-details-stream';
import { POST as honoScenario } from '#/adapters/generate-scenario';
import { POST as honoScenarioStream } from '#/adapters/generate-scenario-stream';
import {
  POST as honoSublimation,
  hostedService as honoSublimationCore,
} from '#/adapters/generate-sublimation';
import {
  POST as honoSublimationStream,
  hostedService as honoSublimationStreamCore,
} from '#/adapters/generate-sublimation-stream';

describe('常规 Hosted generation runtime adapters', () => {
  it('十四条 Hono 适配器使用 package 默认 service composition', () => {
    expect(honoFree).toBe(defaultGenerateFreeService);
    expect(honoFreeStream).toBe(defaultGenerateFreeStreamService);
    expect(honoGameCard).toBe(defaultGenerateGameCardService);
    expect(honoMagicalGirl).toBe(defaultGenerateMagicalGirlService);
    expect(honoCreator).toBe(defaultGenerateCreatorService);
    expect(honoCreatorStream).toBe(defaultGenerateCreatorStreamService);
    expect(honoCanshou).toBe(defaultGenerateCanshouService);
    expect(honoCanshouStream).toBe(defaultGenerateCanshouStreamService);
    expect(honoScenario).toBe(defaultGenerateScenarioService);
    expect(honoScenarioStream).toBe(defaultGenerateScenarioStreamService);
    expect(honoMagicalGirlDetailsCore).toBe(defaultGenerateMagicalGirlDetailsService);
    expect(honoMagicalGirlDetailsStreamCore).toBe(defaultGenerateMagicalGirlDetailsStreamService);
    expect(honoSublimationCore).toBe(defaultGenerateSublimationService);
    expect(honoSublimationStreamCore).toBe(defaultGenerateSublimationStreamService);
    expect(honoMagicalGirlDetails).not.toBe(honoMagicalGirlDetailsCore);
    expect(honoMagicalGirlDetailsStream).not.toBe(honoMagicalGirlDetailsStreamCore);
    expect(honoSublimation).not.toBe(honoSublimationCore);
    expect(honoSublimationStream).not.toBe(honoSublimationStreamCore);
  });

  it('无需上游调用的 method 与请求校验 wire 保持既有差异', async () => {
    const gameMethod = await honoGameCard(new Request(
      'https://example.test/api/generate-game-card',
      { method: 'GET' },
    ));
    expect(gameMethod.status).toBe(405);
    expect(gameMethod.headers.get('content-type')).toBe('application/json');
    expect(await gameMethod.json()).toEqual({ error: 'Method not allowed' });

    const freeInvalid = await honoFree(new Request(
      'https://example.test/api/generate-free',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema: 'unknown', prompt: 'x', attachments: [] }),
      },
    ));
    expect(freeInvalid.status).toBe(400);
    expect(freeInvalid.headers.get('content-type')).toBe('application/json');
    expect(await freeInvalid.json()).toEqual({ error: '请求参数无效' });

    const scenarioInvalid = await honoScenario(new Request(
      'https://example.test/api/generate-scenario',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: {} }),
      },
    ));
    expect(scenarioInvalid.status).toBe(400);
    expect(scenarioInvalid.headers.get('content-type')).toBe('text/plain;charset=UTF-8');
    expect(await scenarioInvalid.json()).toEqual({ error: 'Answers object is required' });

    const scenarioStreamInvalid = await honoScenarioStream(new Request(
      'https://example.test/api/generate-scenario-stream',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [] }),
      },
    ));
    expect(scenarioStreamInvalid.status).toBe(400);
    expect(scenarioStreamInvalid.headers.get('content-type')).toBe('application/json');
    expect(await scenarioStreamInvalid.json()).toEqual({ error: 'Answers object is required' });

    const canshouNull = await honoCanshou(new Request(
      'https://example.test/api/generate-canshou',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      },
    ));
    expect(canshouNull.status).toBe(500);
    expect(await canshouNull.json()).toEqual({
      error: '生成失败，当前服务器可能正忙，请稍后重试',
      message: '服务器内部错误',
    });
  });
});
