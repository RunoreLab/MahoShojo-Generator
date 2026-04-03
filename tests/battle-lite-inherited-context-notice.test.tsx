import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BattleLiteInheritedContextNotice } from '@/components/arena-lite/BattleLiteInheritedContextNotice';

test('存在隐藏高级上下文时显示继承提示和完整版编辑入口', () => {
  const html = renderToStaticMarkup(
    <BattleLiteInheritedContextNotice
      summary={{
        inheritedSettings: ['长度：long', '语言：en-US'],
        hiddenContext: ['辅助情景 2 个', '问卷 1 张', '判定事件 3 条'],
        hasHiddenContext: true,
      }}
    />,
  );

  expect(html).toContain('当前沿用完整版设置');
  expect(html).toContain('辅助情景 2 个');
  expect(html).toContain('/arena');
  expect(html).toContain('前往完整版编辑');
});

test('没有隐藏高级上下文时仍显示共享设置，但给出空状态说明', () => {
  const html = renderToStaticMarkup(
    <BattleLiteInheritedContextNotice
      summary={{
        inheritedSettings: ['长度：default', '语言：zh-CN'],
        hiddenContext: [],
        hasHiddenContext: false,
      }}
    />,
  );

  expect(html).toContain('当前沿用完整版设置');
  expect(html).toContain('当前未继承额外高级上下文');
});
