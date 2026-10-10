// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { expect, vi, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';

vi.mock('next/head', () => ({
  default(props: { children?: React.ReactNode }) {
    return <>{props.children}</>;
  },
}));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));

vi.mock('@/components/BattleDataModal', () => ({
  default() {
    return null;
  },
}));

vi.mock('@/components/DataCardDetailsModal', () => ({
  default() {
    return null;
  },
}));

vi.mock('@/components/Footer', () => ({
  default() {
    return <div>footer</div>;
  },
}));

vi.mock('@/components/ErrorMessage', () => ({
  ErrorMessage({ message }: { message: string }) {
    return <div>{message}</div>;
  },
}));

vi.mock('@/components/shared/CollapsibleSection', () => ({
  CollapsibleSection(props: { title?: string; children?: React.ReactNode }) {
    return (
      <section>
        {props.title ? <h2>{props.title}</h2> : null}
        {props.children}
      </section>
    );
  },
  DisclosureButton(props: {
    children?: React.ReactNode;
    disabled?: boolean;
    onToggle?: () => void;
    open?: boolean;
  }) {
    return (
      <button type="button" disabled={props.disabled} aria-expanded={props.open} onClick={props.onToggle}>
        {props.children}
      </button>
    );
  },
}));

vi.mock('@/components/arena/components/BattleActions', () => ({
  BattleActions() {
    return <div>battle-actions</div>;
  },
}));

vi.mock('@/components/arena/components/BattleResult', () => ({
  BattleResult() {
    return null;
  },
}));

vi.mock('@/components/arena/components/BattleStorySessionPanel', () => ({
  BattleStorySessionPanel() {
    return null;
  },
}));

vi.mock('@/components/arena/components/CombatantList', () => ({
  CombatantList() {
    return <div>combatant-list</div>;
  },
}));

vi.mock('@/components/arena/components/DatabaseSelector', () => ({
  DatabaseSelector() {
    return <div>database-selector</div>;
  },
}));

vi.mock('@/components/arena/components/GenerationModeSwitcher', () => ({
  GenerationModeSwitcher() {
    return <div>generation-mode-switcher</div>;
  },
}));

vi.mock('@/components/arena/components/PresetSelector', () => ({
  PresetSelector() {
    return <div>preset-selector</div>;
  },
}));

vi.mock('@/components/arena/components/RosterUploader', () => ({
  RosterUploader() {
    return <div>roster-uploader</div>;
  },
}));

vi.mock('@/components/arena/components/ArenaRankingModal', () => ({
  ArenaRankingModal() {
    return null;
  },
}));

vi.mock('@/components/arena/hooks/useBattleActions', () => ({
  useBattleActions: () => ({
    materials: [],
    handleSelectDataCard: async () => {},
    handleRandomMatch: async () => {},
    handleToggleCombatantDataCard: async () => {},
    handleMaterialUpload: async () => {},
    handleMaterialPaste: async () => {},
    removeMaterial: () => {},
    moveMaterial: () => {},
    clearMaterials: () => {},
  }),
}));

vi.mock('@/components/arena/utils/characterValidator', () => ({
  getCombatantDisplayName: () => '角色',
}));

vi.mock('@/components/arena/shared/ArenaCommunitySection', () => ({
  ArenaCommunitySection() {
    return <div>community</div>;
  },
}));

vi.mock('@/components/arena/shared/ArenaPageLinks', () => ({
  ArenaPageLinks({ variant }: { variant: 'lite' | 'full' }) {
    if (variant === 'lite') {
      return (
        <div>
          <a href="/arena">进入完整版竞技场</a>
        </div>
      );
    }

    return (
      <div>
        <a href="/battle">切换到简洁版</a>
        <a href="https://wantu-waystation.pages.dev/arena" target="_blank" rel="noopener noreferrer">
          前往万途竞技场
        </a>
      </div>
    );
  },
}));

vi.mock('@/components/arena/shared/ArenaRankingLinks', () => ({
  ArenaRankingLinks() {
    return <div>ranking-links</div>;
  },
}));

