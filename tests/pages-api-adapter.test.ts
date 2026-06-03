import { describe, expect, test } from 'vitest';

import { withPagesApiResponse } from '@/lib/pages-api-adapter';

const createMockResponse = () => {
  const chunks: unknown[] = [];
  const headers = new Map<string, string | string[]>();
  return {
    statusCode: 0,
    headers,
    chunks,
    ended: false,
    status(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    setHeader(name: string, value: string | string[]) {
      headers.set(name, value);
    },
    write(chunk: unknown) {
      chunks.push(chunk);
    },
    end(body?: unknown) {
      if (body !== undefined) chunks.push(body);
      this.ended = true;
    },
  };
};

describe('withPagesApiResponse', () => {
  test('把 handler 返回的 Web Response 写入 Pages API res', async () => {
    const handler = withPagesApiResponse(async (req) => {
      const url = new URL(req.url);
      return new Response(JSON.stringify({ query: url.searchParams.get('q') }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const res = createMockResponse();

    await handler({ method: 'GET', url: '/api/test?q=ok', headers: { host: 'example.test' } }, res);

    expect(res.statusCode).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.ended).toBe(true);
    expect(new TextDecoder().decode(res.chunks[0] as Uint8Array)).toBe('{"query":"ok"}');
  });

  test('相对 URL 适配时不应让 x-forwarded-host 覆盖 host', async () => {
    const handler = withPagesApiResponse(async (req) => {
      return new Response(new URL(req.url).origin);
    });

    const response = await handler({
      method: 'GET',
      url: '/api/auth/verify',
      headers: {
        host: 'example.test',
        'x-forwarded-host': 'attacker.test',
        'x-forwarded-proto': 'https',
      },
    });

    expect(await response!.text()).toBe('https://example.test');
  });

  test('没有 Pages API res 时保持返回 Web Response，兼容直接单元测试调用', async () => {
    const handler = withPagesApiResponse(async () => new Response('ok'));

    const response = await handler(new Request('https://example.test/api/test'));

    expect(response).toBeInstanceOf(Response);
    expect(await response!.text()).toBe('ok');
  });
});
