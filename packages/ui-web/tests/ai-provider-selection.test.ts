import { describe, expect, it } from 'vitest';

import type { AIProviderOption } from '@mahoshojo/ai-core/provider-catalog';
import { CUSTOM_AI_MODEL_OPTION_VALUE } from '@mahoshojo/ai-core/provider-catalog';

import {
  createAiProviderStorageKeys,
  getGenerationOverridesKey,
  getMaxOutputTokensStorageKey,
  readGenerationOverrides,
  resolveEffectiveModelId,
  resolveModelSelection,
  summarizeProviderAvailability,
  writeGenerationOverrides,
  type AiProviderStoragePort,
} from '../src/ai-provider/index';
import { maskApiKeyForDisplay } from '../src/ai-provider/mask-api-key';
import { resolveAiExecutionLocation } from '../src/ai-provider/execution-location';

const createMemoryStorage = (): AiProviderStoragePort & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

const provider = (overrides: Partial<AIProviderOption> = {}): AIProviderOption => ({
  id: 'prov-a',
  name: 'Provider A',
  description: 'desc',
  docsUrl: 'https://example.test/docs',
  baseUrl: 'https://api.example.test',
  type: 'openai',
  models: [
    { value: 'm1', label: 'M1', description: 'm1 desc' },
    { value: 'm2', label: 'M2', description: 'm2 desc' },
  ],
  ...overrides,
});

describe('createAiProviderStorageKeys', () => {
  it('保持既有 localStorage key 布局兼容', () => {
    const keys = createAiProviderStorageKeys('arena.customProvider');
    expect(keys.selectedProvider).toBe('arena.customProvider.selected');
    expect(getGenerationOverridesKey(keys, 'p1', 'm1')).toBe(
      'arena.customProvider.generationOverrides.p1.m1',
    );
    expect(getMaxOutputTokensStorageKey(keys, 'p1')).toBe(
      'arena.customProvider.maxOutputTokens.p1',
    );
  });
});

describe('resolveModelSelection', () => {
  it('目录命中的模型原样保留', () => {
    expect(resolveModelSelection(provider(), 'm2', '')).toEqual({
      selectedModel: 'm2',
      customModelId: '',
    });
  });

  it('自定义标记且 provider 支持时恢复自定义模式', () => {
    expect(resolveModelSelection(provider(), CUSTOM_AI_MODEL_OPTION_VALUE, 'my-model')).toEqual({
      selectedModel: CUSTOM_AI_MODEL_OPTION_VALUE,
      customModelId: 'my-model',
    });
  });

  it('未收录的 modelId 在支持自定义时折叠为自定义模型', () => {
    expect(resolveModelSelection(provider(), 'unknown-model', '')).toEqual({
      selectedModel: CUSTOM_AI_MODEL_OPTION_VALUE,
      customModelId: 'unknown-model',
    });
  });

  it('不支持自定义时未收录 modelId 回退 provider 默认', () => {
    const noCustom = provider({ baseUrl: '' });
    expect(resolveModelSelection(noCustom, 'unknown-model', '')).toEqual({
      selectedModel: 'm1',
      customModelId: '',
    });
  });
});

describe('resolveEffectiveModelId', () => {
  it('自定义模式取手填 modelId', () => {
    expect(
      resolveEffectiveModelId(provider(), CUSTOM_AI_MODEL_OPTION_VALUE, ' custom-9 '),
    ).toBe('custom-9');
  });

  it('空选择回退 provider 首个模型', () => {
    expect(resolveEffectiveModelId(provider(), '', '')).toBe('m1');
  });
});

