import { describe, expect, test, vi } from 'vitest';

import {
  createHostedDrTelemetryLocalRateLimiter,
  enforceHostedDrTelemetryRateLimit,
  type HostedDrTelemetryRateLimitBindings,
} from '@/lib/hosted-dr/client-telemetry-rate-limit';

const createLimiter = (success: boolean) => ({
  limit: vi.fn(async (_input: { key: string }) => ({ success })),
});

describe('Hosted DR client telemetry rate limit', () => {
  test('Cloudflare binding 使用哈希后的来源键与固定 aggregate 键', async () => {
    const source = createLimiter(true);
    const aggregate = createLimiter(true);
    const bindings: HostedDrTelemetryRateLimitBindings = {
      HOSTED_DR_TELEMETRY_SOURCE_LIMITER: source,
      HOSTED_DR_TELEMETRY_AGGREGATE_LIMITER: aggregate,
    };

    const result = await enforceHostedDrTelemetryRateLimit({
      request: new Request('https://example.test/api/telemetry/hosted-dr', {
        headers: { 'cf-connecting-ip': '203.0.113.9' },
      }),
      bindings,
      localLimiter: () => true,
      now: 0,
    });

    expect(result).toEqual({
      allowed: true,
      limitedBy: null,
      mode: 'cloudflare-binding',
    });
    const sourceKey = source.limit.mock.calls[0]?.[0]?.key;
    expect(sourceKey).toMatch(/^source:[a-f0-9]{64}$/u);
    expect(sourceKey).not.toContain('203.0.113.9');
    expect(aggregate.limit).toHaveBeenCalledWith({ key: 'hosted-dr-client' });
  });

  test('source binding 超限时不继续调用 aggregate binding', async () => {
    const source = createLimiter(false);
    const aggregate = createLimiter(true);
    const result = await enforceHostedDrTelemetryRateLimit({
      request: new Request('https://example.test/api/telemetry/hosted-dr'),
      bindings: {
        HOSTED_DR_TELEMETRY_SOURCE_LIMITER: source,
        HOSTED_DR_TELEMETRY_AGGREGATE_LIMITER: aggregate,
      },
      localLimiter: () => true,
      now: 0,
    });

    expect(result).toMatchObject({
      allowed: false,
      limitedBy: 'source',
      mode: 'cloudflare-binding',
    });
    expect(aggregate.limit).not.toHaveBeenCalled();
  });

  test('binding 不可用时使用有界本地兜底，而不是伪装成全局限额', async () => {
    const localLimiter = createHostedDrTelemetryLocalRateLimiter();
    const request = new Request('https://example.test/api/telemetry/hosted-dr', {
      headers: { 'cf-connecting-ip': '198.51.100.7' },
    });

    for (let index = 0; index < 120; index += 1) {
      await expect(enforceHostedDrTelemetryRateLimit({
        request,
        bindings: null,
        localLimiter,
        now: 0,
      })).resolves.toMatchObject({
        allowed: true,
        mode: 'best-effort-local',
      });
    }

    await expect(enforceHostedDrTelemetryRateLimit({
      request,
      bindings: null,
      localLimiter,
      now: 0,
    })).resolves.toEqual({
      allowed: false,
      limitedBy: null,
      mode: 'best-effort-local',
    });
  });
});
