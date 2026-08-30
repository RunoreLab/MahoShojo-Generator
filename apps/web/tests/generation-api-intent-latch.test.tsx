// @vitest-environment jsdom

import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { honoApiConfig } from '@/config/hono-api';
import { useGenerationApiIntentLatch } from '@/lib/use-generation-api-intent-latch';

const originalEnabled = honoApiConfig.enabled;
const originalOrigin = honoApiConfig.origin;
const originalRoutingMode = honoApiConfig.routingMode;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  honoApiConfig.enabled = originalEnabled;
  honoApiConfig.origin = originalOrigin;
  honoApiConfig.routingMode = originalRoutingMode;
});

describe('generation API intent latch', () => {
  it('组件 rerender 期间重复 callback 只创建一次 probe 与一次 POST', async () => {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = 'https://homura.colanns.me';
    honoApiConfig.routingMode = 'client-preflight';
    let releaseSafetyCheck!: () => void;
    const safetyCheck = new Promise<void>((resolve) => {
      releaseSafetyCheck = resolve;
    });
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return Response.json({
          ok: true,
          service: 'mahoshojo-hono',
          placement: 'hono-primary',
          contractVersion: 'g25e1-v1',
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
      return new Response(null, { status: 204 });
    });
    const auth = {
      getAuthHeader: vi.fn(async () => null),
      getActivityHeaders: vi.fn(async () => ({})),
    };
    let submit: (() => Promise<void>) | null = null;

    const Harness = ({ revision }: { revision: number }) => {
      const latch = useGenerationApiIntentLatch({ fetcher, auth });
      useEffect(() => {
        submit = async () => {
          await safetyCheck;
          const intent = latch.tryAcquire();
          if (!intent) return;
          const response = await intent.dispatch('/api/generate-free', { method: 'POST' });
          await response.arrayBuffer();
        };
      }, [latch, revision]);
      return null;
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Harness revision={1} />));
    const firstSubmit = submit!;
    const first = firstSubmit();
    await act(async () => root?.render(<Harness revision={2} />));
    const second = submit!();
    releaseSafetyCheck();
    await act(async () => Promise.all([first, second]));

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});
