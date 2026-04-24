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
      customStoryLength=""
      onCustomStoryLengthChange={() => {}}
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

test('StoryOptionsPanel 在存在自定义字数时展示自定义输入与说明', () => {
  const html = renderToStaticMarkup(
    <StoryOptionsPanel
      isGenerating={false}
      enableUserGuidance={false}
      userGuidance=""
      onUserGuidanceChange={() => {}}
      storyLength="default"
      onStoryLengthChange={() => {}}
      customStoryLength="1200"
      onCustomStoryLengthChange={() => {}}
      selectedLanguage="zh-CN"
      onSelectedLanguageChange={() => {}}
      showLanguage={false}
    />
  );

  expect(html).toContain('自定义');
  expect(html).toContain('自定义目标字数');
  expect(html).toContain('1200');
  expect(html).toContain('仅作参考');
});
