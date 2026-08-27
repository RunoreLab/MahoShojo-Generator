import { NextRequest } from 'next/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { middleware } from '../middleware';

const request = (path: string, method = 'GET'): NextRequest => new NextRequest(
  `https://mahoshojo-next-dr-candidate.example.test${path}`,
  { method },
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Hosted DR activation candidate middleware', () => {
  test.each(['GET', 'HEAD'])(
    'candidate 仅放行 readiness %s',
    (method) => {
      vi.stubEnv('HOSTED_DR_ACTIVATION_CANDIDATE', 'true');

      const response = middleware(request('/api/hosted/dr-readiness?probe=phase-2.5', method));

      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    },
  );

  test.each([
    ['/api/hosted/dr-readiness', 'POST'],
    ['/api/health/ready', 'GET'],
    ['/api/generate-free', 'GET'],
    ['/', 'GET'],
  ])('candidate 拒绝非 readiness safe-read 请求 %s %s', (path, method) => {
    vi.stubEnv('HOSTED_DR_ACTIVATION_CANDIDATE', 'true');

    const response = middleware(request(path, method));

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  test('candidate 开关非法时保持 fail-closed', () => {
    vi.stubEnv('HOSTED_DR_ACTIVATION_CANDIDATE', 'enabled');

    const response = middleware(request('/api/hosted/dr-readiness'));

    expect(response.status).toBe(503);
  });

  test('candidate 开关关闭时不改变正常请求', () => {
    vi.stubEnv('HOSTED_DR_ACTIVATION_CANDIDATE', 'false');

    const response = middleware(request('/'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
