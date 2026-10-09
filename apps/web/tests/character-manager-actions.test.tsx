// @vitest-environment jsdom
import React, { act, type AnchorHTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterManagerPage } from '@/components/character/CharacterManagerPage';
import { getLocalCardRepository, resetLocalCardRepository } from '@/lib/local-library/card-repository';
import { openLocalLibraryDb, resetLocalLibraryDbConnection } from '@/lib/local-library/db';
import { CHARACTER_MANAGER_PAGE_DRAFT_KEY, readCharacterManagerPageDraftState, writeCharacterManagerPageDraft } from '@/lib/character-manager-page-draft';
import { saveLocalDataCard } from '@/lib/local-library/save-local-data-card';

const mocks = vi.hoisted(() => ({ download: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/link', () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ user: null, loading: false, isAuthenticated: false }) }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: async () => ({ hasSensitiveWords: false, matchDetails: [] }) }));
vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: mocks.download }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/MagicalGirlCard', () => ({ default: () => null }));
vi.mock('@/components/CanshouCard', () => ({ default: () => null }));
vi.mock('@/components/GeneralCharacterCard', () => ({ default: () => null }));
vi.mock('@/components/shared/CharacterPortraitAssetPanel', () => ({ CharacterPortraitAssetPanel: () => null }));
vi.mock('@/components/CharManager/AuthModal', () => ({ default: () => null }));
vi.mock('@/components/CharManager/SaveCardModal', () => ({ default: () => null }));
vi.mock('@/components/CharManager/DataCardsModal', () => ({ default: () => null }));
vi.mock('@/components/CharManager/RecycleBinModal', () => ({ default: () => null }));
vi.mock('@/components/CharManager/NarrativeHistoryCardEditorModal', () => ({ default: () => null }));
vi.mock('@/components/CharManager/QuestionnaireCompatModal', () => ({ default: () => null }));
vi.mock('@/components/UserTitle', () => ({ UserWithTitle: () => null }));

let container: HTMLDivElement;
let root: Root;
const sample = { templateId: '通用角色', name: '雾灯', content: '角色正文', signature: 'opaque-evidence', future: { nested: ['保真', 7] } };
const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!;
const click = async (label: string) => act(async () => { button(label).click(); });
const settle = async () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待角色管理动作完成超时');
    await settle();
  }
};
const mount = async (data: Record<string, unknown> = sample, isNative = false) => {
  writeCharacterManagerPageDraft({ pastedJson: '', characterData: data, originalData: data, isNative, selectedTemplate: 'general' });
  await act(async () => { root.render(<CharacterManagerPage />); });
  await waitFor(() => !!button('保存到本地库'));
};

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  resetLocalLibraryDbConnection();
  resetLocalCardRepository();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('离线'))));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  (await openLocalLibraryDb()).close();
  resetLocalLibraryDbConnection();
  vi.unstubAllGlobals();
});

