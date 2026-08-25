import React from 'react';
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { CreatorStructuredResultCard } from '@/components/creator/CreatorStructuredResultCard';

describe('CreatorStructuredResultCard', () => {
  test('canshou 模板结果使用 CanshouCard 渲染', () => {
    const html = renderToStaticMarkup(
      <CreatorStructuredResultCard
        template="canshou"
        result={{
          name: '灰烬追猎者',
          coreConcept: '饥饿',
          coreEmotion: '空洞',
          evolutionStage: '蜕',
          appearance: '灰白色的多肢残兽',
          materialAndSkin: '裂陶一般的外壳',
          featuresAndAppendages: '多条带钩尾肢',
          attackMethod: '扑杀与撕裂',
          specialAbility: '吞噬温度',
          origin: '废弃炉心',
          birthEnvironment: '坍塌工厂',
          researcherNotes: '避免近距离接触',
          creationInputs: {
            template: 'canshou',
            buildRules: [],
          },
          buildState: {
            rules: [],
          },
        }}
      />
    );

    expect(html).toContain('灰烬追猎者');
    expect(html).toContain('核心概念');
    expect(html).toContain('残兽档案');
  });
});
