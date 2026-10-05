import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { appRouteHandler } from '@/app/api/arena/redo-combatant-updates/handler';

describe('旧版 Arena 角色重做入口', () => {
  it('以 410 明确拒绝旧 POST，并保留方法边界', async () => {
    const post = await appRouteHandler(new Request('http://localhost/api/arena/redo-combatant-updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }) as never);
    expect(post.status).toBe(410);
    await expect(post.json()).resolves.toMatchObject({
      code: 'ARENA_REDO_RETIRED',
    });

    const get = await appRouteHandler(new Request('http://localhost/api/arena/redo-combatant-updates') as never);
    expect(get.status).toBe(405);
  });

  it('不再调用 AI，也不再从客户端输入重签角色卡', () => {
    const handlerSource = readFileSync('app/api/arena/redo-combatant-updates/handler.ts', 'utf8');
    const serviceSource = readFileSync('lib/arena/service.ts', 'utf8');

    expect(handlerSource).not.toContain('generateWithAI');
    expect(handlerSource).not.toContain('redoPostBattleUpdates');
    expect(serviceSource).not.toContain('redoPostBattleUpdates');
  });
});
