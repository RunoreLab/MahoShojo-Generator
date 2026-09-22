import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBattleReportGenerationByIdLite: vi.fn(),
  getBattleReportGenerationCombatantsByGenerationId: vi.fn(),
  parseGenerationCombatantsFallback: vi.fn(),
  loadBattleReportGenerationOutputText: vi.fn(),
  updateBattleReportGenerationOutputHasSensitiveWords: vi.fn(),
  quickCheck: vi.fn(),
  resolveBattleReportAccess: vi.fn(),
}));

vi.mock('@/lib/database/battle-report-generations', () => ({
  getBattleReportGenerationByIdLite: mocks.getBattleReportGenerationByIdLite,
  updateBattleReportGenerationOutputHasSensitiveWords: mocks.updateBattleReportGenerationOutputHasSensitiveWords,
}));
vi.mock('@/lib/database/battle-report-generation-combatants', () => ({
  getBattleReportGenerationCombatantsByGenerationId: mocks.getBattleReportGenerationCombatantsByGenerationId,
}));
vi.mock('@/lib/database/arena-ratings', () => ({
  parseGenerationCombatantsFallback: mocks.parseGenerationCombatantsFallback,
}));
vi.mock('@/lib/arena/battle-report-record-utils', () => ({
  extractBattleReportGenerationErrorMessage: () => null,
  loadBattleReportGenerationOutputText: mocks.loadBattleReportGenerationOutputText,
}));
vi.mock('@/lib/arena/battle-report-access', () => ({
  resolveBattleReportAccess: mocks.resolveBattleReportAccess,
}));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: mocks.quickCheck }));
vi.mock('@/lib/pvp/server', () => ({
  json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  }),
  requireAuthUser: async () => ({ user: { id: 42, username: 'member' }, source: 'better-auth-session' }),
}));

import { appRouteHandler } from '@/app/api/me/battle-reports/[generationId]/handler';

const record = {
  id: 'generation-1',
  user_id: 7,
  output_preview: '# 战报\n\n正文',
  output_has_sensitive_words: 0,
  output_has_shield_words: 0,
  generation_mode: 'stream',
  endpoint: 'api/arena/generate-stream',
  mode: 'classic',
  scenario_title: '共享场景',
  language: 'zh-CN',
  story_length: 'standard',
  headline: '共享战报',
  winner: '角色甲',
  pvp_match_id: null,
  pvp_room_id: null,
  pvp_round_id: null,
  status: 'completed',
  started_at: '2026-09-22T10:00:00.000Z',
  ended_at: '2026-09-22T10:00:01.000Z',
  duration_ms: 1000,
  extra_json: null,
};

describe('battle report detail handler access projection', () => {
  beforeEach(() => {
    mocks.getBattleReportGenerationByIdLite.mockReset();
    mocks.getBattleReportGenerationCombatantsByGenerationId.mockReset();
    mocks.parseGenerationCombatantsFallback.mockReset();
    mocks.loadBattleReportGenerationOutputText.mockReset();
    mocks.updateBattleReportGenerationOutputHasSensitiveWords.mockReset();
    mocks.quickCheck.mockReset();
    mocks.resolveBattleReportAccess.mockReset();
    mocks.getBattleReportGenerationByIdLite.mockResolvedValue(record);
    mocks.getBattleReportGenerationCombatantsByGenerationId.mockResolvedValue([{
      sort_index: 0,
      name: '角色甲',
      type: 'magical-girl',
      template_id: 'host-local-template',
      is_native: 1,
      is_preset: 0,
      team_id: 1,
      character_guidance: '仅房主可见的指导',
      data_card_id: 'private-card-id',
      data_card_updated_at: '2026-09-22T09:00:00.000Z',
    }]);
    mocks.parseGenerationCombatantsFallback.mockReturnValue([]);
    mocks.loadBattleReportGenerationOutputText.mockResolvedValue({
      outputText: '# 战报\n\n正文',
      source: 'd1',
      readError: null,
      hasStoredOutput: true,
    });
    mocks.updateBattleReportGenerationOutputHasSensitiveWords.mockResolvedValue(true);
    mocks.quickCheck.mockResolvedValue({ hasSensitiveWords: false });
  });

  it('returns multiplayer-safe combatants to a member while retaining role provenance', async () => {
    mocks.resolveBattleReportAccess.mockResolvedValue({
      scope: 'arena-participant',
      isArenaParticipant: true,
      arenaParticipantRole: 'member',
    });

    const response = await appRouteHandler(new Request(
      'https://example.test/api/me/battle-reports/generation-1',
    ));
    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(payload.record).toMatchObject({
      accessScope: 'arena-participant',
      arenaParticipantRole: 'member',
      sourceKind: 'arena-multiplayer',
    });
    expect(payload.combatants[0]).toEqual({
      sortIndex: 0,
      name: '角色甲',
      type: 'magical-girl',
      teamId: 1,
    });
    expect(payload.combatants[0]).not.toHaveProperty('templateId');
    expect(payload.combatants[0]).not.toHaveProperty('dataCardId');
    expect(payload.combatants[0]).not.toHaveProperty('characterGuidance');
  });

  it('keeps owner combatant provenance and rejects unrelated users', async () => {
    mocks.resolveBattleReportAccess.mockResolvedValueOnce({
      scope: 'owner',
      isArenaParticipant: false,
      arenaParticipantRole: null,
    }).mockResolvedValueOnce(null);

    const ownerResponse = await appRouteHandler(new Request(
      'https://example.test/api/me/battle-reports/generation-1',
    ));
    const ownerPayload = await ownerResponse.json() as any;
    expect(ownerResponse.status).toBe(200);
    expect(ownerPayload.combatants[0]).toMatchObject({
      templateId: 'host-local-template',
      dataCardId: 'private-card-id',
      characterGuidance: '仅房主可见的指导',
    });

    const deniedResponse = await appRouteHandler(new Request(
      'https://example.test/api/me/battle-reports/generation-1',
    ));
    expect(deniedResponse.status).toBe(403);
  });
});
