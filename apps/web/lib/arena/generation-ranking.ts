export type GenerationRankingQueue = 'strict' | 'free';

export type GenerationRankingQueueResult = {
  eligible: boolean;
  ineligibleReasons: string[];
  eventStatus: 'missing' | 'pending' | 'applied' | 'skipped' | 'failed';
  skipReason: string | null;
  rating: number | null;
  games: number | null;
  tier: string | null;
  delta: number | null;
  rank: number | null;
  total: number | null;
  rankDelta: number | null;
};

export type GenerationRankingParticipant = {
  displayName: string;
  entityType: 'data_card' | 'preset' | 'unknown';
  entityId: string | null;
  entityKey: string | null;
  dataCardId: string | null;
  presetId: string | null;
  techScore: number | null;
  techLevel: string | null;
  queues: Record<GenerationRankingQueue, GenerationRankingQueueResult>;
};

export type PublicGenerationRankingSnapshot = {
  status: string | null;
  combatantCount: number | null;
};

export type GenerationRankingResponse =
  | {
      success: true;
      generationId: string;
      state: 'pending';
      message: string;
    }
  | {
      success: true;
      generationId: string;
      state: 'ready';
      snapshot: PublicGenerationRankingSnapshot;
      participants: GenerationRankingParticipant[];
    }
  | {
      success: false;
      generationId: string;
      error: string;
    };

type InternalSnapshotShape = {
  status?: unknown;
  combatantCount?: unknown;
};

export const buildPublicGenerationRankingSnapshot = <T extends InternalSnapshotShape>(
  snapshot: T,
): PublicGenerationRankingSnapshot => ({
  status: typeof snapshot.status === 'string' ? snapshot.status : null,
  combatantCount:
    typeof snapshot.combatantCount === 'number' && Number.isFinite(snapshot.combatantCount)
      ? snapshot.combatantCount
      : null,
});

type GenerationRankingCacheState =
  | {
      success: true;
      state: 'pending' | 'ready';
      participants?: Array<{
        queues: Record<GenerationRankingQueue, { eventStatus: GenerationRankingQueueResult['eventStatus'] }>;
      }>;
    }
  | { success: false };

export const getGenerationRankingCacheControl = (
  response: GenerationRankingCacheState,
): string => {
  if (!response.success) return 'public, max-age=0, s-maxage=60';
  if (response.state === 'pending') return 'no-store';
  const hasFailedOrSkipped = response.participants?.some((participant) =>
    Object.values(participant.queues).some(
      (queue) => queue.eventStatus === 'failed' || queue.eventStatus === 'skipped',
    ),
  );
  if (hasFailedOrSkipped) return 'public, max-age=0, s-maxage=60';
  return 'public, max-age=0, s-maxage=3600';
};
