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
};

export interface ArenaGenerationFinalizationPorts {
  storeOutput(_input: {
    generationId: string;
    actorKey: string;
    markdown: string;
    signal: AbortSignal;
  }): Promise<{ resultRef: string | null }>;
  claimTerminal(_input: ArenaTerminalClaimInput): Promise<ArenaTerminalClaimResult>;
  persistCombatants(_input: ArenaTerminalClaimInput): Promise<void>;
  applyStoryImpacts(_input: ArenaTerminalClaimInput): Promise<void>;
  settleRatings(_input: ArenaTerminalClaimInput): Promise<void>;
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
  let resultRef: string | null = null;
  if (input.status === 'completed') {
    const startedAt = performance.now();
    const bytes = new TextEncoder().encode(input.markdown).byteLength;
    try {
      resultRef = await ports.storeOutput({
        generationId: input.generationId,
        actorKey: input.actorKey,
        markdown: input.markdown,
        signal: input.signal,
      }).then((result) => result.resultRef);
      observe({
        event: 'storage',
        generationId: input.generationId,
        storage: 'r2',
        outcome: 'success',
        durationMs: performance.now() - startedAt,
        bytes,
      });
    } catch {
      resultRef = null;
      observe({
        event: 'storage',
        generationId: input.generationId,
        storage: 'r2',
        outcome: 'failure',
        durationMs: performance.now() - startedAt,
        bytes,
      });
    }
  }

  const claimInput: ArenaTerminalClaimInput = {
    generationId: input.generationId,
    generationRequestId: input.generationRequestId,
    actorKey: input.actorKey,
    payload: input.payload,
    metadata: input.metadata,
    markdown: input.markdown,
    telemetry: input.telemetry,
    status: input.status,
    errorCode: input.errorCode,
    resultRef,
  };
  const claim = await ports.claimTerminal(claimInput);
  resultRef = claim.resultRef;

  if (claim.kind === 'created') {
    await ports.persistCombatants({ ...claimInput, resultRef }).catch(() => undefined);
    if (input.status === 'completed') {
      await ports.applyStoryImpacts({ ...claimInput, resultRef }).catch(() => undefined);
      await ports.settleRatings({ ...claimInput, resultRef }).catch(() => undefined);
    }
  }

  const ranking = input.status === 'completed'
    ? await ports.readRanking({
      generationId: input.generationId,
      actorKey: input.actorKey,
    }).catch(() => null)
    : null;
  return { resultRef, ranking };
};
