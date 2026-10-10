// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { QuestionnaireEditorPage } from '@/components/creation/QuestionnaireEditorPage';
import { CardForgePage } from '@/components/card-forge/CardForgePage';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => null }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false, user: null }) }));
vi.mock('@/components/Footer', () => ({ default: () => <footer>页脚</footer> }));
vi.mock('@/components/CharManager/DataCardsModal', () => ({ default: () => null }));
vi.mock('@/components/CharManager/RecycleBinModal', () => ({ default: () => null }));
vi.mock('@/components/SaveToCloudButton', () => ({ default: () => <button>保存为云端问卷</button> }));
vi.mock('@/components/BattleDataModal', () => ({ default: () => null }));
vi.mock('@/components/shared/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }));
vi.mock('@/components/AiProviderSelector', () => ({ default: () => null }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('keeps the actual Web editor brand, related navigation and cloud save inside the shared page frame', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); const root = createRoot(container);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  try {
    await act(async () => root.render(<QuestionnaireEditorPage />));
    expect(container.querySelector('h1')?.className).toBe('sr-only');
    expect(container.querySelectorAll('.card > .text-center img[src="/questionnaire-title.svg"]')).toHaveLength(1);
    expect(container.querySelector('a[href="/details"]')?.textContent).toBe('前往魔法少女问卷');
    expect(container.querySelector('a[href="/canshou"]')?.textContent).toBe('前往残兽问卷');
    expect(container.querySelector('a[href="/"]')?.textContent).toBe('返回首页');
    expect(container.textContent).toContain('云端问卷库');
    expect(container.textContent).toContain('保存为云端问卷');
    expect(container.querySelector('.container > footer')?.textContent).toBe('页脚');
    expect(fetch).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); }
});

it('keeps the actual Web forge heading, two-column workspace and home link without a second container', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<CardForgePage />));
    expect(container.querySelector('.card-forge-shell')?.className).toBe('card-forge-shell magic-background-white min-h-[100dvh] pb-12');
    expect(container.querySelector('.max-w-7xl > .pt-8 > h1')?.textContent).toBe('卡牌工坊');
    expect(container.querySelector('[class*="lg:grid-cols-[1fr_minmax(380px,420px)]"]')?.children).toHaveLength(2);
    expect(container.textContent).toContain('将角色卡 / 情景卡数据转化为卡牌游戏风格的精美卡面');
    expect(container.querySelector('a[href="/"]')?.textContent).toBe('返回首页');
    expect(container.querySelector('.card-forge-shell .container')).toBeNull();
  } finally { act(() => root.unmount()); }
});
