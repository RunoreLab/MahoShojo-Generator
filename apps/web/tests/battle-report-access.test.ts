import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAccess: vi.fn(),
  isUserInPvpMatch: vi.fn(),
}));

vi.mock('@/lib/database/battle-report-generations', () => ({
  getBattleReportGenerationAccessByUserId: mocks.getAccess,
}));
vi.mock('@/lib/database/pvp', () => ({
  isUserInPvpMatch: mocks.isUserInPvpMatch,
}));

import { resolveBattleReportAccess } from '@/lib/arena/battle-report-access';

describe('battle report access scopes', () => {
  beforeEach(() => {
    mocks.getAccess.mockReset();
    mocks.isUserInPvpMatch.mockReset();
    mocks.isUserInPvpMatch.mockResolvedValue(false);
  });

  it('keeps owner scope distinct from Arena participant provenance', async () => {
    mocks.getAccess.mockResolvedValue({
      generationId: 'owner-generation',
      ownerUserId: 42,
      pvpMatchId: null,
      arenaParticipantGenerationId: 'owner-generation',
      arenaParticipantRole: 'host',
    });

    await expect(resolveBattleReportAccess('owner-generation', 42)).resolves.toEqual({
      scope: 'owner',
      isArenaParticipant: true,
      arenaParticipantRole: 'host',
    });
  });

  it('allows frozen Arena members without granting owner scope', async () => {
    mocks.getAccess.mockResolvedValue({
      generationId: 'member-generation',
      ownerUserId: 7,
      pvpMatchId: null,
      arenaParticipantGenerationId: 'member-generation',
      arenaParticipantRole: 'member',
    });

    await expect(resolveBattleReportAccess('member-generation', 42)).resolves.toEqual({
      scope: 'arena-participant',
      isArenaParticipant: true,
      arenaParticipantRole: 'member',
    });
  });

  it('preserves the existing PVP participant path and denies unrelated users', async () => {
    mocks.getAccess.mockResolvedValue({
      generationId: 'pvp-generation',
      ownerUserId: 7,
      pvpMatchId: 'match-1',
      arenaParticipantGenerationId: null,
      arenaParticipantRole: null,
    });
    mocks.isUserInPvpMatch.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(resolveBattleReportAccess('pvp-generation', 42)).resolves.toEqual({
      scope: 'pvp-participant',
      isArenaParticipant: false,
      arenaParticipantRole: null,
    });
    await expect(resolveBattleReportAccess('pvp-generation', 42)).resolves.toBeNull();
  });
});
