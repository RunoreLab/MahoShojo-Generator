import type { Context, Hono } from 'hono';
import { queryD1Payload } from '@/lib/database/core';
import type { HonoServerConfig } from '@/server/config';
import type { HonoAppVariables } from '@/server/middleware/request-metadata';
import type { RedisService } from '@/server/redis/runtime';

const isD1Configured = (): boolean => {
  if (process.env.D1_GATEWAY_URL?.trim()) return true;
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
    && process.env.D1_DATABASE_ID?.trim()
    && process.env.CLOUDFLARE_API_TOKEN?.trim(),
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSuccessfulD1ProbePayload = (payload: unknown): boolean => {
  if (!isRecord(payload) || payload.success !== true) return false;
  if (!Array.isArray(payload.result) || payload.result.length !== 1) return false;

  const statementResult = payload.result[0];
  if (!isRecord(statementResult) || statementResult.success !== true) return false;
  if (!Array.isArray(statementResult.results) || statementResult.results.length !== 1) return false;

  const row = statementResult.results[0];
  return isRecord(row) && row.ok === 1;
};

const probeD1 = async (): Promise<boolean> => {
  if (!isD1Configured()) return false;
  try {
    const payload = await queryD1Payload('SELECT 1 AS ok', [], { retry: 'safe-read' });
    return isSuccessfulD1ProbePayload(payload);
  } catch (error) {
    console.error('[hono][health] D1 探测失败', error);
    return false;
  }
};

export const registerHealthRoutes = (
  app: Hono<{ Variables: HonoAppVariables }>,
  config: HonoServerConfig,
  redis: RedisService,
): void => {
  const liveHandler = (path: string) => app.get(path, (context) => context.json({
    ok: true,
    service: 'mahoshojo-hono',
    runtime: 'node',
    timestamp: new Date().toISOString(),
  }));

  liveHandler('/health/live');
  liveHandler('/api/health/live');

  const readyHandler = async (context: Context<{ Variables: HonoAppVariables }>) => {
    const redisConfigured = redis.getStatus().configured;
    const d1Configured = isD1Configured();
    const [redisReady, d1Ready] = await Promise.all([
      redisConfigured ? redis.ping() : Promise.resolve(false),
      d1Configured ? probeD1() : Promise.resolve(false),
    ]);

    const redisSatisfied = config.redisRequired ? redisReady : true;
    const d1Satisfied = config.d1Required ? d1Ready : true;
    const ready = redisSatisfied && d1Satisfied;
    return context.json({
      ok: ready,
      service: 'mahoshojo-hono',
      dependencies: {
        redis: {
          configured: redisConfigured,
          required: config.redisRequired,
          ready: redisReady,
        },
        d1: {
          configured: d1Configured,
          required: config.d1Required,
          ready: d1Ready,
          transport: process.env.D1_GATEWAY_URL?.trim() ? 'gateway' : d1Configured ? 'cloudflare-api' : 'none',
        },
      },
      timestamp: new Date().toISOString(),
    }, ready ? 200 : 503);
  };

  app.get('/health/ready', readyHandler);
  app.get('/api/health/ready', readyHandler);
};
