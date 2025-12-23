'use client';

import { ReactNode } from 'react';

import AiProviderSelector from '@/components/AiProviderSelector';
import { config as appConfig } from '@/lib/config';
import { StoryOptionsPanel } from '@/components/shared/StoryOptionsPanel';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, LanguageOption } from '../types';

interface StoryOptionsProps {
  languages: LanguageOption[] | undefined;
  afterUserGuidance?: ReactNode;
}

export function StoryOptions({ languages, afterUserGuidance }: StoryOptionsProps) {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const storyLength = useBattleSelector((state) => state.storyLength);
  const setStoryLength = useBattleSelector((state) => state.setStoryLength);
  const selectedLevel = useBattleSelector((state) => state.selectedLevel);
  const setSelectedLevel = useBattleSelector((state) => state.setSelectedLevel);
  const selectedLanguage = useBattleSelector((state) => state.selectedLanguage);
  const setSelectedLanguage = useBattleSelector((state) => state.setSelectedLanguage);
  const settings = useBattleSelector((state) => state.settings);
  const updateSettings = useBattleSelector((state) => state.updateSettings);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setUserProviderConfig = useBattleSelector((state) => state.setUserProviderConfig);

  return (
    <>
      <StoryOptionsPanel
        battleMode={battleMode}
        isGenerating={isGenerating}
        enableUserGuidance={appConfig.ENABLE_ARENA_USER_GUIDANCE}
        languages={languages}
        selectedLevel={selectedLevel}
        onSelectedLevelChange={(value) => setSelectedLevel(value)}
        userGuidance={settings.userGuidance}
        onUserGuidanceChange={(value) => updateSettings({ userGuidance: value })}
        afterUserGuidance={afterUserGuidance}
        storyLength={storyLength}
        onStoryLengthChange={setStoryLength}
        selectedLanguage={selectedLanguage}
        onSelectedLanguageChange={setSelectedLanguage}
      />

      <AiProviderSelector onConfigChange={setUserProviderConfig} />
    </>
  );
}
