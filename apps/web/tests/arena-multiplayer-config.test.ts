import { describe, expect, it } from 'vitest';

import { resolveArenaMultiplayerConfig } from '@/config/arena-multiplayer';
import {
  hostedDrClientRouting,
  hostedDrPreviewOrigin,
  hostedDrStableOrigin,
} from '@/config/hosted-dr-client.generated';

describe('Arena multiplayer browser feature flag', () => {
  it('production 只凭单一公开 flag 启用，并从 Hosted manifest 选择 ingress', () => {
    expect(resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: 'https://stable-control-plane.example.test',
      target: 'production',
    })).toEqual({ enabled: true, origin: hostedDrClientRouting.primaryOrigin });
  });

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

  it('protected target 从 Hosted manifest 选择 Hono ingress', () => {
    expect(resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: 'https://api.example.test',
      target: 'production',
    })).toEqual({ enabled: true, origin: hostedDrClientRouting.primaryOrigin });

    expect(resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: 'https://stable-control-plane.example.test',
      target: 'preview',
    })).toEqual({ enabled: true, origin: hostedDrPreviewOrigin });
  });

  it('Room endpoint 不受 optional Hosted DR control-plane provisioning 门禁影响', () => {
    expect(resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: hostedDrStableOrigin,
      target: 'production',
    })).toEqual({ enabled: true, origin: hostedDrClientRouting.primaryOrigin });
    expect(hostedDrClientRouting.primaryOrigin).not.toBe(hostedDrStableOrigin);
  });
});
