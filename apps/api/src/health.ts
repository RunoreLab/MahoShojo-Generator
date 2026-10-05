import type { Context, Hono } from 'hono';
import { probeD1Readiness } from '#/d1/runtime';
import type { HonoServerConfig } from '#/config';
import type { HonoAppVariables } from '#/middleware/request-metadata';
import type { RedisService } from '#/redis/runtime';
import type { HonoReadinessObservation, RuntimeTelemetryService } from '#/telemetry/runtime';
import { HOSTED_DR_CONTRACT_VERSION } from '@mahoshojo/hosted-api/hosted-dr';

const isD1Configured = (): boolean => {
  if (process.env.D1_GATEWAY_URL?.trim()) return true;
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
    && process.env.D1_DATABASE_ID?.trim()
    && process.env.CLOUDFLARE_API_TOKEN?.trim(),
  );
};

export const registerHealthRoutes = (
  app: Hono<{ Variables: HonoAppVariables }>,
  config: HonoServerConfig,
  redis: RedisService,
  telemetry: Pick<RuntimeTelemetryService, 'observeReadiness'> = {},
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
    const startedAt = performance.now();
    let redisConfigured = false;
    let d1Configured = false;
    let d1Transport: HonoReadinessObservation['d1Transport'] = 'none';
    let redisReady = false;
    let d1Ready = false;
    let ready = false;

    try {
      redisConfigured = redis.getStatus().configured;
      d1Configured = isD1Configured();
      d1Transport = process.env.D1_GATEWAY_URL?.trim()
        ? 'gateway'
        : d1Configured
          ? 'cloudflare-api'
          : 'none';

      [redisReady, d1Ready] = await Promise.all([
        redisConfigured ? redis.ping() : Promise.resolve(false),
        d1Configured ? probeD1Readiness() : Promise.resolve(false),
      ]);

      const redisSatisfied = config.redisRequired ? redisReady : true;
      const d1Satisfied = config.d1Required ? d1Ready : true;
      ready = redisSatisfied && d1Satisfied;
      context.header('Cache-Control', 'no-store');
      return context.json({
        ok: ready,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: HOSTED_DR_CONTRACT_VERSION,
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
            transport: d1Transport,
          },
        },
        timestamp: new Date().toISOString(),
      }, ready ? 200 : 503);
    } finally {
      try {
        telemetry.observeReadiness?.({
          outcome: ready ? 'ready' : 'not-ready',
          durationMs: Math.max(0, performance.now() - startedAt),
          redisReady,
          d1Ready,
          d1Transport,
        });
      } catch {
        // readiness telemetry 失败不得改变 health/readiness contract。
      }
    }
  };

  app.get('/health/ready', readyHandler);
  app.get('/api/health/ready', readyHandler);
};
