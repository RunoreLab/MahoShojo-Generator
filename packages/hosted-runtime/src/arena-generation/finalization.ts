import type {
  ArenaGenerationFinalizationInput,
  ArenaGenerationFinalizationResult,
} from './runtime';
import type { ArenaGenerationObserver } from '@mahoshojo/hosted-api/arena-generation/service';

export type ArenaTerminalClaimInput = Omit<
  ArenaGenerationFinalizationInput,
  'signal'
> & {
  resultRef: string | null;
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
  if (input.status === 'completed') {
    const startedAt = performance.now();
    const bytes = new TextEncoder().encode(input.markdown).byteLength;
    let storageError: unknown = null;
    for (let attempt = 0; attempt < 3 && !resultRef; attempt += 1) {
      try {
        resultRef = await ports.storeOutput({
          generationId: input.generationId,
          actorKey: input.actorKey,
          markdown: input.markdown,
          signal: input.signal,
        }).then((result) => result.resultRef);
        if (!resultRef) throw new Error('ARENA_R2_RESULT_REF_MISSING');
      } catch (error) {
        storageError = error;
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
      const failedClaim: ArenaTerminalClaimInput = {
        generationId: input.generationId,
        generationRequestId: input.generationRequestId,
        actorKey: input.actorKey,
        payloadHash: input.payloadHash,
        payload: input.payload,
        metadata: input.metadata,
        markdown: '',
        telemetry: input.telemetry,
        status: 'failed',
        errorCode: 'ARENA_R2_STORAGE_FAILED',
        resultRef: null,
      };
      let failureRecorded = false;
      for (let attempt = 0; attempt < 3 && !failureRecorded; attempt += 1) {
        try {
          const claim = await ports.claimTerminal(failedClaim);
          if (!claim.finalized) {
            await ports.persistCombatants(effectInput(failedClaim, 'combatants'));
            await ports.completeTerminal(failedClaim);
          }
          failureRecorded = true;
        } catch {
          // Bounded retry uses the deterministic terminal claim as the idempotency gate.
        }
      }
      if (!failureRecorded) {
        await ports.failTerminal({
          ...failedClaim,
          failureCode: 'ARENA_R2_STORAGE_FAILED',
        }).catch(() => undefined);
      }
      throw storageError ?? new Error('ARENA_R2_STORAGE_FAILED');
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
  return { resultRef, ranking };
};
