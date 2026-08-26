import type {
  ArenaGenerationObserver,
  ArenaGenerationService,
} from '@mahoshojo/hosted-api/arena-generation/service';
import type { SignatureService } from '../signature';
import { createArenaPostBattleProjector } from './post-battle';
import { acquireArenaSessionSoftRateLimit } from './rate-limit';
import {
  createArenaCompanionService,
  type ArenaCompanionOperation,
  type ArenaCompanionService,
} from './service';
import {
  createArenaSessionCompanionService,
  type ArenaSessionCompanionService,
} from './session';

export * from './post-battle';
export * from './rate-limit';
export * from './service';
export * from './service-registry';
export * from './session';

export type ArenaCompanionRouteService = ArenaCompanionService & ArenaSessionCompanionService;

export const createArenaCompanionRouteService = (input: {
  generationService: ArenaGenerationService;
  signatures: SignatureService;
  placement: 'hono-primary' | 'next-dr';
  observer?: ArenaGenerationObserver;
  now?(): Date;
  recordActivity?(_request: Request): void;
}): ArenaCompanionRouteService => {
  const observe = (
    operation: 'arena/generate' | 'generate-battle-story' | 'arena/session/generate-next',
    outcome: 'success' | 'rejected' | 'failure' | 'cancelled',
    durationMs: number,
  ): void => {
    try {
      input.observer?.observeArenaGeneration({
        event: 'companion',
        operation,
        placement: input.placement,
        outcome,
        durationMs,
      });
    } catch {
      // Telemetry transport failures must not affect companion execution.
    }
  };
  const generation = createArenaCompanionService({
    generationService: input.generationService,
    projectUpdatedCombatants: createArenaPostBattleProjector({
      signatures: input.signatures,
      now: input.now,
    }),
  });
  const session = createArenaSessionCompanionService({
    generationService: input.generationService,
    signatures: input.signatures,
    acquireRateLimit: ({ request, ...rateInput }) => acquireArenaSessionSoftRateLimit({
      req: request,
      ...rateInput,
    }),
    now: input.now,
    recordActivity: input.recordActivity,
    observeLifecycle: ({ outcome, durationMs }) => observe(
      'arena/session/generate-next',
      outcome,
      durationMs,
    ),
  });
  const observeCall = async (
    operation: 'arena/generate' | 'generate-battle-story' | 'arena/session/generate-next',
    call: () => Promise<Response>,
    deferSuccessfulStream = false,
  ): Promise<Response> => {
    const startedAt = Date.now();
    try {
      const response = await call();
      if (!deferSuccessfulStream || !response.ok || !response.body) {
        const outcome = response.ok ? 'success' : response.status < 500 ? 'rejected' : 'failure';
        observe(operation, outcome, Math.max(0, Date.now() - startedAt));
      }
      return response;
    } catch (error) {
      observe(operation, 'failure', Math.max(0, Date.now() - startedAt));
      throw error;
    }
  };
  return Object.freeze({
    generate: (request: Request, operation?: ArenaCompanionOperation) => {
      const resolvedOperation: ArenaCompanionOperation = operation
        ?? (new URL(request.url).pathname.endsWith('/generate-battle-story')
          ? 'generate-battle-story'
          : 'arena/generate');
      return observeCall(
        resolvedOperation,
        () => generation.generate(request, resolvedOperation),
      );
    },
    generateNext: (request: Request) => observeCall(
      'arena/session/generate-next',
      () => session.generateNext(request),
      true,
    ),
  });
};
