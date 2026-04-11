import { describe, expect, test } from 'bun:test';

import { createAdminDashboardStatsHandler } from '@/pages/api/admin/dashboard-stats';

describe('admin dashboard stats API', () => {
  test('GET /api/admin/dashboard-stats reads governance section', async () => {
    let governanceCalled = false;
    const handler = createAdminDashboardStatsHandler({
      getDashboardStats: async () => ({ totalUsers: 1 }),
      getDashboardStatsCore: async () => ({ totalUsers: 1 }),
      getDashboardStatsActivity: async () => ({ activeUsers24h: 1, activeUsers7d: 1, activityTrackingOk: true }),
      getDashboardStatsArena: async () => ({ arenaRatingsStrictTotal: 1 }),
      getDashboardStatsTags: async () => ({ activeTagsTotal: 1 }),
      getDashboardStatsStorage: async () => ({ largeObjectsTotal: 1 }),
      getDashboardStatsAccounts: async () => ({ authLinkedUsersCount: 1 }),
      getDashboardStatsPvp: async () => ({ pvpOpenRoomsTotal: 1 }),
      getDashboardStatsGovernance: async () => {
        governanceCalled = true;
        return {
          openReportCasesTotal: 3,
          underReviewReportCasesTotal: 2,
          activeCrowdReviewRoundsTotal: 1,
          submittedReportAppealsTotal: 4,
          activeInspectorsTotal: 5,
          recentSiteMessagesTotal: 6,
          recentDirectMessagesTotal: 7,
        };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/dashboard-stats?section=governance'),
    );
    const payload = (await response.json()) as { success: boolean; section: string; stats: { openReportCasesTotal: number } };

    expect(response.status).toBe(200);
    expect(governanceCalled).toBe(true);
    expect(payload.section).toBe('governance');
    expect(payload.stats.openReportCasesTotal).toBe(3);
  });
});
