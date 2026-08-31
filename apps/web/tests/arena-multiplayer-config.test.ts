import { describe, expect, it } from 'vitest';

import { resolveArenaMultiplayerConfig } from '@/config/arena-multiplayer';
import {
  hostedDrClientRouting,
  hostedDrPreviewOrigin,
  hostedDrStableOrigin,
} from '@/config/hosted-dr-client.generated';

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

  it('production/preview 显式 true 但缺少 activation evidence 时 fail closed', () => {
    for (const target of ['production', 'preview'] as const) {
      expect(() => resolveArenaMultiplayerConfig('true', {
        enabled: true,
        origin: 'https://api.example.test',
        target,
      })).toThrow(/activation|provision/iu);
    }
  });

  it('protected target 从 Hosted manifest 选择 Hono ingress 并保留发布证明', () => {
    const checkpointContract = 'arena-room-authority-v2-generation-payload-digest-v1';
    expect(resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: 'https://api.example.test',
      target: 'production',
    }, {
      writerActivation: 'enabled',
      readerContract: checkpointContract,
      goNoGo: 'approved',
    })).toEqual({ enabled: true, origin: hostedDrClientRouting.primaryOrigin });

    expect(resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: 'https://stable-control-plane.example.test',
      target: 'preview',
    }, {
      writerActivation: 'enabled',
      readerContract: checkpointContract,
      goNoGo: 'approved',
    })).toEqual({ enabled: true, origin: hostedDrPreviewOrigin });
  });

  it('protected target 拒绝 writer/reader/go-no-go 任一证明缺失', () => {
    const baseActivation = {
      writerActivation: 'enabled',
      readerContract: 'arena-room-authority-v2-generation-payload-digest-v1',
      goNoGo: 'approved',
    };
    const hostedApi = {
      enabled: true,
      origin: 'https://homura.example.test',
      target: 'production' as const,
    };

    expect(() => resolveArenaMultiplayerConfig('true', hostedApi, {
      ...baseActivation,
      writerActivation: 'disabled',
    })).toThrow(/writer activation/iu);
    expect(() => resolveArenaMultiplayerConfig('true', hostedApi, {
      ...baseActivation,
      readerContract: 'legacy-reader',
    })).toThrow(/reader contract/iu);
    expect(() => resolveArenaMultiplayerConfig('true', hostedApi, {
      ...baseActivation,
      goNoGo: undefined,
    })).toThrow(/go.no.go/iu);
  });

  it('Room endpoint 不受 optional Hosted DR control-plane provisioning 门禁影响', () => {
    const checkpointContract = 'arena-room-authority-v2-generation-payload-digest-v1';
    expect(resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: hostedDrStableOrigin,
      target: 'production',
    }, {
      writerActivation: 'enabled',
      readerContract: checkpointContract,
      goNoGo: 'approved',
    })).toEqual({ enabled: true, origin: hostedDrClientRouting.primaryOrigin });
    expect(hostedDrClientRouting.primaryOrigin).not.toBe(hostedDrStableOrigin);
  });
});
