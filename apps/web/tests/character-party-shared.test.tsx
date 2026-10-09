// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CharacterPartyPage } from '@/components/character/CharacterPartyPage';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));
vi.mock('@/components/BattleDataModal', () => ({ default: () => null }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/MagicalGirlCard', () => ({ default: () => null }));
vi.mock('@/components/CanshouCard', () => ({ default: () => null }));
vi.mock('@/components/GeneralCharacterCard', () => ({ default: () => null }));
vi.mock('@/components/shared/CharacterPortraitAssetPanel', () => ({ CharacterPortraitAssetPanel: () => null }));
vi.mock('@/components/SaveToCloudButton', () => ({ default: () => null }));
vi.mock('@/components/arena/components/DatabaseSelector', () => ({ DatabaseSelector: () => null }));
const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: mocks.download }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
it('Web really consumes shared team controls while retaining host-only verification and signing', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, '', '/character-party');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const fetch = vi.fn(async (url: string, options: { body: string }) => ({ ok: true, json: async () => url === '/api/verify-origin' ? { isValid: true } : { ...JSON.parse(options.body), signature: 'new-server-signature' } }));
  vi.stubGlobal('fetch', fetch);
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const button = (text: string) => [...container.querySelectorAll('button')].find((node) => node.textContent === text)!;
  try {
    await act(async () => root.render(<CharacterPartyPage />));
    const paste = container.querySelector('textarea')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(paste, JSON.stringify([{ codename: 'A', signature: 'source-A' }, { codename: 'B', signature: 'source-B' }])); paste.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => button('解析并添加').click());
    const label = container.querySelector('[aria-label="队员 1 标识"]')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(label, '甲'); label.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => button('下移').click());
    expect(JSON.parse(container.querySelector('pre')!.textContent!).codename).toBe('B & 甲');
    const dirtyUnload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirtyUnload); expect(dirtyUnload.defaultPrevented).toBe(true);
    const home = container.querySelector('a[href="/"]')!;
    const leaving = new MouseEvent('click', { bubbles: true, cancelable: true }); home.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true); expect(confirm).toHaveBeenCalled();
    await act(async () => button('下载 JSON').click());
    const savedUnload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedUnload); expect(savedUnload.defaultPrevented).toBe(false);
    expect(fetch.mock.calls.some(([url]) => url === '/api/resign-data')).toBe(true);
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('原生性签名认证成功');
  } finally { act(() => root.unmount()); container.remove(); window.history.replaceState(null, '', '/'); }
});
