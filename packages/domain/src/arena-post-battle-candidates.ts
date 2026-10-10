import { planDerivedCharacterAuthorityRemoval, stripDerivedCharacterAuthority } from './character-authority';
import {
  projectArenaPostBattleCharacters,
  planArenaPostBattleCharacters,
  type ArenaPostBattleCharacterProjection,
  type ArenaPostBattleProjectionInput,
} from './arena-post-battle';
import { assertBattleStoryCommitFrozenJson, prepareBattleStoryCommitJson, type PreparedBattleStoryCommitJson } from './arena-story-commit';
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
const projectUnsignedArenaPostBattleCandidatesWithCopies = (
  input: ArenaPostBattleCandidateInput,
  context: ArenaPostBattleCandidateContext,
  copies: Readonly<{
    characters: typeof planArenaPostBattleCharacters;
    authority: typeof planDerivedCharacterAuthorityRemoval;
    history: (entries: readonly NarrativeHistoryEntry[]) => NarrativeHistoryEntry[];
  }>,
): ArenaUnsignedPostBattleCandidates => {
  if (!context.scopeKey.trim() || !context.requestId.trim() || !context.generationId.trim()
    || context.generationId !== context.generationId.trim()
    || !Number.isFinite(Date.parse(context.occurredAt))) {
    throw new Error('Arena candidates require original scope, request, generation and fixed time');
  }
  const projected = copies.characters({
    ...input, generationId: context.generationId, occurredAt: context.occurredAt,
  }, {
    worldLineIds: context.worldLineIds,
    // Client projection cannot claim it verified the original card's server signature.
    nonNativeDataInvolved: true,
  });
  const characterEffects = projected.map(({ combatantIndex, data }) => ({
    combatantIndex,
    // Reuse the canonical, location-specific cleanup; nested/unknown user fields stay intact.
    data: copies.authority(data),
  }));
  const narrativeHistory = input.writeNarrativeHistory
    ? appendNarrativeHistoryEntry(
      copies.history(input.narrativeHistory.entries),
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

/** Preserve the existing editable, independent candidate-copy API. */
export const projectUnsignedArenaPostBattleCandidates = (
  input: ArenaPostBattleCandidateInput,
  context: ArenaPostBattleCandidateContext,
): ArenaUnsignedPostBattleCandidates => projectUnsignedArenaPostBattleCandidatesWithCopies(input, context, {
  characters: projectArenaPostBattleCharacters,
  authority: stripDerivedCharacterAuthority,
  history: (entries) => structuredClone([...entries]),
});

/**
 * Read-only copy-on-write plan of the exact same effects. No source objects are frozen or
 * changed here; callers must not edit referenced data. Large participants, guidance and
 * existing history are shared in memory, but each occurrence still counts in JSON bytes.
 */
export const planUnsignedArenaPostBattleCandidates = (
  input: ArenaPostBattleCandidateInput,
  context: ArenaPostBattleCandidateContext,
): ArenaUnsignedPostBattleCandidates => projectUnsignedArenaPostBattleCandidatesWithCopies(input, context, {
  characters: planArenaPostBattleCharacters,
  authority: planDerivedCharacterAuthorityRemoval,
  history: (entries) => [...entries],
});

/**
 * The host freezes its independently-owned generation snapshot explicitly, before calling
 * this API. Mutable inputs are rejected without freezing a page draft behind its back.
 * assemble runs once and must build the actual save payload from references, without deep
 * cloning. Only then is that entire payload frozen and counted. There is no default budget.
 * Native can stream the returned handle directly; optional materialization happens later.
 */
export const prepareUnsignedArenaPostBattleCandidates = <T>(
  input: ArenaPostBattleCandidateInput,
  context: ArenaPostBattleCandidateContext,
  options: Readonly<{
    maxBytes: number;
    assemble: (plan: ArenaUnsignedPostBattleCandidates) => T;
  }>,
): PreparedBattleStoryCommitJson<T> => {
  assertBattleStoryCommitFrozenJson(input);
  const plan = planUnsignedArenaPostBattleCandidates(input, context);
  return prepareBattleStoryCommitJson(options.assemble(plan), options.maxBytes);
};
