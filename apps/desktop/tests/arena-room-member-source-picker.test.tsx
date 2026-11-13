// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopCardLibraryRequestSchema } from '@mahoshojo/contracts/desktop-cloud';
import type { ArenaMemberSourcePickerProps } from '@mahoshojo/ui-web/arena-room';
import type { CardLibraryHost } from '@mahoshojo/ui-web/card-library';
import { BUILTIN_WEB_PACKAGE_PRESETS, unpackWebPackageZip } from '@mahoshojo/web-package';
import { createDesktopCardLibraryOnlinePort } from '../src/platform/card-library-host';
import { createDesktopMemberPublicLibraryHost } from '../src/features/arena/room-member-source-data';
import { DesktopArenaMemberPublicSourcePicker, downloadDesktopMemberBuiltinPackage } from '../src/features/arena/room-member-sources';

const downloads = vi.hoisted(() => ({ binary: vi.fn() }));
vi.mock('../src/platform/download-text-file', () => ({ downloadBinaryFile: downloads.binary, downloadTextFile: vi.fn() }));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const card = (type = 'character') => ({ id: 'public-one', type, name: '源卡', description: '描述', data: '{"codename":"来源正文"}', is_public: 1,
  review_status: 'approved', updated_at: '2026-10-15T00:00:00Z', created_at: '2026-10-15T00:00:00Z', usage_count: 0, like_count: 0, favorite_count: 0,
  is_recommended: 0, username: 'author', roleType: 'magical-girl', nativeAllowed: false, has_pending_update: false, tag_ids: [], favorited_at: null });
type PublicResponse = { status: number; body: { success: boolean; card?: Record<string, unknown> } };
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('crypto', webcrypto); downloads.binary.mockReset();
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const click = async (element: Element | null) => { expect(element).not.toBeNull(); await act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

function setup(kind: ArenaMemberSourcePickerProps['kind'], read: () => Promise<PublicResponse>) {
  const onlineRow = card(kind === 'scenario' || kind === 'auxScenario' ? 'scenario' : 'character');
  const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
    const request = DesktopCardLibraryRequestSchema.parse(args?.request);
    if (request.routeId === 'public-data-cards.query') return request.query?.id ? read() : { status: 200, body: { success: true, cards: [onlineRow], total: 1, nextOffset: null } };
    if (request.routeId === 'tags.query') return { status: 200, body: { success: true, tags: [] } };
    if (request.routeId === 'data-card-meta-batch.query') return { status: 200, body: { success: true, items: { 'public-one': { metrics: {}, strict: {} } } } };
    if (request.routeId === 'badges-batch.query') return { status: 200, body: { success: true, items: {} } };
    if (request.routeId === 'data-card-stats.report') return { status: 200, body: { success: true } };
    throw new Error(`Unexpected member source route: ${request.routeId}`);
  });
  const host = createDesktopMemberPublicLibraryHost({ auth: { status: 'unauthenticated', userId: null, userBadges: [] }, online: createDesktopCardLibraryOnlinePort(invoke),
    platform: { Link: ({ href, children }) => <a href={href}>{children}</a>, copyText: async () => {}, marks: { isLiked: () => false, markLiked: () => true, isUsed: () => true, markUsed: () => false } },
    local: {} as CardLibraryHost['local'], slots: {},
  });
  const onSelect = vi.fn(), onToggle = vi.fn(), onClose = vi.fn(), onRead = vi.fn();
  let current = true;
  const isCurrent = () => current;
  function Picker() {
    const [open, setOpen] = useState(true);
    return <DesktopArenaMemberPublicSourcePicker open={open} kind={kind} selectedIds={[]} error={null} host={host} isCurrent={isCurrent} onRead={onRead}
      onSelect={ref => { onSelect(ref); setOpen(false); }} onToggle={onToggle} onClose={() => { onClose(); setOpen(false); }} />;
  }
  return { render: async () => { await act(async () => root.render(<Picker />)); await settle(); }, invoke, onSelect, onToggle, onClose, onRead, retire: () => { current = false; } };
}

