import { createUnavailableGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/unavailable-replay-store';
import { isArenaGenerationDispatchReady } from '@mahoshojo/hosted-api/arena-generation/service';
import {
  ARENA_PVP_GENERATION_SIGNATURE_PURPOSE,
  createArenaGenerationActorResolvers,
  createArenaGenerationFinalizer,
  createArenaSeasonContextReader,
  createArenaR2ObjectStoreFromEnvironment,
  createNodeArenaGenerationFinalizationPorts,
  createNodeArenaGenerationService,
  createNodeArenaGenerationTerminalStore,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { createEnvSignatureService } from '@mahoshojo/hosted-runtime/node-runtime/env-signature';

import { readGenerationRankingForGeneration } from '@/app/api/arena/generation-ranking/handler';
import { settleArenaRatingsForGeneration } from '@/lib/database/arena-ratings';
import { cloudflareArenaGenerationObserver } from '@/app/api/arena/generation-telemetry';
import { getNextHostedD1Client } from '@/lib/hosted-dr/database-provider';

const globalKey = '__mahoshojoArenaGenerationDrRuntimeV3';

const buildRuntime = () => {
  const getD1Client = getNextHostedD1Client;
  const signatures = createEnvSignatureService();
  const pvpSignatures = createEnvSignatureService({
    purpose: ARENA_PVP_GENERATION_SIGNATURE_PURPOSE,
  });
  const actorResolvers = createArenaGenerationActorResolvers({
    signatures,
    pvpSignatures,
    getD1Client,
  });
  const objectStore = createArenaR2ObjectStoreFromEnvironment();
  const seasonContextBaseUrl = process.env.ARENA_SEASON_CONTEXT_URL?.trim()
    || process.env.BETTER_AUTH_URL?.trim()
    || process.env.NEXT_PUBLIC_SITE_URL?.trim()
    || 'http://127.0.0.1:3000';
  const readSeasonContext = createArenaSeasonContextReader({
    baseUrl: seasonContextBaseUrl,
    accessClientId: process.env.CF_ACCESS_CLIENT_ID,
    accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
  });
  const persistence = createNodeArenaGenerationFinalizationPorts({
    getD1Client,
    ...(objectStore ? { objectStore } : {}),
    settleRatings: settleArenaRatingsForGeneration,
    readRanking: readGenerationRankingForGeneration,
  });
  const service = createNodeArenaGenerationService({
    store: createUnavailableGenerationReplayStore(),
    terminalStore: createNodeArenaGenerationTerminalStore({
      getD1Client,
      ...(objectStore ? { objectStore } : {}),
      settleRatings: settleArenaRatingsForGeneration,
    }),
    getD1Client,
    signatures,
    pvpSignatures,
    resolveActor: actorResolvers.resolveActor,
    resolveCreateActor: actorResolvers.resolveCreateActor,
    observer: cloudflareArenaGenerationObserver,
    executorOptions: {
      finalizer: createArenaGenerationFinalizer(persistence, {
        observer: cloudflareArenaGenerationObserver,
      }),
      readSeasonContext,
      requireSeasonAuthority: true,
      readinessCheck: async () => {
        const signatureSecret = process.env.SIGNATURE_SECRET_KEY?.trim() ?? '';
        if (!isArenaGenerationDispatchReady({
          d1Available: Boolean(getD1Client()),
          signatureSecret,
          finalizationBridgeReady: true,
        })) {
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
  return Object.freeze({
    service,
    resolveActor: actorResolvers.resolveActor,
  });
};

type ArenaGenerationDrRuntime = ReturnType<typeof buildRuntime>;

type GlobalWithArenaGeneration = typeof globalThis & {
  [globalKey]?: ArenaGenerationDrRuntime;
};

const getRuntime = (): ArenaGenerationDrRuntime => {
  const scope = globalThis as GlobalWithArenaGeneration;
  scope[globalKey] ??= buildRuntime();
  return scope[globalKey];
};

export const getCloudflareDrArenaGenerationService = () => getRuntime().service;

export const resolveCloudflareDrArenaGenerationActor = (request: Request) => (
  getRuntime().resolveActor(request)
);
