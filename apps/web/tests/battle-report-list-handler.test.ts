import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  countBattleReportGenerationsByUserId: vi.fn(),
  getBattleReportGenerationsByUserIdLite: vi.fn(),
}));

vi.mock('@/lib/database/battle-report-generations', () => ({
  countBattleReportGenerationsByUserId: mocks.countBattleReportGenerationsByUserId,
  getBattleReportGenerationsByUserIdLite: mocks.getBattleReportGenerationsByUserIdLite,
  countBattleReportGenerationsByUserIdSince: async () => ({ total: 2, completed: 2, failed: 0, aborted: 0 }),
}));
vi.mock('@/lib/database/users', () => ({
  getUserProfileCardRowByUserId: async () => ({ id: 42, username: 'member' }),
}));
vi.mock('@/lib/database/badges', () => ({ getUserBadges: async () => [] }));
vi.mock('@/lib/database/data-cards', () => ({
  getUserProfileCardDataStats: async () => ({}),
  getUserTopDataCardsByEngagement: async () => [],
}));
vi.mock('@/lib/database/pvp', () => ({
  getPvpUserSummariesByUserIds: async () => [],
  getPvpMatchesByUserId: async () => ({ matches: [], players: [] }),
  getPvpMatchRoundOutcomeSummariesByMatchIds: async () => [],
}));
vi.mock('@/lib/db/drizzle', () => ({ getDrizzleDbFromRuntime: () => null }));
vi.mock('@/lib/arena/battle-report-display-title', () => ({
  resolveBattleReportDisplayTitle: ({ headline }: { headline: string | null }) => headline || '无标题',
}));
vi.mock('@/lib/arena/battle-report-record-utils', () => ({
  extractBattleReportGenerationErrorMessage: () => null,
}));
vi.mock('@/lib/pvp/server', () => ({
  json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  }),
  requireAuthUser: async () => ({ user: { id: 42, username: 'member' }, source: 'better-auth-session' }),
  withPvpErrorBoundary: (handler: (req: Request) => Promise<Response>) => handler,
}));

import { appRouteHandler } from '@/app/api/me/battle-reports/handler';
import { appRouteHandler as profileCardHandler } from '@/app/api/me/profile-card/handler';

describe('battle report list and profile card handlers', () => {
  beforeEach(() => {
    mocks.countBattleReportGenerationsByUserId.mockReset();
    mocks.getBattleReportGenerationsByUserIdLite.mockReset();
    mocks.countBattleReportGenerationsByUserId.mockResolvedValue(2);
    mocks.getBattleReportGenerationsByUserIdLite.mockResolvedValue([
      {
        id: 'member-generation', started_at: '2026-09-22T10:00:00.000Z', status: 'completed',
        endpoint: 'api/arena/generate-stream', generation_mode: 'stream', mode: 'classic',
        headline: '多人战报', scenario_title: null, winner: '角色甲', output_preview: '正文',
        output_has_sensitive_words: 0, output_has_shield_words: 0, extra_json: null,
        pvp_room_id: 'room-1', pvp_match_id: 'member-generation', pvp_round_id: 'attempt-1',
        source_kind: 'arena-multiplayer',
        arena_participant_generation_id: 'member-generation', arena_participant_role: 'member',
      },
      {
        id: 'legacy-generation', started_at: '2026-09-22T09:00:00.000Z', status: 'completed',
        endpoint: 'api/arena/generate-stream', generation_mode: 'stream', mode: 'classic',
        headline: '旧多人战报', scenario_title: null, winner: null, output_preview: null,
        output_has_sensitive_words: 0, output_has_shield_words: 0, extra_json: null,
        pvp_room_id: null, pvp_match_id: null, pvp_round_id: null,
        source_kind: 'arena-multiplayer',
        arena_participant_generation_id: 'legacy-generation', arena_participant_role: null,
      },
    ]);
  });

  it.each([
    ['battle-reports', appRouteHandler, 'records'],
    ['profile-card', profileCardHandler, 'recentBattleReports'],
  ] as const)('%s returns multiplayer source and role badges without exposing participant ids', async (route, handler, recordsKey) => {
    const response = await handler(new Request(
      `https://example.test/api/me/${route}?page=1&pageSize=10`,
    ));
    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(payload[recordsKey]).toMatchObject([
      { id: 'member-generation', sourceKind: 'arena-multiplayer', arenaParticipantRole: 'member' },
      { id: 'legacy-generation', sourceKind: 'arena-multiplayer', arenaParticipantRole: null },
    ]);
    expect(payload[recordsKey][0]).not.toHaveProperty('arenaParticipantGenerationId');
  });
});
