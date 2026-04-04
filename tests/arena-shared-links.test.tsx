import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArenaCommunitySection } from '@/components/arena/shared/ArenaCommunitySection';
import { ArenaPageLinks } from '@/components/arena/shared/ArenaPageLinks';
import { ArenaRankingLinks } from '@/components/arena/shared/ArenaRankingLinks';

test('ArenaPageLinks 为简洁版和完整版输出正确入口', () => {
  const liteHtml = renderToStaticMarkup(<ArenaPageLinks variant="lite" />);
  const fullHtml = renderToStaticMarkup(<ArenaPageLinks variant="full" />);

  expect(liteHtml).toContain('/arena');
  expect(liteHtml).toContain('进入完整版竞技场');
  expect(liteHtml).toContain('/challenge');
  expect(liteHtml).toContain('进入挑战模式');
  expect(fullHtml).toContain('/battle');
  expect(fullHtml).toContain('切换到简洁版');
  expect(fullHtml).toContain('/challenge');
  expect(fullHtml).toContain('进入挑战模式');
});

test('ArenaRankingLinks 输出排行榜入口文案', () => {
  const html = renderToStaticMarkup(<ArenaRankingLinks />);

  expect(html).toContain('快速查看排行榜');
  expect(html).toContain('/ranking');
  expect(html).toContain('进入排行榜页');
});

test('ArenaCommunitySection 复用当前社区信息', () => {
  const html = renderToStaticMarkup(<ArenaCommunitySection />);

  expect(html).toContain('1059830952');
  expect(html).toContain('1076725478');
  expect(html).toContain('点击加入腾讯频道');
});
