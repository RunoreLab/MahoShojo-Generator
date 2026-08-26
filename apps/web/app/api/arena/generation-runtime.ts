import { createUnavailableGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/unavailable-replay-store';
import {
  createArenaGenerationFinalizer,
  createArenaSeasonContextReader,
  createArenaR2ObjectStoreFromEnvironment,
  createNodeArenaGenerationFinalizationPorts,
  createNodeArenaGenerationService,
  createNodeArenaGenerationTerminalStore,
} from '@mahoshojo/hosted-runtime/arena-generation';

import { readGenerationRankingForGeneration } from '@/app/api/arena/generation-ranking/handler';
import { settleArenaRatingsForGeneration } from '@/lib/database/arena-ratings';
import { cloudflareArenaGenerationObserver } from '@/app/api/arena/generation-telemetry';
import { getNextHostedD1Client } from '@/lib/hosted-dr/database-provider';

const globalKey = '__mahoshojoArenaGenerationDrServiceV2';

type GlobalWithArenaGeneration = typeof globalThis & {
  [globalKey]?: ReturnType<typeof createNodeArenaGenerationService>;
};

const buildService = (): ReturnType<typeof createNodeArenaGenerationService> => {
  const getD1Client = getNextHostedD1Client;
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
  return createNodeArenaGenerationService({
    store: createUnavailableGenerationReplayStore(),
    terminalStore: createNodeArenaGenerationTerminalStore({
      getD1Client,
      ...(objectStore ? { objectStore } : {}),
      settleRatings: settleArenaRatingsForGeneration,
    }),
    getD1Client,
    observer: cloudflareArenaGenerationObserver,
    executorOptions: {
      finalizer: createArenaGenerationFinalizer(persistence, {
        observer: cloudflareArenaGenerationObserver,
      }),
      readSeasonContext,
      requireSeasonAuthority: true,
      readinessCheck: async () => {
        const signatureSecret = process.env.SIGNATURE_SECRET_KEY?.trim() ?? '';
        if (!getD1Client() || !objectStore || signatureSecret.length < 32) {
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
};

export const getCloudflareDrArenaGenerationService = () => {
  const scope = globalThis as GlobalWithArenaGeneration;
  scope[globalKey] ??= buildService();
  return scope[globalKey];
};
