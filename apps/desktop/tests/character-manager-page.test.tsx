// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeLocalLibraryRecord } from '@mahoshojo/local-library/archive-export';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';

import { LIST_LOCAL_BACKUPS_COMMAND } from '../src/platform/local-backup-bridge';
import {
  DELETE_LOCAL_CARD_COMMAND,
  GET_LOCAL_CARD_COMMAND,
  LIST_LOCAL_CARDS_COMMAND,
  RESTORE_LOCAL_CARD_COMMAND,
  SAVE_LOCAL_CARD_COMMAND,
} from '../src/platform/local-card-bridge';
import { DESKTOP_CHARACTER_MANAGER_DRAFT_KEY } from '../src/features/character-manager/draft-persistence';
import { createDesktopRouter } from '../src/app/router';

const native = vi.hoisted(() => ({ listen: vi.fn() }));
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: native.listen }) }));
vi.mock('../src/platform/desktop-archive-host', () => ({
  createDesktopArchiveHost: () => ({
    probeStorage: async () => null,
    runExport: vi.fn(),
    pickArchiveBytes: vi.fn(),
    inspectArchive: vi.fn(),
    applyArchive: vi.fn(),
    describeError: () => '归档失败',
  }),
  DESKTOP_LIBRARY_ARCHIVE_LIMITS: { fileBytes: 1024 },
}));

