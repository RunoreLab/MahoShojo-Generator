import { describe, expect, it } from 'vitest';

import { resolveArenaMultiplayerConfig } from '@/config/arena-multiplayer';

describe('Arena multiplayer browser feature flag', () => {
  it('默认关闭且 flag off 不依赖 Hono placement', () => {
    expect(resolveArenaMultiplayerConfig(undefined, {
      enabled: false,
      origin: 'https://api.example.test',
      target: 'production',
    })).toEqual({ enabled: false, origin: 'https://api.example.test' });
  });

  it('只允许 local/test 且 Hono 已启用时显式开启', () => {
    expect(resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: 'http://127.0.0.1:8787',
      target: 'local',
    })).toEqual({ enabled: true, origin: 'http://127.0.0.1:8787' });
    expect(() => resolveArenaMultiplayerConfig('true', {
      enabled: false,
      origin: 'http://127.0.0.1:8787',
      target: 'test',
    })).toThrow(/Hono.*enabled/u);
  });

  it('production/preview 显式 true 一律拒绝构建', () => {
    for (const target of ['production', 'preview'] as const) {
      expect(() => resolveArenaMultiplayerConfig('true', {
        enabled: true,
        origin: 'https://api.example.test',
        target,
      })).toThrow(/Production Gate/u);
    }
  });
});
