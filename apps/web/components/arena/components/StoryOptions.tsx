'use client';

import { ReactNode } from 'react';

import AiProviderSelector from '@/components/AiProviderSelector';
import { config as appConfig } from '@/lib/config';
import { StoryOptionsControl } from '../editor/presentation/StoryOptionsControl';
import {
  useArenaEditorActions,
  useArenaEditorSelector,
  useArenaEditorSession,
} from '../editor';

import { useBattleStore } from '../stores/useBattleStore';
import { LanguageOption } from '../types';

interface StoryOptionsProps {
  languages: LanguageOption[] | undefined;
  afterUserGuidance?: ReactNode;
}

function HostOnlyAiProviderSelector() {
  const setUserProviderConfig = useBattleStore((state) => state.setUserProviderConfig);
  return <AiProviderSelector onConfigChange={setUserProviderConfig} />;
}

export function StoryOptions({ languages, afterUserGuidance }: StoryOptionsProps) {
  const session = useArenaEditorSession();
  const storyLength = useArenaEditorSelector((state) => state.storyLength);
  const customStoryLength = useArenaEditorSelector((state) => state.customStoryLength);
  const selectedLanguage = useArenaEditorSelector((state) => state.selectedLanguage);
  const userGuidance = useArenaEditorSelector((state) => state.userGuidance);
  const isGenerating = useArenaEditorSelector((state) => state.busy);
  const actions = useArenaEditorActions();

  return (
    <>
      <StoryOptionsControl
        disabled={isGenerating}
        enableUserGuidance={appConfig.ENABLE_ARENA_USER_GUIDANCE}
        languages={languages}
        userGuidance={userGuidance}
        onUserGuidanceChange={actions.setUserGuidance}
        afterUserGuidance={afterUserGuidance}
        storyLength={storyLength}
        onStoryLengthChange={actions.setStoryLength}
        customStoryLength={customStoryLength}
        onCustomStoryLengthChange={actions.setCustomStoryLength}
        selectedLanguage={selectedLanguage}
        onSelectedLanguageChange={actions.setSelectedLanguage}
      />

      {session.capabilities.canUseHostOnlyGenerationOptions ? (
        <HostOnlyAiProviderSelector />
      ) : null}
    </>
  );
}
