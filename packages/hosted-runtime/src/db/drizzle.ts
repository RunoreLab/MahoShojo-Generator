import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type AppDrizzleDb = DrizzleD1Database<typeof schema>;
export type DrizzleD1Client = Parameters<typeof drizzle>[0];

export const isD1LikeClient = (value: unknown): value is DrizzleD1Client => {
  if (typeof value !== 'object' || value === null) return false;
  const client = value as Record<string, unknown>;
  return typeof client.prepare === 'function'
    && typeof client.batch === 'function'
    && typeof client.exec === 'function';
};

/** 构建仅绑定所传 client 的实例；环境选择和缓存由调用方负责。 */
export const createDrizzleDb = (client: unknown): AppDrizzleDb => {
  if (!isD1LikeClient(client)) {
    throw new Error('Drizzle 初始化失败：未检测到可用的 D1 Client（缺少 prepare/batch/exec）');
  }
  return drizzle(client, { schema });
};
