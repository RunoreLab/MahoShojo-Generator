// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { MagicalGirlResultBody, type MagicalGirlResultData } from '../src/character-result/index';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => act(() => root.unmount()));

const render = (node: ReactNode) => act(() => root.render(node));

const result: MagicalGirlResultData = {
  codename: '雾灯',
  appearance: { outfit: '校服与斗篷', accessories: '银色挂坠', colorScheme: '靛蓝', overallLook: '冷清' },
  magicConstruct: {
    name: '星轨',
    form: { shape: '长杖' },
    basicAbilities: [{ name: '引导', description: '聚集星光', subFields: { 范围: '十米' }, cooldown: '一轮' }],
    description: '**详细描述**',
  },
  wonderlandRule: { name: '回声', description: '回答呼唤', tendency: '守护', activation: '听见名字' },
  blooming: { name: '满月', evolvedAbilities: ['星瀑'], evolvedForm: '银色长杖', evolvedOutfit: '月白礼装', powerLevel: 'A' },
  analysis: {
    personalityAnalysis: '沉静',
    abilityReasoning: '守望远方',
    coreTraits: ['谨慎', '温柔'],
    predictionBasis: '日常选择',
    background: { belief: '答应的事会完成', bonds: '信任伙伴' },
  },
};

test('shared magical-girl result body preserves Web-visible sections and lets the host own Markdown policy', () => {
  render(
    <MagicalGirlResultBody
      magicalGirl={result}
      renderMarkdown={(content) => <span data-host-markdown="true">rendered:{content}</span>}
    />,
  );
  const html = container.innerHTML;

  for (const text of ['雾灯', '魔法少女外观', '魔力构装', '奇境规则', '繁开状态', '性格分析', '角色背景', '信念']) {
    expect(html).toContain(text);
  }
  expect(html).toContain('data-host-markdown="true"');
  expect(html).toContain('rendered:**详细描述**');
  expect(html).toContain('cooldown');
});
