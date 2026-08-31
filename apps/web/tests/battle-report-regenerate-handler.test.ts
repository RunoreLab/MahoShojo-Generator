import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBattleReportGenerationByIdLite: vi.fn(),
  updateBattleReportGenerationOutputHasSensitiveWords: vi.fn(),
  isUserInPvpMatch: vi.fn(),
  quickCheck: vi.fn(),
}));

vi.mock('@/lib/database/battle-report-generations', () => ({
  getBattleReportGenerationByIdLite: mocks.getBattleReportGenerationByIdLite,
  updateBattleReportGenerationOutputHasSensitiveWords: mocks.updateBattleReportGenerationOutputHasSensitiveWords,
}));

vi.mock('@/lib/database/pvp', () => ({
  isUserInPvpMatch: mocks.isUserInPvpMatch,
}));

vi.mock('@/lib/sensitive-word-filter', () => ({
  quickCheck: mocks.quickCheck,
}));

vi.mock('@/lib/pvp/server', () => ({
  json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  }),
  readJson: async (request: Request) => ({ data: await request.json() }),
  requireAuthUser: async () => ({
    user: { id: 7, username: 'hana' },
    source: 'better-auth-session',
  }),
}));

import { appRouteHandler } from '@/app/api/me/battle-reports/[generationId]/regenerate/handler';

describe('battle report regenerate handler', () => {
  beforeEach(() => {
    mocks.getBattleReportGenerationByIdLite.mockReset();
    mocks.updateBattleReportGenerationOutputHasSensitiveWords.mockReset();
    mocks.isUserInPvpMatch.mockReset();
    mocks.quickCheck.mockReset();
    mocks.isUserInPvpMatch.mockResolvedValue(false);
    mocks.quickCheck.mockResolvedValue({ hasSensitiveWords: false });
    mocks.updateBattleReportGenerationOutputHasSensitiveWords.mockResolvedValue(undefined);
  });

  it('successfully restores the persisted adjudication snapshot without rerolling it', async () => {
    const adjudicationResults = [{
      depth: 0,
      description: '攻击是否命中？',
      type: 'binary',
      roll: 42,
      outcome: '成功',
      details: '掷骰(42) vs 成功率(65%)',
    }];
    mocks.getBattleReportGenerationByIdLite.mockResolvedValue({
      id: 'generation-1',
      user_id: 7,
      pvp_match_id: null,
      output_preview: '# 快照战报\n\n正文。\n\n## 胜利者\n角色甲',
      output_has_sensitive_words: 0,
      generation_mode: 'stream',
      endpoint: 'api/arena/generate-stream',
      mode: 'classic',
      scenario_title: null,
      headline: null,
      winner: null,
      ai_model: null,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      cached_tokens: null,
      reasoning_tokens: null,
      extra_json: JSON.stringify({
        battleReportRenderSnapshotV1: {
          version: 1,
          reporterInfo: { name: '即时记者', publication: 'A.R.E.N.A.' },
          userGuidance: '原始指引',
          characterGuidances: [{ characterName: '角色甲', guidance: '保护队友' }],
          adjudicationResults,
          narrativeHistoryReadCount: 3,
        },
      }),
    });

    const response = await appRouteHandler(new Request(
      'https://example.test/api/me/battle-reports/generation-1/regenerate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userGuidance: '本次查看指引' }),
      },
    ));
    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(payload.report).toMatchObject({
      reporterInfo: { name: '即时记者', publication: 'A.R.E.N.A.' },
      userGuidance: '本次查看指引',
      characterGuidances: [{ characterName: '角色甲', guidance: '保护队友' }],
      adjudicationResults,
      narrativeHistoryReadCount: 3,
    });
    expect(mocks.getBattleReportGenerationByIdLite).toHaveBeenCalledWith('generation-1');
  });

  it('blocks regeneration when a restored snapshot field contains sensitive text', async () => {
    mocks.quickCheck.mockImplementation(async (text: string) => ({
      hasSensitiveWords: text.includes('快照敏感词'),
    }));
    mocks.getBattleReportGenerationByIdLite.mockResolvedValue({
      id: 'generation-sensitive-snapshot',
      user_id: 7,
      pvp_match_id: null,
      output_preview: '# 正常战报\n\n正文没有命中词。',
      output_has_sensitive_words: 0,
      generation_mode: 'stream',
      endpoint: 'api/arena/generate-stream',
      mode: 'classic',
      scenario_title: null,
      headline: null,
      winner: null,
      ai_model: null,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      cached_tokens: null,
      reasoning_tokens: null,
      extra_json: JSON.stringify({
        battleReportRenderSnapshotV1: {
          version: 1,
          adjudicationResults: [{
            depth: 0,
            description: '快照敏感词',
            type: 'binary',
            roll: 42,
            outcome: '成功',
            details: '掷骰详情',
          }],
        },
      }),
    });

    const response = await appRouteHandler(new Request(
      'https://example.test/api/me/battle-reports/generation-sensitive-snapshot/regenerate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.quickCheck).toHaveBeenCalledWith(expect.stringContaining('快照敏感词'));
    expect(mocks.updateBattleReportGenerationOutputHasSensitiveWords).toHaveBeenCalledWith(
      'generation-sensitive-snapshot',
      true,
    );
  });
});
