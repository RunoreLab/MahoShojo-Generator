import React from 'react';
import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';

mock.module('next/head', () => ({
  default(props: { children?: React.ReactNode }) {
    return <>{props.children}</>;
  },
}));

mock.module('@/lib/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));

mock.module('@/components/BattleDataModal', () => ({
  default() {
    return null;
  },
}));

mock.module('@/components/DataCardDetailsModal', () => ({
  default() {
    return null;
  },
}));

mock.module('@/components/Footer', () => ({
  default() {
    return <div>footer</div>;
  },
}));

mock.module('@/components/ErrorMessage', () => ({
  ErrorMessage({ message }: { message: string }) {
    return <div>{message}</div>;
  },
}));

mock.module('@/components/shared/CollapsibleSection', () => ({
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

mock.module('@/components/arena/components/BattleActions', () => ({
  BattleActions() {
    return <div>battle-actions</div>;
  },
}));

mock.module('@/components/arena/components/BattleModeSwitcher', () => ({
  BattleModeSwitcher() {
    return <div>battle-mode-switcher</div>;
  },
}));

mock.module('@/components/arena/components/BattleResult', () => ({
  BattleResult() {
    return null;
  },
}));

mock.module('@/components/arena/components/BattleStorySessionPanel', () => ({
  BattleStorySessionPanel() {
    return null;
  },
}));

mock.module('@/components/arena/components/CombatantList', () => ({
  CombatantList() {
    return <div>combatant-list</div>;
  },
}));

mock.module('@/components/arena/components/DatabaseSelector', () => ({
  DatabaseSelector() {
    return <div>database-selector</div>;
  },
}));

mock.module('@/components/arena/components/GenerationModeSwitcher', () => ({
  GenerationModeSwitcher() {
    return <div>generation-mode-switcher</div>;
  },
}));

mock.module('@/components/arena/components/PresetSelector', () => ({
  PresetSelector() {
    return <div>preset-selector</div>;
  },
}));

mock.module('@/components/arena/components/RosterUploader', () => ({
  RosterUploader() {
    return <div>roster-uploader</div>;
  },
}));

mock.module('@/components/arena/components/ArenaRankingModal', () => ({
  ArenaRankingModal() {
    return null;
  },
}));

mock.module('@/components/arena/hooks/useBattleActions', () => ({
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

mock.module('@/components/arena/utils/characterValidator', () => ({
  getCombatantDisplayName: () => '角色',
}));

mock.module('@/components/arena/shared/ArenaCommunitySection', () => ({
  ArenaCommunitySection() {
    return <div>community</div>;
  },
}));

mock.module('@/components/arena/shared/ArenaPageLinks', () => ({
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

mock.module('@/components/arena/shared/ArenaRankingLinks', () => ({
  ArenaRankingLinks() {
    return <div>ranking-links</div>;
  },
}));

mock.module('@/components/arena-lite/BattleLiteHeader', () => ({
  BattleLiteHeader() {
    return <div>battle-lite-header</div>;
  },
}));

mock.module('@/components/arena-lite/BattleLiteScenarioSection', () => ({
  BattleLiteScenarioSection() {
    return <div>battle-lite-scenario</div>;
  },
}));

mock.module('@/components/arena-lite/BattleLiteStoryOptions', () => ({
  BattleLiteStoryOptions() {
    return <div>battle-lite-story-options</div>;
  },
}));

const { BattleLitePage } = await import('@/components/arena-lite/BattleLitePage');
mock.restore();

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
