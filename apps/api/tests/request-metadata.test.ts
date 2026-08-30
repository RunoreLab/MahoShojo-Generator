import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestMetadata,
  type HonoAppVariables,
} from '#/middleware/request-metadata';
import { HonoRuntimeTelemetry } from '#/telemetry/runtime';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestMetadata', () => {
  const createApp = (telemetry?: HonoRuntimeTelemetry) => {
    const app = new Hono<{ Variables: HonoAppVariables }>();
    app.use('*', requestMetadata(telemetry));
    app.get('/resource', (context) => context.text('ok'));
    app.get('/resource-stream', () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'));
        controller.close();
      },
    }), {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }));
    app.options('/resource', (context) => context.body(null, 204));
    app.post('/resource', (context) => context.text('created', 201));
    app.get('/failure', (context) => context.json({ error: 'failed' }, 500));
    return app;
  };

  it('不记录 GET 请求，但仍添加请求元数据响应头', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await createApp().request('/resource', {
      headers: { 'x-request-id': 'get-request-id' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('get-request-id');
    expect(response.headers.get('x-backend-runtime')).toBe('hono-node');
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('不记录成功的 OPTIONS 请求', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await createApp().request('/resource', { method: 'OPTIONS' });

    expect(response.status).toBe(204);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('仍记录 GET 请求的错误响应', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await createApp().request('/failure', {
      headers: { 'x-request-id': 'failed-get-request-id' },
    });

    expect(response.status).toBe(500);
    expect(infoSpy).toHaveBeenCalledWith('[hono][request]', expect.objectContaining({
      requestId: 'failed-get-request-id',
      method: 'GET',
      status: 500,
    }));
    expect(infoSpy.mock.calls[0]?.[1]).not.toHaveProperty('path');
  });

  it('继续记录非 GET 请求', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await createApp().request('/resource', {
      method: 'POST',
      headers: { 'x-request-id': 'post-request-id' },
    });

    expect(response.status).toBe(201);
    expect(infoSpy).toHaveBeenCalledWith('[hono][request]', expect.objectContaining({
      requestId: 'post-request-id',
      method: 'POST',
      status: 201,
    }));
    expect(infoSpy.mock.calls[0]?.[1]).not.toHaveProperty('path');
  });

  it('客户端 request id 不符合低基数格式时生成服务器 ID', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await createApp().request('/resource', {
      method: 'POST',
      headers: { 'x-request-id': 'client/path?secret=request-id-canary' },
    });

    const requestId = response.headers.get('x-request-id');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(requestId).not.toContain('request-id-canary');
    expect(JSON.stringify(infoSpy.mock.calls)).not.toMatch(/request-id-canary|client\/path/u);
  });

  it('跟踪 request 和 streaming response 直到响应体消费完成', async () => {
    const telemetry = new HonoRuntimeTelemetry();
    const response = await createApp(telemetry).request('/resource-stream');

    expect(telemetry.snapshot().http).toMatchObject({
      activeRequests: 0,
      peakActiveRequests: 1,
      activeStreams: 1,
      peakActiveStreams: 1,
    });

    await expect(response.text()).resolves.toBe('chunk');
    expect(telemetry.snapshot().http.activeStreams).toBe(0);
  });
});
