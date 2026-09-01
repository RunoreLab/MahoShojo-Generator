import type {
  ArenaGenerationFinalizationInput,
  ArenaGenerationFinalizationResult,
} from './runtime';
import type { ArenaGenerationObserver } from '@mahoshojo/hosted-api/arena-generation/service';
import { ARENA_OUTPUT_NOT_ARCHIVED_WARNING } from '@mahoshojo/hosted-api/arena-generation/service';

export type ArenaTerminalClaimInput = Omit<
  ArenaGenerationFinalizationInput,
  'signal'
> & {
  resultRef: string | null;
  persistenceWarning?: typeof ARENA_OUTPUT_NOT_ARCHIVED_WARNING;
};

export type ArenaTerminalClaimResult = {
  kind: 'created' | 'existing';
  resultRef: string | null;
  finalized: boolean;
};

export type ArenaTerminalEffect = 'combatants' | 'story-impacts' | 'ratings';

export type ArenaTerminalEffectInput = ArenaTerminalClaimInput & {
  /**
   * Stable per-generation effect identity. Implementations MUST use it (or a
   * deterministic identity derived from it) for idempotent writes because a
   * transport timeout can cause the finalizer to call an effect again.
   */
  idempotencyKey: string;
};

export const buildArenaTerminalEffectIdempotencyKey = (
  generationId: string,
  effect: ArenaTerminalEffect,
): string => `arena-terminal:${generationId}:${effect}`;

export interface ArenaGenerationFinalizationPorts {
  storeOutput(_input: {
    generationId: string;
    actorKey: string;
    markdown: string;
    contentType: 'text/markdown; charset=utf-8' | 'application/json; charset=utf-8';
    signal: AbortSignal;
  }): Promise<{ resultRef: string | null }>;
  claimTerminal(_input: ArenaTerminalClaimInput): Promise<ArenaTerminalClaimResult>;
  completeTerminal(_input: ArenaTerminalClaimInput): Promise<void>;
  failTerminal(_input: ArenaTerminalClaimInput & { failureCode: string }): Promise<void>;
  persistCombatants(_input: ArenaTerminalEffectInput): Promise<void>;
  applyStoryImpacts(_input: ArenaTerminalEffectInput): Promise<void>;
  settleRatings(_input: ArenaTerminalEffectInput): Promise<void>;
  readRanking(_input: {
    generationId: string;
    actorKey: string;
  }): Promise<unknown | null>;
}

export const createArenaGenerationFinalizer = (
  ports: ArenaGenerationFinalizationPorts,
  options: { observer?: ArenaGenerationObserver } = {},
) => async (
  input: ArenaGenerationFinalizationInput,
): Promise<ArenaGenerationFinalizationResult> => {
  const observe = (observation: Parameters<
    NonNullable<typeof options.observer>['observeArenaGeneration']
  >[0]): void => {
    try {
      options.observer?.observeArenaGeneration(observation);
    } catch {
      // Telemetry is fail-soft and cannot change finalization behavior.
    }
  };
  const effectInput = (
    claim: ArenaTerminalClaimInput,
    effect: ArenaTerminalEffect,
  ): ArenaTerminalEffectInput => ({
    ...claim,
    idempotencyKey: buildArenaTerminalEffectIdempotencyKey(claim.generationId, effect),
  });
  let resultRef: string | null = null;
  let persistenceWarning: typeof ARENA_OUTPUT_NOT_ARCHIVED_WARNING | undefined;
  if (input.status === 'completed') {
    const startedAt = performance.now();
    const bytes = new TextEncoder().encode(input.markdown).byteLength;
    for (let attempt = 0; attempt < 3 && !resultRef; attempt += 1) {
      try {
        resultRef = await ports.storeOutput({
          generationId: input.generationId,
          actorKey: input.actorKey,
          markdown: input.markdown,
          contentType: input.metadata.outputContract === 'structured-report'
            ? 'application/json; charset=utf-8'
            : 'text/markdown; charset=utf-8',
          signal: input.signal,
        }).then((result) => result.resultRef);
        if (!resultRef) throw new Error('ARENA_R2_RESULT_REF_MISSING');
      } catch {
        resultRef = null;
      }
    }
    if (resultRef) {
      observe({
        event: 'storage',
        generationId: input.generationId,
        storage: 'r2',
        outcome: 'success',
        durationMs: performance.now() - startedAt,
        bytes,
      });
    } else {
      observe({
        event: 'storage',
        generationId: input.generationId,
        storage: 'r2',
        outcome: 'failure',
        durationMs: performance.now() - startedAt,
        bytes,
      });
      persistenceWarning = ARENA_OUTPUT_NOT_ARCHIVED_WARNING;
    }
  }

  const claimInput: ArenaTerminalClaimInput = {
    generationId: input.generationId,
    generationRequestId: input.generationRequestId,
    actorKey: input.actorKey,
    payloadHash: input.payloadHash,
    payload: input.payload,
    metadata: input.metadata,
    markdown: input.markdown,
    telemetry: input.telemetry,
    status: input.status,
    errorCode: input.errorCode,
    resultRef,
    ...(persistenceWarning ? { persistenceWarning } : {}),
  };
  let finalized = false;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3 && !finalized; attempt += 1) {
    try {
      const claim = await ports.claimTerminal({ ...claimInput, resultRef });
      resultRef = claim.resultRef;
      if (!claim.finalized) {
        const effectClaim = { ...claimInput, resultRef };
        await ports.persistCombatants(effectInput(effectClaim, 'combatants'));
        if (input.status === 'completed') {
          await ports.applyStoryImpacts(effectInput(effectClaim, 'story-impacts'));
          await ports.settleRatings(effectInput(effectClaim, 'ratings'));
        }
        await ports.completeTerminal(effectClaim);
      }
      finalized = true;
    } catch (error) {
      lastError = error;
    }
  }
  if (!finalized) {
    throw lastError ?? new Error('ARENA_TERMINAL_FINALIZATION_FAILED');
  }

  const ranking = input.status === 'completed'
    ? await ports.readRanking({
      generationId: input.generationId,
      actorKey: input.actorKey,
    }).catch(() => null)
    : null;
  return {
    resultRef,
    ranking,
    ...(persistenceWarning ? { persistenceWarning } : {}),
  };
};
