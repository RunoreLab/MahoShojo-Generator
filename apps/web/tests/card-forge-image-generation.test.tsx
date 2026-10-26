// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CardForgePage } from '@/components/card-forge/CardForgePage';

vi.mock('next/navigation', () => ({ useSearchParams: () => null }));
vi.mock('@/components/BattleDataModal', () => ({ default: () => null }));
vi.mock('@/components/shared/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }));
vi.mock('@/components/AiProviderSelector', () => ({ default: () => null }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: async () => ({ hasSensitiveWords: false }) }));

let root: Root;
let container: HTMLDivElement;
const button = (text: string) => [...container.querySelectorAll('button')].find(node => node.textContent?.trim() === text)!;
const input = async (selector: string, value: string) => {
  const element = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  await act(async () => {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('card-forge-tachie-remember', 'true');
  localStorage.setItem('card-forge-tachie-credentials', JSON.stringify({ modelscopeToken: 'old-token' }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<CardForgePage />));
  await act(async () => button('AI 立绘生成').click());
  await input('textarea[placeholder="输入角色外观描述，用于生成立绘插图"]', '原角色');
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('工坊真实页面双击只创建一次，故障后原凭据查询原任务，不重新 POST create', async () => {
  let rejectQuery!: (error: Error) => void;
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { generateUuid: 'forge-job' } }))
    .mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectQuery = reject; }))
    .mockResolvedValueOnce(Response.json({ taskStatus: 'SUCCEED', outputImages: ['https://example.test/forge.png'] }));
  vi.stubGlobal('fetch', fetchMock);
  const sizeSelector = 'select:has(option[value="928x1664"])';
  const modelSelector = 'input[placeholder="Stonego/XiabanmostyleV3"]';
  await input(sizeSelector, '928x1664');
  await input(modelSelector, ' custom/original ');
  await act(async () => { button('生成立绘').click(); button('生成立绘').click(); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(container.querySelector<HTMLSelectElement>(sizeSelector)!.disabled).toBe(false);
  expect(container.querySelector<HTMLInputElement>(modelSelector)!.disabled).toBe(false);
  await input(sizeSelector, '1472x1104');
  await input(modelSelector, 'custom/next');
  await input('input[type=password]', 'new-token');
  await input('textarea[placeholder="输入角色外观描述，用于生成立绘插图"]', '新提示词');
  await act(async () => rejectQuery(new Error('查询连接中断')));
  expect(container.textContent).toContain('forge-job');
  await act(async () => button('继续查询原任务').click());
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/tachie/generate', '/api/tachie/status', '/api/tachie/status']);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    prompt: '原角色, 二次元, 精致立绘', modelscopeToken: 'old-token',
    modelscopeModel: ' custom/original ', modelscopeSize: '928x1664',
  });
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ source: 'modelscope', modelscopeToken: 'old-token', generateUuid: 'forge-job' });
  expect(fetchMock.mock.calls[2][1].method).toBe('POST');
  expect(container.querySelector('img[src="https://example.test/forge.png"]')).not.toBeNull();
  expect(container.textContent).toContain('立绘生成成功');
  expect(container.querySelector<HTMLSelectElement>(sizeSelector)!.value).toBe('1472x1104');
  expect(container.querySelector<HTMLInputElement>(modelSelector)!.value).toBe('custom/next');
});

it.each([
  ['928x1664', '928x1664'], [' 928x1664 ', '1328x1328'], [928, '1328x1328'],
])('工坊恢复尺寸严格匹配、不修剪已存模型：%j', async (modelscopeSize, expectedSize) => {
  localStorage.setItem('card-forge-tachie-credentials', JSON.stringify({
    modelscopeToken: 'old-token', modelscopeSize, modelscopeModel: ' custom/saved ',
  }));
  await act(async () => root.render(<CardForgePage key="restore" />));
  await act(async () => button('AI 立绘生成').click());
  const size = container.querySelector<HTMLSelectElement>('select:has(option[value="928x1664"])')!;
  expect(size.value).toBe(expectedSize);
  expect([...size.options].map(option => option.text)).toEqual([
    '16:9 竖屏（928×1664）', '16:9 横屏（1664×928）', '正方形（1328×1328）',
    '4:3 竖屏（1104×1472）', '4:3 横屏（1472×1104）',
  ]);
  expect(container.querySelector<HTMLInputElement>('input[placeholder="Stonego/XiabanmostyleV3"]')!.value).toBe(' custom/saved ');
});

it('停止等待中止查询，已成功的图片在下一次失败后仍保留', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { generateUuid: 'first' } }))
    .mockResolvedValueOnce(Response.json({ taskStatus: 'SUCCEED', outputImages: ['https://example.test/old.png'] }))
    .mockResolvedValueOnce(Response.json({ data: { generateUuid: 'second' } }))
    .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => button('生成立绘').click());
  await act(async () => button('生成立绘').click());
  const stop = [...container.querySelectorAll('button')].find(node => node.textContent?.includes('停止等待'))!;
  await act(async () => stop.click());
  expect(fetchMock.mock.calls[3][1].signal.aborted).toBe(true);
  expect(container.textContent).toContain('second');
  expect(button('继续查询原任务')).toBeTruthy();
  expect(container.querySelector('img[src="https://example.test/old.png"]')).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('换数据卡后取消旧图片请求，忽略不遵守 signal 的迟到成功', async () => {
  let finish!: (value: Response) => void;
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { generateUuid: 'old-job' } }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => button('生成立绘').click());
  await input('textarea[placeholder^="可直接粘贴角色卡"]', '{"name":"新角色"}');
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async () => finish(Response.json({ taskStatus: 'SUCCEED', outputImages: ['https://example.test/stale.png'] })));
  expect(container.querySelector('img[src="https://example.test/stale.png"]')).toBeNull();
  expect(button('继续查询原任务')).toBeUndefined();
});

it('导入读取期间启动的任务在导入提交时失效，迟到图片不能覆盖导入卡', async () => {
  let finishImport!: (value: string) => void;
  let finishImage!: (value: Response) => void;
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { generateUuid: 'during-import' } }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finishImage = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  const fileInput = [...container.querySelectorAll('label')].find(label => label.textContent?.trim() === '导入卡面 JSON')!.querySelector('input')!;
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ text: () => new Promise<string>(resolve => { finishImport = resolve; }) }] });
  await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => button('生成立绘').click());
  await act(async () => finishImport(JSON.stringify({ cardName: '新导入卡', cardType: 'character', rarity: 'epic', cost: 3,
    element: 'dark', attack: 2, defense: 1, hp: 3, effects: [], traits: [], flavorText: '', powerLevel: 'A', description: '', themeColor: '#EF4444' })));
  expect(container.querySelector('.gc-name-text')?.textContent).toBe('新导入卡');
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async () => finishImage(Response.json({ taskStatus: 'SUCCEED', outputImages: ['https://example.test/stale-import.png'] })));
  expect(container.querySelector('img[src="https://example.test/stale-import.png"]')).toBeNull();
});
