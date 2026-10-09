// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopSublimationLoreSelector } from '../src/features/sublimation/lore-selector';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
const mocks = vi.hoisted(() => ({ host: { auth: { status: 'authenticated', userId: 'a' } }, picker: null as null | { onSelectCard: (payload: unknown, context: unknown) => void } }));
vi.mock('../src/platform/card-library-host', () => ({ useDesktopCardLibraryHost: () => mocks.host }));
vi.mock('@mahoshojo/ui-web/card-library', () => ({ CardLibraryModal: (props: typeof mocks.picker) => { mocks.picker = props; return null; } }));
let root: Root; let container: HTMLDivElement;
const change = vi.fn(); const loading = vi.fn();
const render = (selections: QuestionnaireSelection[] = []) => act(() => root.render(<DesktopSublimationLoreSelector selections={selections} onChange={change} disabled={false} onLoadingChange={loading} />));
const click = async (text: string) => { const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text)); if (!button) throw new Error(text); await act(async () => button.click()); };
beforeEach(() => { vi.clearAllMocks(); mocks.host.auth.userId = 'a'; container = document.createElement('div'); document.body.append(container); root = createRoot(container); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const q = { id: 'lore', kind: 'magical-girl', title: '设定', loreMarkdown: '原文', questions: [], nativeAllowed: true };
it('uses existing library source mapping, keeping cloud identity and demoting cached copy', async () => {
  await render(); await click('设定（Lore）');
  await act(() => mocks.picker!.onSelectCard({ ...q, _cardType: 'questionnaire', _cardId: 'public-1', _storageLocation: 'cloud' }, { selectionId: 'cloud:public-1' }));
  expect(change.mock.calls[0][0][0]).toMatchObject({ source: 'database', dataCardId: 'public-1' });
  await act(() => mocks.picker!.onSelectCard({ ...q, _cardType: 'questionnaire', _cardId: 'public-1', _storageLocation: 'local' }, { selectionId: 'cache:public-1' }));
  expect(change.mock.calls[1][0][0]).toMatchObject({ source: 'upload', questionnaire: { nativeAllowed: false } });
  expect(change.mock.calls[1][0][0]).not.toHaveProperty('dataCardId');
});
it('drops a late picker result after account switch, while anonymous local selection still works', async () => {
  await render(); const old = mocks.picker!;
  mocks.host.auth.userId = 'b'; await render();
  await act(() => old.onSelectCard({ ...q, _cardType: 'questionnaire', _cardId: 'public-1' }, { selectionId: 'cloud:public-1' }));
  expect(change).not.toHaveBeenCalled();
  mocks.host.auth = { status: 'unauthenticated', userId: '' }; await render();
  await act(() => mocks.picker!.onSelectCard({ ...q, _cardType: 'questionnaire', _storageLocation: 'local' }, { selectionId: 'local:1' }));
  expect(change.mock.calls[0][0][0].source).toBe('upload');
});
it('failed preset load preserves selected sources and releases loading; unmount discards late response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await render(); await click('设定（Lore）');
  const select = container.querySelector('select')!;
  await act(async () => { select.value = select.options[1].value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(change).not.toHaveBeenCalled(); expect(container.textContent).toContain('offline'); expect(loading).toHaveBeenLastCalledWith(false);
  let resolve!: (value: unknown) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { resolve = r; })));
  await act(() => { select.value = select.options[1].value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(() => root.unmount()); root = createRoot(container);
  await act(async () => resolve({ ok: true, json: async () => ({ ...q, id: 'magical-girl-default' }) }));
  expect(change).not.toHaveBeenCalled();
});

it('keeps distinct local copies of one canonical questionnaire, deduplicating only the same record', async () => {
  await render();
  await act(() => mocks.picker!.onSelectCard({ ...q, _cardType: 'questionnaire', _storageLocation: 'local' }, { selectionId: 'local:A' }));
  const first = change.mock.calls[0][0]; await render(first);
  await act(() => mocks.picker!.onSelectCard({ ...q, loreMarkdown: '第二份正文', _cardType: 'questionnaire', _storageLocation: 'local' }, { selectionId: 'local:B' }));
  expect(change.mock.calls[1][0]).toHaveLength(2);
  expect(change.mock.calls[1][0][1].questionnaire.loreMarkdown).toBe('第二份正文');
  await render(change.mock.calls[1][0]);
  await act(() => mocks.picker!.onSelectCard({ ...q, _cardType: 'questionnaire', _storageLocation: 'local' }, { selectionId: 'local:A' }));
  expect(change).toHaveBeenCalledTimes(2);
});

it('rejects unsafe retained extensions before changing the existing draft', async () => {
  await render(); await click('设定（Lore）');
  await act(() => mocks.picker!.onSelectCard({ ...q, constructor: 'foreign-extension', _cardType: 'questionnaire', _storageLocation: 'local' }, { selectionId: 'local:bad' }));
  expect(change).not.toHaveBeenCalled();
  expect(container.textContent).toContain('设定来源草稿损坏');
});
