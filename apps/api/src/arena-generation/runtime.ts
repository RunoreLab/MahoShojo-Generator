import {
  canonicalizeNodeArenaGenerationSemanticPayload,
  configureArenaGenerationService,
  createArenaFinalizationBridge,
  createArenaGenerationFinalizer,
  createArenaGenerationActorResolvers,
  createArenaR2ObjectStoreFromEnvironment,
  createArenaSeasonContextReader,
  createArenaInternalGuidanceAuthority,
  createArenaPvpGenerationAuthority,
  createNodeArenaGenerationFinalizationPorts,
  createNodeArenaRejectedTerminalRecorder,
  createNodeArenaGenerationService,
  createNodeArenaGenerationTerminalStore,
  readOwnedNodeArenaGenerationProvenance,
  deriveArenaGenerationId,
  ARENA_PVP_GENERATION_SIGNATURE_PURPOSE,
} from '@mahoshojo/hosted-runtime/arena-generation';
import {
  configureArenaCompanionRouteService,
  createArenaCompanionRouteService,
  createNodeArenaRepairMetaService,
} from '@mahoshojo/hosted-runtime/arena-companion';
import type { ArenaGenerationObserver } from '@mahoshojo/hosted-api/arena-generation/service';
import type { ArenaTerminalEffectInput } from '@mahoshojo/hosted-runtime/arena-generation';
import { recordUserActivityFromRequest } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';
import { createEnvSignatureService } from '@mahoshojo/hosted-runtime/node-runtime/env-signature';
import { getHonoPrimaryD1Client } from '#/d1/provider';
import type { RedisRuntime } from '#/redis/runtime';
import {
  createArenaRoomGenerationPort,
  type ArenaRoomGenerationPort,
} from './room-generation-port';

export type HonoArenaGenerationRuntimeOptions = {
  settleRatings?(_input: Pick<
    ArenaTerminalEffectInput,
    'generationId' | 'idempotencyKey'
  >): Promise<void>;
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
): ArenaRoomGenerationPort => {
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
  const pvpSignatures = createEnvSignatureService({
    purpose: ARENA_PVP_GENERATION_SIGNATURE_PURPOSE,
  });
  const actorResolvers = createArenaGenerationActorResolvers({
    signatures,
    pvpSignatures,
    getD1Client,
  });
  const generationService = createNodeArenaGenerationService({
    store: redis.getGenerationReplayStore(),
    terminalStore,
    rejectedTerminalRecorder: createNodeArenaRejectedTerminalRecorder({ getD1Client }),
    getD1Client,
    signatures,
    pvpSignatures,
    resolveActor: actorResolvers.resolveActor,
    resolveCreateActor: actorResolvers.resolveCreateActor,
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
  const repairMetaService = createNodeArenaRepairMetaService({
    resolveActor: actorResolvers.resolveActor,
    readProvenance: async (input) => {
      const client = getD1Client();
      if (!client) throw new Error('ARENA_D1_UNAVAILABLE');
      return readOwnedNodeArenaGenerationProvenance({ client, ...input });
    },
    verifySignature: (value) => signatures.verifySignature(value),
    recordActivity: recordUserActivityFromRequest,
  });
  configureArenaCompanionRouteService(createArenaCompanionRouteService({
    generationService,
    signatures,
    placement: 'hono-primary',
    observer: options.observer,
    recordActivity: recordUserActivityFromRequest,
    repairMetaService,
  }));
  return createArenaRoomGenerationPort({
    generationService,
    pvpAuthority: createArenaPvpGenerationAuthority(pvpSignatures),
    internalGuidanceAuthority: createArenaInternalGuidanceAuthority(signatures),
    deriveGenerationId: deriveArenaGenerationId,
    canonicalizeSemanticPayload: (input) => canonicalizeNodeArenaGenerationSemanticPayload({
      payload: input.payload,
      signatures,
      trustedInternalGuidance: input.trustedInternalGuidance,
      trustedPvpContext: input.trustedPvpContext,
    }),
  });
};
