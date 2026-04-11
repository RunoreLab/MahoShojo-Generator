import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { EncounterSnapshotV1 } from '@/lib/challenge/types';

const buildBattleEncounter = (): EncounterSnapshotV1 => ({
  version: 1,
  nodeId: 'L1-N1',
  templateId: 'arena-battle-placeholder',
  kind: 'battle',
  inputMode: 'recommended-action-plus-free-intent',
  enemySnapshot: {
    version: 1,
    sourceType: 'preset',
    sourceId: 'preset-snowy',
    displayName: '雪绒',
    strengthTier: 'common',
    combatProfile: {},
    tags: ['游击', '机动'],
    promptSummary: '善于高速游走与试探的竞技场魔法少女。',
  },
  rewardOptions: [],
  eventOptions: [],
  shopOffers: [],
});

describe('challenge node display', () => {
  test('battle 节点优先渲染敌方角色卡区', async () => {
    const { NodeResolutionPanel } = await import('@/components/challenge/NodeResolutionPanel');

    const html = renderToStaticMarkup(
      <NodeResolutionPanel
        encounter={buildBattleEncounter()}
        latestStoryText=""
        isResolving={false}
        note=""
        selectedOptionId=""
        selectedRecommendedActionId="advance-pressure"
        recommendedActions={[]}
        viewMode="input"
        enemyDisplayState={{
          status: 'fallback',
          template: 'general',
          card: {
            templateId: '通用角色',
            name: '雪绒',
            content: '# 雪绒\n\n> 该卡为挑战快照，不代表完整原始数据卡。',
          },
          message: '已回退为挑战快照',
          sourceMeta: { sourceType: 'season-entity', sourceId: 'enemy-1', isFallback: true },
        }}
        storyCardState={null}
        onUserProviderConfigChange={() => {}}
        onRecommendedActionChange={() => {}}
        onSelectOption={() => {}}
        onNoteChange={() => {}}
        onResolve={() => {}}
        onBackToMap={() => {}}
      />
    );

    expect(html).toContain('敌方角色卡');
    expect(html).toContain('当前节点');
    expect(html).toContain('危险等级：标准');
    expect(html).not.toContain('Node');
    expect(html).not.toContain('common');
    expect(html).not.toContain('对手：雪绒 ·');
  });

  test('敌方展示解析中时显示加载提示但不隐藏结算表单', async () => {
    const { NodeResolutionPanel } = await import('@/components/challenge/NodeResolutionPanel');

    const html = renderToStaticMarkup(
      <NodeResolutionPanel
        encounter={buildBattleEncounter()}
        latestStoryText=""
        isResolving={false}
        note=""
        selectedOptionId=""
        selectedRecommendedActionId="advance-pressure"
        recommendedActions={[]}
        viewMode="input"
        enemyDisplayState={{
          status: 'loading',
          template: null,
          card: null,
          message: '正在解析敌方角色卡...',
          sourceMeta: { sourceType: 'preset', sourceId: 'preset-snowy', isFallback: false },
        }}
        storyCardState={null}
        onUserProviderConfigChange={() => {}}
        onRecommendedActionChange={() => {}}
        onSelectOption={() => {}}
        onNoteChange={() => {}}
        onResolve={() => {}}
        onBackToMap={() => {}}
      />
    );

    expect(html).toContain('正在解析敌方角色卡');
    expect(html).toContain('提交结算');
  });

  test('存在 storyCardState 时渲染战报卡而不是旧的纯文本实时战报', async () => {
    const { NodeResolutionPanel } = await import('@/components/challenge/NodeResolutionPanel');

    const html = renderToStaticMarkup(
      <NodeResolutionPanel
        encounter={buildBattleEncounter()}
        latestStoryText="# 战报\n\n雾灯抢下先手。"
        isResolving
        note=""
        selectedOptionId=""
        selectedRecommendedActionId="advance-pressure"
        recommendedActions={[]}
        viewMode="input"
        enemyDisplayState={null}
        storyCardState={{
          markdown: '# 战报\n\n雾灯抢下先手。',
          reasoning: null,
          telemetry: null,
          finalSource: 'ai',
        }}
        onUserProviderConfigChange={() => {}}
        onRecommendedActionChange={() => {}}
        onSelectOption={() => {}}
        onNoteChange={() => {}}
        onResolve={() => {}}
        onBackToMap={() => {}}
      />
    );

    expect(html).toContain('下载记录');
    expect(html).not.toContain('实时战报');
  });

  test('结果态继续显示战报卡', async () => {
    const { NodeResolutionPanel } = await import('@/components/challenge/NodeResolutionPanel');

    const html = renderToStaticMarkup(
      <NodeResolutionPanel
        encounter={buildBattleEncounter()}
        latestStoryText="# 战报\n\n雾灯抢下先手。"
        isResolving={false}
        note=""
        selectedOptionId=""
        selectedRecommendedActionId="advance-pressure"
        recommendedActions={[]}
        viewMode="result"
        enemyDisplayState={{
          status: 'fallback',
          template: 'general',
          card: {
            templateId: '通用角色',
            name: '雪绒',
            content: '# 雪绒\n\n> 该卡为挑战快照，不代表完整原始数据卡。',
          },
          message: '已回退为挑战快照',
          sourceMeta: { sourceType: 'season-entity', sourceId: 'enemy-1', isFallback: true },
        }}
        storyCardState={{
          markdown: '# 战报\n\n雾灯抢下先手。',
          reasoning: null,
          telemetry: null,
          finalSource: 'ai',
        }}
        onUserProviderConfigChange={() => {}}
        onRecommendedActionChange={() => {}}
        onSelectOption={() => {}}
        onNoteChange={() => {}}
        onResolve={() => {}}
        onBackToMap={() => {}}
      />
    );

    expect(html).toContain('敌方角色卡');
    expect(html).toContain('下载记录');
    expect(html).toContain('结算结果');
    expect(html).not.toContain('Resolution');
    expect(html).not.toContain('本节点已结算。');
  });
});
