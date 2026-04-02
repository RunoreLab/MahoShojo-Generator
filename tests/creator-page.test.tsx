import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { FreeformBriefPanel } from '@/components/creator/FreeformBriefPanel';
import { TemplateSelector } from '@/components/creator/TemplateSelector';

test('TemplateSelector 显示 5 个模板并标出流式边界', () => {
  const html = renderToStaticMarkup(
    <TemplateSelector value="general" onChange={() => {}} />
  );

  expect(html).toContain('魔法少女（结构化）');
  expect(html).toContain('残兽（结构化）');
  expect(html).toContain('通用角色卡（Markdown）');
  expect(html).toContain('情景（结构化）');
  expect(html).toContain('通用情景卡（Markdown）');
  expect(html).toContain('支持流式');
});

test('FreeformBriefPanel 渲染自由补充说明输入区', () => {
  const html = renderToStaticMarkup(
    <FreeformBriefPanel value="" onChange={() => {}} />
  );

  expect(html).toContain('自由补充说明');
  expect(html).toContain('创作要求');
});
