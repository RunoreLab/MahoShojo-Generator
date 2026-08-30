import { describe, expect, it } from 'vitest';
import type { DatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import { createHonoDrReadinessHandler } from '#/adapters/hosted/dr-readiness';

const provider: DatabaseProvider = {
  id: 'hono-d1-primary',
  openSession: ({ consistency }) => ({
    consistency,
    initialBookmark: null,
    getBookmark: () => null,
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

describe('Hono Hosted DR readiness adapter', () => {
  it('只注入 hono placement/provider 并保留 shared response', async () => {
    const handler = createHonoDrReadinessHandler(provider);
    const response = await handler(new Request('https://hono.test/api/hosted/dr-readiness'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      contractVersion: 'g25e1-v1',
      placement: 'hono-primary',
      databaseProvider: 'hono-d1-primary',
      consistency: 'replica-ok',
    });
  });

  it('provider unavailable 时返回 shared 503 wire', async () => {
    const handler = createHonoDrReadinessHandler({
      id: 'hono-d1-primary',
      openSession: () => null,
    });
    const response = await handler(new Request('https://hono.test/api/hosted/dr-readiness'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'HOSTED_DR_CAPABILITY_UNAVAILABLE',
      contractVersion: 'g25e1-v1',
    });
  });
});
