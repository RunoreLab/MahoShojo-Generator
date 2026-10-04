import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth/server', () => ({ getAuthUser: vi.fn(), requireAuthUser: vi.fn() }));
import { json, readJson, withApiErrorBoundary } from '@/lib/api/server';

describe('shared API response helpers', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('preserves JSON responses and rejects malformed request bodies', async () => {
    const response = json({ ok: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    expect(response.status).toBe(201);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ ok: true });
    const invalid = await readJson(new Request('https://example.test/api', { method: 'POST', body: '{' }));
    expect('response' in invalid && invalid.response.status).toBe(400);
  });
  it('catches errors with a neutral trace ID when randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await withApiErrorBoundary(async () => { throw new Error('storage unavailable'); })(new Request('https://example.test/api'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.traceId).toMatch(/^api_/);
  });
});
