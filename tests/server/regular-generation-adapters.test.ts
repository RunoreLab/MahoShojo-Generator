import { describe, expect, it } from 'vitest';

import { appRouteHandler as nextFree } from '@/app/api/generate-free/handler';
import { appRouteHandler as nextFreeStream } from '@/app/api/generate-free-stream/handler';
import { handler as nextGameCard } from '@/app/api/generate-game-card/handler';
import { appRouteHandler as nextCreator } from '@/app/api/creator/generate/handler';
import { appRouteHandler as nextCreatorStream } from '@/app/api/creator/generate-stream/handler';
import { appRouteHandler as nextCanshou } from '@/app/api/generate-canshou/handler';
import { appRouteHandler as nextCanshouStream } from '@/app/api/generate-canshou-stream/handler';
import { appRouteHandler as nextScenario } from '@/app/api/generate-scenario/handler';
import { appRouteHandler as nextScenarioStream } from '@/app/api/generate-scenario-stream/handler';
import { POST as honoCreator } from '@/server/adapters/creator/generate';
import { POST as honoCreatorStream } from '@/server/adapters/creator/generate-stream';
import { POST as honoCanshou } from '@/server/adapters/generate-canshou';
import { POST as honoCanshouStream } from '@/server/adapters/generate-canshou-stream';
import { POST as honoFree } from '@/server/adapters/generate-free';
import { POST as honoFreeStream } from '@/server/adapters/generate-free-stream';
import { POST as honoGameCard } from '@/server/adapters/generate-game-card';
import { POST as honoScenario } from '@/server/adapters/generate-scenario';
import { POST as honoScenarioStream } from '@/server/adapters/generate-scenario-stream';

describe('常规 Hosted generation runtime adapters', () => {
  it('Next 与 Hono 适配器使用同一默认 service composition', () => {
    expect(honoFree).toBe(nextFree);
    expect(honoFreeStream).toBe(nextFreeStream);
    expect(honoGameCard).toBe(nextGameCard);
    expect(honoCreator).toBe(nextCreator);
    expect(honoCreatorStream).toBe(nextCreatorStream);
    expect(honoCanshou).toBe(nextCanshou);
    expect(honoCanshouStream).toBe(nextCanshouStream);
    expect(honoScenario).toBe(nextScenario);
    expect(honoScenarioStream).toBe(nextScenarioStream);
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
      message: "Cannot destructure property 'answers' of 'parsedBody' as it is null.",
    });
  });
});
