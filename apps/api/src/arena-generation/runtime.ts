import {
  configureArenaGenerationService,
  createArenaFinalizationBridge,
  createArenaGenerationFinalizer,
  createArenaR2ObjectStoreFromEnvironment,
  createArenaSeasonContextReader,
  createNodeArenaGenerationFinalizationPorts,
  createNodeArenaGenerationService,
  createNodeArenaGenerationTerminalStore,
} from '@mahoshojo/hosted-runtime/arena-generation';
import type { ArenaGenerationObserver } from '@mahoshojo/hosted-api/arena-generation/service';
import { getDefaultNodeD1Client } from '@mahoshojo/hosted-runtime/node-runtime/d1-client';
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
  const getD1Client = () => getDefaultNodeD1Client();
  const readSeasonContext = createArenaSeasonContextReader({
    baseUrl: finalizationBaseUrl,
    accessClientId: process.env.CF_ACCESS_CLIENT_ID,
    accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
  });
  const objectStore = createArenaR2ObjectStoreFromEnvironment();
  const persistence = createNodeArenaGenerationFinalizationPorts({
    getD1Client,
    ...(objectStore ? { objectStore } : {}),
    settleRatings: options.settleRatings ?? bridge!.settleRatings,
    readRanking: options.readRanking ?? bridge!.readRanking,
  });
  const finalizer = createArenaGenerationFinalizer(persistence, {
    observer: options.observer,
  });
  const terminalStore = createNodeArenaGenerationTerminalStore({
    getD1Client,
    ...(objectStore ? { objectStore } : {}),
  });
  configureArenaGenerationService(createNodeArenaGenerationService({
    store: redis.getGenerationReplayStore(),
    terminalStore,
    getD1Client,
    observer: options.observer,
    executorOptions: { finalizer, readSeasonContext },
  }));
};
