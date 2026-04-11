'use client';

import AiProviderSelector from '@/components/AiProviderSelector';
import { StoryOptionsPanel } from '@/components/shared/StoryOptionsPanel';
import { config as appConfig } from '@/lib/config';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import type { BattleStoreState } from '@/components/arena/types';

export function BattleLiteStoryOptions() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const settings = useBattleSelector((state) => state.settings);
  const updateSettings = useBattleSelector((state) => state.updateSettings);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setUserProviderConfig = useBattleSelector((state) => state.setUserProviderConfig);

  return (
    <>
      <StoryOptionsPanel
        isGenerating={isGenerating}
        enableUserGuidance={appConfig.ENABLE_ARENA_USER_GUIDANCE}
        userGuidance={settings.userGuidance}
        onUserGuidanceChange={(value) => updateSettings({ userGuidance: value })}
        storyLength="default"
        onStoryLengthChange={() => {}}
        selectedLanguage="zh-CN"
        onSelectedLanguageChange={() => {}}
        showStoryLength={false}
        showLanguage={false}
      />
      <AiProviderSelector onConfigChange={setUserProviderConfig} />
    </>
  );
}