vi.mock('@/components/arena-lite/BattleLiteHeader', () => ({
  BattleLiteHeader() {
    return <div>battle-lite-header</div>;
  },
}));

vi.mock('@/components/arena-lite/BattleLiteScenarioSection', () => ({
  BattleLiteScenarioSection() {
    return <div>battle-lite-scenario</div>;
  },
}));

vi.mock('@/components/AiProviderSelector', () => ({ default: () => <div>host-provider</div> }));

const { BattleLitePage } = await import('@/components/arena-lite/BattleLitePage');
vi.restoreAllMocks();

test('BattleLitePage 不再引用 applyBattleLiteDefaults，并保留共享设置', () => {
  const source = readFileSync(join(process.cwd(), 'components/arena-lite/BattleLitePage.tsx'), 'utf8');
  expect(source).not.toContain('applyBattleLiteDefaults');

  const before = useBattleStore.getState();

  try {
    useBattleStore.setState((state) => ({
      ...state,
      battleMode: 'classic',
      scenario: { content: null, fileName: null, isNative: false },
      auxScenarios: [
        {
          id: 'aux-1',
          content: { title: '不会生效的辅助情景' },
          fileName: 'aux.json',
          isNative: false,
        },
      ],
      selectedQuestionnaires: [],
      adjudicationEvents: [{ id: 'evt-1', label: '判定事件' } as any],
      storyLength: 'long',
      selectedLanguage: 'en-US',
      settings: {
        ...state.settings,
        readArenaHistory: true,
        readArenaHistoryLimit: 5,
        isArenaHistoryUnlimited: false,
        readCurrentState: false,
        writeCurrentState: true,
        readNarrativeHistory: false,
        writeNarrativeHistory: false,
      },
    }));

    const html = renderToStaticMarkup(<BattleLitePage />);
    const after = useBattleStore.getState();

    expect(html).toContain('当前沿用完整版设置');
    expect(after.storyLength).toBe('long');
    expect(after.selectedLanguage).toBe('en-US');
    expect(after.settings.readCurrentState).toBe(false);
  } finally {
    useBattleStore.setState((state) => ({
      ...state,
      battleMode: before.battleMode,
      scenario: before.scenario,
      auxScenarios: before.auxScenarios,
      selectedQuestionnaires: before.selectedQuestionnaires,
      adjudicationEvents: before.adjudicationEvents,
      storyLength: before.storyLength,
      selectedLanguage: before.selectedLanguage,
      settings: before.settings,
    }));
  }
});


test('真实 Lite 页面通过共源页框保留四模式、故事输入清除、宿主区块和继承高级设置', async () => {
  localStorage.clear();
  useBattleStore.setState(useBattleStore.getInitialState(), true);
  useBattleStore.setState({ storyLength: 'long', selectedLanguage: 'en-US' });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label))!;
  try {
    await act(async () => root.render(<BattleLitePage />));
    expect(container.querySelector('.magic-background-white.battle-lite-shell .battle-lite-panel')).not.toBeNull();
    expect(container.textContent).toContain('host-provider');
    for (const [label, value] of [['日常模式', 'daily'], ['羁绊模式', 'kizuna'], ['经典模式', 'classic'], ['情景模式', 'scenario']]) {
      await act(async () => button(label).click()); expect(useBattleStore.getState().battleMode).toBe(value);
    }
    expect(container.textContent).toContain('battle-lite-scenario');
    const guidance = container.querySelector<HTMLInputElement>('#arena-story-guidance')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(guidance, '雨夜相遇');
      guidance.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(useBattleStore.getState().settings.userGuidance).toBe('雨夜相遇');
    await act(async () => guidance.parentElement!.querySelector<HTMLButtonElement>('button')!.click()); expect(guidance.value).toBe('');
    expect(useBattleStore.getState().storyLength).toBe('long'); expect(useBattleStore.getState().selectedLanguage).toBe('en-US');
    expect(container.querySelector('#custom-story-length')).toBeNull();
    expect(container.querySelector('#language-select')).toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); localStorage.clear(); }
});
