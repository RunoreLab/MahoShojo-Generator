// @vitest-environment jsdom
// DesktopAiProviderPanel（D5.1-AIP-4）回归：
// 五个生成页共用同一份「执行位置 + 连接 + 生效模型 + 高级参数 + 连接测试」
// 装配。钉住分组下拉语义、原子激活、未实现 adapter 提示、多模型选择与
// 内嵌连接编辑器入口，防止各页再长出私有副本。

import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiExecutionResult } from '@mahoshojo/ai-core/stream-events';
import type { DirectProviderProfileV1 } from '@mahoshojo/contracts/provider-profile';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import {
  getDesktopAiConfigStore,
  resetDesktopAiConfigStoreForTests,
} from '../src/features/ai-config/use-desktop-ai-config';
import { DesktopAiProviderPanel } from '../src/features/ai-config/desktop-ai-provider-panel';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  navigate: vi.fn(async () => undefined),
  profileIds: ['p1', 'p2'] as string[],
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === 'has_provider_secret') return false;
    return undefined;
  }),
}));

// 面板只消费 router.navigate（「管理连接」动作）与 Link（空连接提示）；
// 单测用桩路由即可，其余页面路由装配在页面级测试里覆盖。
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

const profiles: Record<string, DirectProviderProfileV1> = {
  p1: {
    version: 1,
    id: 'p1',
    name: '一号',
    adapter: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    modelId: 'm1',
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  },
  p2: {
    version: 1,
    id: 'p2',
    name: '二号',
    adapter: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    modelId: 'm2',
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  },
  anth: {
    version: 1,
    id: 'anth',
    name: '三号',
    adapter: 'anthropic',
    baseUrl: 'https://model.example/v1',
    modelId: 'm3',
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  },
};

vi.mock('../src/platform/provider-profile-bridge', () => ({
  listProviderProfileIds: async () => [...mocks.profileIds],
  getProviderProfile: async (_invoke: unknown, id: string) => profiles[id] ?? null,
  saveProviderProfile: async () => undefined,
  deleteProviderProfile: async () => undefined,
  validateProviderExecutionProfile: async (_invoke: unknown, doc: unknown) => doc,
}));

vi.mock('../src/platform/desktop-ai-execution', () => ({
  createDesktopAiExecutionPort: () => ({ execute: mocks.execute }),
}));

let root: Root;
let container: HTMLDivElement;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
const buttons = () => [...container.querySelectorAll('button')];
const button = (name: string) => buttons().find((item) => item.textContent?.includes(name));
const triggers = () =>
  buttons().filter((item) => item.getAttribute('aria-haspopup') === 'listbox');

const copy = {
  serverOutput: { stream: 'Markdown 流式输出（未签名）', nonStream: '结构化 JSON 输出（服务器签名）' },
  emptyProfilesHint: '回答可以先填写，配置加载后再生成。',
  serverFootnote: '不使用客户端连接与高级模型参数（由服务器侧 System Default 解析）。',
  payloadNoun: '情景回答',
};

const seedOverlay = (overlay: Record<string, unknown>) => {
  window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify(overlay));
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.profileIds = ['p1', 'p2'];
  window.localStorage.clear();
  seedOverlay({
    version: 3,
    selection: { executionPreference: 'client', clientConnectionId: 'p1' },
    hiddenPresetIds: [],
    generationOverrides: {},
    modelsByProfileId: {},
  });
  resetDesktopAiConfigStoreForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = async (generationMode: 'stream' | 'non-stream' = 'non-stream') => {
  await act(async () =>
    root.render(
      <StrictMode>
        <DesktopAiProviderPanel generationMode={generationMode} copy={copy} />
      </StrictMode>,
    ),
  );
  await settle();
};

/** 打开第一个（连接）自定义下拉并点击匹配文本的 option。 */
const pickConnectionOption = async (text: string) => {
  const trigger = triggers()[0]!;
  await act(async () => trigger.click());
  await settle();
  const option = [...container.querySelectorAll('[role="option"]')].find((item) =>
    item.textContent?.includes(text),
  );
  expect(option, `option "${text}"`).toBeTruthy();
  await act(async () => (option as HTMLElement).click());
  await settle();
};

