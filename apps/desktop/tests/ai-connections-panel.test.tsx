// @vitest-environment jsdom
// AiConnectionsPanel 连接测试的 run-identity 回归（D5.0b-r2）：
// P1 测试在途 → 用户切到 P2 → P1 的迟到终态不得写进 P2 的 UI。
// 同时钉住「取消测试」真实 abort 语义与切换时的清理行为。

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiExecutionResult } from '@mahoshojo/ai-core/stream-events';
import type { DirectProviderProfileV1 } from '@mahoshojo/contracts/provider-profile';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { getDesktopAiConfigStore, resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { AiConnectionsPanel } from '../src/features/ai-config/AiConnectionsPanel';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === 'has_provider_secret') return false;
    return undefined;
  }),
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
};

vi.mock('../src/platform/provider-profile-bridge', () => ({
  listProviderProfileIds: async () => ['p1', 'p2'],
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
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent === name);
const cancelledResult: AiExecutionResult = {
  status: 'cancelled',
  requestId: 'r1',
  contractVersion: 1,
  mode: 'direct-local',
  reason: 'aborted',
};

const selectConnection = async (profileId: string) => {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
  await act(async () => trigger.click());
  await settle();
  const profiles = getDesktopAiConfigStore().getSnapshot().profiles;
  const profile = profiles.find((item) => item.id === profileId)!;
  const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.includes(profile.name))!;
  await act(async () => option.click());
  await settle();
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({
    version: 2,
    selection: { executionPreference: 'client', clientConnectionId: 'p1' },
    hiddenPresetIds: [],
  }));
  resetDesktopAiConfigStoreForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = async () => {
  await act(async () => root.render(<StrictMode><AiConnectionsPanel /></StrictMode>));
  await settle();
};

describe('AiConnectionsPanel connection test', () => {
  it('cancels a running test via the cancel button', async () => {
    let finish!: (result: AiExecutionResult) => void;
    mocks.execute.mockImplementation(
      () => new Promise<AiExecutionResult>((resolve) => { finish = resolve; }),
    );
    await mount();

    await act(async () => button('测试当前连接')!.click());
    await settle();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(button('取消测试')).toBeTruthy();

    await act(async () => button('取消测试')!.click());
    expect(mocks.execute.mock.calls[0]![1].aborted).toBe(true);
    await act(async () => finish(cancelledResult));
    await settle();
    expect(container.textContent).toContain('测试已取消');
    expect(button('测试当前连接')).toBeTruthy();
  });

  it('discards the late terminal state of a test whose target was switched away', async () => {
    let finishP1!: (result: AiExecutionResult) => void;
    mocks.execute.mockImplementation(
      () => new Promise<AiExecutionResult>((resolve) => { finishP1 = resolve; }),
    );
    await mount();

    await act(async () => button('测试当前连接')!.click());
    await settle();
    expect(mocks.execute).toHaveBeenCalledTimes(1);

    // 切到 p2：效果应立即 abort P1 并把测试 UI 复位为 idle。
    await selectConnection('p2');
    expect(mocks.execute.mock.calls[0]![1].aborted).toBe(true);
    expect(container.textContent).not.toContain('测试已取消');

    // P1 的 cancelled 迟到达：run identity 已过期，不得在新目标上显示「测试已取消」。
    await act(async () => finishP1(cancelledResult));
    await settle();
    expect(container.textContent).not.toContain('测试已取消');
    expect(container.textContent).toContain('二号');
    expect(button('测试当前连接')).toBeTruthy();
  });
});
