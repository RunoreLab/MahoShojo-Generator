import 'server-only';
import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '@/lib/db/schema';
import { createHttpD1ClientFromEnv } from '@/lib/db/d1-http-client';

export type AppDrizzleDb = DrizzleD1Database<typeof schema>;

type DrizzleD1Client = Parameters<typeof drizzle>[0];
type CloudflareContextEnv = { DB?: unknown };

const dbCache = new WeakMap<object, AppDrizzleDb>();

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isD1LikeClient = (value: unknown): value is DrizzleD1Client => {
  if (!isObject(value)) return false;

  const prepare = value.prepare;
  const batch = value.batch;
  const exec = value.exec;

  return typeof prepare === 'function' && typeof batch === 'function' && typeof exec === 'function';
};

const getCachedDb = (client: DrizzleD1Client): AppDrizzleDb => {
  const cacheKey = client as object;
  const cached = dbCache.get(cacheKey);
  if (cached) return cached;

  const db = drizzle(client, { schema });
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
    const context = getOptionalRequestContext();
    const env = context?.env as CloudflareContextEnv | undefined;
    if (!env) return null;
    if (!isD1LikeClient(env.DB)) return null;
    return env.DB;
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
  if (options.allowHttpFallback === false) return null;
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
