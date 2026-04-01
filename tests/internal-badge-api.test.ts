import { describe, expect, test } from 'bun:test';
import { createGrantExcellentReporterInternalHandler } from '@/pages/api/internal/badges/excellent-reporter';
import { createGrantSponsorInternalHandler } from '@/pages/api/internal/badges/sponsor';

describe('internal badge api handlers', () => {
  test('excellent reporter 接口应校验 token 后返回任务结果', async () => {
    const handler = createGrantExcellentReporterInternalHandler({
      requireInternalToken: async () => ({
        principal: {
          name: 'badge-cron',
          scopes: ['badges:grant:*'],
        },
      }),
      runGrantExcellentReporter: async (options = {}) => ({
        rule: {
          badgeId: 'excellent_reporter',
          name: '优秀记者',
          description: 'desc',
          slotIncrement: 128,
          minTotalLikes: 5,
          minTotalFavorites: 3,
          minTotalUsage: 30,
        },
        summary: {
          totalPublicUsers: 12,
          eligibleUsers: 3,
          badgeGranted: options.dryRun ? 3 : 1,
          slotIncreased: options.dryRun ? 3 : 1,
          skipped: 0,
          errors: 0,
          dryRun: options.dryRun ?? false,
        },
      }),
    });

    const response = await handler(
      new Request('https://example.com/api/internal/badges/excellent-reporter', {
        method: 'POST',
        body: JSON.stringify({
          dryRun: true,
          requestId: 'cron-2026-04-01-001',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      success?: boolean;
      triggeredBy?: string;
      job?: string;
      summary?: { badgeGranted?: number; dryRun?: boolean };
    };
    expect(payload.success).toBeTrue();
    expect(payload.triggeredBy).toBe('badge-cron');
    expect(payload.job).toBe('grantExcellentReporter');
    expect(payload.summary?.badgeGranted).toBe(3);
    expect(payload.summary?.dryRun).toBeTrue();
  });

  test('sponsor 接口应拒绝非法 dryRun 参数', async () => {
    const handler = createGrantSponsorInternalHandler({
      requireInternalToken: async () => ({
        principal: {
          name: 'badge-cron',
          scopes: ['badges:grant:*'],
        },
      }),
      runGrantSponsor: async () => ({
        sponsorBadgeId: 'sponsor',
        excellentReporterRule: {
          badgeId: 'excellent_reporter',
          name: '优秀记者',
          description: 'desc',
          slotIncrement: 128,
          minTotalLikes: 5,
          minTotalFavorites: 3,
          minTotalUsage: 30,
        },
        summary: {
          totalCandidates: 1,
          slotOnly: 1,
          excellentOnly: 0,
          bothSources: 0,
          badgeGranted: 1,
          skippedHasBadge: 0,
          errors: 0,
          dryRun: false,
        },
      }),
    });

    const response = await handler(
      new Request('https://example.com/api/internal/badges/sponsor', {
        method: 'POST',
        body: JSON.stringify({
          dryRun: 'yes',
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: string };
    expect(payload.error).toBe('dryRun 必须是布尔值');
  });
});
