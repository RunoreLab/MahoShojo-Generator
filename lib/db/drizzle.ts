import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '@/lib/db/schema';

export type AppDrizzleDb = DrizzleD1Database<typeof schema>;

type DrizzleD1Client = Parameters<typeof drizzle>[0];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isD1LikeClient = (value: unknown): value is DrizzleD1Client => {
  if (!isObject(value)) return false;

  const prepare = value.prepare;
  const batch = value.batch;
  const exec = value.exec;

  return typeof prepare === 'function' && typeof batch === 'function' && typeof exec === 'function';
};

export const createDrizzleDb = (client: unknown): AppDrizzleDb => {
  if (!isD1LikeClient(client)) {
    throw new Error('Drizzle 初始化失败：未检测到可用的 D1 Client（缺少 prepare/batch/exec）');
  }

  return drizzle(client, { schema });
};

export const getDrizzleDbFromEnv = (env: { DB?: unknown }): AppDrizzleDb => {
  return createDrizzleDb(env.DB);
};
