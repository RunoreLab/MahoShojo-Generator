// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNarrativeHistoryCardPayload } from '@mahoshojo/domain/narrative-history-operations';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { DesktopArenaHistoryControls } from '../src/features/arena/history-controls';
import { DesktopArenaSession } from '../src/features/arena/session';

const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('../src/platform/download-text-file', () => ({ downloadTextFile: mocks.download }));
vi.mock('../src/platform/card-library-host', () => ({ useDesktopCardLibraryHost: () => ({}) }));
vi.mock('@mahoshojo/ui-web/card-library', () => ({ CardLibraryModal: () => null }));

let root: Root, container: HTMLDivElement, session: DesktopArenaSession;
let scope: string;
let records: LocalCardRecordV1[];
let repository: CardRepository;
let storage: Storage;
const dirty = vi.fn(), busy = vi.fn();
const entry = { id: 'web-entry', title: '网页战报', content: '完整叙事正文', createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z' };
const webExport = JSON.stringify(buildNarrativeHistoryCardPayload([entry], entry.updatedAt, { now: () => entry.updatedAt }));

function Harness() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return <DesktopArenaHistoryControls session={session} draft={state.draft} scope={scope}
    disabled={state.importing || state.saving} importInput={load => session.importInput(load)} onDirtyChange={dirty} onBusyChange={busy} />;
}
const render = () => act(async () => root.render(<Harness />));
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes(text));
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
}
async function paste(text: string) {
  const field = document.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  vi.clearAllMocks(); localStorage.clear(); storage = localStorage; records = []; scope = 'first';
  repository = { putIfAbsent: vi.fn(async record => { records.push(record); return { written: true }; }), get: vi.fn() } as unknown as CardRepository;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(async () => { await act(async () => root.unmount()); session?.dispose(); container.remove(); vi.restoreAllMocks(); });

describe('Desktop 活动历史使用 Web 共源编辑器', () => {
  it.each(['battle', 'arena'] as const)('%s 可导入网页正式历史、导出并显式保存，重开草稿保留', async product => {
    session = new DesktopArenaSession({ product, repository, storage }); session.setScope(scope);
    await render(); await click('查看 / 编辑活动叙事历史'); await click('粘贴导入'); await paste(webExport);
    expect(dirty).toHaveBeenLastCalledWith(true);
    await click('确认追加导入');
    expect(session.getSnapshot().draft.narrativeHistoryEntries).toEqual([entry]);
    expect(session.getSnapshot().draft.historyOriginals?.[0].text).toBe(webExport);
    expect(records).toHaveLength(0);
    expect(busy).toHaveBeenCalledWith(true); expect(busy).toHaveBeenLastCalledWith(false);
    await click('导出 JSON');
    expect(JSON.parse(mocks.download.mock.calls[0][1]).entries).toEqual([entry]);
    await click('另存完整历史');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ cardType: 'history', provenance: { kind: 'unsigned' }, data: { entries: [entry] } });
    expect(records[0].provenance).not.toHaveProperty('execution');
    expect(document.body.textContent).toContain('已另存本地库');
    const reopened = new DesktopArenaSession({ product, repository, storage });
    reopened.restoreDraft(); expect(reopened.getSnapshot().draft.narrativeHistoryEntries).toEqual([entry]); reopened.dispose();
    await act(async () => session.updateDraft({ ...session.getSnapshot().draft, narrativeHistoryEntries: [{ ...entry, content: '编辑后的正文' }] }));
    expect(session.getSnapshot().saveStatus).toBe('idle');
    expect(document.body.textContent).not.toContain('已另存本地库');
  });

  it('无效导入和拒绝覆盖均保留原历史与输入文本', async () => {
    session = new DesktopArenaSession({ repository, storage }); session.setScope(scope);
    session.updateDraft({ ...session.getSnapshot().draft, narrativeHistoryEntries: [entry] });
    await render(); await click('查看 / 编辑活动叙事历史'); await click('粘贴导入'); await paste('{invalid'); await click('确认追加导入');
    expect(session.getSnapshot().draft.narrativeHistoryEntries).toEqual([entry]);
    expect(document.querySelector('textarea')?.value).toBe('{invalid');
    await paste(JSON.stringify({ entries: [{ ...entry, id: 'replacement', content: '替换正文' }] }));
    await act(async () => { const select = [...document.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'replace'))!; select.value = 'replace'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await click('确认覆盖导入');
    expect(window.confirm).toHaveBeenCalled(); expect(session.getSnapshot().draft.narrativeHistoryEntries).toEqual([entry]);
    expect(document.querySelector('textarea')?.value).toContain('替换正文');
  });

  it('文件读取期间身份变化使旧导入失效，不写入新身份草稿', async () => {
    session = new DesktopArenaSession({ repository, storage }); session.setScope(scope);
    await render(); await click('查看 / 编辑活动叙事历史');
    let finish!: (text: string) => void;
    const file = { name: 'history.json', size: webExport.length, text: () => new Promise<string>(resolve => { finish = resolve; }) } as File;
    await act(async () => { const input = document.querySelector('input[type="file"]')!; Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(session.getSnapshot().importing).toBe(true);
    await act(async () => { scope = 'second'; session.setScope(scope); }); await render();
    await act(async () => finish(webExport));
    expect(session.getSnapshot().draft.narrativeHistoryEntries).toEqual([]);
    expect(records).toHaveLength(0); expect(document.querySelector('textarea')).toBeNull();
  });
});
