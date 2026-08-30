import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  authStorage: {
    getAuthHeader: vi.fn(async () => 'Bearer auth-key'),
    getActivityHeaders: vi.fn(async () => ({
      'x-mahoshojo-activity-token': 'activity-token',
      'x-mahoshojo-user-id': '7',
    })),
  },
}));

import {
  createPinnedGenerationApiSafeReadDispatcher,
  createGenerationApiIntent,
  isGenerationApiClientErrorCode,
  isGenerationApiRoutePin,
  isHonoApiPath,
  resolveGenerationApiUrl,
} from '@/lib/hono-api-client';
import { honoApiConfig, resolveHostedApiConfig } from '@/config/hono-api';
import hostedDrManifest from '../../../config/hosted-dr-capabilities.json';
import honoApiRoutes from '../../../config/hono-api-routes.json';
import { readTextAndReasoningStreamFromResponse } from '@/lib/stream/read-text-and-reasoning-stream';

const originalEnabled = honoApiConfig.enabled;
const originalOrigin = honoApiConfig.origin;
const originalRoutingMode = honoApiConfig.routingMode;

afterEach(() => {
  honoApiConfig.enabled = originalEnabled;
  honoApiConfig.origin = originalOrigin;
  honoApiConfig.routingMode = originalRoutingMode;
  vi.unstubAllGlobals();
});

