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
import { listDesktopPresetEntries } from '../src/features/ai-config/desktop-ai-config';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  navigate: vi.fn(async () => undefined),
  profileIds: ['p1', 'p2'] as string[],
  saveProfile: vi.fn(async () => undefined),
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
  saveProviderProfile: (...args: unknown[]) => mocks.saveProfile(...args),
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
  serverFootnote: '不使用客户端连接与凭据（由服务器侧系统默认配置解析）。',
  payloadNoun: '情景回答',
};

const seedOverlay = (overlay: Record<string, unknown>) => {
  window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify(overlay));
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.profileIds = ['p1', 'p2'];
  mocks.saveProfile.mockResolvedValue(undefined);
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

  it('switches to server via the shared system option and back to a connection', async () => {
    await mount();
    // 与 Web 同一目录事实源：hosted 项标签为「使用系统默认配置」。
    await pickConnectionOption('使用系统默认配置');
    expect(getDesktopAiConfigStore().getSnapshot().selection.executionPreference).toBe('server');
    expect(container.textContent).toContain('结构化 JSON 输出（服务器签名）');
    expect(container.textContent).not.toContain('接收方：');
    // 服务器位置生效时系统模型行与高级参数照常呈现（systemConfig 下发）。
    const modelTrigger = triggers()[1]!;
    expect(modelTrigger.textContent).toContain('默认策略');
    expect(container.textContent).toContain('高级生成设置');

    // 系统模型选择：显式选取 GLM 5.3 Flash 落入 overlay（不静默回落默认）。
    await act(async () => modelTrigger.click());
    await settle();
    // 按 label 精确匹配——「默认策略」选项描述也提到 GLM 5.3 Flash。
    const glmOption = [...container.querySelectorAll('[role="option"]')].find(
      (item) => item.querySelector('.battle-lite-strong-text')?.textContent === 'GLM 5.3 Flash',
    )!;
    expect(glmOption).toBeTruthy();
    await act(async () => (glmOption as HTMLElement).click());
    await settle();
    expect(getDesktopAiConfigStore().getSnapshot().selection.systemModelId).toBe(
      'glm-5.3-flash',
    );

    await pickConnectionOption('二号');
    const selection = getDesktopAiConfigStore().getSnapshot().selection;
    expect(selection).toEqual({
      executionPreference: 'client',
      clientConnectionId: 'p2',
      systemModelId: 'glm-5.3-flash',
    });
    expect(container.textContent).toContain('接收方：http://127.0.0.1:1234/v1');
    expect(container.textContent).toContain('模型：m2');
  });

  it('opens the preset-seeded connection editor from the provider dropdown', async () => {
    await mount();
    const trigger = triggers()[0]!;
    await act(async () => trigger.click());
    await settle();
    // 「内置供应商」分组列出已核验可直连预设；选预设=打开带默认值的编辑器，
    // 不直接写入 Profile、不改动激活状态（预设直配旅程）。
    expect(container.textContent).toContain('内置供应商');
    const firstCapable = listDesktopPresetEntries(new Set()).find(
      (entry) => entry.directCapableModels.length > 0,
    )!;
    expect(firstCapable, '目录中至少一个可直连预设').toBeTruthy();
    const presetOption = [...container.querySelectorAll('[role="option"]')].find((item) =>
      item.textContent?.includes(firstCapable.preset.name),
    )!;
    expect(presetOption).toBeTruthy();
    await act(async () => (presetOption as HTMLElement).click());
    await settle();

    expect(container.textContent).toContain('新建连接');
    expect(button('保存并使用')).toBeTruthy();
    // 打开编辑器即预填 Endpoint 与可直连模型；未保存前激活状态不变。
    const selection = getDesktopAiConfigStore().getSnapshot().selection;
    expect(selection).toEqual({ executionPreference: 'client', clientConnectionId: 'p1' });
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

  it('asks before discarding a dirty editor when navigating away', async () => {
    await mount();
    const trigger = triggers()[0]!;
    await act(async () => trigger.click());
    await settle();
    await act(async () => buttons().find((item) => item.textContent?.includes('新建自定义连接'))!.click());
    await settle();
    // 输入未保存内容 → 编辑器进入脏状态（含显示名与 Key 输入同样口径）。
    // 首个 input.input-field 是模型行的自定义输入：先定位编辑器容器再取显示名输入。
    const editorBox = [...container.querySelectorAll('h3')]
      .find((item) => item.textContent === '新建连接')!
      .closest('div')!;
    const nameInput = editorBox.querySelector<HTMLInputElement>('input.input-field')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
        .set!.call(nameInput, '未保存连接');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();

    // 拒绝放弃 → 不跳转且草稿仍在表单中。
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => trigger.click());
    await settle();
    await act(async () => buttons().find((item) => item.textContent?.includes('管理连接'))!.click());
    await settle();
    expect(confirmSpy).toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(editorBox.querySelector<HTMLInputElement>('input.input-field')!.value).toBe('未保存连接');

    // 确认放弃 → 正常跳转，草稿随面板卸载丢弃（不进入持久化）。
    confirmSpy.mockReturnValue(true);
    await act(async () => trigger.click());
    await settle();
    await act(async () => buttons().find((item) => item.textContent?.includes('管理连接'))!.click());
    await settle();
    expect(mocks.navigate).toHaveBeenCalled();
    confirmSpy.mockRestore();
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

  it('selects a real connection whose id collides with the preset namespace', async () => {
    // preset:deepseek 是合法 Profile ID（字符集允许 ':'）：裸值会与 preset:
    // 前缀撞名，连接必须经 conn: 前缀编码才能正确落回「我的连接」语义，
    // 而不是被分派成目录预设打开编辑器（D5.1-AIP-r1-r1）。
    profiles['preset:deepseek'] = {
      version: 1,
      id: 'preset:deepseek',
      name: '撞名连接',
      adapter: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9999/v1',
      modelId: 'deepseek-chat',
      createdAt: '2026-10-05T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
    };
    mocks.profileIds = ['p1', 'preset:deepseek'];
    try {
      await mount();
      await pickConnectionOption('撞名连接');
      // 命中的是真实连接：原子激活为当前连接，不打开预设直配编辑器。
      expect(getDesktopAiConfigStore().getSnapshot().selection).toEqual({
        executionPreference: 'client',
        clientConnectionId: 'preset:deepseek',
      });
      expect(container.textContent).not.toContain('新建连接');
      expect(container.textContent).toContain('接收方：http://127.0.0.1:9999/v1');
      expect(container.textContent).toContain('模型：deepseek-chat');
    } finally {
      delete profiles['preset:deepseek'];
    }
  });

  it('warns and offers reselection when the saved system model left the catalog', async () => {
    // 服务器位置：曾选的系统模型被目录移除后，保留原值供诊断、禁用项
    // 告警 + 生效模型下拉即重选入口——不得静默回落「默认策略」。
    seedOverlay({
      version: 3,
      selection: {
        executionPreference: 'server',
        clientConnectionId: 'p1',
        systemModelId: 'retired-model',
      },
      hiddenPresetIds: [],
      generationOverrides: {},
      modelsByProfileId: {},
    });
    await mount();
    expect(container.textContent).toContain('所选系统模型已不在支持列表中，请重新选择');
    const modelTrigger = triggers()[1]!;
    expect(modelTrigger.textContent).toContain('retired-model');
    await act(async () => modelTrigger.click());
    await settle();
    const danglingOption = [...container.querySelectorAll('[role="option"]')].find((item) =>
      item.textContent?.includes('retired-model'),
    )!;
    expect(danglingOption.getAttribute('aria-disabled')).toBe('true');
    expect(danglingOption.textContent).toContain('已不在支持列表中');

    // 同一下拉里重新选择有效模型后告警解除。
    const glmOption = [...container.querySelectorAll('[role="option"]')].find(
      (item) => item.querySelector('.battle-lite-strong-text')?.textContent === 'GLM 5.3 Flash',
    )!;
    await act(async () => (glmOption as HTMLElement).click());
    await settle();
    expect(getDesktopAiConfigStore().getSnapshot().selection.systemModelId).toBe('glm-5.3-flash');
    expect(container.textContent).not.toContain('已不在支持列表中');
  });

  it('disables cancel while a save transaction is still in flight', async () => {
    // 「取消」的语义是放弃未提交的表单，不是撤销已发起的保存事务——
    // savingConnection 期间允许关闭会让迟到的落盘看起来像「取消后仍保存」。
    await mount();
    const trigger = triggers()[0]!;
    await act(async () => trigger.click());
    await settle();
    await act(async () =>
      buttons().find((item) => item.textContent?.includes('编辑「一号」'))!.click(),
    );
    await settle();
    expect(container.textContent).toContain('编辑连接');

    let releaseSave: (() => void) | null = null;
    mocks.saveProfile.mockImplementation((_invoke: unknown, doc: unknown) => {
      // 模拟真实落盘：resolve 之后回读必须能拿到本次候选文档，
      // 否则保存后核验会按「结果不确定」如实报错。
      profiles[(doc as DirectProviderProfileV1).id] = doc as DirectProviderProfileV1;
      return new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
    });
    await act(async () => button('保存连接')!.click());
    await settle();
    expect(button('取消').disabled).toBe(true);
    expect(button('保存中…').disabled).toBe(true);

    releaseSave!();
    await settle();
    // 事务收尾后编辑器关闭，不会出现「已取消但仍落盘」的错位结果。
    expect(container.textContent).not.toContain('编辑连接');
  });
});
