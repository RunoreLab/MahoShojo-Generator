import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CreatorOverviewCard } from '@/components/creator/CreatorOverviewCard';
import { CreatorQuestionnaireSidebarPanel } from '@/components/creator/CreatorQuestionnaireSidebarPanel';
import { CreatorSidebar } from '@/components/creator/CreatorSidebar';

test('CreatorOverviewCard 输出阶段、进度、模板与主规则摘要', () => {
  const html = renderToStaticMarkup(
    <CreatorOverviewCard
      stageLabel="答题中"
      progressLabel="问题 3 / 12"
      templateLabel="通用角色卡"
      primaryRuleLabel="魔法少女竞技场 TRPG 简化角色卡"
      nativeHint="当前仍具备原生性"
    />
  );

  expect(html).toContain('答题中');
  expect(html).toContain('问题 3 / 12');
  expect(html).toContain('通用角色卡');
  expect(html).toContain('当前仍具备原生性');
});

test('CreatorSidebar 在 mobile + questionnaire 阶段默认展开概况与问卷组', () => {
  const html = renderToStaticMarkup(
    <CreatorSidebar
      layoutMode="mobile"
      stage="questionnaire"
      overview={<div>概况内容</div>}
      configuration={<div>配置内容</div>}
      questionnaire={<div>问卷内容</div>}
      advanced={<div>高级内容</div>}
    />
  );

  expect(html).toContain('概况内容');
  expect(html).toContain('问卷内容');
  expect(html).toContain('data-group="advanced"');
  expect(html).toContain('data-default-open="false"');
  expect(html).toContain('创作概况');
  expect(html).toContain('创作配置');
  expect(html).toContain('问卷与作答');
  expect(html).toContain('高级生成');
});

test('CreatorQuestionnaireSidebarPanel 收拢问卷设置与答案概览', () => {
  const html = renderToStaticMarkup(
    <CreatorQuestionnaireSidebarPanel
      navigator={<div>题目导航</div>}
      settings={<div>问卷设置</div>}
      answerReview={<div>答案概览</div>}
    />
  );

  expect(html).toContain('题目导航');
  expect(html).toContain('问卷设置');
  expect(html).toContain('答案概览');
});