const makeRecord = async (data: Record<string, unknown>, overrides: Partial<LocalCardRecordV1> = {}): Promise<LocalCardRecordV1> => {
  const contentDigest = await digestLocalCardPayloadV1(data);
  return {
    id: deriveLocalDataCardIdV1(contentDigest),
    schemaVersion: 1,
    storageLocation: 'local',
    cardType: 'character',
    title: String(data.codename ?? '卡'),
    data: data as LocalCardRecordV1['data'],
    contentDigest,
    provenance: { kind: 'unsigned', execution: 'direct-local' },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
};

let rows: Map<string, LocalCardRecordV1>;
let original: LocalCardRecordV1;
let root: Root;
let container: HTMLDivElement;
let close: (event: { preventDefault: () => void }) => void;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
/** 懒加载路由与 IPC mock 在负载下可能晚于固定等待；按条件轮询而不是赌一个时长。 */
const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待条件超时');
    await settle();
  }
};
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (target: Element | undefined) => {
  await act(async () => { target!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};
const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
});
const fieldByLabel = (label: string) => {
  const target = [...container.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith(label))!;
  return container.querySelector<HTMLInputElement>(`#${CSS.escape(target.htmlFor)}`)!;
};
/** 共享导入区的粘贴区默认折叠；先展开再取 textarea。 */
const expandPasteArea = async () => {
  await click(button('▶ 展开文本粘贴区域 (手机端推荐)'));
  await waitFor(() => container.querySelector('textarea') !== null);
};

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  window.localStorage.clear();
  original = await makeRecord({ codename: '星光', appearance: { outfit: '白裙' } });
  rows = new Map([[original.id, original]]);
  bridge.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === LIST_LOCAL_BACKUPS_COMMAND) return { backups: [], invalidCount: 0 };
    if (command === LIST_LOCAL_CARDS_COMMAND) {
      const includeDeleted = (args?.request as { includeDeleted: boolean }).includeDeleted;
      return { documents: [...rows.values()].filter((item) => includeDeleted || item.deletedAt === undefined).map(serializeLocalLibraryRecord) };
    }
    if (command === GET_LOCAL_CARD_COMMAND) {
      const found = rows.get(args?.id as string);
      return found === undefined ? null : serializeLocalLibraryRecord(found);
    }
    if (command === SAVE_LOCAL_CARD_COMMAND || command === DELETE_LOCAL_CARD_COMMAND || command === RESTORE_LOCAL_CARD_COMMAND) {
      const request = args?.request as { document: string; writeMode: string };
      const document = JSON.parse(request.document) as LocalCardRecordV1;
      if (request.writeMode === 'insert-if-absent' && rows.has(document.id)) return { id: document.id, alreadyPresent: true };
      rows.set(document.id, document);
      return { id: document.id };
    }
    return undefined;
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.location.hash = '#/local-library';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  native.listen.mockImplementation(async (handler) => { close = handler; return vi.fn(); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const mount = async () => {
  const router = createDesktopRouter();
  await router.load();
  await act(async () => { root.render(<RouterProvider router={router} />); });
  await settle();
  return router;
};

describe('Desktop 本地角色管理（IPC mock，仍需真机重启验收）', () => {
  it('与 Web 同一产品骨架：品牌 Logo、使用指南、我的数据卡与内容模板入口齐全', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await waitFor(() => container.querySelector('img[src="/character-manager.svg"]') !== null);
    expect(container.querySelector('img[src="/character-manager-white.svg"]')).not.toBeNull();
    expect(container.textContent).toContain('在这里查看、编辑和维护你的角色档案');
    expect(container.textContent).toContain('使用指南');
    expect(button('我的数据卡')).not.toBeUndefined();
    expect(container.textContent).toContain('内容模板');
    // 空页面没有可持久化的内容：不写「空草稿」，也就不显示「已自动保存」。
    expect(container.textContent).not.toContain('已自动保存');
    expect(window.localStorage.getItem(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY)).toBeNull();
    // 未交付能力不渲染入口：立绘、敏感词、原生性徽章、问卷编辑器均不出现。
    expect(container.textContent).not.toContain('立绘');
    expect(container.textContent).not.toContain('敏感词检测控制台');
    expect(container.textContent).not.toContain('原生数据');
  });

  it('「我的数据卡」打开共享选择器，默认落在本地页签并列出本地记录', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await waitFor(() => button('我的数据卡') !== undefined);
    await click(button('我的数据卡'));
    // 打开选择器是一次主动使用：顺手探测一次会话（DESK-ONLINE-013）。
    await waitFor(() => bridge.invoke.mock.calls.some((call) => call[0] === 'cloud_auth_status'));
    // Modal 内容渲染在页面 DOM 中（非 portal），等待本地列表出现记录标题。
    await waitFor(() => document.body.textContent?.includes('星光') === true);
    expect(document.body.textContent).toContain('本地');
  });

  it('从本地库进入编辑，只改标题时原记录整卡替换，未保存修改受离开保护', async () => {
    const router = await mount();
    await waitFor(() => button('编辑') !== undefined);
    await click(button('编辑'));
    await waitFor(() => container.textContent?.includes('编辑角色: 星光') === true);
    expect(router.state.location.pathname).toBe('/character-manager');
    expect(router.state.location.search).toEqual({ card: original.id });
    expect(container.textContent).toContain('本地库记录');
    // 已有记录的类型创建后不可修改：编辑器里是只读文本而不是下拉选择。
    const typeInput = container.querySelector<HTMLInputElement>(`#${CSS.escape([...container.querySelectorAll('label')].find((item) => item.textContent?.includes('类型（创建后不可修改）'))!.htmlFor)}`)!;
    expect(typeInput.readOnly).toBe(true);

    await type(fieldByLabel('记录标题'), '星光·改');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => { void router.navigate({ to: '/settings' }); });
    await settle();
    expect(confirm).toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/character-manager');
    const prevented = vi.fn();
    // 关窗回调会同步写入提示状态（guard message），与真实事件一样需要 act 包裹。
    await act(async () => { close({ preventDefault: prevented }); });
    expect(prevented).toHaveBeenCalledOnce();

    await click(button('保存到本地库'));
    await waitFor(() => container.textContent?.includes('已更新本地库中的记录。') === true);
    expect(rows.get(original.id)?.title).toBe('星光·改');
    expect(rows.size).toBe(1);

    confirm.mockClear();
    await act(async () => { await router.navigate({ to: '/settings' }); });
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('改正文另存为新记录，原记录保留并可显式移入回收站', async () => {
    window.location.hash = `#/character-manager?card=${original.id}`;
    const router = await mount();
    await waitFor(() => container.querySelector('#editor-field-appearance__outfit') !== null);
    await type(container.querySelector<HTMLInputElement>('#editor-field-appearance__outfit')!, '黑裙');
    await click(button('保存到本地库'));
    await waitFor(() => container.textContent?.includes('已另存为一条新记录') === true);
    expect(rows.size).toBe(2);
    const created = [...rows.values()].find((item) => item.id !== original.id)!;
    expect(created.provenance).toEqual({ kind: 'unsigned', execution: 'edited' });
    await waitFor(() => router.state.location.search.card === created.id);

    await click(button('将原记录移入回收站'));
    await waitFor(() => container.textContent?.includes('原记录已移入回收站') === true);
    expect(rows.get(original.id)?.deletedAt).toBeDefined();
  });

  it('粘贴导入命中回收站中的同内容卡时需显式恢复', async () => {
    rows.set(original.id, { ...original, deletedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' });
    window.location.hash = '#/character-manager';
    const router = await mount();
    await expandPasteArea();
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, JSON.stringify(original.data));
    await click(button('从文本加载数据'));
    expect(container.textContent).toContain('编辑角色: 星光');
    // 尚未首次保存的导入草稿可以选择类型。
    expect(container.textContent).toContain('尚未保存到本地库');
    const typeLabel = [...container.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith('类型'))!;
    expect(container.querySelector(`#${CSS.escape(typeLabel.htmlFor)}`)?.tagName).toBe('SELECT');
    await click(button('保存到本地库'));
    await waitFor(() => container.textContent?.includes('内容相同的记录在回收站中') === true);
    expect(rows.get(original.id)?.deletedAt).toBeDefined();

    await click(button('从回收站恢复并打开'));
    await waitFor(() => container.textContent?.includes('本地库记录') === true);
    expect(rows.get(original.id)?.deletedAt).toBeUndefined();
    expect(router.state.location.search).toEqual({ card: original.id });
    expect(container.textContent).toContain('编辑角色: 星光');
  });

  it('导出为 JSON 文件走 WebView 下载通道，导出的是草稿内容且不要求先保存', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    window.location.hash = '#/character-manager';
    await mount();
    await expandPasteArea();
    const imported = { codename: '导出角色', appearance: { outfit: '白裙' } };
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, JSON.stringify(imported));
    await click(button('从文本加载数据'));
    await waitFor(() => container.textContent?.includes('编辑角色: 导出角色') === true);

    await click(button('导出为 JSON 文件'));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    // 文件名按记录标题生成（与共享卡库下载同一口径）。
    const anchor = anchorClick.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('导出角色.json');
    // Blob 里装着的是当前草稿正文，不是已保存记录。
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(JSON.parse(await blob.text())).toEqual(imported);
    expect(rows.size).toBe(1);
  });

  it('非法导入给出原因且不进入编辑', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await expandPasteArea();
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, '[1, 2]');
    await click(button('从文本加载数据'));
    expect(container.textContent).toContain('数据卡必须是一个 JSON 对象。');
    expect(container.textContent).not.toContain('编辑角色:');
  });

  it('粘贴超过 4 MiB 的文本在解析前拒绝且不进入编辑', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await expandPasteArea();
    const oversized = `{"a":"${'x'.repeat(4 * 1024 * 1024)}"}`;
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, oversized);
    await click(button('从文本加载数据'));
    expect(container.textContent).toContain('内容超过单张数据卡的大小上限（4 MiB）。');
    expect(container.textContent).not.toContain('编辑角色:');
  });

  it('页面草稿自动持久化并在下次访问时恢复', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await expandPasteArea();
    const imported = { codename: '草稿角色', appearance: { outfit: '白裙' } };
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, JSON.stringify(imported));
    await click(button('从文本加载数据'));
    await waitFor(() => container.textContent?.includes('编辑角色: 草稿角色') === true);
    await settle();
    // 草稿已落 localStorage（key 与 Web 同一产品语义）。
    expect(window.localStorage.getItem(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY)).not.toBeNull();

    // 重新挂载整个应用模拟重启：草稿恢复到编辑器。
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.location.hash = '#/character-manager';
    await mount();
    await waitFor(() => container.textContent?.includes('编辑角色: 草稿角色') === true);
    expect(container.textContent).toContain('已恢复浏览器内的编辑草稿');
    expect(container.textContent).toContain('尚未保存到本地库');
  });

  it('清空本地草稿后重新访问不再恢复', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await expandPasteArea();
    const imported = { codename: '草稿角色', appearance: { outfit: '白裙' } };
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, JSON.stringify(imported));
    await click(button('从文本加载数据'));
    await waitFor(() => container.textContent?.includes('编辑角色: 草稿角色') === true);
    await settle();

    await click(button('清空本地草稿'));
    expect(window.localStorage.getItem(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY)).toBeNull();
    // 当前编辑内容不因为清空草稿而消失（同 Web 语义：只清持久化副本）。
    expect(container.textContent).toContain('编辑角色: 草稿角色');

    // 真正 remount（模拟重启）：已清空的草稿不得复活。
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.location.hash = '#/character-manager';
    await mount();
    await waitFor(() => button('我的数据卡') !== undefined);
    await settle();
    expect(container.textContent).not.toContain('编辑角色: 草稿角色');
    expect(container.textContent).not.toContain('已恢复浏览器内的编辑草稿');
    expect(window.localStorage.getItem(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY)).toBeNull();
  });

  it('同一 `?card` 刷新恢复未提交修改：恢复后仍 dirty、保留草稿标题且可保存', async () => {
    window.location.hash = `#/character-manager?card=${original.id}`;
    await mount();
    await waitFor(() => container.textContent?.includes('编辑角色: 星光') === true);
    await type(fieldByLabel('记录标题'), '星光·草稿');
    await type(container.querySelector<HTMLInputElement>('#editor-field-appearance__outfit')!, '黑裙');
    await waitFor(() => container.textContent?.includes('已自动保存') === true);

    // 模拟刷新：URL 仍是同一条记录的 `?card`——草稿必须恢复而不是被直达清掉。
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.location.hash = `#/character-manager?card=${original.id}`;
    await mount();
    await waitFor(() => container.textContent?.includes('已恢复浏览器内的编辑草稿') === true);
    // baseline 是本地库原记录而不是草稿自身：恢复出的草稿保持 dirty 与离开保护。
    expect(container.textContent).toContain('本地库记录 · 有未保存的修改');
    expect(fieldByLabel('记录标题').value).toBe('星光·草稿');
    expect(container.querySelector<HTMLInputElement>('#editor-field-appearance__outfit')!.value).toBe('黑裙');

    const saveButton = button('保存到本地库');
    expect(saveButton).not.toBeUndefined();
    expect(saveButton!.disabled).toBe(false);
    await click(saveButton);
    await waitFor(() => container.textContent?.includes('已另存为一条新记录') === true);
    expect(rows.size).toBe(2);
  });

  it('`?card` 指向不存在的记录时不销毁无关草稿：旧草稿恢复并保留失败原因', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await expandPasteArea();
    const imported = { codename: '草稿角色', appearance: { outfit: '白裙' } };
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, JSON.stringify(imported));
    await click(button('从文本加载数据'));
    await waitFor(() => container.textContent?.includes('编辑角色: 草稿角色') === true);
    await waitFor(() => window.localStorage.getItem(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY) !== null);

    // 带着无关草稿以无效 `?card` 重新进入：URL 打不开不能顺手清掉旧草稿。
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.location.hash = '#/character-manager?card=missing-record-id';
    await mount();
    await waitFor(() => container.textContent?.includes('本地库中没有这张数据卡') === true);
    await waitFor(() => container.textContent?.includes('编辑角色: 草稿角色') === true);
    expect(container.textContent).toContain('已恢复浏览器内的编辑草稿');
    expect(window.localStorage.getItem(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY)).not.toBeNull();
  });

  it('`?card` 指向其它记录时 URL 显式意图优先，旧草稿由新编辑会话接管', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await expandPasteArea();
    const imported = { codename: '草稿角色', appearance: { outfit: '白裙' } };
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, JSON.stringify(imported));
    await click(button('从文本加载数据'));
    await waitFor(() => container.textContent?.includes('编辑角色: 草稿角色') === true);
    await waitFor(() => window.localStorage.getItem(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY) !== null);

    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.location.hash = `#/character-manager?card=${original.id}`;
    await mount();
    await waitFor(() => container.textContent?.includes('编辑角色: 星光') === true);
    // 显式打开的记录正常进入编辑；旧草稿卡被自动保存的新会话状态接管
    // （pastedJson 是独立的暂存字段，不受此约束）。
    expect(container.textContent).toContain('本地库记录');
    await waitFor(() => {
      const raw = window.localStorage.getItem(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY);
      if (raw === null) return false;
      const stored = JSON.parse(raw) as { payload?: { draft?: { originalId?: string | null } | null } };
      return stored.payload?.draft?.originalId === original.id;
    });
  });

  it('自动保存写失败时草稿条如实报告，不再声称会自动保存', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await expandPasteArea();
    const imported = { codename: '草稿角色', appearance: { outfit: '白裙' } };
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, JSON.stringify(imported));
    await click(button('从文本加载数据'));
    await waitFor(() => container.textContent?.includes('编辑角色: 草稿角色') === true);
    await waitFor(() => container.textContent?.includes('已自动保存') === true);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await type(fieldByLabel('记录标题'), '草稿角色·改');
    await waitFor(() => container.textContent?.includes('页面草稿自动保存失败') === true);
    expect(container.textContent).toContain('页面草稿自动保存暂不可用');
    expect(container.textContent).not.toContain('当前输入会自动保存到浏览器');
  });

  it('结构化情景卡导入归类为 scenario，跨类别模板转换脱离原记录', async () => {
    window.location.hash = '#/character-manager';
    await mount();
    await expandPasteArea();
    // `elements` 是对象而非数组——按正文特征（`inferDataCardTemplate`）判为情景。
    const scenarioCard = { title: '雾港', elements: { scene: { time: '夜' } }, description: '雨夜' };
    await type(container.querySelector<HTMLTextAreaElement>('textarea')!, JSON.stringify(scenarioCard));
    await click(button('从文本加载数据'));
    await waitFor(() => container.textContent?.includes('编辑情景: 雾港') === true);
    const typeLabel = [...container.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith('类型'))!;
    expect(container.querySelector<HTMLSelectElement>(`#${CSS.escape(typeLabel.htmlFor)}`)?.value).toBe('scenario');

    // 已有记录跨类别转换（character → scenario）：脱离原记录成为新的未保存草稿。
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    window.location.hash = `#/character-manager?card=${original.id}`;
    await mount();
    await waitFor(() => container.textContent?.includes('编辑角色: 星光') === true);

    const templateLabel = [...container.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith('内容模板'))!;
    const templateSelect = templateLabel.parentElement!.querySelector('select')!;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(templateSelect), 'value')!.set!;
    await act(async () => {
      setter.call(templateSelect, 'scenario');
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(container.textContent).toContain('已转换为目标模板');
    expect(container.textContent).toContain('脱离原本地库记录');
    expect(container.textContent).toContain('尚未保存到本地库');

    // 保存写入一条新 scenario 记录；原记录不被原地重分类。
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click(button('保存到本地库'));
    await waitFor(() => container.textContent?.includes('已保存到本地库') === true);
    expect(rows.size).toBe(2);
    expect(rows.get(original.id)?.cardType).toBe('character');
    const created = [...rows.values()].find((item) => item.id !== original.id)!;
    expect(created.cardType).toBe('scenario');
    confirm.mockRestore();
  });
});
