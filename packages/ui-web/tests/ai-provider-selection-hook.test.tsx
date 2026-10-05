// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AIProviderOption } from '@mahoshojo/ai-core/provider-catalog';
import type { UserAIProviderConfig } from '@mahoshojo/ai-core/generation-settings';

import {
  useAiProviderSelection,
  type AiProviderStoragePort,
  type AiProviderSyncDetail,
  type UseAiProviderSelectionOptions,
} from '../src/ai-provider/index';

const PROVIDER_A: AIProviderOption = {
  id: 'prov-a',
  name: 'Provider A',
  description: 'desc a',
  docsUrl: '',
  baseUrl: 'https://api.a.test',
  type: 'openai',
  models: [
    { value: 'm1', label: 'M1', description: 'm1 desc' },
    { value: 'm2', label: 'M2', description: 'm2 desc' },
  ],
};

const PROVIDER_B: AIProviderOption = {
  id: 'prov-b',
  name: 'Provider B',
  description: 'desc b',
  docsUrl: '',
  baseUrl: 'https://api.b.test',
  type: 'openai',
  models: [{ value: 'b1', label: 'B1', description: 'b1 desc' }],
};

const SYSTEM: AIProviderOption = {
  id: 'system',
  name: 'System',
  description: 'sys',
  docsUrl: '',
  baseUrl: '',
  type: 'openai',
  models: [{ value: 'default', label: 'Default', description: 'default desc' }],
};

const PROVIDERS = [SYSTEM, PROVIDER_A, PROVIDER_B];

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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

interface HarnessProps extends Partial<UseAiProviderSelectionOptions> {
  onConfigChange: (config: UserAIProviderConfig | null) => void;
}

const Harness = ({ onConfigChange, ...rest }: HarnessProps) => {
  useAiProviderSelection({
    storage: rest.storage!,
    providers: PROVIDERS,
    onConfigChange,
    ...rest,
  });
  return null;
};

