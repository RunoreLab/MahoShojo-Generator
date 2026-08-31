// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BattleModeControl } from '@/components/arena/editor/presentation/BattleModeControl';
import { SharedBattleSettingsControl } from '@/components/arena/editor/presentation/SharedBattleSettingsControl';
import { StoryOptionsControl } from '@/components/arena/editor/presentation/StoryOptionsControl';
import {
  ArenaEditorSessionProvider,
  createRoomProposalArenaEditorSession,
} from '@/components/arena/editor';
import { BattleModeSwitcher } from '@/components/arena/components/BattleModeSwitcher';
import { StoryOptions } from '@/components/arena/components/StoryOptions';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const historySettings = {
  readArenaHistory: true,
  readArenaHistoryLimit: 3,
  isArenaHistoryUnlimited: false,
  writeArenaHistory: true,
  readCurrentState: true,
  writeCurrentState: true,
  readNarrativeHistory: false,
  readNarrativeHistoryLimit: 10,
  isNarrativeHistoryUnlimited: false,
  writeNarrativeHistory: false,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Arena editor shared controlled presentations', () => {
  it.each(['single', 'proposal'] as const)('%s adapter 可复用同一个 BattleMode/StoryOptions/history 控件', async (adapter) => {
    const onBattleModeChange = vi.fn();
    const onStoryLengthChange = vi.fn();
    const onSettingsChange = vi.fn();

    await act(async () => root.render(
      <div data-adapter={adapter}>
        <BattleModeControl value="classic" onChange={onBattleModeChange} />
        <StoryOptionsControl
          disabled={false}
          enableUserGuidance
          languages={[{ code: 'zh-CN', name: '简体中文' }]}
          userGuidance=""
          onUserGuidanceChange={() => {}}
          storyLength="default"
          onStoryLengthChange={onStoryLengthChange}
          customStoryLength=""
          onCustomStoryLengthChange={() => {}}
          selectedLanguage="zh-CN"
          onSelectedLanguageChange={() => {}}
        />
        <SharedBattleSettingsControl
          value={historySettings}
          onChange={onSettingsChange}
          disabled={false}
        />
      </div>,
    ));

    const dailyButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('日常模式'));
    expect(dailyButton).toBeInstanceOf(HTMLButtonElement);
    await act(async () => dailyButton?.click());
    expect(onBattleModeChange).toHaveBeenCalledWith('daily');

    const standardButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('标准(600+)'));
    await act(async () => standardButton?.click());
    expect(onStoryLengthChange).toHaveBeenCalledWith('standard');

    const narrativeRead = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.parentElement?.textContent?.includes('用于延续剧情'));
    expect(narrativeRead).toBeInstanceOf(HTMLInputElement);
    await act(async () => narrativeRead?.click());
    expect(onSettingsChange).toHaveBeenCalledWith({ readNarrativeHistory: true });

    expect(container.textContent).toContain('资料读写策略');
    expect(container.textContent).toContain('叙事历史（战报正文）');
    expect(container.textContent).not.toContain('AI 提供商');
    expect(container.textContent).not.toContain('战报卡片宽度');
  });

  it('真实 wrapper 通过 Context 修改 detached proposal 而不污染 single store', async () => {
    useBattleStore.setState({ battleMode: 'classic' });
    const session = createRoomProposalArenaEditorSession({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      revision: 1,
      sharedConfig: {
        battleMode: 'daily',
        combatants: [{
          key: 'data-card:c1',
          ref: { id: 'c1', kind: 'character', versionToken: 'v1' },
        }],
        teams: [],
        scenario: null,
        auxScenarios: [],
        materials: [],
        userGuidance: '',
        storyLength: 'default',
        customStoryLength: null,
        selectedLanguage: 'zh-CN',
        historySettings,
      },
    });
    await act(async () => root.render(
      <ArenaEditorSessionProvider session={session}>
        <BattleModeSwitcher />
        <StoryOptions languages={[{ code: 'zh-CN', name: '简体中文' }]} />
      </ArenaEditorSessionProvider>,
    ));

    const scenarioButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('情景模式'));
    await act(async () => scenarioButton?.click());
    expect(session.exportSharedConfig().battleMode).toBe('scenario');
    expect(useBattleStore.getState().battleMode).toBe('classic');
    expect(container.textContent).not.toContain('AI 提供商');
  });
});