describe('DesktopAiProviderPanel', () => {
  it('renders the resolved client target with model and advanced settings', async () => {
    await mount();
    // trigger 显示当前连接；接收方信息框给出 baseUrl 与生效模型。
    expect(container.textContent).toContain('一号');
    expect(container.textContent).toContain('接收方：http://127.0.0.1:11434/v1');
    expect(container.textContent).toContain('模型：m1');
    expect(container.textContent).toContain('点击生成会发送情景回答');
    expect(button('测试当前连接')).toBeTruthy();
    // 高级参数区块（折叠标题由 AdvancedGenerationSettings 渲染）。
    expect(container.textContent).toContain('高级生成设置');
  });

  it('switches to server via the System Default option and back to a connection', async () => {
    await mount();
    await pickConnectionOption('服务器 · System Default');
    expect(getDesktopAiConfigStore().getSnapshot().selection.executionPreference).toBe('server');
    expect(container.textContent).toContain('结构化 JSON 输出（服务器签名）');
    expect(container.textContent).not.toContain('接收方：');

    await pickConnectionOption('二号');
    const selection = getDesktopAiConfigStore().getSnapshot().selection;
    expect(selection).toEqual({ executionPreference: 'client', clientConnectionId: 'p2' });
    expect(container.textContent).toContain('接收方：http://127.0.0.1:1234/v1');
    expect(container.textContent).toContain('模型：m2');
  });

  it('shows the unavailable reason for an unimplemented adapter without hiding the connection', async () => {
    seedOverlay({
      version: 3,
      selection: { executionPreference: 'client', clientConnectionId: 'anth' },
      hiddenPresetIds: [],
      generationOverrides: {},
      modelsByProfileId: {},
    });
    mocks.profileIds = ['p1', 'p2', 'anth'];
    await mount();
    expect(container.textContent).toContain('三号');
    expect(container.textContent).toContain('当前客户端尚未实现 anthropic 适配器');
    expect(button('测试当前连接')).toBeUndefined();
  });

  it('opens the shared connection editor from the action area and navigates to settings', async () => {
    await mount();
    const trigger = triggers()[0]!;
    await act(async () => trigger.click());
    await settle();
    const newAction = buttons().find((item) => item.textContent?.includes('新建自定义连接'))!;
    await act(async () => newAction.click());
    await settle();
    expect(container.textContent).toContain('新建连接');
    expect(button('保存并使用')).toBeTruthy();

    // 关闭编辑器后从操作区进设置页。
    const cancel = buttons().find((item) => item.textContent === '取消')!;
    await act(async () => cancel.click());
    await settle();
    await act(async () => trigger.click());
    await settle();
    const manage = buttons().find((item) => item.textContent?.includes('管理连接'))!;
    await act(async () => manage.click());
    expect(mocks.navigate).toHaveBeenCalled();
  });

  it('selects, adds and removes custom models on the effective-model row', async () => {
    await mount();
    // 生效模型 = 连接默认 m1（第二个自定义下拉）。
    const modelTrigger = triggers()[1]!;
    expect(modelTrigger.textContent).toContain('m1');

    const input = container.querySelector<HTMLInputElement>('input[aria-label="自定义模型 ID"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
        .set!.call(input, 'glm-4.6');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('添加')!.click());
    await settle();
    const selection = getDesktopAiConfigStore().getSnapshot().modelsByProfileId['p1'];
    expect(selection?.customModelIds).toEqual(['glm-4.6']);
    // 添加只入列，不自动切换当前模型。
    expect(selection?.selectedModelId).toBeUndefined();

    // 从新模型下拉里选中自定义模型 → selectedModelId 显式落定。
    await act(async () => modelTrigger.click());
    await settle();
    const option = [...container.querySelectorAll('[role="option"]')].find((item) =>
      item.textContent?.includes('glm-4.6'),
    )!;
    await act(async () => (option as HTMLElement).click());
    await settle();
    expect(
      getDesktopAiConfigStore().getSnapshot().modelsByProfileId['p1']?.selectedModelId,
    ).toBe('glm-4.6');

    // 选中态是自定义模型时出现「移除」操作；移除后选择悬空，解析层提示重新选择。
    await act(async () => modelTrigger.click());
    await settle();
    const removeAction = buttons().find((item) => item.textContent?.includes('移除模型'))!;
    await act(async () => removeAction.click());
    await settle();
    expect(container.textContent).toContain('所选模型已不在连接模型列表中');
  });

  it('rejects invalid custom model ids without writing overlay', async () => {
    await mount();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="自定义模型 ID"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
        .set!.call(input, '   ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('添加')!.click());
    await settle();
    expect(container.textContent).toContain('模型 ID 无效');
    expect(
      getDesktopAiConfigStore().getSnapshot().modelsByProfileId['p1'],
    ).toBeUndefined();
  });

  it('runs the shared connection test against the resolved target', async () => {
    mocks.execute.mockResolvedValue({
      status: 'completed',
      requestId: 'r1',
      contractVersion: 1,
      mode: 'direct-local',
      output: { text: '你好' },
    } satisfies AiExecutionResult);
    await mount();
    await act(async () => button('测试当前连接')!.click());
    await settle();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0]![0]).toMatchObject({ mode: 'direct-local', modelId: 'm1' });
    expect(container.textContent).toContain('测试输出：你好');
  });
});
