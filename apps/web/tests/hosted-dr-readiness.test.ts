import { describe, expect, it } from 'vitest';
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
});
