import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  createDrizzleDb as createUncachedDrizzleDb,
  isD1LikeClient,
  type AppDrizzleDb,
  type DrizzleD1Client,
} from '@mahoshojo/hosted-runtime/db/drizzle';
import { createHttpD1ClientFromEnv } from '@/lib/db/d1-http-client';
import { parseHostedApiDeploymentTarget } from '@mahoshojo/hosted-api/hosted-dr';

export type { AppDrizzleDb } from '@mahoshojo/hosted-runtime/db/drizzle';

const dbCache = new WeakMap<object, AppDrizzleDb>();

const getCachedDb = (client: DrizzleD1Client): AppDrizzleDb => {
  const cacheKey = client as object;
  const cached = dbCache.get(cacheKey);
  if (cached) return cached;

  const db = createUncachedDrizzleDb(client);
  dbCache.set(cacheKey, db);
  return db;
};

export const createDrizzleDb = (client: unknown): AppDrizzleDb => {
  if (!isD1LikeClient(client)) {
    throw new Error('Drizzle 初始化失败：未检测到可用的 D1 Client（缺少 prepare/batch/exec）');
  }

  return getCachedDb(client);
};

export const getDrizzleDbFromEnv = (env: { DB?: unknown }): AppDrizzleDb => {
  return createDrizzleDb(env.DB);
};

const readD1FromCloudflareContext = (): DrizzleD1Client | null => {
  try {
    const { env } = getCloudflareContext();
    const candidate = (env as { DB?: unknown }).DB;
    if (!isD1LikeClient(candidate)) return null;
    return candidate;
  } catch {
    return null;
  }
};

const readD1FromGlobal = (): DrizzleD1Client | null => {
  const candidate = (globalThis as { __MAHOSHOJO_D1__?: unknown }).__MAHOSHOJO_D1__;
  if (!isD1LikeClient(candidate)) return null;
  return candidate;
};

const readD1FromHttpEnv = (): DrizzleD1Client | null => {
  try {
    const candidate = createHttpD1ClientFromEnv();
    if (!isD1LikeClient(candidate)) return null;
    return candidate;
  } catch {
    return null;
  }
};

export const getRuntimeD1Client = (): DrizzleD1Client | null => {
  return getRuntimeD1ClientWithOptions();
};

type RuntimeD1ClientOptions = {
  allowHttpFallback?: boolean;
};

const getRuntimeD1ClientWithOptions = (options: RuntimeD1ClientOptions = {}): DrizzleD1Client | null => {
  const boundClient = readD1FromCloudflareContext() ?? readD1FromGlobal();
  if (boundClient) return boundClient;
  const deploymentTarget = parseHostedApiDeploymentTarget(
    process.env.NEXT_PUBLIC_HOSTED_API_ENVIRONMENT,
  );
  const allowHttpFallback = options.allowHttpFallback
    ?? (deploymentTarget === 'local' || deploymentTarget === 'test');
  if (!allowHttpFallback) return null;
  return readD1FromHttpEnv();
};

export const getRuntimeD1ClientWithoutHttpFallback = (): DrizzleD1Client | null => {
  return getRuntimeD1ClientWithOptions({ allowHttpFallback: false });
};

export const getDrizzleDbFromRuntime = (): AppDrizzleDb | null => {
  const client = getRuntimeD1Client();
  if (!client) return null;
  return createDrizzleDb(client);
};
