// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { appRouteHandler } from '@/app/api/telemetry/hosted-dr/handler';
import { observeHostedDrClientTelemetry } from '@/lib/hosted-dr/client-preflight-telemetry';

const selectionEvent = {
  schemaVersion: 1,
  phase: 'selection',
  contractVersion: 'g25e1-v1',
  routeFamily: '/api/generate-free',
  selectedPlacement: 'hono-primary',
  selectionReason: 'PRIMARY_READY',
  primaryProbeOutcome: 'ready',
  primaryProbeDurationBucket: '50-199ms',
  drProbeOutcome: 'not-run',
  drProbeDurationBucket: 'not-run',
} as const;

const postEvent = async (
  event: unknown,
  headers: Record<string, string> = {},
): Promise<Response> => appRouteHandler(new Request(
  'https://next.test/api/telemetry/hosted-dr',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(event),
  },
));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Hosted DR client telemetry intake', () => {
  it('失败类事件通过 keepalive fetch best-effort 上报，不携带业务凭据或 referrer', () => {
    const fetchMock = vi.fn<typeof fetch>(
      () => Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    observeHostedDrClientTelemetry({
      schemaVersion: 1,
      phase: 'dispatch-terminal',
      contractVersion: 'g25e1-v1',
      routeFamily: '/api/generate-free',
      selectedPlacement: 'hono-primary',
      terminalClass: 'not-dispatched',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/telemetry/hosted-dr');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      keepalive: true,
      referrerPolicy: 'no-referrer',
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/authorization|cookie|prompt|room|generation/iu);
  });

  it('接受低基数 selection event 并以 no-store 204 返回', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const response = await postEvent(selectionEvent, {
      'cf-connecting-ip': '198.51.100.10',
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]?.[0]).toContain('hosted.dr.client.telemetry');
  });

  it('unavailable selection 即使不含 probe failure 也始终 best-effort 上报', () => {
    const fetchMock = vi.fn<typeof fetch>(
      () => Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    observeHostedDrClientTelemetry({
      schemaVersion: 1,
      phase: 'selection',
      contractVersion: 'g25e1-v1',
      routeFamily: 'undeclared',
      selectedPlacement: 'unavailable',
      selectionReason: 'OPERATION_NOT_DECLARED',
      primaryProbeOutcome: 'not-run',
      primaryProbeDurationBucket: 'not-run',
      drProbeOutcome: 'not-run',
      drProbeDurationBucket: 'not-run',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('拒绝未知字段与敏感内容，不把无效事件写入日志', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const response = await postEvent({
      ...selectionEvent,
      prompt: 'prompt-canary',
      roomId: 'room-canary',
    }, {
      'cf-connecting-ip': '198.51.100.11',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'INVALID_TELEMETRY_EVENT',
    });
    expect(info).not.toHaveBeenCalled();
  });

  it('拒绝 selection reason 与 placement/probe 不一致的事件，同时兼容旧客户端形状', async () => {
    const impossible = await postEvent({
      ...selectionEvent,
      selectedPlacement: 'next-dr',
      selectionReason: 'PRIMARY_READY',
    }, {
      'cf-connecting-ip': '198.51.100.20',
    });
    expect(impossible.status).toBe(400);

    const legacyDrNotEligible = await postEvent({
      ...selectionEvent,
      selectedPlacement: 'unavailable',
      selectionReason: 'DR_NOT_ELIGIBLE',
      primaryProbeOutcome: 'not-ready',
      primaryProbeDurationBucket: '50-199ms',
    }, {
      'cf-connecting-ip': '198.51.100.21',
    });
    expect(legacyDrNotEligible.status).toBe(204);
  });

  it('限制 content type 与 body 大小', async () => {
    const invalidContentType = await postEvent(selectionEvent, {
      'Content-Type': 'text/plain',
      'cf-connecting-ip': '198.51.100.12',
    });
    expect(invalidContentType.status).toBe(415);

    const oversized = await appRouteHandler(new Request(
      'https://next.test/api/telemetry/hosted-dr',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(9 * 1024),
          'cf-connecting-ip': '198.51.100.13',
        },
        body: JSON.stringify(selectionEvent),
      },
    ));
    expect(oversized.status).toBe(413);

    const oversizedWithoutLength = await appRouteHandler(new Request(
      'https://next.test/api/telemetry/hosted-dr',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '198.51.100.15',
        },
        body: `{"padding":"${'x'.repeat(9 * 1024)}"}`,
      },
    ));
    expect(oversizedWithoutLength.status).toBe(413);
  });

  it('拒绝不兼容或过长的 contract version', async () => {
    const incompatible = await postEvent({
      ...selectionEvent,
      contractVersion: 'g25e1-v999',
    }, {
      'cf-connecting-ip': '198.51.100.16',
    });
    expect(incompatible.status).toBe(400);

    const oversizedVersion = await postEvent({
      ...selectionEvent,
      contractVersion: `g25e1-v${'1'.repeat(40)}`,
    }, {
      'cf-connecting-ip': '198.51.100.17',
    });
    expect(oversizedVersion.status).toBe(400);
  });

  it('按来源限速，超限只返回 429 不影响业务事件格式', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const headers = { 'cf-connecting-ip': '198.51.100.14' };

    for (let index = 0; index < 120; index += 1) {
      await expect(postEvent(selectionEvent, headers)).resolves.toMatchObject({ status: 204 });
    }
    const limited = await postEvent(selectionEvent, headers);

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });

  it('单一来源超限不会继续耗尽全局额度', async () => {
    vi.useFakeTimers({ now: Date.now() + 61_000 });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const sourceHeaders = { 'cf-connecting-ip': '198.51.100.18' };

    for (let index = 0; index < 120; index += 1) {
      await expect(postEvent(selectionEvent, sourceHeaders)).resolves.toMatchObject({ status: 204 });
    }
    for (let index = 0; index < 2_048; index += 1) {
      await expect(postEvent(selectionEvent, sourceHeaders)).resolves.toMatchObject({ status: 429 });
    }

    const otherSource = await postEvent(selectionEvent, {
      'cf-connecting-ip': '198.51.100.19',
    });
    expect(otherSource.status).toBe(204);
  });
});
