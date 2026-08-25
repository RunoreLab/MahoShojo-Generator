import {
  createArenaGenerationService,
  type ArenaGenerationActor,
  type ArenaGenerationExecutor,
  type ArenaGenerationObserver,
  type ArenaGenerationService,
  type ArenaGenerationTerminalStore,
  type GenerationReplayStore,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { createArenaGenerationActorResolver } from './actor';
import {
  createNodeArenaGenerationExecutor,
  type NodeArenaGenerationExecutorOptions,
} from './node-executor';
import { createEnvSignatureService } from '../node-runtime/env-signature';
import { silentLogger } from '../node-runtime/logger';
import type { NodeDataD1Client } from '../node-runtime/data-ports';
import type { SignatureService } from '../signature';

const sortCanonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    result[key] = sortCanonical((value as Record<string, unknown>)[key]);
  }
  return result;
};

export const canonicalizeArenaGenerationPayload = (
  payload: Record<string, unknown>,
): string => JSON.stringify(sortCanonical(payload));

export const hashArenaGenerationPayload = async (
  payload: Record<string, unknown>,
): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalizeArenaGenerationPayload(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export type NodeArenaGenerationServiceOptions = {
  store: GenerationReplayStore;
  terminalStore?: ArenaGenerationTerminalStore;
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  now?: () => Date;
  createGenerationId?: () => string;
  getD1Client(): NodeDataD1Client | null;
  signatures?: SignatureService;
  resolveActor?(_request: Request): Promise<ArenaGenerationActor | null>;
  executor?: ArenaGenerationExecutor;
  executorOptions?: Omit<
    NodeArenaGenerationExecutorOptions,
    'env' | 'fetch' | 'signatureService'
  >;
  heartbeatIntervalMs?: number;
  leaseDurationMs?: number;
  replayPollMs?: number;
  deltaFlushIntervalMs?: number;
  deltaFlushBytes?: number;
  observer?: ArenaGenerationObserver;
};

export const createNodeArenaGenerationService = (
  options: NodeArenaGenerationServiceOptions,
): ArenaGenerationService => {
  const env = options.env ?? process.env;
  const signatures = options.signatures ?? createEnvSignatureService({
    env,
    logger: options.executorOptions?.logger ?? silentLogger,
  });
  const resolveActor = options.resolveActor ?? createArenaGenerationActorResolver({
    env,
    fetch: options.fetch,
    signatures,
    getD1Client: options.getD1Client,
    now: options.now,
  });
  let executor = options.executor;
  if (!executor) {
    if (!options.executorOptions?.finalizer) {
      throw new Error('Arena generation finalizer 未配置');
    }
    executor = createNodeArenaGenerationExecutor({
      ...options.executorOptions,
      env,
      fetch: options.fetch,
      signatureService: signatures,
      observer: options.observer,
    });
  }
  return createArenaGenerationService({
    store: options.store,
    executor,
    resolveActor,
    createGenerationId: options.createGenerationId ?? (() => crypto.randomUUID()),
    hashPayload: hashArenaGenerationPayload,
    now: options.now ?? (() => new Date()),
    observer: options.observer,
    ...(options.terminalStore ? { terminalStore: options.terminalStore } : {}),
    ...(options.heartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: options.heartbeatIntervalMs }
      : {}),
    ...(options.leaseDurationMs !== undefined ? { leaseDurationMs: options.leaseDurationMs } : {}),
    ...(options.replayPollMs !== undefined ? { replayPollMs: options.replayPollMs } : {}),
    ...(options.deltaFlushIntervalMs !== undefined
      ? { deltaFlushIntervalMs: options.deltaFlushIntervalMs }
      : {}),
    ...(options.deltaFlushBytes !== undefined ? { deltaFlushBytes: options.deltaFlushBytes } : {}),
  });
};
