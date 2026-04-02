import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CreatorWorkbenchPage } from '@/components/creator/CreatorWorkbenchPage';

test('CreatorWorkbenchPage 在 result 阶段仍输出工作台壳与 overlay 内容', () => {
  const html = renderToStaticMarkup(
    <CreatorWorkbenchPage
      layoutMode="desktop"
      sidebarResetKey="result"
      sidebarStage="result"
      mainStage="result"
      overviewStageLabel="创作完成"
      progressLabel="共 12 题，已进入结果阶段"
      templateLabel="通用角色卡"
      primaryRuleLabel="魔法少女竞技场 TRPG 简化角色卡"
      nativeHint="当前仍具备原生性"
      configuration={<div>配置内容</div>}
      buildRules={<div>规则内容</div>}
      advanced={<div>高级内容</div>}
      mainTopContent={<div>问卷与作答</div>}
      mainContent={<div>结果主区</div>}
      showFooter
      overlayContent={<div>弹层内容</div>}
    />
  );

  expect(html).toContain('creator-workbench-shell');
  expect(html).toContain('data-creator-sidebar-stage="result"');
  expect(html).toContain('data-creator-stage="result"');
  expect(html).toContain('规则内容');
  expect(html).toContain('问卷与作答');
  expect(html.indexOf('问卷与作答')).toBeLessThan(html.indexOf('结果主区'));
  expect(html).toContain('结果主区');
  expect(html).toContain('弹层内容');
});
