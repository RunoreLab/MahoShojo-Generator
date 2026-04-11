import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ChallengeRunRecord } from '@/lib/challenge/types';

const mockRun: ChallengeRunRecord = {
  id: 'run-resume-1',
  worldPresetId: 'arena',
  status: 'in_progress',
  snapshotSeed: 'snap-resume-1',
  runSeed: 'run-seed-resume-1',
  usedBootstrapReroll: false,
  playerSnapshot: {
    version: 1,
    sourceType: 'local-card',
    sourceId: 'card-1',
    displayName: '雾灯',
    snapshotSeed: 'snap-resume-1',
    strengthTier: 'common',
    baseTrackSnapshot: {},
    combatProfile: {},
    tags: ['谨慎'],
    promptSummary: '擅长观察与节奏控制。',
  },
  runState: null,
  currentStateDigest: null,
  currentNodeId: 'L2-N1',
  visitedNodeCount: 3,
  lastResolvedNodeId: 'L1-N2',
  lastCheckpointId: 'checkpoint-3',
  startedAt: 100,
  updatedAt: 200,
  finishedAt: null,
};

describe('challenge resume panel', () => {
  test('ChallengeResumePanel 会列出最近挑战、继续按钮与删除按钮', async () => {
    const { ChallengeResumePanel } = await import('@/components/challenge/ChallengeResumePanel');

    const html = renderToStaticMarkup(
      <ChallengeResumePanel
        worldTitle="魔法少女竞技场"
        runs={[mockRun]}
        isLoading={false}
        onResume={() => {}}
        onDelete={() => {}}
      />
    );

    expect(html).toContain('最近挑战');
    expect(html).toContain('继续挑战');
    expect(html).toContain('删除本地挑战');
    expect(html).toContain('已完成节点 3');
  });
});
