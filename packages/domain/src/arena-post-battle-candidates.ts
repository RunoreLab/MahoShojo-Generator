import { stripDerivedCharacterAuthority } from './character-authority';
import {
  projectArenaPostBattleCharacters,
  type ArenaPostBattleCharacterProjection,
  type ArenaPostBattleProjectionInput,
} from './arena-post-battle';
import type { NarrativeHistoryEntry } from './arena-types';
import { appendNarrativeHistoryEntry } from './narrative-history-operations';

export type ArenaPostBattleCandidateContext = Readonly<{
  /** Original host scope; never replace it with the scope active when saving. */
  scopeKey: string;
  requestId: string;
  generationId: string;
  /** Fixed by the host on completion. Replays must reuse this value, not read a clock. */
  occurredAt: string;
  /** Stable local identity only; neither a signature nor evidence of server authority. */
  worldLineIds: Readonly<Record<number, string>>;
}>;

export type ArenaPostBattleCandidateInput = Omit<ArenaPostBattleProjectionInput, 'generationId' | 'occurredAt'>
  & Readonly<{
    writeNarrativeHistory: boolean;
    /** Full report body is separate from the per-character impact/current-state summaries. */
    narrativeHistory: Readonly<{
      /** Raw entries from the intended history document, never namespaced picker projections. */
      entries: readonly NarrativeHistoryEntry[];
      title: string;
      content: string;
    }>;
  }>;

export type ArenaUnsignedPostBattleCandidates = Readonly<{
  scopeKey: string;
  requestId: string;
  generationId: string;
  occurredAt: string;
  /** Unsigned derived copies, never server updatedCombatants or in-place source edits. */
  characterEffects: readonly ArenaPostBattleCharacterProjection[];
  narrativeHistory: ReturnType<typeof appendNarrativeHistoryEntry> | null;
}>;

/**
 * Candidate construction only: no completion admission, clock, IO, signing or persistence.
 * The host calls this only after its existing completed/valid-output guard and original-scope
 * fence succeed, and checks that same scope again before any save. Partial, cancelled and failed
 * outcomes must never reach this helper. A candidate grants no authority or permission to save.
 * Keep the complete body here; a storage adapter must report its own document-envelope limit
 * instead of truncating this candidate or broadening the storage contract.
 */
export const projectUnsignedArenaPostBattleCandidates = (
  input: ArenaPostBattleCandidateInput,
  context: ArenaPostBattleCandidateContext,
): ArenaUnsignedPostBattleCandidates => {
  if (!context.scopeKey.trim() || !context.requestId.trim() || !context.generationId.trim()
    || context.generationId !== context.generationId.trim()
    || !Number.isFinite(Date.parse(context.occurredAt))) {
    throw new Error('Arena candidates require original scope, request, generation and fixed time');
  }
  const projected = projectArenaPostBattleCharacters({
    ...input, generationId: context.generationId, occurredAt: context.occurredAt,
  }, {
    worldLineIds: context.worldLineIds,
    // Client projection cannot claim it verified the original card's server signature.
    nonNativeDataInvolved: true,
  });
  const characterEffects = projected.map(({ combatantIndex, data }) => ({
    combatantIndex,
    // Reuse the canonical, location-specific cleanup; nested/unknown user fields stay intact.
    data: stripDerivedCharacterAuthority(data),
  }));
  const narrativeHistory = input.writeNarrativeHistory
    ? appendNarrativeHistoryEntry(
      structuredClone([...input.narrativeHistory.entries]),
      {
        title: input.narrativeHistory.title,
        content: input.narrativeHistory.content,
        generationId: context.generationId,
      },
      { fallbackId: context.generationId, createdAt: context.occurredAt },
    )
    : null;
  return Object.freeze({
    scopeKey: context.scopeKey,
    requestId: context.requestId,
    generationId: context.generationId,
    occurredAt: context.occurredAt,
    characterEffects,
    narrativeHistory,
  });
};
