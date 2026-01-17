import { describe, expect, it } from 'bun:test';

import { computeMagicTeaPartyCleanupPlan } from '@/lib/magic-tea-party/retention';
import type { MagicTeaPartySession } from '@/lib/magic-tea-party/types';

const DAY_MS = 24 * 60 * 60 * 1000;

const baseSettings: MagicTeaPartySession['settings'] = {
  providerId: 'test',
  modelId: 'model',
  enableChoices: false,
  choiceCount: 3,
  outputFormat: 'jsonl',
  outputPlan: { choices: 'off', summary: 'off', updates: 'off' },
  updateApplyMode: 'auto',
  language: 'zh-CN',
  userDisplayName: '旅人',
  enableSummary: true,
  readArenaHistory: true,
  readArenaHistoryLimit: 3,
  isArenaHistoryUnlimited: false,
  readCurrentState: true,
  writeArenaHistory: false,
  writeCurrentState: false,
};

const buildSession = (id: string, updatedAt: number): MagicTeaPartySession => ({
  id,
  title: `会话-${id}`,
  createdAt: updatedAt,
  updatedAt,
  roles: [],
  auxScenarios: [],
  playerRoleId: null,
  settings: baseSettings,
});

describe('computeMagicTeaPartyCleanupPlan', () => {
  it('根据过期与数量上限生成清理候选', () => {
    const now = 100 * DAY_MS;
    const sessions = [
      buildSession('s1', now - 10 * DAY_MS),
      buildSession('s2', now - 40 * DAY_MS),
      buildSession('s3', now - 20 * DAY_MS),
    ];

    const plan = computeMagicTeaPartyCleanupPlan({
      sessions,
      retentionDays: 30,
      maxSessions: 2,
      now,
    });

    expect(plan.expired.map((item) => item.id)).toEqual(['s2']);
    expect(plan.overLimit.map((item) => item.id)).toEqual(['s2']);
    expect(plan.candidates.map((item) => item.id)).toEqual(['s2']);
  });

  it('排除当前会话不进入候选', () => {
    const now = 50 * DAY_MS;
    const sessions = [
      buildSession('active', now - 100 * DAY_MS),
      buildSession('keep', now - 1 * DAY_MS),
    ];

    const plan = computeMagicTeaPartyCleanupPlan({
      sessions,
      retentionDays: 30,
      maxSessions: 1,
      excludeSessionId: 'active',
      now,
    });

    expect(plan.expired.map((item) => item.id)).toEqual([]);
    expect(plan.candidates.map((item) => item.id)).toEqual(['keep']);
  });

  it('置顶会话不进入清理候选', () => {
    const now = 20 * DAY_MS;
    const pinned = { ...buildSession('pinned', now - 200 * DAY_MS), pinnedAt: now - 10 * DAY_MS };
    const old = buildSession('old', now - 200 * DAY_MS);

    const plan = computeMagicTeaPartyCleanupPlan({
      sessions: [pinned, old],
      retentionDays: 30,
      maxSessions: 1,
      now,
    });

    expect(plan.candidates.map((item) => item.id)).toEqual(['old']);
  });
});
