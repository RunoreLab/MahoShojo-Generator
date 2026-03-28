import React from 'react';
import { expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('@/components/arena/hooks/useBattleEngine', () => ({
  useBattleEngine: () => ({
    handleGenerate: () => {},
    isGenerating: false,
    isCooldown: false,
    remainingTime: 0,
    providerCooldownMode: null,
    otherRemainingTime: null,
  }),
}));

test('BattleActions 可按需隐藏高级叙事历史与上下文估算区块', async () => {
  const { BattleActions } = await import('@/components/arena/components/BattleActions');
  const html = renderToStaticMarkup(<BattleActions showAdvancedUtilities={false} />);

  expect(html).not.toContain('高级：叙事历史 / 上下文估算');
  expect(html).toContain('生成独家新闻');
});
