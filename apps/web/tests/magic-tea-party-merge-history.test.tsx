// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMagicTeaPartySessions, type UseMagicTeaPartySessionsResult } from '@/lib/magic-tea-party/useMagicTeaPartySessions';
import type { MagicTeaPartyMessage, MagicTeaPartySession } from '@/lib/magic-tea-party/types';

const host = vi.hoisted(() => ({ preserve: vi.fn(), read: vi.fn(), list: vi.fn(), messages: vi.fn(), put: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/app-router-adapter', () => ({ useAppRouterAdapter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/magic-tea-party/migration', () => ({ migrateMagicTeaPartyLocalStorage: vi.fn() }));
vi.mock('@/lib/magic-tea-party/storage', async () => ({ ...(await vi.importActual('@/lib/magic-tea-party/storage')),
  putMagicTeaPartySessionPreservingRoles: host.preserve, getMagicTeaPartySession: host.read,
  listMagicTeaPartySessions: host.list, listMagicTeaPartyMessages: host.messages, putMagicTeaPartyMessage: host.put,
}));
let root: Root; let container: HTMLDivElement; let state: UseMagicTeaPartySessionsResult;
const parent: MagicTeaPartySession = { id: 'parent', title: '原会话', createdAt: 1, updatedAt: 2, roles: [],
  settings: { providerId: 'openai', modelId: 'test', autoSummaryEnabled: true },
  draft: '父草稿', summary: '已过期摘要', summaryMeta: { updatedAt: 1, toMessageId: 'old-choice' },
  lastChoices: [{ id: 'old', text: '旧行动' }], autoSummaryState: { lastAttemptedThroughMessageId: 'old-choice' },
};
const source: MagicTeaPartySession = { ...parent, id: 'source', title: '分支', updatedAt: 3,
  forkedFrom: { sessionId: 'parent', messageId: 'anchor', createdAt: 2 } };
const message = (id: string, sessionId: string, role: MagicTeaPartyMessage['role'] = 'assistant'): MagicTeaPartyMessage =>
  ({ id, sessionId, role, content: id, createdAt: 1, status: 'done' });
const previous = { ...message('previous-old', 'parent'), meta: { superseded: true, supersededAt: 1, supersededBy: 'edit', supersededBySessionId: 'earlier-source', extension: 'keep' } };
const parentMessages = [message('prefix', 'parent'), message('anchor', 'parent', 'user'), previous, message('old-choice', 'parent')];
const sourceMessages = [{ ...message('edited', 'source', 'user'), revisionOf: 'anchor' }, { ...message('new-tail', 'source'), sourceMessageId: 'edited' }];
function Harness() {
  const current = useMagicTeaPartySessions({ userProviderConfig: null, onGlobalError: host.error });
  useEffect(() => { state = current; }); return null;
}
beforeEach(async () => {
  for (const mock of Object.values(host)) mock.mockReset(); window.localStorage.clear();
  host.list.mockResolvedValue([source, parent]);
  host.read.mockImplementation(async (id: string) => id === parent.id ? parent : id === source.id ? source : null);
  host.messages.mockImplementation(async (id: string) => id === parent.id ? parentMessages : sourceMessages);
  host.put.mockResolvedValue(undefined); host.preserve.mockImplementation(async (session: MagicTeaPartySession) => session);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Harness />));
  await act(async () => state.setActiveSessionId(source.id));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('preserves earlier superseded attribution and source records while invalidating parent derived state', async () => {
  const before = JSON.stringify({ parent, source, parentMessages, sourceMessages });
  await act(async () => { expect(await state.mergeSessionToParent(source.id)).toBe(parent.id); });
  const writes = host.put.mock.calls.map(([value]) => value as MagicTeaPartyMessage);
  expect(writes.some(value => value.id === previous.id)).toBe(false);
  expect(writes.find(value => value.id === 'anchor')?.meta).toMatchObject({ superseded: true, supersededBy: 'merge', supersededBySessionId: source.id });
  expect(writes.find(value => value.id === 'old-choice')?.meta).toMatchObject({ superseded: true });
  const edited = writes.find(value => value.content === 'edited')!;
  const tail = writes.find(value => value.content === 'new-tail')!;
  expect(edited.id).not.toBe('edited'); expect(edited).toMatchObject({ sessionId: 'parent', revisionOf: 'anchor' });
  expect(tail.sourceMessageId).toBe(edited.id);
  expect(host.preserve).toHaveBeenCalledOnce();
  expect(host.preserve.mock.calls[0][0]).toMatchObject({ id: parent.id, draft: parent.draft, settings: parent.settings,
    lastChoices: undefined, autoSummaryState: undefined, summary: undefined, summaryMeta: undefined });
  expect(JSON.stringify({ parent, source, parentMessages, sourceMessages })).toBe(before);
});
