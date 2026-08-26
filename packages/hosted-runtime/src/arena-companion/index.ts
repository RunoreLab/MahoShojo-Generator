import type { ArenaGenerationService } from '@mahoshojo/hosted-api/arena-generation/service';
import type { SignatureService } from '../signature';
import { createArenaPostBattleProjector } from './post-battle';
import { acquireArenaSessionSoftRateLimit } from './rate-limit';
import {
  createArenaCompanionService,
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
  return Object.freeze({
    generate: generation.generate,
    generateNext: session.generateNext,
  });
};
