import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { StoryOptionsPanel } from '@/components/shared/StoryOptionsPanel';

test('StoryOptionsPanel 可以按需隐藏字数和语言选择', () => {
  const html = renderToStaticMarkup(
    <StoryOptionsPanel
      isGenerating={false}
      enableUserGuidance
      userGuidance=""
      onUserGuidanceChange={() => {}}
      storyLength="default"
      onStoryLengthChange={() => {}}
      selectedLanguage="zh-CN"
      onSelectedLanguageChange={() => {}}
      showStoryLength={false}
      showLanguage={false}
    />
  );

  expect(html).toContain('故事方向引导');
  expect(html).not.toContain('期望字数');
  expect(html).not.toContain('生成语言');
});
