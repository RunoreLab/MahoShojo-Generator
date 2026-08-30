import React from 'react';
import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CharacterParameterView } from '@/lib/creator/character-parameter-view';
import { CharacterParameterSection } from '@/components/shared/CharacterParameterSection';

const mockView: CharacterParameterView = {
  activeSource: 'current',
  sources: [
    {
      key: 'initial',
      label: '初始',
      rules: [
        {
          ruleId: 'dnd-5e-lite',
          title: 'DND 5e 经典角色卡',
          version: '1.0.0',
          valid: true,
          statusLabel: '规则校验通过',
          issues: [],
          sections: [
            {
              key: 'level',
              title: '等级',
              entries: [{ key: 'level-value', label: '等级', value: '3 级' }],
            },
          ],
        },
      ],
    },
    {
      key: 'current',
      label: '当前',
      rules: [
        {
          ruleId: 'dnd-5e-lite',
          title: 'DND 5e 经典角色卡',
          version: '1.0.0',
          valid: false,
          statusLabel: '存在 1 条规则问题',
          issues: ['命中骰缺失'],
          sections: [
            {
              key: 'level',
              title: '等级',
              entries: [{ key: 'level-value', label: '等级', value: '5 级' }],
            },
          ],
        },
      ],
    },
  ],
};

test('交互态显示角色参数标题、初始/当前切换与规则内容', () => {
  const html = renderToStaticMarkup(
    <CharacterParameterSection
      view={mockView}
      sourceKey="current"
      renderMode="interactive"
      onChangeSource={() => {}}
    />
  );

  expect(html).toContain('角色参数');
  expect(html).toContain('初始');
  expect(html).toContain('当前');
  expect(html).toContain('data-character-parameter-toggle="initial"');
  expect(html).toContain('data-character-parameter-toggle="current"');
  expect(html).toContain('DND 5e 经典角色卡');
  expect(html).toContain('5 级');
  expect(html).toContain('存在 1 条规则问题');
});

test('导出态隐藏切换控件但保留当前来源静态标识', () => {
  const html = renderToStaticMarkup(
    <CharacterParameterSection
      view={mockView}
      sourceKey="current"
      renderMode="export"
      onChangeSource={() => {}}
    />
  );

  expect(html).toContain('角色参数 · 当前');
  expect(html).not.toContain('data-character-parameter-toggle');
});

test('单来源时直接展示静态来源标识', () => {
  const html = renderToStaticMarkup(
    <CharacterParameterSection
      view={{ ...mockView, sources: [mockView.sources[0]] }}
      sourceKey="initial"
      renderMode="interactive"
      onChangeSource={() => {}}
    />
  );

  expect(html).toContain('角色参数 · 初始');
  expect(html).not.toContain('data-character-parameter-toggle');
});
