import {
  getBattleReportGenerationAccessByUserId,
  type BattleReportGenerationParticipantRole,
} from '@/lib/database/battle-report-generations';
import { isUserInPvpMatch } from '@/lib/database/pvp';

export type BattleReportAccessScope = 'owner' | 'arena-participant' | 'pvp-participant';

export type BattleReportAccessDecision = {
  scope: BattleReportAccessScope;
  isArenaParticipant: boolean;
  arenaParticipantRole: BattleReportGenerationParticipantRole;
};

/**
 * Resolves the narrow access scope for a generation without turning participant
 * membership into owner privileges. The participant relation is the only
 * durable source for Arena multiplayer history; PVP keeps its existing check.
 */
export const resolveBattleReportAccess = async (
  generationId: string,
  userId: number,
): Promise<BattleReportAccessDecision | null> => {
  const access = await getBattleReportGenerationAccessByUserId(generationId, userId);
  if (!access) return null;

  if (access.ownerUserId === userId) {
    return {
      scope: 'owner',
      isArenaParticipant: Boolean(access.arenaParticipantGenerationId),
      arenaParticipantRole: access.arenaParticipantGenerationId ? access.arenaParticipantRole : null,
    };
  }

  if (access.arenaParticipantGenerationId) {
    return {
      scope: 'arena-participant',
      isArenaParticipant: true,
      arenaParticipantRole: access.arenaParticipantRole,
    };
  }

  if (access.pvpMatchId && await isUserInPvpMatch(access.pvpMatchId, userId)) {
    return { scope: 'pvp-participant', isArenaParticipant: false, arenaParticipantRole: null };
  }

  return null;
};
