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
  });
  const observeCall = async (
    operation: 'arena/generate' | 'generate-battle-story' | 'arena/session/generate-next',
    call: () => Promise<Response>,
  ): Promise<Response> => {
    const startedAt = Date.now();
    let outcome: 'success' | 'rejected' | 'failure' = 'failure';
    try {
      const response = await call();
      outcome = response.ok ? 'success' : response.status < 500 ? 'rejected' : 'failure';
      return response;
    } finally {
      try {
        input.observer?.observeArenaGeneration({
          event: 'companion',
          operation,
          placement: input.placement,
          outcome,
          durationMs: Math.max(0, Date.now() - startedAt),
        });
      } catch {
        // Telemetry transport failures must not affect companion execution.
      }
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
    ),
  });
};
