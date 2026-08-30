import { describe, expect, it } from 'vitest';

import { resolveArenaMultiplayerConfig } from '@/config/arena-multiplayer';

describe('Arena multiplayer browser feature flag', () => {
  const roomTargets = {
    production: {
      logicalOrigin: 'https://api.example.test',
      provisioning: 'provisioned' as const,
    },
    preview: {
      logicalOrigin: 'https://preview-api.example.test',
      provisioning: 'provisioned' as const,
    },
  };

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

  it('protected target 仅接受已 provision 的独立 logical Room origin 与发布证明', () => {
    const checkpointContract = 'arena-room-authority-v2-generation-payload-digest-v1';
    expect(resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: 'https://homura.example.test',
      target: 'production',
    }, {
      origin: 'https://api.example.test',
      writerActivation: 'enabled',
      readerContract: checkpointContract,
      goNoGo: 'approved',
      targets: roomTargets,
    })).toEqual({ enabled: true, origin: 'https://api.example.test' });

    expect(() => resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: 'https://homura.example.test',
      target: 'production',
    }, {
      origin: 'https://homura.example.test',
      writerActivation: 'enabled',
      readerContract: checkpointContract,
      goNoGo: 'approved',
      targets: roomTargets,
    })).toThrow(/logical Room origin/iu);
  });

  it('protected target 拒绝 writer/reader/go-no-go 任一证明缺失', () => {
    const baseActivation = {
      origin: 'https://api.example.test',
      writerActivation: 'enabled',
      readerContract: 'arena-room-authority-v2-generation-payload-digest-v1',
      goNoGo: 'approved',
      targets: roomTargets,
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

  it('Room provisioning 与 Hosted DR control plane 解耦，preview 可独立开启而 production 仍 fail closed', () => {
    const checkpointContract = 'arena-room-authority-v2-generation-payload-digest-v1';
    expect(resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: 'https://homura-preview.example.test',
      target: 'preview',
    }, {
      origin: 'https://preview-api.example.test',
      writerActivation: 'enabled',
      readerContract: checkpointContract,
      goNoGo: 'approved',
      targets: {
        ...roomTargets,
        production: {
          ...roomTargets.production,
          provisioning: 'not-provisioned',
        },
      },
    })).toEqual({ enabled: true, origin: 'https://preview-api.example.test' });

    expect(() => resolveArenaMultiplayerConfig('true', {
      enabled: true,
      origin: 'https://homura.example.test',
      target: 'production',
    }, {
      origin: 'https://api.example.test',
      writerActivation: 'enabled',
      readerContract: checkpointContract,
      goNoGo: 'approved',
      targets: {
        ...roomTargets,
        production: {
          ...roomTargets.production,
          provisioning: 'not-provisioned',
        },
      },
    })).toThrow(/provision/iu);
  });
});
