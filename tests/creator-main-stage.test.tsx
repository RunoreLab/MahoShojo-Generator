import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CreatorMainStage } from '@/components/creator/CreatorMainStage';

test('CreatorMainStage 在 questionnaire 阶段只保留主任务区域', () => {
  const html = renderToStaticMarkup(
    <CreatorMainStage
      stage="questionnaire"
      title="当前题目"
      content={<div>当前题目面板</div>}
    />
  );

  expect(html).toContain('当前题目');
  expect(html).toContain('当前题目面板');
  expect(html).not.toContain('问卷设置');
  expect(html).not.toContain('答案概览');
});
