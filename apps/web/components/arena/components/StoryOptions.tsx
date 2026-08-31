'use client';

import { ReactNode } from 'react';

import AiProviderSelector from '@/components/AiProviderSelector';
import { config as appConfig } from '@/lib/config';
import { StoryOptionsControl } from '../editor/presentation/StoryOptionsControl';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, LanguageOption } from '../types';

interface StoryOptionsProps {
  languages: LanguageOption[] | undefined;
  afterUserGuidance?: ReactNode;
}

export function StoryOptions({ languages, afterUserGuidance }: StoryOptionsProps) {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const storyLength = useBattleSelector((state) => state.storyLength);
  const setStoryLength = useBattleSelector((state) => state.setStoryLength);
  const customStoryLength = useBattleSelector((state) => state.customStoryLength);
  const setCustomStoryLength = useBattleSelector((state) => state.setCustomStoryLength);
  const selectedLanguage = useBattleSelector((state) => state.selectedLanguage);
  const setSelectedLanguage = useBattleSelector((state) => state.setSelectedLanguage);
  const settings = useBattleSelector((state) => state.settings);
  const updateSettings = useBattleSelector((state) => state.updateSettings);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setUserProviderConfig = useBattleSelector((state) => state.setUserProviderConfig);

  return (
    <>
      <StoryOptionsControl
        disabled={isGenerating}
        enableUserGuidance={appConfig.ENABLE_ARENA_USER_GUIDANCE}
        languages={languages}
        userGuidance={settings.userGuidance}
        onUserGuidanceChange={(value) => updateSettings({ userGuidance: value })}
        afterUserGuidance={afterUserGuidance}
        storyLength={storyLength}
        onStoryLengthChange={setStoryLength}
        customStoryLength={customStoryLength}
        onCustomStoryLengthChange={setCustomStoryLength}
        selectedLanguage={selectedLanguage}
        onSelectedLanguageChange={setSelectedLanguage}
      />

      <AiProviderSelector onConfigChange={setUserProviderConfig} />
    </>
  );
}