describe('real public CardLibrary member picker', () => {
  it('keeps single selection open until fresh validation and emits only the current reference', async () => {
    const pending = deferred<PublicResponse>(), picker = setup('scenario', () => pending.promise);
    await picker.render();
    expect([...document.body.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(['公开情景']);
    expect(document.body.textContent).not.toContain('卡组导入'); expect(document.body.textContent).not.toContain('已缓存');
    await click(document.body.querySelector('[role="button"][aria-label="选择源卡"]'));
    expect(picker.onClose).not.toHaveBeenCalled(); expect(picker.onSelect).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => pending.resolve({ status: 200, body: { success: true, card: card('scenario') } }));
    expect(picker.onSelect).toHaveBeenCalledExactlyOnceWith({ id: 'public-one', kind: 'scenario', versionToken: '2026-10-15T00:00:00Z' });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    const requests = picker.invoke.mock.calls.map(call => DesktopCardLibraryRequestSchema.parse(call[1]?.request));
    expect(requests.filter(request => request.query?.id)).toEqual([{ routeId: 'public-data-cards.query', query: { id: 'public-one' } }]);
  });

  it('manual close during validation aborts selection and late results never escape', async () => {
    const pending = deferred<PublicResponse>(), picker = setup('scenario', () => pending.promise);
    await picker.render(); await click(document.body.querySelector('[role="button"][aria-label="选择源卡"]'));
    await click(document.body.querySelector('button[aria-label^="关闭"]'));
    await act(async () => pending.resolve({ status: 200, body: { success: true, card: card('scenario') } }));
    expect(picker.onClose).toHaveBeenCalledTimes(1); expect(picker.onSelect).not.toHaveBeenCalled(); expect(picker.onRead).not.toHaveBeenCalled();
  });

  it('shows withdrawn fresh source failure and permits explicit retry without accepting the old body', async () => {
    let valid = false;
    const picker = setup('scenario', async () => valid ? { status: 200, body: { success: true, card: card('scenario') } } : { status: 404, body: { success: false } });
    await picker.render(); await click(document.body.querySelector('[role="button"][aria-label="选择源卡"]'));
    expect(document.body.textContent).toContain('已撤回'); expect(picker.onSelect).not.toHaveBeenCalled();
    valid = true; await click(document.body.querySelector('[role="button"][aria-label="选择源卡"]'));
    expect(picker.onSelect).toHaveBeenCalledTimes(1);
  });

  it('guards an old owner during a multi-selection fresh read', async () => {
    const pending = deferred<PublicResponse>(), picker = setup('character', () => pending.promise);
    await picker.render(); await click(document.body.querySelector('button[aria-label="加入"]'));
    expect(picker.invoke.mock.calls.map(call => DesktopCardLibraryRequestSchema.parse(call[1]?.request)).filter(request => request.query?.id)).toEqual([{ routeId: 'public-data-cards.query', query: { id: 'public-one' } }]);
    picker.retire(); await act(async () => pending.resolve({ status: 200, body: { success: true, card: card() } }));
    expect(picker.onToggle).not.toHaveBeenCalled(); expect(picker.onRead).not.toHaveBeenCalled();
  });
});

describe('builtin package download host', () => {
  it('exports a verified exact builtin ZIP using the existing file boundary', async () => {
    const ref = BUILTIN_WEB_PACKAGE_PRESETS[0]!.packageRef;
    await downloadDesktopMemberBuiltinPackage(ref.digest, () => true);
    expect(downloads.binary).toHaveBeenCalledTimes(1);
    const [filename, archive, mime] = downloads.binary.mock.calls[0]!;
    expect(filename).toMatch(/\.zip$/u); expect(mime).toBe('application/zip');
    expect((await unpackWebPackageZip(archive)).ref).toEqual(ref);
  });
  it('rejects unknown imports and suppresses a delayed archive after scope retirement', async () => {
    await expect(downloadDesktopMemberBuiltinPackage('not-builtin', () => true)).rejects.toThrow('内置');
    let checks = 0;
    await downloadDesktopMemberBuiltinPackage(BUILTIN_WEB_PACKAGE_PRESETS[0]!.packageRef.digest, () => ++checks === 1);
    expect(downloads.binary).not.toHaveBeenCalled();
  });
});