describe('Hono API 客户端', () => {
  test('intent 在业务 POST settle 前同步通知已选 route pin', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    let resolveBusinessPost: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveBusinessPost = resolve;
      }));
    const observer = vi.fn(() => {
      throw new Error('observer failure must not change dispatch');
    });
    const intent = createGenerationApiIntent({ fetcher: fetchMock });
    intent.subscribeRoutePinSelected(observer);

    const dispatched = intent.dispatch('/api/arena/generate-stream', { method: 'POST' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(observer).toHaveBeenCalledOnce();
    expect(observer).toHaveBeenCalledWith({ placement: 'hono-primary' });
    resolveBusinessPost!(new Response(null, { status: 204 }));
    await expect(dispatched).resolves.toMatchObject({ status: 204 });
  });

  test('primary intent 在 ambiguous 后保留 pin，pinned safe-read 不再 probe', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockRejectedValueOnce(new TypeError('create transport lost'))
      .mockResolvedValueOnce(Response.json({ status: 'running' }))
      .mockResolvedValueOnce(new Response(
        'event: done\ndata: {"status":"completed"}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ));
    const intent = createGenerationApiIntent({ fetcher: fetchMock });

    expect(intent.getRoutePin()).toBeNull();
    await expect(intent.dispatch('/api/arena/generate-stream', { method: 'POST' }))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_OPERATION_OUTCOME' });
    expect(intent.getRoutePin()).toEqual({ placement: 'hono-primary' });

    const pinned = createPinnedGenerationApiSafeReadDispatcher(
      intent.getRoutePin()!,
      { fetcher: fetchMock },
    );
    await (await pinned.dispatch(
      '/api/arena/generation-requests/request-1234',
      { method: 'GET' },
    )).json();
    await (await pinned.dispatch(
      '/api/arena/generations/generation-1234/stream',
      { method: 'GET' },
    )).text();

    expect(fetchMock.mock.calls.map(([target]) => target)).toEqual([
      `${hostedDrManifest.controlPlane.primaryOrigin}/api/health/ready`,
      `${hostedDrManifest.controlPlane.primaryOrigin}/api/arena/generate-stream`,
      `${hostedDrManifest.controlPlane.primaryOrigin}/api/arena/generation-requests/request-1234`,
      `${hostedDrManifest.controlPlane.primaryOrigin}/api/arena/generations/generation-1234/stream`,
    ]);
  });

  test('next-dr pinned safe-read 保持同源 auth 与 credentials', async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: 'running' }));
    const pinned = createPinnedGenerationApiSafeReadDispatcher(
      { placement: 'next-dr' },
      { fetcher: fetchMock },
    );

    await (await pinned.dispatch(
      '/api/arena/generation-requests/request-1234',
      { method: 'GET' },
    )).json();
    await (await pinned.dispatch(
      '/api/arena/generation-requests/request-5678',
      { method: 'GET', credentials: 'omit' },
    )).json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [target, init] = fetchMock.mock.calls[0]!;
    expect(target).toBe('/api/arena/generation-requests/request-1234');
    expect(init?.credentials).toBe('same-origin');
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer auth-key');
    expect(headers.get('x-mahoshojo-activity-token')).toBe('activity-token');
    expect(headers.get('x-mahoshojo-user-id')).toBe('7');
    expect(fetchMock.mock.calls[1]?.[1]?.credentials).toBe('omit');
  });

  test('route pin shape 严格且 dispatcher 不受调用方后续 mutation 影响', async () => {
    expect(isGenerationApiRoutePin({
      placement: 'hono-primary',
      origin: 'https://attacker.example.test',
    })).toBe(false);

    const mutablePin: { placement: 'hono-primary' | 'next-dr' } = {
      placement: 'hono-primary',
    };
    const fetchMock = vi.fn(async () => Response.json({ status: 'running' }));
    const pinned = createPinnedGenerationApiSafeReadDispatcher(mutablePin, {
      fetcher: fetchMock,
    });
    mutablePin.placement = 'next-dr';

    await pinned.dispatch('/api/arena/generation-requests/request-1234', {
      method: 'GET',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${hostedDrManifest.controlPlane.primaryOrigin}/api/arena/generation-requests/request-1234`,
    );
  });

  test('pinned dispatcher 拒绝写操作与未声明 route', async () => {
    const fetchMock = vi.fn();
    const pinned = createPinnedGenerationApiSafeReadDispatcher(
      { placement: 'hono-primary' },
      { fetcher: fetchMock },
    );

    await expect(pinned.dispatch('/api/arena/generations/generation-1234/cancel', {
      method: 'POST',
    })).rejects.toThrow('PINNED_GENERATION_SAFE_READ_NOT_ALLOWED');
    await expect(pinned.dispatch('/api/not-declared', { method: 'GET' }))
      .rejects.toThrow('PINNED_GENERATION_SAFE_READ_NOT_ALLOWED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('跨 realm 仍可按结构化 code 识别 GenerationApiClientError', () => {
    const crossRealmError = {
      name: 'GenerationApiClientError',
      code: 'AMBIGUOUS_OPERATION_OUTCOME',
      message: 'request outcome is ambiguous',
    };

    expect(isGenerationApiClientErrorCode(
      crossRealmError,
      'AMBIGUOUS_OPERATION_OUTCOME',
    )).toBe(true);
    expect(isGenerationApiClientErrorCode(crossRealmError, 'DR_NOT_ELIGIBLE')).toBe(false);
    expect(isGenerationApiClientErrorCode(
      new TypeError('auth storage unavailable'),
      'AMBIGUOUS_OPERATION_OUTCOME',
    )).toBe(false);
  });

  test('客户端配置只消费 generated 最小投影，并包含 preflight 所需公开 origin/policy', () => {
    const source = readFileSync(path.join(process.cwd(), 'config/hono-api.ts'), 'utf8');
    const generatedSource = readFileSync(
      path.join(process.cwd(), 'config/hosted-dr-client.generated.ts'),
      'utf8',
    );

    expect(honoApiConfig.origin).toBe(hostedDrManifest.controlPlane.stableOrigin);
    expect(honoApiConfig.enabled).toBe(false);
    expect(source).toContain('hosted-dr-client.generated');
    expect(source).toContain('NEXT_PUBLIC_HONO_API_ORIGIN');
    expect(source).not.toContain('hosted-dr-capabilities.json');
    expect(generatedSource).toContain(hostedDrManifest.controlPlane.stableOrigin);
    expect(generatedSource).toContain(hostedDrManifest.controlPlane.previewOrigin);
    expect(generatedSource).toContain('hostedDrControlPlaneProvisioning');
    expect(generatedSource).toContain('hostedDrProductionFallbackReadiness');
    expect(generatedSource).toContain('hostedDrClientRouting');
    expect(generatedSource).toContain('hostedDrClientOperations');
    for (const publicOrigin of [
      hostedDrManifest.controlPlane.primaryOrigin,
      hostedDrManifest.controlPlane.drOrigin,
    ]) {
      expect(generatedSource).toContain(publicOrigin);
    }
    expect(source).not.toContain('hosted-dr-capabilities.json');
    expect(generatedSource).not.toContain('SIGNATURE_SECRET_KEY');
    expect(generatedSource).not.toContain('R2_SECRET_ACCESS_KEY');
    expect(generatedSource).not.toContain('R2_OBJECT_STORE');
  });

  test('显式 deployment target 与 activation state 共同决定 Hosted placement', () => {
    expect(resolveHostedApiConfig(undefined, undefined)).toEqual({
      enabled: false,
      origin: hostedDrManifest.controlPlane.stableOrigin,
      routingMode: 'static-next',
      target: 'local',
    });
    expect(resolveHostedApiConfig(undefined, 'production')).toEqual({
      enabled: true,
      origin: hostedDrManifest.controlPlane.primaryOrigin,
      routingMode: 'client-preflight',
      target: 'production',
    });
    expect(resolveHostedApiConfig(undefined, 'production', {
      defaultMode: 'managed-control-plane',
      managedControlPlane: 'optional-disabled',
      controlPlaneProvisioning: 'not-provisioned',
      productionFallbackReadiness: 'verified',
    })).toEqual({
      enabled: false,
      origin: hostedDrManifest.controlPlane.stableOrigin,
      routingMode: 'static-next',
      target: 'production',
    });
    expect(resolveHostedApiConfig(undefined, 'production', {
      defaultMode: 'managed-control-plane',
      managedControlPlane: 'production',
      controlPlaneProvisioning: 'production',
      productionFallbackReadiness: 'deferred',
    })).toEqual({
      enabled: true,
      origin: hostedDrManifest.controlPlane.stableOrigin,
      routingMode: 'managed-control-plane',
      target: 'production',
    });
    expect(resolveHostedApiConfig(undefined, 'production', {
      activationCandidate: true,
      controlPlaneProvisioning: 'not-provisioned',
      productionFallbackReadiness: 'deferred',
    })).toEqual({
      enabled: false,
      origin: hostedDrManifest.controlPlane.stableOrigin,
      routingMode: 'static-next',
      target: 'production',
    });
    expect(() => resolveHostedApiConfig(
      hostedDrManifest.controlPlane.stableOrigin,
      'production',
      {
        activationCandidate: true,
        controlPlaneProvisioning: 'not-provisioned',
        productionFallbackReadiness: 'deferred',
      },
    )).toThrow(/candidate.*NEXT_PUBLIC_HONO_API_ORIGIN/);
    expect(() => resolveHostedApiConfig(
      hostedDrManifest.controlPlane.previewOrigin,
      'production',
    )).toThrow(/production.*generated origin/);
    expect(resolveHostedApiConfig(
      hostedDrManifest.controlPlane.previewOrigin,
      'preview',
    )).toEqual({
      enabled: true,
      origin: hostedDrManifest.controlPlane.previewOrigin,
      routingMode: 'static-hono',
      target: 'preview',
    });
    expect(() => resolveHostedApiConfig(undefined, 'preview')).toThrow(/preview origin/);
    expect(() => resolveHostedApiConfig(
      hostedDrManifest.controlPlane.stableOrigin,
      'preview',
    ))
      .toThrow(/preview origin/);
    expect(() => resolveHostedApiConfig('https://untrusted.example.test', 'production'))
      .toThrow(/NEXT_PUBLIC_HONO_API_ORIGIN/);
    expect(resolveHostedApiConfig('http://127.0.0.1:8787', 'local')).toEqual({
      enabled: true,
      origin: 'http://127.0.0.1:8787',
      routingMode: 'static-hono',
      target: 'local',
    });
    expect(() => resolveHostedApiConfig('http://127.0.0.1:8787', 'unknown'))
      .toThrow(/deployment target/);
    expect(() => resolveHostedApiConfig('https://homura.colanns.me', 'production'))
      .toThrow(/NEXT_PUBLIC_HONO_API_ORIGIN/);
  });

  test('只匹配迁移白名单，且 Tachie 始终不匹配', () => {
    expect(isHonoApiPath('/api/generate-free?format=sse')).toBe(true);
    expect(isHonoApiPath('/api/arena/generate-stream?format=sse')).toBe(true);
    expect(isHonoApiPath('/api/arena/generation-requests/request-1')).toBe(true);
    expect(isHonoApiPath('/api/arena/generations/generation-1/stream?after=8-0')).toBe(true);
    expect(isHonoApiPath('/api/arena/generations/generation-1')).toBe(true);
    expect(isHonoApiPath('/api/arena/generations/generation-1/cancel')).toBe(true);
    expect(isHonoApiPath('/api/me/battle-reports/report-1/regenerate')).toBe(false);
    expect(isHonoApiPath('/api/tachie/generate')).toBe(false);
    expect(isHonoApiPath('/api/me/battle-reports')).toBe(false);
  });

  test('退出 Hono 的 capability 即使开关开启也保持同源 Next 路径', () => {
    honoApiConfig.enabled = true;
    for (const routeId of honoApiRoutes.exitedRouteIds) {
      const path = `/api/${routeId.replace(/\[[^\]]+\]/gu, 'test-id')}`;
      expect(isHonoApiPath(path)).toBe(false);
      expect(resolveGenerationApiUrl(path)).toBe(path);
    }
  });

  test('开关关闭时保持同源相对地址', () => {
    honoApiConfig.enabled = false;
    expect(resolveGenerationApiUrl('/api/generate-free')).toBe('/api/generate-free');
  });

  test('开关开启时将白名单路由切换到 Hono', () => {
    honoApiConfig.enabled = true;
    expect(resolveGenerationApiUrl('/api/generate-free?format=sse')).toBe(
      'https://api.mahoshojo.colanns.me/api/generate-free?format=sse',
    );
    expect(resolveGenerationApiUrl('/api/tachie/generate')).toBe('/api/tachie/generate');
  });

  test('跨域请求携带 authKey 和活跃令牌，但不携带 Cookie', async () => {
    honoApiConfig.enabled = true;
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await createGenerationApiIntent().dispatch('/api/generate-game-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const [target, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(target).toBe('https://api.mahoshojo.colanns.me/api/generate-game-card');
    expect(target).not.toContain('homura.colanns.me');
    expect(init.credentials).toBe('omit');
    expect(headers.get('Authorization')).toBe('Bearer auth-key');
    expect(headers.get('x-mahoshojo-activity-token')).toBe('activity-token');
    expect(headers.get('x-mahoshojo-user-id')).toBe('7');
  });

  test('client-preflight primary ready 后只向 Hono 发送一次业务 POST', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await createGenerationApiIntent().dispatch('/api/generate-free', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'client-body-canary' }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${hostedDrManifest.controlPlane.primaryOrigin}/api/health/ready`,
    );
    const [target, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(target).toBe(`${hostedDrManifest.controlPlane.primaryOrigin}/api/generate-free`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.body).toBe(JSON.stringify({ prompt: 'client-body-canary' }));
  });

  test('client-preflight primary down 时 eligible operation 只向同源 Next 发送一次 POST', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({
        ok: true,
        placement: 'next-dr',
        contractVersion: hostedDrManifest.contractVersion,
        capabilityId: 'generate-game-card',
        operationMethod: 'POST',
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const intent = createGenerationApiIntent();
    await intent.dispatch('/api/generate-game-card', { method: 'POST' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(intent.getRoutePin()).toEqual({ placement: 'next-dr' });
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/generate-game-card');
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ credentials: 'same-origin' });
    const drHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(drHeaders.get('Authorization')).toBe('Bearer auth-key');
    expect(drHeaders.get('x-mahoshojo-activity-token')).toBe('activity-token');
    expect(drHeaders.get('x-mahoshojo-user-id')).toBe('7');
  });

  test('client-preflight 不向 DR dispatch fail-closed operation', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const fetchMock = vi.fn(async () => Response.json({ ok: false }, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createGenerationApiIntent().dispatch('/api/arena/generate', { method: 'POST' }))
      .rejects.toMatchObject({ code: 'DR_NOT_ELIGIBLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('业务 POST transport 异常投影为 ambiguous outcome 且零跨 runtime 重放', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockRejectedValueOnce(new TypeError('connection reset'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createGenerationApiIntent().dispatch(
      '/api/generate-canshou-stream',
      { method: 'POST' },
    ))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_OPERATION_OUTCOME' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([target]) => (
      String(target).includes(hostedDrManifest.controlPlane.drOrigin)
    ))).toBe(false);
  });

  test('业务 POST 未知 5xx 记录为 ambiguous terminal 且零跨 runtime 重放', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const observe = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockResolvedValueOnce(Response.json({
        error: 'Internal server error',
        code: 'INTERNAL_SERVER_ERROR',
      }, { status: 500 }));
    const intent = createGenerationApiIntent({ fetcher: fetchMock, observe });

    await expect(intent.dispatch('/api/generate-free', { method: 'POST' }))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_OPERATION_OUTCOME' });

    expect(intent.getRoutePin()).toEqual({ placement: 'hono-primary' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'dispatch-terminal',
      terminalClass: 'ambiguous',
    }));
  });

  test('Arena route pin 在 useBattleEngine 中只路由 read，cancel 保持独立 intent', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'components/arena/hooks/useBattleEngine.ts'),
      'utf8',
    );

    expect(source).toContain('getInitialRoutePin');
    expect(source).toContain('createPinnedGenerationApiSafeReadDispatcher');
    expect(source).toContain('if (routePin)');
    expect(source).toContain('generationIntent?.getRoutePin()');
    expect(source).toContain('generationIntent.subscribeRoutePinSelected(onRoutePinSelected)');
  });

  test('退出 Hono 的 non-idempotent POST 未知 5xx 同样投影 ambiguous', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.routingMode = 'client-preflight';
    const onSettled = vi.fn();
    const fetchMock = vi.fn(async () => Response.json({
      code: 'INTERNAL_SERVER_ERROR',
    }, { status: 500 }));
    const intent = createGenerationApiIntent({ fetcher: fetchMock, onSettled });

    await expect(intent.dispatch('/api/me/battle-reports/report-1/regenerate', {
      method: 'POST',
    })).rejects.toMatchObject({
      code: 'AMBIGUOUS_OPERATION_OUTCOME',
      decision: null,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  test('safe-read 的 5xx 保持明确 response-error，不伪装写操作 ambiguity', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const observe = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockResolvedValueOnce(Response.json({ code: 'UNAVAILABLE' }, { status: 503 }));
    const intent = createGenerationApiIntent({ fetcher: fetchMock, observe });

    const response = await intent.dispatch('/api/arena/generation-requests/request-1', {
      method: 'GET',
    });
    expect(response.status).toBe(503);
    await response.json();
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({
      terminalClass: 'response-error',
    }));
  });

  test('显式 intent scope 拒绝第二次 dispatch，避免重复 callback 创建第二份 POST', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const intent = createGenerationApiIntent({ fetcher: fetchMock });
    const repeatedCallback = () => intent.dispatch('/api/generate-free', { method: 'POST' });

    await repeatedCallback();
    await expect(repeatedCallback())
      .rejects.toMatchObject({ code: 'GENERATION_INTENT_ALREADY_DISPATCHED' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('业务 response body 读取异常投影为 ambiguous outcome 且不重新选择 placement', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('stream disconnected'));
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockResolvedValueOnce(new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await createGenerationApiIntent().dispatch(
      '/api/generate-free-stream',
      { method: 'POST' },
    );
    await expect(response.text()).rejects.toMatchObject({
      code: 'AMBIGUOUS_OPERATION_OUTCOME',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('业务 response body 被取消时向调用方投影 ambiguous outcome', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const observe = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'));
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const intent = createGenerationApiIntent({ fetcher: fetchMock, observe });

    const response = await intent.dispatch('/api/generate-free-stream', { method: 'POST' });
    await expect(response.body?.cancel('page-hidden'))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_OPERATION_OUTCOME' });
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'dispatch-terminal',
      terminalClass: 'ambiguous',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('SSE done 是明确成功终态并释放 intent latch', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const observe = vi.fn();
    const onSettled = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockResolvedValueOnce(new Response([
        'event: markdown\ndata: {"chunk":"完成"}\n\n',
        'event: done\ndata: {"ok":true}\n\n',
      ].join(''), { headers: { 'Content-Type': 'text/event-stream' } }));
    const intent = createGenerationApiIntent({ fetcher: fetchMock, observe, onSettled });

    const response = await intent.dispatch('/api/generate-free-stream', { method: 'POST' });
    await expect(readTextAndReasoningStreamFromResponse(response)).resolves.toMatchObject({
      text: '完成',
      isSse: true,
    });

    expect(onSettled).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({
      terminalClass: 'response-ok',
    }));
  });

  test('SSE EOF-before-done 是 ambiguous 并释放 intent latch', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const observe = vi.fn();
    const onSettled = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockResolvedValueOnce(new Response(
        'event: markdown\ndata: {"chunk":"partial"}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ));
    const intent = createGenerationApiIntent({ fetcher: fetchMock, observe, onSettled });

    const response = await intent.dispatch('/api/generate-free-stream', { method: 'POST' });
    await expect(readTextAndReasoningStreamFromResponse(response))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_OPERATION_OUTCOME' });

    expect(onSettled).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({
      terminalClass: 'ambiguous',
    }));
  });

  test('SSE error 是明确失败终态并释放 intent latch', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const observe = vi.fn();
    const onSettled = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ok: true,
        service: 'mahoshojo-hono',
        placement: 'hono-primary',
        contractVersion: hostedDrManifest.contractVersion,
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockResolvedValueOnce(new Response(
        'event: error\ndata: {"error":"upstream failed"}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ));
    const intent = createGenerationApiIntent({ fetcher: fetchMock, observe, onSettled });

    const response = await intent.dispatch('/api/generate-free-stream', { method: 'POST' });
    await expect(readTextAndReasoningStreamFromResponse(response)).rejects.toThrow('upstream failed');

    expect(onSettled).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({
      terminalClass: 'response-error',
    }));
  });

  test('只记录低基数 client-preflight decision/terminal telemetry', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = hostedDrManifest.controlPlane.primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const observe = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({
        ok: true,
        placement: 'next-dr',
        contractVersion: hostedDrManifest.contractVersion,
        capabilityId: 'generate-scenario',
        operationMethod: 'POST',
      }, { headers: { 'Cache-Control': 'no-store' } }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const intent = createGenerationApiIntent({ fetcher: fetchMock, observe });

    const response = await intent.dispatch('/api/generate-scenario?private-query-canary=1', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-header-canary' },
      body: JSON.stringify({ prompt: 'private-prompt-canary' }),
    });
    await response.json();

    expect(observe).toHaveBeenCalledTimes(2);
    expect(observe.mock.calls[0]?.[0]).toMatchObject({
      schemaVersion: 1,
      phase: 'selection',
      contractVersion: hostedDrManifest.contractVersion,
      routeFamily: '/api/generate-scenario',
      selectedPlacement: 'next-dr',
      selectionReason: 'DR_READY',
      primaryProbeOutcome: 'not-ready',
      drProbeOutcome: 'ready',
    });
    expect(observe.mock.calls[1]?.[0]).toMatchObject({
      phase: 'dispatch-terminal',
      terminalClass: 'response-ok',
    });
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(
      /private-query-canary|secret-header-canary|private-prompt-canary/u,
    );
  });

  test('退出 capability 使用同源 Next credentials 且继续携带兼容鉴权头', async () => {
    honoApiConfig.enabled = true;
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await createGenerationApiIntent().dispatch('/api/me/battle-reports/report-1/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const [target, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(target).toBe('/api/me/battle-reports/report-1/regenerate');
    expect(init.credentials).toBe('same-origin');
    expect(headers.get('Authorization')).toBe('Bearer auth-key');
    expect(headers.get('x-mahoshojo-activity-token')).toBe('activity-token');
    expect(headers.get('x-mahoshojo-user-id')).toBe('7');
  });
});
