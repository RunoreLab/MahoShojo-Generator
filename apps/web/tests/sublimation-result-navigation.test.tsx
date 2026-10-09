// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  dispatch: vi.fn(),
  stream: vi.fn(),
}));
vi.mock('@/lib/use-generation-api-intent-latch', () => ({
  useGenerationApiIntentLatch: () => ({ tryAcquire: () => ({ dispatch: mock.dispatch }) }),
}));
vi.mock('@/lib/client-route-adapter', () => ({ useClientRouteAdapter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));
vi.mock('@/lib/auth', () => ({ authStorage: { getActivityHeaders: async () => ({}) } }));
vi.mock('@/lib/content-safety/client', () => ({ getSensitiveWordRedirectTarget: async () => null }));
vi.mock('@/lib/cooldown', () => ({ useProviderModeCooldown: () => ({ isCooldown: false, startCooldown: vi.fn() }) }));
vi.mock('@/lib/stream/read-safe-text-and-reasoning-stream', () => ({
  readSafeTextAndReasoningStreamFromResponse: (...args: unknown[]) => mock.stream(...args),
}));
vi.mock('@/components/MagicalGirlCard', () => ({ default: () => <article>魔法少女结果</article> }));
vi.mock('@/components/CanshouCard', () => ({ default: () => <article>残兽结果</article> }));
vi.mock('@/components/GeneralCharacterCard', () => ({ default: ({ general }: any) => <article>{general.content}</article> }));
vi.mock('@/components/SaveToCloudButton', () => ({ default: () => null }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/BattleDataModal', () => ({ default: () => null }));
vi.mock('@/components/DataCardDetailsModal', () => ({ default: () => null }));
vi.mock('@/components/arena/components/NarrativeHistoryModal', () => ({ NarrativeHistoryModal: () => null }));
vi.mock('@/components/arena/components/NarrativeHistoryPickerModal', () => ({ NarrativeHistoryPickerModal: () => null }));
vi.mock('@/components/AiProviderSelector', () => ({ default: () => null }));
vi.mock('@/components/ai/AiReasoningPanel', () => ({ default: () => null }));
vi.mock('@/components/ai/ProviderCooldownNotice', () => ({ ProviderCooldownNotice: () => null }));
vi.mock('@/components/shared/ThemeImage', () => ({ ThemeImage: () => null }));
vi.mock('@/components/shared/TokenIndicator', () => ({ TokenIndicator: () => null }));

import { SublimationPage } from '@/components/competition/SublimationPage';

let root: Root;
let container: HTMLDivElement;
let streamOptions: any;
let finishStream: (result: any) => void;
const scroll = vi.fn();
const source = { templateId: '通用角色', name: '原角色', content: '原卡正文' };
const click = async (label: string) => {
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(label));
  expect(button).toBeTruthy();
  await act(async () => button!.click());
};
const mountAndImport = async (stream = false) => {
  localStorage.setItem('mahoshojo.sublimation.preferences.v1', JSON.stringify({
    generationMode: stream ? 'stream' : 'non-stream', targetTemplate: 'general',
  }));
  await act(async () => root.render(<SublimationPage />));
  const input = container.querySelector('#character-upload')!;
  Object.defineProperty(input, 'files', { value: [{ type: 'application/json', name: 'source.json', text: async () => JSON.stringify(source) }] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(scroll).not.toHaveBeenCalled();
};
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-motion');
  scroll.mockClear();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: innerHeight + 300 } as DOMRect);
  Element.prototype.scrollIntoView = scroll;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url === '/languages.json' ? [] : url === '/api/verify-origin' ? { isNative: false } : { presets: [] },
  ), { headers: { 'content-type': 'application/json' } })));
  mock.dispatch.mockImplementation(async () => new Response(JSON.stringify({ targetTemplate: 'general', sublimatedData: { ...source, content: '升华正文' } }), { headers: { 'content-type': 'application/json' } }));
  mock.stream.mockImplementation((_response, options) => {
    streamOptions = options;
    return new Promise((resolve) => { finishStream = resolve; });
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

describe('成长升华结果导航（真实页面）', () => {
  it('恢复偏好和导入原卡不滚；非流式结果每次请求只滚一次', async () => {
    await mountAndImport();
    await click('开始升华');
    expect(mock.dispatch).toHaveBeenCalledWith('/api/generate-sublimation', expect.any(Object));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(container.querySelector('article')?.textContent).toBe('升华正文');
    await click('开始升华');
    expect(scroll).toHaveBeenCalledTimes(2);
  });
  it('流式空占位和推理不滚，首段正文滚一次，后续和最终卡不重复滚', async () => {
    await mountAndImport(true);
    mock.dispatch.mockResolvedValue(new Response('', { headers: { 'content-type': 'text/event-stream' } }));
    await click('开始升华');
    await act(async () => { streamOptions.onText('  '); streamOptions.onReasoning({ status: 'streaming', content: '推理' }); });
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => streamOptions.onText('首段正文'));
    expect(scroll).toHaveBeenCalledTimes(1);
    await act(async () => streamOptions.onText('首段正文和后续'));
    await act(async () => finishStream({ text: '首段正文和后续', outputSafetyStatus: 'safe', wasAborted: false }));
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('停止后迟到正文不定位', async () => {
    await mountAndImport(true);
    mock.dispatch.mockResolvedValue(new Response('', { headers: { 'content-type': 'text/event-stream' } }));
    await click('开始升华');
    await click('停止');
    expect(streamOptions.abortController.signal.aborted).toBe(true);
    await act(async () => streamOptions.onText('迟到正文'));
    await act(async () => finishStream({ text: '迟到正文', outputSafetyStatus: 'safe', wasAborted: true }));
    expect(scroll).not.toHaveBeenCalled();
  });
  it('失败请求不定位', async () => {
    await mountAndImport();
    mock.dispatch.mockResolvedValue(new Response(JSON.stringify({ error: '生成失败' }), { status: 500 }));
    await click('开始升华');
    expect(scroll).not.toHaveBeenCalled();
  });
  it('结果已经可见时不打断用户', async () => {
    await mountAndImport();
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue({ top: innerHeight - 20 } as DOMRect);
    await click('开始升华');
    expect(scroll).not.toHaveBeenCalled();
  });
  it('减少动效时用瞬时定位', async () => {
    await mountAndImport();
    document.documentElement.setAttribute('data-motion', 'reduce');
    await click('开始升华');
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });
  it('设备关闭自动定位时不滚', async () => {
    await mountAndImport();
    localStorage.setItem('mahoshojo.result-auto-scroll', 'off');
    await click('开始升华');
    expect(scroll).not.toHaveBeenCalled();
  });
});
