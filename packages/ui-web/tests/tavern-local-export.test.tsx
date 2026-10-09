// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TavernLocalExportPanel, readTavernBasePng, readTavernSourceJson, type TavernInputFile, type TavernExportFile } from '../src/tavern';
import { getPlaceholderPngBytes, MAX_TAVERN_FILE_BYTES, MAX_TAVERN_TEXT_BYTES, readTavernLocalDocument } from '@mahoshojo/domain/tavern-card';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';

let root: Root | undefined;
let container: HTMLDivElement;
const source = { templateId: '通用角色', name: '原角色', content: '完整源正文', signature: 'unverified',
  isNative: true, rankTier: 'SSS', unknownExtension: { nested: [false, '未知', 17, null] } };
const encoder = new TextEncoder();
function file(data: unknown, name = 'source.json'): TavernInputFile {
  const bytes = encoder.encode(JSON.stringify(data));
  return { name, size: bytes.length, arrayBuffer: vi.fn(async () => bytes.buffer) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function repository(item?: LocalCardRecordV1): CardRepository {
  return { list: vi.fn(async () => ({ items: item ? [item] : [] })), get: vi.fn(async () => item ?? null) } as unknown as CardRepository;
}
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((element) => element.textContent === text);
  if (!found) throw new Error(`missing button: ${text}`);
  return found;
}
function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const found = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`missing field: ${label}`);
  return found;
}
async function choose(inputFile: TavernInputFile, label = '选择本项目数据卡 JSON') {
  const input = field(label);
  Object.defineProperty(input, 'files', { value: [inputFile], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
}
function edit(label: string, value: string) {
  const input = field(label);
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function toggle(label: string) {
  const checkbox = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .find((input) => input.closest('label')?.textContent?.includes(label));
  if (!checkbox) throw new Error(`missing checkbox: ${label}`);
  act(() => checkbox.click());
}
async function mount(props: Partial<ComponentProps<typeof TavernLocalExportPanel>> = {}) {
  const exportFile = props.exportFile ?? vi.fn(async (_output: TavernExportFile) => {});
  await act(async () => root!.render(<TavernLocalExportPanel repository={repository()} exportFile={exportFile} {...props} />));
  return exportFile as ReturnType<typeof vi.fn<(output: TavernExportFile) => Promise<void>>>;
}
function parseExport(output: TavernExportFile) {
  return readTavernLocalDocument(output.bytes, output.mimeType === 'image/png' ? 'png' : 'json').candidates[0].parsed as {
    name: string; data: { name: string; description: string; talkativeness?: number; tags: string[];
      extensions: { talkativeness: number; ms_export: { source: { kind: string; metrics: { isNative: boolean | null }; rankTier?: string }; sourceDataJson?: string; sourceDataTruncated?: boolean } };
      character_book: { entries: Array<{ content: string; comment: string }> }; scenario: string };
  };
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected network'); }));
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('rendered local Tavern export journey', () => {
  it.each(['file', 'library'] as const)('%s role card → edited fields → real PNG/JSON round trip, preserving complete source separately', async (kind) => {
    const original = JSON.stringify(source);
    const item = { id: 'card-a', title: '本地角色', cardType: 'character', data: source } as unknown as LocalCardRecordV1;
    const repo = repository(item);
    const exportFile = await mount({ repository: repo, getDefaultBase: vi.fn(async () => getPlaceholderPngBytes()) });
    expect(repo.list).not.toHaveBeenCalled();
    if (kind === 'file') await choose(file(source));
    else {
      await act(async () => button('从本地卡库读取角色卡').click());
      expect(repo.list).toHaveBeenCalledWith({ cardTypes: ['character'], limit: 100 });
      await act(async () => button('本地角色').click());
      expect(repo.get).toHaveBeenCalledWith('card-a');
    }
    expect(field('name').value).toBe('原角色');
    edit('name', '编辑角色'); edit('description', '编辑后的酒馆正文'); edit('talkativeness', '0');
    for (const format of ['PNG', 'JSON']) await act(async () => button(`导出酒馆 ${format}`).click());
    expect(exportFile).toHaveBeenCalledTimes(2);
    for (const [output] of exportFile.mock.calls) {
      expect(output.name).toMatch(/^编辑角色\.(png|json)$/);
      const card = parseExport(output);
      expect(card.data).toMatchObject({ name: '编辑角色', description: '编辑后的酒馆正文', extensions: { talkativeness: 0 } });
      expect(card).not.toHaveProperty('signature'); expect(card.data).not.toHaveProperty('signature');
      expect(card.data.tags).not.toContain('原生'); expect(card.data.tags).not.toContain('段位-SSS');
      expect(card.data.extensions.ms_export.source).toMatchObject({ kind: 'local', metrics: { isNative: null } });
      expect(card.data.extensions.ms_export.source.rankTier).toBeUndefined();
      expect(JSON.parse(card.data.extensions.ms_export.sourceDataJson!)).toEqual(source);
    }
    await act(async () => button('另存完整源 JSON').click());
    const complete = exportFile.mock.calls[2][0];
    expect(complete.name).toBe('编辑角色_源数据.json');
    expect(new TextDecoder().decode(complete.bytes)).toBe(original);
    expect(JSON.stringify(source)).toBe(original);
    expect(container.textContent).toContain('已发起下载');
    expect(container.textContent).not.toContain('已保存到'); expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a truncated diagnostic snapshot while retaining full description and exact source JSON', async () => {
    const longSource = { ...source, content: '正文'.repeat(14_000), unknownTail: '源JSON末尾保留' };
    const exportFile = await mount(); await choose(file(longSource));
    expect(container.textContent).toContain('sourceDataJson 已截断到 24000');
    await act(async () => button('导出酒馆 JSON').click());
    const card = parseExport(exportFile.mock.calls[0][0]);
    expect(card.data.description).toBe(longSource.content); expect(card.data.extensions.ms_export.sourceDataTruncated).toBe(true);
    await act(async () => button('另存完整源 JSON').click());
    expect(new TextDecoder().decode(exportFile.mock.calls[1][0].bytes)).toBe(JSON.stringify(longSource));
    toggle('附带源 JSON 诊断快照');
    expect(container.textContent).not.toContain('sourceDataJson 已截断到 24000');
    await act(async () => button('导出酒馆 JSON').click());
    expect(parseExport(exportFile.mock.calls[2][0]).data.extensions.ms_export).not.toHaveProperty('sourceDataJson');
  });

  it('does not replace edited fields when an older library selection finally resolves', async () => {
    const delayed = deferred<LocalCardRecordV1>();
    const item = { id: 'old', title: '较旧卡', cardType: 'character', data: { ...source, name: '旧名称' } } as unknown as LocalCardRecordV1;
    const repo = repository(item); vi.mocked(repo.get).mockReturnValue(delayed.promise);
    const exportFile = await mount({ repository: repo }); await choose(file(source));
    await act(async () => button('从本地卡库读取角色卡').click());
    act(() => button('较旧卡').click());
    edit('name', '新编辑'); edit('description', '保留我');
    await act(async () => delayed.resolve(item));
    expect(field('name').value).toBe('新编辑'); expect(field('description').value).toBe('保留我');
    await act(async () => button('导出酒馆 JSON').click());
    expect(parseExport(exportFile.mock.calls[0][0]).data.name).toBe('新编辑');
  });

  it('invalidates a pending file read on an edit and ignores older read errors after a newer file', async () => {
    await mount(); await choose(file(source));
    const pending = deferred<ArrayBuffer>();
    await choose({ name: 'old.json', size: 100, arrayBuffer: () => pending.promise });
    expect(container.textContent).toContain('正在读取角色卡');
    edit('name', '用户编辑');
    await act(async () => pending.resolve(encoder.encode(JSON.stringify({ ...source, name: '迟到卡' })).buffer));
    expect(field('name').value).toBe('用户编辑'); expect(container.textContent).not.toContain('正在读取角色卡');
    const staleFailure = deferred<ArrayBuffer>();
    await choose({ name: 'failing.json', size: 100, arrayBuffer: () => staleFailure.promise });
    await choose(file({ ...source, name: '最新文件' }, 'new.json'));
    await act(async () => staleFailure.reject(new Error('stale read failed')));
    expect(field('name').value).toBe('最新文件'); expect(container.textContent).not.toContain('stale read failed');
  });

  it('cancels stale source intent when exporting while a newer read is still pending', async () => {
    const exportFile = await mount(); await choose(file(source));
    const pending = deferred<ArrayBuffer>();
    await choose({ name: 'slow.json', size: 100, arrayBuffer: () => pending.promise });
    await act(async () => button('导出酒馆 JSON').click());
    await act(async () => pending.resolve(encoder.encode(JSON.stringify({ ...source, name: '迟到卡' })).buffer));
    expect(field('name').value).toBe('原角色'); expect(parseExport(exportFile.mock.calls[0][0]).data.name).toBe('原角色');
  });

  it('single-flights a pending default PNG and never downloads after unmount', async () => {
    const pending = deferred<Uint8Array>(); const getDefaultBase = vi.fn(() => pending.promise); const onBusyChange = vi.fn();
    const exportFile = await mount({ getDefaultBase, onBusyChange }); await choose(file(source));
    act(() => { button('导出酒馆 PNG').click(); button('导出酒馆 PNG').click(); });
    expect(getDefaultBase).toHaveBeenCalledTimes(1); expect(field('name').disabled).toBe(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    act(() => root!.unmount()); root = undefined;
    await act(async () => pending.resolve(getPlaceholderPngBytes()));
    expect(exportFile).not.toHaveBeenCalled(); expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('shows a download failure and permits an explicit retry without changing edited fields', async () => {
    const exportFile = vi.fn<(output: TavernExportFile) => Promise<void>>().mockRejectedValueOnce(new Error('下载失败')).mockResolvedValue(undefined);
    await mount({ exportFile }); await choose(file(source)); edit('description', '保留的编辑');
    await act(async () => button('导出酒馆 JSON').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('下载失败');
    expect(field('description').value).toBe('保留的编辑'); expect(button('导出酒馆 JSON').disabled).toBe(false);
    await act(async () => button('导出酒馆 JSON').click()); expect(exportFile).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('已发起下载');
  });

  it.each([['选择本项目数据卡 JSON', 'large.json', MAX_TAVERN_TEXT_BYTES + 1], ['自定义 PNG 底图', 'large.png', MAX_TAVERN_FILE_BYTES + 1]] as const)
    ('rejects oversized %s before materializing bytes and preserves the current source', async (label, name, size) => {
      await mount(); await choose(file(source)); const arrayBuffer = vi.fn();
      await choose({ name, size, arrayBuffer }, label);
      expect(arrayBuffer).not.toHaveBeenCalled(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('上限');
      expect(field('name').value).toBe('原角色');
    });

  it('rejects malformed role JSON and scene-only input without destroying the loaded role', async () => {
    await mount(); await choose(file(source));
    await choose(file({ templateId: '通用情景', title: '只有情景', content: '不能做角色' }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('请选择角色数据卡');
    await choose({ name: 'broken.json', size: 1, arrayBuffer: async () => encoder.encode('{').buffer });
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(field('name').value).toBe('原角色');
  });

  it('errors before fetching a default base when both Tavern chunks are disabled, while JSON still works', async () => {
    const getDefaultBase = vi.fn(async () => getPlaceholderPngBytes());
    const exportFile = await mount({ getDefaultBase }); await choose(file(source)); toggle('写入 ccv3'); toggle('写入 chara');
    await act(async () => button('导出酒馆 PNG').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('至少写入一个');
    expect(getDefaultBase).not.toHaveBeenCalled(); expect(exportFile).not.toHaveBeenCalled();
    await act(async () => button('导出酒馆 JSON').click()); expect(parseExport(exportFile.mock.calls[0][0]).data.name).toBe('原角色');
  });

  it('uses a selected base PNG and actual scene controls when assembling the output', async () => {
    const getDefaultBase = vi.fn(async () => getPlaceholderPngBytes());
    const exportFile = await mount({ getDefaultBase }); await choose(file(source));
    const bytes = getPlaceholderPngBytes(); await choose({ name: 'chosen.png', size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer }, '自定义 PNG 底图');
    await choose(file({ templateId: '通用情景', title: '客厅', content: '场景正文' }, 'scene.json'), '附加本地情景 JSON');
    toggle('写入竞技场默认世界书'); toggle('把情景片段写入 scenario'); edit('scenario', '自定义舞台');
    await act(async () => button('导出酒馆 PNG').click());
    const card = parseExport(exportFile.mock.calls[0][0]);
    expect(getDefaultBase).not.toHaveBeenCalled(); expect(card.data.scenario).toBe('自定义舞台');
    expect(card.data.character_book.entries).toHaveLength(1); expect(card.data.character_book.entries[0].content).toContain('场景正文');
    await act(async () => button('移除情景').click());
    await act(async () => button('导出酒馆 JSON').click()); expect(parseExport(exportFile.mock.calls[1][0]).data.character_book.entries).toEqual([]);
  });

  it('keeps a pending base PNG and subsequently added scene as independent user choices', async () => {
    const pendingBase = deferred<ArrayBuffer>();
    const getDefaultBase = vi.fn(async () => getPlaceholderPngBytes());
    const onBusyChange = vi.fn();
    const exportFile = await mount({ getDefaultBase, onBusyChange }); await choose(file(source));
    const bytes = getPlaceholderPngBytes();
    await choose({ name: 'deferred.png', size: bytes.length, arrayBuffer: () => pendingBase.promise }, '自定义 PNG 底图');
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await choose(file({ templateId: '通用情景', title: '保留情景', content: '独立情景正文' }), '附加本地情景 JSON');
    expect(container.textContent).toContain('保留情景');
    await act(async () => pendingBase.resolve(new Uint8Array(bytes).buffer));
    expect(container.textContent).toContain('deferred.png'); expect(onBusyChange).toHaveBeenLastCalledWith(false);
    await act(async () => button('导出酒馆 PNG').click());
    expect(getDefaultBase).not.toHaveBeenCalled();
    expect(parseExport(exportFile.mock.calls[0][0]).data.scenario).toContain('独立情景正文');
  });

  it('disables oversized assembled cards but still exports their complete under-limit source', async () => {
    const large = { ...source, content: 'a'.repeat(2_100_000) };
    const exportFile = await mount(); await choose(file(large));
    expect(container.textContent).toContain('4 MiB'); expect(container.textContent).toContain('完整源 JSON 仍可另存');
    expect(button('导出酒馆 PNG').disabled).toBe(true); expect(button('导出酒馆 JSON').disabled).toBe(true);
    expect(button('另存完整源 JSON').disabled).toBe(false);
    await act(async () => button('另存完整源 JSON').click());
    expect(new TextDecoder().decode(exportFile.mock.calls[0][0].bytes)).toBe(JSON.stringify(large));
  });
});

describe('source file materialization guards', () => {
  it('rechecks source length after an adapter understates size and validates UTF-8 and safe JSON', async () => {
    await expect(readTavernSourceJson({ name: 'understated.json', size: 1, arrayBuffer: async () => new ArrayBuffer(MAX_TAVERN_TEXT_BYTES + 1) })).rejects.toThrow('4 MiB');
    await expect(readTavernBasePng({ name: 'understated.png', size: 1, arrayBuffer: async () => new ArrayBuffer(MAX_TAVERN_FILE_BYTES + 1) })).rejects.toThrow('32 MiB');
    await expect(readTavernSourceJson({ name: 'utf8.json', size: 1, arrayBuffer: async () => Uint8Array.from([255]).buffer })).rejects.toThrow();
    await expect(readTavernSourceJson({ name: 'unsafe.json', size: 20, arrayBuffer: async () => encoder.encode('{"__proto__":{}}').buffer })).rejects.toThrow('安全有效');
  });
});
