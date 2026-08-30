import { describe, expect, it, vi } from 'vitest';
import type { DatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import { createNextDrReadinessHandler } from '@/app/api/hosted/dr-readiness/handler';

const provider: DatabaseProvider = {
  id: 'cloudflare-d1-binding',
  openSession: ({ consistency }) => ({
    consistency,
    initialBookmark: 'bookmark-do-not-project',
    getBookmark: () => 'bookmark-do-not-project',
    client: {
      prepare: () => {
        const statement = {
          bind: () => statement,
          run: async () => ({ success: true, results: [], meta: {} }),
          all: async () => ({ success: true, results: [{ ok: 1 }], meta: {} }),
        };
        return statement;
      },
    },
  }),
};

describe('Next Hosted DR readiness adapter', () => {
  it('只注入 next placement/provider 并保留 shared response', async () => {
    const handler = createNextDrReadinessHandler(provider);
    const response = await handler(new Request('https://next.test/api/hosted/dr-readiness'));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({
      ok: true,
      contractVersion: 'g25e1-v1',
      placement: 'next-dr',
      databaseProvider: 'cloudflare-d1-binding',
      consistency: 'replica-ok',
    });
    expect(body).not.toContain('bookmark-do-not-project');
  });

  it('HEAD body 为空且保留 no-store', async () => {
    const handler = createNextDrReadinessHandler(provider);
    const response = await handler(new Request(
      'https://next.test/api/hosted/dr-readiness',
      { method: 'HEAD' },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('目标 capability 缺少 secret 时 readiness fail closed', async () => {
    const openSession = vi.fn(provider.openSession);
    const handler = createNextDrReadinessHandler({ ...provider, openSession }, {
      deploymentTarget: 'production',
      environment: {
        HONO_CORS_ORIGINS: 'https://app.example.test',
      },
    });
    const response = await handler(new Request(
      'https://next.test/api/hosted/dr-readiness',
      {
        headers: {
          'x-mahoshojo-hosted-dr-capability': 'generate-magical-girl',
          'x-mahoshojo-hosted-dr-method': 'POST',
        },
      },
    ));

    expect(response.status).toBe(503);
    expect(openSession).not.toHaveBeenCalled();
  });

  it('目标 capability 缺少 R2 binding 时 readiness fail closed', async () => {
    const openSession = vi.fn(provider.openSession);
    const handler = createNextDrReadinessHandler({ ...provider, openSession }, {
      deploymentTarget: 'production',
      environment: {
        HONO_CORS_ORIGINS: 'https://app.example.test',
        R2_ACCESS_KEY_ID: 'local-access-key',
        R2_SECRET_ACCESS_KEY: 'local-secret-key',
      },
    });
    const response = await handler(new Request(
      'https://next.test/api/hosted/dr-readiness',
      {
        headers: {
          'x-mahoshojo-hosted-dr-capability': 'arena/generations/[generationId]/stream',
          'x-mahoshojo-hosted-dr-method': 'GET',
        },
      },
    ));

    expect(response.status).toBe(503);
    expect(openSession).not.toHaveBeenCalled();
  });

  it('目标 capability 前置满足时回显低基数 identity', async () => {
    const handler = createNextDrReadinessHandler(provider, {
      deploymentTarget: 'production',
      environment: {
        HONO_CORS_ORIGINS: 'https://app.example.test',
      },
    });
    const response = await handler(new Request(
      'https://next.test/api/hosted/dr-readiness',
      {
        headers: {
          'x-mahoshojo-hosted-dr-capability': 'generate-free',
          'x-mahoshojo-hosted-dr-method': 'POST',
        },
      },
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      capabilityId: 'generate-free',
      operationMethod: 'POST',
    });
  });
});
