// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const api = vi.hoisted(() => ({ dispatch: vi.fn(), stream: vi.fn() }));
vi.mock('@/lib/use-generation-api-intent-latch', () => ({ useGenerationApiIntentLatch: () => ({ tryAcquire: () => ({ dispatch: api.dispatch }) }) }));
vi.mock('@/lib/auth', () => ({ authStorage: { getActivityHeaders: async () => ({}), getAuthHeader: async () => null } }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/cooldown', () => ({ useCooldown: () => ({ isCooldown: false, startCooldown: vi.fn(), remainingTime: 0 }) }));
vi.mock('@/lib/content-safety/client', () => ({ getSensitiveWordRedirectTarget: async () => null }));
vi.mock('@/lib/app-router-adapter', () => ({ useAppRouterAdapter: () => ({ push: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@zumer/snapdom', () => ({ snapdom: vi.fn() }));
vi.mock('@/components/TachieGenerator', () => ({ default: () => null }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/shared/ThemeImage', () => ({ ThemeImage: () => null }));
vi.mock('@/components/shared/GeneratedByUserBadge', () => ({ GeneratedByUserBadge: () => null }));
vi.mock('@/components/shared/CreatorEntryLink', () => ({ CreatorEntryLink: () => null }));
vi.mock('@/components/encyclopedia/EncyclopediaLinks', () => ({ EncyclopediaLinks: () => null }));
vi.mock('@/components/AiProviderSelector', () => ({ default: () => null }));
vi.mock('@/components/ai/AiReasoningPanel', () => ({ default: () => null }));
vi.mock('@/components/SaveToCloudButton', () => ({ default: () => null }));
vi.mock('@/components/BattleDataModal', () => ({ default: () => null }));
vi.mock('@/components/card-forge/ImageCropEditor', () => ({ ImageCropEditor: () => null }));
vi.mock('@/components/shared/TokenIndicator', () => ({ TokenIndicator: () => null }));
vi.mock('@/components/game-card/GameCardFace', () => ({ GameCardFace: () => <div>Generated face</div>, DEFAULT_IMAGE_TRANSFORM: {} }));
vi.mock('@/lib/card-forge/content-safety', () => ({ applyShieldWordsToGameCardFaceData: (faceData: unknown) => ({ faceData }) }));
vi.mock('@/components/GeneralCharacterCard', () => ({ default: ({ general }: { general: { content: string } }) => <div>{general.content}</div> }));
vi.mock('@/components/GeneralScenarioCard', () => ({ default: () => null }));
vi.mock('@/components/MagicalGirlCard', () => ({ default: () => null }));
vi.mock('@/components/CanshouCard', () => ({ default: () => null }));
vi.mock('@/components/tavern/TavernCardPreview', () => ({ TavernCardPreview: () => null }));
vi.mock('@/lib/stream/read-safe-text-and-reasoning-stream', () => ({ readSafeTextAndReasoningStreamFromResponse: (...args: unknown[]) => api.stream(...args) }));
vi.mock('@/lib/tavern-card', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/tavern-card')>();
  const candidate = { keyword: 'chara', parsed: { name: 'Test', description: 'Description', personality: 'Kind', scenario: '', first_mes: '', mes_example: '' } };
  return { ...original, parseTavernCardFromPngFile: async () => ({ candidates: [candidate], selected: candidate, normalized: { name: 'Test', description: 'Description' }, meta: { extractedAt: 'now', warnings: [] } }) };
});

import { NamePage } from '@/components/creation/NamePage';
import { CardForgePage } from '@/components/card-forge/CardForgePage';
import { TavernImportPanel } from '@/components/tavern/TavernImportPanel';

let root: Root;
let host: HTMLDivElement;
let scroll: Mock<HTMLElement['scrollIntoView']>;
const nameResult = { flowerName: '花', flowerDescription: 'Description', appearance: { mainColor: 'Pink' }, spell: 'Spell' };
const faceResult = { faceData: { name: '花', rarity: 'common', cardType: 'character', element: 'light', stats: {}, effects: [] } };

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.motion = 'reduce';
  scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 2000 } as DOMRect);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(page: React.ReactNode) { await act(async () => root.render(page)); }
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
}
async function change(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  await act(async () => el.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => el.dispatchEvent(new Event('input', { bubbles: true })));
}
async function nameSetup() { await render(<NamePage />); await change(host.querySelector('#name')!, 'Test'); }
async function forgeSetup() { await render(<CardForgePage />); await change(host.querySelector('textarea')!, '{"name":"Test"}'); }
async function tavernSetup(ai = true) {
  await render(<TavernImportPanel />);
  const file = host.querySelector('#tavern-import-file')!;
  Object.defineProperty(file, 'files', { value: [new File(['png'], 'card.png', { type: 'image/png' })] });
  await act(async () => file.dispatchEvent(new Event('change', { bubbles: true })));
  if (ai) {
    await act(async () => (host.querySelectorAll<HTMLInputElement>('input[name="tavern-convert-mode"]')[1]).click());
  }
}

describe('real card generation pages use request-bound result navigation', () => {
  it('name scrolls once on a generated card and again on a new request', async () => {
    api.dispatch.mockImplementation(async () => Response.json(nameResult));
    await nameSetup(); expect(scroll).not.toHaveBeenCalled();
    await click('へんしん'); expect(scroll).toHaveBeenCalledTimes(1);
    await click('へんしん'); expect(scroll).toHaveBeenCalledTimes(2);
  });
  it('name respects disabled preference and failed requests', async () => {
    localStorage.setItem('mahoshojo.result-auto-scroll', 'off');
    api.dispatch.mockImplementation(async () => Response.json(nameResult));
    await nameSetup(); await click('へんしん'); expect(scroll).not.toHaveBeenCalled();
    localStorage.setItem('mahoshojo.result-auto-scroll', 'on');
    api.dispatch.mockRejectedValue(new Error('failed'));
    await click('へんしん'); expect(scroll).not.toHaveBeenCalled();
  });
  it('forge scrolls only when a face has arrived', async () => {
    let resolve!: (value: Response) => void;
    api.dispatch.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    await forgeSetup(); await click('生成卡牌卡面'); expect(scroll).not.toHaveBeenCalled();
    await act(async () => resolve(Response.json(faceResult)));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect((scroll.mock.instances[0] as HTMLElement).textContent).toContain('卡面预览');
  });
  it('forge ignores a response arriving after stop', async () => {
    let resolve!: (value: Response) => void;
    api.dispatch.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    await forgeSetup(); await click('生成卡牌卡面'); await click('停止');
    await act(async () => resolve(Response.json(faceResult)));
    expect(scroll).not.toHaveBeenCalled();
  });
  it('tavern local mapping and imports do not navigate', async () => {
    await tavernSetup(false); expect(scroll).not.toHaveBeenCalled();
    await click('生成角色卡'); expect(scroll).not.toHaveBeenCalled();
  });
  it('tavern AI result navigates once while cached reuse does not', async () => {
    await tavernSetup();
    vi.mocked(fetch).mockResolvedValue(Response.json({ name: 'Test', content: 'AI content' }));
    await click('生成角色卡'); expect(scroll).toHaveBeenCalledTimes(1);
    await click('生成角色卡'); expect(scroll).toHaveBeenCalledTimes(1);
  });
});


describe('tavern streaming navigation boundaries', () => {
  type StreamOptions = { onText: (text: string) => void; abortController: AbortController };
  async function startStream() {
    await tavernSetup();
    const streamButton = Array.from(host.querySelectorAll('button')).find((el) => el.textContent === '流式');
    expect(streamButton).toBeTruthy();
    await act(async () => streamButton!.click());
    vi.mocked(fetch).mockResolvedValue(new Response('stream', { headers: { 'Content-Type': 'text/event-stream' } }));
    await click('生成角色卡');
  }
  it('ignores blank placeholders and scrolls only on first body, not completion', async () => {
    let options!: StreamOptions;
    let finish!: (value: unknown) => void;
    api.stream.mockImplementation((_response, opts) => { options = opts; return new Promise((resolve) => { finish = resolve; }); });
    await startStream(); expect(scroll).not.toHaveBeenCalled();
    await act(async () => options.onText('   ')); expect(scroll).not.toHaveBeenCalled();
    await act(async () => options.onText('First body')); expect(scroll).toHaveBeenCalledTimes(1);
    await act(async () => options.onText('First body extended')); expect(scroll).toHaveBeenCalledTimes(1);
    await act(async () => finish({ text: 'First body extended' })); expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('does not navigate on an empty completed stream', async () => {
    api.stream.mockResolvedValue({ text: '' });
    await startStream(); expect(scroll).not.toHaveBeenCalled();
  });
  it('does not navigate for late body after stop', async () => {
    let options!: StreamOptions;
    let finish!: (value: unknown) => void;
    api.stream.mockImplementation((_response, opts) => { options = opts; return new Promise((resolve) => { finish = resolve; }); });
    await startStream(); await click('停止');
    expect(options.abortController.signal.aborted).toBe(true);
    await act(async () => { options.onText('Late body'); finish({ text: 'Late body', wasAborted: true }); });
    expect(scroll).not.toHaveBeenCalled();
  });
  it('does not navigate on a failed stream or its late callbacks', async () => {
    let options!: StreamOptions;
    api.stream.mockImplementation(async (_response, opts: StreamOptions) => { options = opts; throw new Error('stream failed'); });
    await startStream(); expect(scroll).not.toHaveBeenCalled();
    expect(host.textContent).toContain('stream failed');
    await act(async () => options.onText('Late body')); expect(scroll).not.toHaveBeenCalled();
  });
  it('respects disabled preference on streamed body', async () => {
    localStorage.setItem('mahoshojo.result-auto-scroll', 'off');
    api.stream.mockImplementation(async (_response, options: StreamOptions) => { options.onText('Body'); return { text: 'Body' }; });
    await startStream(); expect(scroll).not.toHaveBeenCalled();
  });
});
