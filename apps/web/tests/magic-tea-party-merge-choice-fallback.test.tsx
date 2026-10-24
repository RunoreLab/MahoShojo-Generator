// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { MagicTeaPartyMessage, MagicTeaPartySession } from '@/lib/magic-tea-party/types';
import { DEFAULT_MAGIC_TEA_PARTY_PREFERENCES } from '@/lib/magic-tea-party/preferences';
import { MagicTeaPartyPage } from '@/components/magic-tea-party/MagicTeaPartyPage';
const host = vi.hoisted(() => ({ sessions: vi.fn(), chat: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/lib/magic-tea-party/useMagicTeaPartySessions', () => ({ useMagicTeaPartySessions: host.sessions }));
vi.mock('@/lib/magic-tea-party/useMagicTeaPartyChat', () => ({ useMagicTeaPartyChat: host.chat }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ user: { id: 1 }, isAuthenticated: true, loading: false }) }));
vi.mock('@/lib/app-router-adapter', () => ({ useAppRouterAdapter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ authStorage: { getActivityHeaders: async () => ({}) } }));
vi.mock('@/lib/use-generation-api-intent-latch', () => ({ useGenerationApiIntentLatch: () => ({ tryAcquire: () => ({ dispatch: host.dispatch }) }) }));
vi.mock('@/components/magic-tea-party/SessionSidebar', () => ({ MagicTeaPartySessionSidebar: ({ onProviderConfigChange }: { onProviderConfigChange: (config: unknown) => void }) =>
  <button onClick={() => onProviderConfigChange({ providerId: 'openai', modelId: 'synthetic', apiKey: 'fixture' })}>配置合成连接</button> }));
vi.mock('@/components/magic-tea-party/SummaryPanel', () => ({ MagicTeaPartySummaryPanel: ({ onGenerateUpdates }: { onGenerateUpdates: () => void }) => <button onClick={onGenerateUpdates}>生成合成更新</button> }));
vi.mock('@/components/magic-tea-party/CardModals', () => ({ MagicTeaPartyCardModals: () => null }));
vi.mock('@/components/magic-tea-party/PresetCharacterPanel', () => ({ MagicTeaPartyPresetCharacterPanel: () => null }));
vi.mock('@/components/magic-tea-party/PresetScenarioPanel', () => ({ MagicTeaPartyPresetScenarioPanel: () => null }));
vi.mock('@/components/magic-tea-party/CharacterPanel', () => ({ MagicTeaPartyCharacterPanel: () => null }));
vi.mock('@/components/magic-tea-party/TachiePanel', () => ({ MagicTeaPartyTachiePanel: () => null }));
vi.mock('@/components/magic-tea-party/HistoryImageExportPanel', () => ({ MagicTeaPartyHistoryImageExportPanel: () => null }));

it.each([true, false])('the actual Web update request ignores superseded fallback choices (active alternative: %s)', async hasActive => {
  const originalScrollTo = HTMLElement.prototype.scrollTo; HTMLElement.prototype.scrollTo = vi.fn();
  const activeChoices = [{ id: 'active', text: '有效剧情行动' }];
  const session: MagicTeaPartySession = { id: 'tea', title: '合并后的原会话', roles: [], createdAt: 1, updatedAt: 1,
    settings: { providerId: 'openai', modelId: 'synthetic', writeCurrentState: true } };
  const messages: MagicTeaPartyMessage[] = [
    { id: 'anchor', sessionId: 'tea', role: 'user', content: '有效剧情', createdAt: 1 },
    ...(hasActive ? [{ id: 'active', sessionId: 'tea', role: 'assistant' as const, content: '有效行动', createdAt: 2, choices: activeChoices }] : []),
    { id: 'old', sessionId: 'tea', role: 'assistant', content: '旧剧情', createdAt: 3, choices: [{ id: 'old', text: '不应重新使用的行动' }], meta: { superseded: true } },
  ];
  const noop = () => {};
  host.sessions.mockReturnValue({ sessions: [session], activeSessionId: session.id, activeSession: session, messages, preferences: DEFAULT_MAGIC_TEA_PARTY_PREFERENCES,
    setActiveSessionId: noop, setMessages: noop, applyPreferencePatch: noop, persistSession: async () => {}, createSession: async () => {},
    selectedRoleCardIds: [], selectedScenarioCardIds: [], playerOptions: [], updateSessionTitle: noop, lockSessionTitle: noop, updatePlayerRole: noop });
  host.chat.mockReturnValue({ isGenerating: false, isSummarizing: false, summaryError: null, stopGenerating: noop, cancelSummary: noop, getMessageCharLimit: () => 8000 });
  host.dispatch.mockReset(); host.dispatch.mockResolvedValue(new Response(JSON.stringify({ drafts: [] })));
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const click = async (label: string) => act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === label)!.click());
  try {
    await act(async () => root.render(<MagicTeaPartyPage />));
    await click('配置合成连接'); await click('生成合成更新');
    expect(host.dispatch).toHaveBeenCalledOnce();
    const body = JSON.parse(host.dispatch.mock.calls[0][1].body);
    expect(body.lastChoices).toEqual(hasActive ? activeChoices : undefined);
    expect(JSON.stringify(body.messages)).not.toContain('旧剧情');
  } finally { await act(async () => root.unmount()); container.remove(); HTMLElement.prototype.scrollTo = originalScrollTo; }
});
