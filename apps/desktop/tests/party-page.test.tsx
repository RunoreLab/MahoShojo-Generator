// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopParty } from '../src/app/party-page';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), navigate: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: mocks.navigate }), Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock('../src/app/useLeaveGuard', () => ({ useLeaveGuard: () => ({ ready: true, message: '' }) }));
vi.mock('../src/features/external-links/external-links-provider', () => ({ useExternalLinks: () => ({ openFixed: vi.fn() }) }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('Desktop party real host wiring', () => {
  it('saves via existing IPC insert-if-absent with unsigned provenance and downloads exact result', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob); vi.useFakeTimers();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const create = vi.fn((_blob: NodeBlob) => 'blob:party');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let saved: LocalCardRecordV1 | undefined;
    mocks.invoke.mockImplementation(async (command: string, args: { request?: { writeMode: string; document: string } }) => {
      if (command !== 'save_local_card') throw new Error(`Unexpected IPC ${command}`);
      expect(args.request?.writeMode).toBe('insert-if-absent');
      saved = JSON.parse(args.request!.document);
      return { id: saved!.id, alreadyPresent: false };
    });
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const button = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === name)!;
    try {
      await act(async () => root.render(<DesktopParty />));
      const input = container.querySelector('textarea')!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, JSON.stringify([{ templateId: '通用角色', name: '甲', content: '内容A', signature: 'forged', _native: 'true' }, { templateId: '通用角色', name: '乙', content: '内容B' }]));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => button('解析并添加').click());
      await act(async () => button('保存到本地卡库').click());
      await act(async () => { await vi.waitFor(() => expect(saved).toBeDefined()); });
      expect(saved?.provenance).toEqual({ kind: 'unsigned', execution: 'imported' });
      expect(saved?.storageLocation).toBe('local'); expect(saved?.data).not.toHaveProperty('signature'); expect(saved?.data).not.toHaveProperty('_native');
      expect(container.textContent).toContain('已保存到本地卡库');
      await act(async () => button('下载 JSON').click());
      expect(anchor).toHaveBeenCalledTimes(1);
      expect(JSON.parse(await create.mock.calls[0][0].text())).toEqual(saved?.data);
      expect(fetch).not.toHaveBeenCalled(); expect(mocks.invoke).toHaveBeenCalledTimes(1);
      expect(revoke).not.toHaveBeenCalled(); vi.advanceTimersByTime(60_000); expect(revoke).toHaveBeenCalledWith('blob:party');
    } finally { act(() => root.unmount()); container.remove(); }
  });
});