describe('Web 角色管理共源动作与本地库接线', () => {
  it('未登录且离线时可保存到既有本地库，正文/未知字段/签名证据保持不变，重复保存不增行', async () => {
    await mount(sample, true);
    expect(container.textContent).toContain('已恢复本地草稿（');
    expect(button('保存到本地库').className).toBe('generate-button w-full');
    await click('保存到本地库');
    await waitFor(() => container.textContent?.includes('已保存到本地库。') === true);
    const repository = getLocalCardRepository();
    const first = await repository.list({ limit: 100 });
    expect(first.items).toHaveLength(1);
    expect(first.items[0].data).toEqual(sample);
    expect(first.items[0].provenance).toEqual({ kind: 'unsigned', execution: 'edited' });
    expect(fetch).not.toHaveBeenCalled();
    await click('保存到本地库');
    await waitFor(() => container.textContent?.includes('已更新本地库中的同内容数据卡。') === true);
    expect((await repository.list({ limit: 100 })).items).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('情景保存沿用 scenario 分类，命中墓碑不自动恢复', async () => {
    const scenario = { templateId: '通用情景', title: '雾港', content: '夜景', future: { keep: true } };
    const repository = getLocalCardRepository();
    const existing = await saveLocalDataCard(repository, { cardType: 'scenario', title: '雾港', payload: scenario });
    await repository.delete(existing.record.id);
    await mount(scenario);
    await click('保存到本地库');
    await waitFor(() => container.textContent?.includes('请先恢复后再保存') === true);
    expect((await repository.get(existing.record.id))?.deletedAt).toBeDefined();
    expect((await repository.list({ limit: 100 })).items).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    await repository.restore(existing.record.id);
    await click('保存到本地库');
    await waitFor(() => container.textContent?.includes('已更新本地库中的同内容数据卡。') === true);
    expect((await repository.get(existing.record.id))?.cardType).toBe('scenario');
  });

  it('写库失败保留编辑内容且可重试，不发起网络请求', async () => {
    await mount();
    vi.spyOn(getLocalCardRepository(), 'put').mockRejectedValueOnce(new Error('磁盘不可用'));
    await click('保存到本地库');
    await waitFor(() => container.textContent?.includes('保存到本地库失败：磁盘不可用') === true);
    expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe('雾灯');
    expect(button('复制到剪贴板').disabled).toBe(false);
    await click('保存到本地库');
    await waitFor(() => container.textContent?.includes('已保存到本地库。') === true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('保存使用点击时快照，期间继续编辑不会被覆盖或误报为已保存', async () => {
    await mount();
    const repository = getLocalCardRepository();
    const put = repository.put.bind(repository);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(repository, 'put').mockImplementationOnce(async (record) => { await pending; await put(record); });
    await click('保存到本地库');
    await waitFor(() => !!button('正在保存…'));
    expect(button('加载其他数据').disabled).toBe(true);
    const content = container.querySelector<HTMLTextAreaElement>('#editor-field-content')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(content, '保存期间的新正文');
      content.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { release(); });
    await waitFor(() => container.textContent?.includes('后续修改尚未写入本地库') === true);
    expect(content.value).toBe('保存期间的新正文');
    expect((await repository.list({ limit: 100 })).items[0].data).toEqual(sample);
  });

  it.each(['{broken', JSON.stringify({ version: 77, updatedAt: Date.now(), payload: { future: true } })])('坏/未来草稿保留；新编辑可保存导出并确认放弃：%s', async (raw) => {
    window.localStorage.setItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY, raw);
    await act(async () => { root.render(<CharacterManagerPage />); });
    await waitFor(() => container.textContent?.includes('自动保存已暂停') === true);
    const select = container.querySelector<HTMLSelectElement>('select')!;
    await act(async () => { select.value = 'general'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await waitFor(() => !!button('保存到本地库'));
    expect(window.localStorage.getItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY)).toBe(raw);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await click('保存修改并下载');
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY)).toBe(raw);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await click('加载其他数据');
    expect(button('保存到本地库')).toBeDefined();
    await click('加载其他数据');
    expect(button('保存到本地库')).toBeUndefined();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY)).toBe(raw);
    await act(async () => { select.value = 'general'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await click('保存到本地库');
    await waitFor(() => container.textContent?.includes('已保存到本地库。') === true);
    const afterSaveUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterSaveUnload);
    expect(afterSaveUnload.defaultPrevented).toBe(false);
    expect(window.localStorage.getItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY)).toBe(raw);
  });

  it('读取失败保留草稿，显式清空失败仍暂停，成功后保留新编辑并恢复自动保存', async () => {
    const raw = '{keep';
    window.localStorage.setItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY, raw);
    const originalRead = Storage.prototype.getItem;
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === CHARACTER_MANAGER_PAGE_DRAFT_KEY) throw new Error('denied');
      return originalRead.call(this, key);
    });
    await act(async () => { root.render(<CharacterManagerPage />); });
    await waitFor(() => container.textContent?.includes('本地草稿读取失败') === true);
    read.mockRestore();
    const select = container.querySelector<HTMLSelectElement>('select')!;
    await act(async () => { select.value = 'general'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click('清空本地草稿');
    expect(container.textContent).toContain('清空本地草稿失败');
    expect(button('保存修改并下载').disabled).toBe(false);
    expect(window.localStorage.getItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY)).toBe(raw);
    expect(readCharacterManagerPageDraftState().kind).toBe('blocked');
    remove.mockRestore();
    await click('清空本地草稿');
    await waitFor(() => readCharacterManagerPageDraftState().kind === 'ready');
    expect(container.textContent).not.toContain('自动保存已暂停');
    expect(button('保存到本地库')).toBeDefined();
  });

  it('清空坏草稿成功但新稿写入失败时仍有提示和离开保护，本地保存与自动保存恢复分别更新dirty', async () => {
    window.localStorage.setItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY, '{broken');
    await act(async () => { root.render(<CharacterManagerPage />); });
    await waitFor(() => container.textContent?.includes('自动保存已暂停') === true);
    const select = container.querySelector<HTMLSelectElement>('select')!;
    await act(async () => { select.value = 'general'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const originalSet = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === CHARACTER_MANAGER_PAGE_DRAFT_KEY) throw new Error('quota');
      originalSet.call(this, key, value);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click('清空本地草稿');
    await waitFor(() => container.textContent?.includes('页面草稿自动保存失败') === true);
    expect(window.localStorage.getItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY)).toBeNull();
    expect(container.textContent).not.toContain('当前输入会自动保存到浏览器');
    expect(container.textContent).not.toContain('当前编辑内容会重新自动保存');
    const isLeaveGuarded = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(isLeaveGuarded()).toBe(true);
    await click('保存修改并下载');
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(isLeaveGuarded()).toBe(true);
    await click('保存到本地库');
    await waitFor(() => container.textContent?.includes('已保存到本地库。') === true);
    expect(isLeaveGuarded()).toBe(false);
    const input = container.querySelector<HTMLTextAreaElement>('#editor-field-content')!;
    const editContent = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await editContent('本地保存后又修改');
    expect(isLeaveGuarded()).toBe(true);
    expect(container.textContent).toContain('页面草稿自动保存失败');
    write.mockRestore();
    await editContent('自动保存恢复的新正文');
    await waitFor(() => container.textContent?.includes('已自动保存于') === true);
    expect(container.textContent).not.toContain('页面草稿自动保存失败');
    expect(isLeaveGuarded()).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY)!).payload.characterData.content).toBe('自动保存恢复的新正文');
  });

  it('共源下载入口仍走 Web 补签与 Blob adapter，未改为本地库保存', async () => {
    await mount(sample, true);
    const signed = { ...sample, signature: 'renewed-evidence' };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(signed), { status: 200 }));
    await click('保存修改并下载');
    await waitFor(() => mocks.download.mock.calls.length === 1);
    expect(fetch).toHaveBeenCalledWith('/api/resign-data', expect.objectContaining({ method: 'POST' }));
    expect(mocks.download.mock.calls[0][1]).toBe('角色档案_雾灯_已编辑.json');
    const blob = mocks.download.mock.calls[0][0] as Blob;
    expect(JSON.parse(await blob.text())).toEqual(signed);
    expect((await getLocalCardRepository().list({ limit: 100 })).items).toHaveLength(0);
  });
});
