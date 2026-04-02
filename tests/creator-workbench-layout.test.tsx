import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CreatorWorkbenchLayout } from '@/components/creator/CreatorWorkbenchLayout';

test('CreatorWorkbenchLayout 在 desktop 模式输出左右区域', () => {
  const html = renderToStaticMarkup(
    <CreatorWorkbenchLayout
      layoutMode="desktop"
      sidebar={<div>侧栏内容</div>}
      main={<div>主区内容</div>}
    />
  );

  expect(html).toContain('data-layout-mode="desktop"');
  expect(html).toContain('creator-workbench-sidebar');
  expect(html).toContain('creator-workbench-main');
});

test('CreatorWorkbenchLayout 在 mobile 模式先渲染顶部面板再渲染主区', () => {
  const html = renderToStaticMarkup(
    <CreatorWorkbenchLayout
      layoutMode="mobile"
      sidebar={<div>移动侧栏</div>}
      main={<div>移动主区</div>}
    />
  );

  expect(html).toContain('data-layout-mode="mobile"');
  expect(html.indexOf('移动侧栏')).toBeLessThan(html.indexOf('移动主区'));
});