describe('useAiProviderSelection', () => {
  it('hydration 还原已持久化的 provider/model/apiKey 并 emit 生效配置', async () => {
    const storage = createMemoryStorage();
    storage.setItem('ns.selected', 'prov-a');
    storage.setItem('ns.apiKey.prov-a', 'sk-abc');
    storage.setItem('ns.model.prov-a', 'm2');

    const emitted: Array<UserAIProviderConfig | null> = [];
    act(() => {
      root.render(
        <Harness
          storage={storage}
          storageNamespace="ns"
          onConfigChange={(config) => emitted.push(config)}
        />,
      );
    });
    await settle();
    await settle();

    expect(emitted.at(-1)).toEqual({
      providerId: 'prov-a',
      modelId: 'm2',
      apiKey: 'sk-abc',
    });
  });

  it('无持久化数据时默认 provider 生效，并在存储中写入默认选择', async () => {
    const storage = createMemoryStorage();
    const emitted: Array<UserAIProviderConfig | null> = [];
    act(() => {
      root.render(
        <Harness
          storage={storage}
          storageNamespace="ns"
          onConfigChange={(config) => emitted.push(config)}
        />,
      );
    });
    await settle();
    await settle();

    expect(storage.map.get('ns.selected')).toBe('system');
    expect(emitted.at(-1)).toMatchObject({ providerId: 'system' });
  });

  it('allowSystemProvider=false 时默认 provider 取首个非 system 项', async () => {
    const storage = createMemoryStorage();
    const emitted: Array<UserAIProviderConfig | null> = [];
    act(() => {
      root.render(
        <Harness
          storage={storage}
          storageNamespace="ns"
          allowSystemProvider={false}
          onConfigChange={(config) => emitted.push(config)}
        />,
      );
    });
    await settle();
    await settle();

    expect(emitted.at(-1)).toMatchObject({ providerId: 'prov-a' });
  });

  it('旧 maxOutputTokens key 迁移进 emit 配置并删除旧 key', async () => {
    const storage = createMemoryStorage();
    storage.setItem('ns.selected', 'prov-a');
    storage.setItem('ns.maxOutputTokens.prov-a', '4096');

    const emitted: Array<UserAIProviderConfig | null> = [];
    act(() => {
      root.render(
        <Harness
          storage={storage}
          storageNamespace="ns"
          onConfigChange={(config) => emitted.push(config)}
        />,
      );
    });
    await settle();
    await settle();

    expect(emitted.at(-1)).toMatchObject({
      providerId: 'prov-a',
      modelId: 'm1',
      maxOutputTokens: 4096,
      generationOverrides: { maxOutputTokens: 4096 },
    });
    expect(storage.map.has('ns.maxOutputTokens.prov-a')).toBe(false);
  });

  it('updateGenerationOverrides 仅写当前 provider+model 的 key 并立即 emit', async () => {
    const storage = createMemoryStorage();
    storage.setItem('ns.selected', 'prov-a');

    let update: ((next: { temperature: number }) => void) | null = null;
    const emitted: Array<UserAIProviderConfig | null> = [];
    const Capture = () => {
      const selection = useAiProviderSelection({
        storage,
        storageNamespace: 'ns',
        providers: PROVIDERS,
        onConfigChange: (config) => emitted.push(config),
      });
      update = selection.updateGenerationOverrides;
      return null;
    };

    act(() => root.render(<Capture />));
    await settle();
    await settle();

    act(() => update!({ temperature: 0.7 }));
    await settle();

    expect(storage.map.get('ns.generationOverrides.prov-a.m1')).toBe(
      JSON.stringify({ temperature: 0.7 }),
    );
    expect(emitted.at(-1)).toMatchObject({
      providerId: 'prov-a',
      generationOverrides: { temperature: 0.7 },
    });
  });

  it('同步事件持久化并更新当前选择', async () => {
    const storage = createMemoryStorage();
    let syncHandler: ((detail: AiProviderSyncDetail) => void) | null = null;
    const emitted: Array<UserAIProviderConfig | null> = [];

    act(() => {
      root.render(
        <Harness
          storage={storage}
          storageNamespace="ns"
          subscribeSync={(handler) => {
            syncHandler = handler;
            return () => {};
          }}
          onConfigChange={(config) => emitted.push(config)}
        />,
      );
    });
    await settle();
    await settle();

    act(() => {
      syncHandler!({ providerId: 'prov-b', modelId: 'b1', apiKey: 'sk-b' });
    });
    await settle();
    await settle();

    expect(storage.map.get('ns.selected')).toBe('prov-b');
    expect(storage.map.get('ns.apiKey.prov-b')).toBe('sk-b');
    expect(emitted.at(-1)).toMatchObject({ providerId: 'prov-b', modelId: 'b1', apiKey: 'sk-b' });
  });

  it('同步事件拒绝 allowSystemProvider=false 下的 system', async () => {
    const storage = createMemoryStorage();
    storage.setItem('ns.selected', 'prov-a');
    let syncHandler: ((detail: AiProviderSyncDetail) => void) | null = null;

    act(() => {
      root.render(
        <Harness
          storage={storage}
          storageNamespace="ns"
          allowSystemProvider={false}
          subscribeSync={(handler) => {
            syncHandler = handler;
          }}
          onConfigChange={() => {}}
        />,
      );
    });
    await settle();
    await settle();

    act(() => {
      syncHandler!({ providerId: 'system' });
    });
    await settle();

    expect(storage.map.get('ns.selected')).toBe('prov-a');
  });

  it('切换 provider 后 emit 不带上一个模型的旧 overrides', async () => {
    const storage = createMemoryStorage();
    storage.setItem('ns.selected', 'prov-a');
    storage.setItem('ns.generationOverrides.prov-a.m1', JSON.stringify({ temperature: 0.9 }));

    let setProvider: ((id: string) => void) | null = null;
    const emitted: Array<UserAIProviderConfig | null> = [];
    const Capture = () => {
      const selection = useAiProviderSelection({
        storage,
        storageNamespace: 'ns',
        providers: PROVIDERS,
        onConfigChange: (config) => emitted.push(config),
      });
      setProvider = selection.setSelectedProviderId;
      return null;
    };

    act(() => root.render(<Capture />));
    await settle();
    await settle();

    act(() => setProvider!('prov-b'));
    await settle();
    await settle();

    const last = emitted.at(-1);
    expect(last).toMatchObject({ providerId: 'prov-b', modelId: 'b1' });
    expect(last?.generationOverrides).toBeUndefined();
  });
});
