import {
  configureArenaGenerationService,
  createArenaFinalizationBridge,
  createArenaGenerationFinalizer,
  createArenaR2ObjectStoreFromEnvironment,
  createArenaSeasonContextReader,
  createNodeArenaGenerationFinalizationPorts,
  createNodeArenaRejectedTerminalRecorder,
  createNodeArenaGenerationService,
  createNodeArenaGenerationTerminalStore,
} from '@mahoshojo/hosted-runtime/arena-generation';
import {
  configureArenaCompanionRouteService,
  createArenaCompanionRouteService,
} from '@mahoshojo/hosted-runtime/arena-companion';
import type { ArenaGenerationObserver } from '@mahoshojo/hosted-api/arena-generation/service';
import { recordUserActivityFromRequest } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';
import { createEnvSignatureService } from '@mahoshojo/hosted-runtime/node-runtime/env-signature';
import { getHonoPrimaryD1Client } from '#/d1/provider';
import type { RedisRuntime } from '#/redis/runtime';

export type HonoArenaGenerationRuntimeOptions = {
  settleRatings?(_generationId: string): Promise<void>;
  readRanking?(_generationId: string): Promise<unknown | null>;
  finalizationBaseUrl?: string;
  finalizationSecret?: string;
  observer?: ArenaGenerationObserver;
};

const DEVELOPMENT_FINALIZATION_URL = 'http://127.0.0.1:3000';
const DEVELOPMENT_FINALIZATION_SECRET = 'development-only-arena-finalization-secret';

export const configureHonoArenaGenerationRuntime = (
  redis: Pick<RedisRuntime, 'getGenerationReplayStore'>,
  options: HonoArenaGenerationRuntimeOptions = {},
): void => {
  const finalizationBaseUrl = options.finalizationBaseUrl?.trim()
    || process.env.ARENA_FINALIZATION_URL?.trim()
    || DEVELOPMENT_FINALIZATION_URL;
  const finalizationSecret = options.finalizationSecret?.trim()
    || process.env.ARENA_FINALIZATION_HMAC_SECRET?.trim()
    || DEVELOPMENT_FINALIZATION_SECRET;
  const bridge = options.settleRatings && options.readRanking
    ? null
    : createArenaFinalizationBridge({
      baseUrl: finalizationBaseUrl,
      secret: finalizationSecret,
      accessClientId: process.env.CF_ACCESS_CLIENT_ID,
      accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    });
  const getD1Client = getHonoPrimaryD1Client;
  const readSeasonContext = createArenaSeasonContextReader({
    baseUrl: finalizationBaseUrl,
    accessClientId: process.env.CF_ACCESS_CLIENT_ID,
    accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
  });
  const objectStore = createArenaR2ObjectStoreFromEnvironment();
  const settleRatings = options.settleRatings ?? bridge!.settleRatings;
  const persistence = createNodeArenaGenerationFinalizationPorts({
    getD1Client,
    ...(objectStore ? { objectStore } : {}),
    settleRatings,
    readRanking: options.readRanking ?? bridge!.readRanking,
  });
  const finalizer = createArenaGenerationFinalizer(persistence, {
    observer: options.observer,
  });
  const terminalStore = createNodeArenaGenerationTerminalStore({
    getD1Client,
    ...(objectStore ? { objectStore } : {}),
    settleRatings,
  });
  const signatures = createEnvSignatureService();
  const generationService = createNodeArenaGenerationService({
    store: redis.getGenerationReplayStore(),
    terminalStore,
    rejectedTerminalRecorder: createNodeArenaRejectedTerminalRecorder({ getD1Client }),
    getD1Client,
    signatures,
    observer: options.observer,
    executorOptions: {
      finalizer,
      readSeasonContext,
      requireSeasonAuthority: true,
      readinessCheck: async () => {
        const signatureSecret = process.env.SIGNATURE_SECRET_KEY?.trim() ?? '';
        const bridgeSecretReady = !bridge || finalizationSecret.length >= 32;
        if (!getD1Client() || !objectStore || signatureSecret.length < 32 || !bridgeSecretReady) {
          return new Response(JSON.stringify({
            code: 'ARENA_GENERATION_CAPABILITY_UNAVAILABLE',
            error: 'Arena generation durable capability unavailable',
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          });
        }
        return null;
      },
    },
  });
  configureArenaGenerationService(generationService);
  configureArenaCompanionRouteService(createArenaCompanionRouteService({
    generationService,
    signatures,
    placement: 'hono-primary',
    observer: options.observer,
    recordActivity: recordUserActivityFromRequest,
  }));
};