describe('read/writeGenerationOverrides', () => {
  const keys = createAiProviderStorageKeys('ns');

  it('读写 provider+model 维度覆盖', () => {
    const storage = createMemoryStorage();
    writeGenerationOverrides(storage, keys, 'p1', 'm1', { temperature: 0.5 });
    expect(readGenerationOverrides(storage, keys, 'p1', 'm1')).toEqual({
      overrides: { temperature: 0.5 },
      migrated: false,
    });
    expect(readGenerationOverrides(storage, keys, 'p1', 'm2').overrides).toBeUndefined();
  });

  it('空覆盖删除 key', () => {
    const storage = createMemoryStorage();
    writeGenerationOverrides(storage, keys, 'p1', 'm1', { temperature: 0.5 });
    writeGenerationOverrides(storage, keys, 'p1', 'm1', undefined);
    expect(storage.map.has('ns.generationOverrides.p1.m1')).toBe(false);
  });

  it('schema 不符的持久化值按损坏缓存移除', () => {
    const storage = createMemoryStorage();
    storage.setItem('ns.generationOverrides.p1.m1', JSON.stringify({ bogus: true }));
    const result = readGenerationOverrides(storage, keys, 'p1', 'm1');
    expect(result.overrides).toBeUndefined();
    expect(storage.map.has('ns.generationOverrides.p1.m1')).toBe(false);
  });

  it('旧 provider 级 maxOutputTokens 迁移到新 key 并删除旧 key', () => {
    const storage = createMemoryStorage();
    storage.setItem('ns.maxOutputTokens.p1', '2048');
    const result = readGenerationOverrides(storage, keys, 'p1', 'm1');
    expect(result).toEqual({ overrides: { maxOutputTokens: 2048 }, migrated: true });
    expect(storage.map.has('ns.maxOutputTokens.p1')).toBe(false);
    expect(storage.map.get('ns.generationOverrides.p1.m1')).toBe(
      JSON.stringify({ maxOutputTokens: 2048 }),
    );
    // 第二次读取不会再触发迁移。
    expect(readGenerationOverrides(storage, keys, 'p1', 'm1').migrated).toBe(false);
  });
});

describe('summarizeProviderAvailability', () => {
  it('无任何条目时返回 undefined', () => {
    expect(summarizeProviderAvailability(provider(), new Map())).toBeUndefined();
  });

  it('聚合模型级数据并优先 1h 窗口', () => {
    const map = new Map([
      [
        'prov-a:m1',
        {
          providerId: 'prov-a',
          modelId: 'm1',
          primary: { window: '1h' as const, successRate: 0.95, status: 'healthy' as const },
        },
      ],
      [
        'prov-a:m2',
        {
          providerId: 'prov-a',
          modelId: 'm2',
          primary: { window: 'none' as const, successRate: null, status: 'unknown' as const },
          reference: { window: '24h' as const, successRate: 0.6, status: 'poor' as const },
        },
      ],
    ]);
    const summary = summarizeProviderAvailability(provider(), map);
    expect(summary?.primary.window).toBe('1h');
    expect(summary?.primary.successRate).toBeCloseTo((0.95 + 0.6) / 2);
    expect(summary?.primary.status).toBe('degraded');
  });

  it('条目存在但无成功率数据时给出 unknown 占位', () => {
    const map = new Map([
      [
        'prov-a:m1',
        {
          providerId: 'prov-a',
          modelId: 'm1',
          primary: { window: 'none' as const, successRate: null, status: 'unknown' as const },
        },
      ],
    ]);
    const summary = summarizeProviderAvailability(provider(), map);
    expect(summary?.primary.status).toBe('unknown');
    expect(summary?.primary.window).toBe('none');
  });
});

describe('maskApiKeyForDisplay', () => {
  it('保留前 6 位并追加掩码', () => {
    expect(maskApiKeyForDisplay('sk-1234567890abcdef')).toBe('sk-123********');
    expect(maskApiKeyForDisplay('short')).toBe('short');
    expect(maskApiKeyForDisplay('  ')).toBe('');
  });
});

describe('resolveAiExecutionLocation', () => {
  it('偏好可用时直接使用', () => {
    expect(
      resolveAiExecutionLocation({
        preference: 'server',
        client: { enabled: true },
        server: { enabled: true },
      }),
    ).toEqual({ location: 'server', fallbackReason: null });
  });

  it('偏好不可用时回退默认位置并带原因', () => {
    const result = resolveAiExecutionLocation({
      preference: 'server',
      client: { enabled: true },
      server: { enabled: false, reason: '服务器执行将在接入在线能力后开放' },
    });
    expect(result.location).toBe('client');
    expect(result.fallbackReason).toBe('服务器执行将在接入在线能力后开放');
  });

  it('无偏好时使用默认位置', () => {
    expect(
      resolveAiExecutionLocation({
        client: { enabled: true },
        server: { enabled: false, reason: 'x' },
        defaultLocation: 'client',
      }).location,
    ).toBe('client');
  });
});
