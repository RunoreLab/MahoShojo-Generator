import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestMetadata,
  type HonoAppVariables,
} from '@/server/middleware/request-metadata';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestMetadata', () => {
  const createApp = () => {
    const app = new Hono<{ Variables: HonoAppVariables }>();
    app.use('*', requestMetadata());
    app.get('/resource', (context) => context.text('ok'));
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
      path: '/failure',
      status: 500,
    }));
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
      path: '/resource',
      status: 201,
    }));
  });
});
