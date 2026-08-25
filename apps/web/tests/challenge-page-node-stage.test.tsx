import React from 'react';
import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChallengePageView, type ChallengePageController } from '@/components/challenge/ChallengePage';

const createBattleEncounter = () => ({
  version: 1 as const,
  nodeId: 'L1-N1',
  templateId: 'arena-battle-placeholder',
  kind: 'battle' as const,
  inputMode: 'recommended-action-plus-free-intent' as const,
  enemySnapshot: {
    version: 1 as const,
    sourceType: 'preset' as const,
    sourceId: 'preset-snowy',
    displayName: '雪绒',
    strengthTier: 'common' as const,
    combatProfile: {},
    tags: ['游击', '机动'],
    promptSummary: '善于高速游走与试探的竞技场魔法少女。',
  },
  rewardOptions: [],
  eventOptions: [],
  shopOffers: [],
});

test('ChallengePageView 在战斗节点会透传敌方角色卡区与战报卡区', () => {
  const controller = {
    stage: 'node',
    worldTitle: '魔法少女竞技场',
    error: null,
    selectionError: null,
    localImportError: null,
    editorError: null,
    recentRuns: [],
    allUnlocks: [],
    newUnlocks: [],
    isLoadingRecentRuns: false,
    isBusy: false,
    isResolving: false,
    entrantCards: [],
    sourceMode: 'demo' as const,
    rawEditorText: '',
    lastAppliedEditorText: '',
    isEditorDirty: false,
    isMatching: null,
    selectedEntrantSummary: null,
    bootstrapDraft: null,
    runState: null,
    currentEncounter: createBattleEncounter(),
    nodeViewMode: 'input',
    note: '',
    selectedOptionId: '',
    selectedRecommendedActionId: 'advance-pressure',
    latestStoryText: '',
    enemyDisplayState: {
      status: 'fallback' as const,
      template: 'general' as const,
      card: {
        templateId: '通用角色',
        name: '雪绒',
        content: '# 雪绒\n\n> 该卡为挑战快照，不代表完整原始数据卡。',
      },
      message: '已回退为挑战快照',
      sourceMeta: { sourceType: 'season-entity' as const, sourceId: 'enemy-1', isFallback: true },
    },
    storyCardState: {
      markdown: '# 战报\n\n雾灯抢下先手。',
      reasoning: null,
      telemetry: null,
      finalSource: 'ai' as const,
    },
    latestNodeSummary: '',
    summaryText: '',
    recommendedActions: [],
    setRawEditorText: (_value: string) => {},
    setUserProviderConfig: () => {},
    applyEditorText: async () => {},
    clearEntrantCard: () => {},
    selectEntrantFromDataCard: async () => {},
    randomMatchEntrant: async () => {},
    importEntrantFromFile: async (_file: File) => {},
    importEntrantFromText: async (_text: string) => {},
    revealAdvancedEditor: () => {},
    setNote: () => {},
    setSelectedOptionId: () => {},
    setSelectedRecommendedActionId: () => {},
    loadDemoCard: () => {},
    prepareChallenge: async () => {},
    rerollBootstrap: async () => {},
    acceptBootstrap: async () => {},
    cancelBootstrap: async () => {},
    resumeRun: async () => {},
    deleteRun: async () => {},
    enterNode: async () => {},
    resolveCurrentNode: async () => {},
    backToMap: () => {},
    backToLobby: () => {},
  } satisfies ChallengePageController;

  const html = renderToStaticMarkup(<ChallengePageView controller={controller} />);

  expect(html).toContain('敌方角色卡');
  expect(html).toContain('自定义 AI 能力提供商');
  expect(html).toContain('下载记录');
});
