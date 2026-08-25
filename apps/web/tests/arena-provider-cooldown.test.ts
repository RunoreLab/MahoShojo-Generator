import { describe, expect, test } from 'vitest';

import { resolveArenaProviderCooldownConfig } from '@/components/arena/utils/providerCooldown';

describe('arena provider cooldown config', () => {
  test('默认系统通道维持 system 模式和 120 秒冷却', () => {
    expect(
      resolveArenaProviderCooldownConfig({
        providerId: 'system',
        modelId: 'default',
        apiKey: '',
      })
    ).toEqual({
      currentMode: 'system',
      systemDurationMs: 120000,
      customDurationMs: 3000,
    });
  });

  test('填写自定义 provider 的 API Key 后切换到 custom 模式', () => {
    expect(
      resolveArenaProviderCooldownConfig({
        providerId: 'kourichat',
        modelId: 'gemini-2.5-flash',
        apiKey: 'sk-test',
      })
    ).toEqual({
      currentMode: 'custom',
      systemDurationMs: 120000,
      customDurationMs: 3000,
    });
  });

  test('未填写 API Key 的自定义 provider 仍视为 system 模式', () => {
    expect(
      resolveArenaProviderCooldownConfig({
        providerId: 'kourichat',
        modelId: 'gemini-2.5-flash',
        apiKey: '   ',
      })
    ).toEqual({
      currentMode: 'system',
      systemDurationMs: 120000,
      customDurationMs: 3000,
    });
  });
});
