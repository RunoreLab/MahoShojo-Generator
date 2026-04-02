import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CreatorResultStageContent } from '@/components/creator/CreatorResultStageContent';

test('CreatorResultStageContent 在结果阶段同时保留问卷编辑区与结果区', () => {
  const html = renderToStaticMarkup(
    <CreatorResultStageContent
      questionnaireEditor={<div>问卷编辑器</div>}
      resultContent={<div>结果展示</div>}
    />
  );

  expect(html).toContain('继续编辑问卷');
  expect(html).toContain('问卷编辑器');
  expect(html).toContain('结果展示');
  expect(html.indexOf('问卷编辑器')).toBeLessThan(html.indexOf('结果展示'));
});
