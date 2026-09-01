import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createHostedDrReadinessService,
  selectHostedDrRuntime,
  type HostedDrReadinessDatabaseProvider,
} from '../src/hosted-dr';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const clientRouting = JSON.parse(readFileSync(
  path.join(repositoryRoot, 'config/hosted-routing.json'),
  'utf8',
)) as {
  origins: { stable: string; preview: string; primary: string; dr: string };
};

const createProvider = (
  id: 'hono-d1-primary' | 'cloudflare-d1-binding',
  result: unknown = { success: true, results: [{ ok: 1 }], meta: {} },
): HostedDrReadinessDatabaseProvider => ({
  id,
  openSession: ({ consistency }) => ({
    consistency,
    initialBookmark: null,
    getBookmark: () => null,
    client: {
      prepare: () => ({
        bind: () => { throw new Error('readiness must not bind input'); },
        run: async () => { throw new Error('readiness must use all'); },
        all: async () => result as never,
      }),
    },
  }),
});

describe('G25E-2 Hosted DR fault matrix: selector/readiness/cutback', () => {
  it('G25E2-HONO-UNAVAILABLE：primary 不可达时 safe-read 进入 DR readiness', async () => {
    const primaryProbe = vi.fn(async () => {
      throw new Error('Hono primary unavailable');
    });
    await expect(primaryProbe()).rejects.toThrow('Hono primary unavailable');
    const selected = selectHostedDrRuntime({
      requestClass: 'safe-read',
      dispatchState: 'not-dispatched',
      primaryHealth: 'unavailable',
      hasDurableIdempotencyProof: false,
    });
    expect(selected).toBe('next-dr');
    expect(clientRouting.origins).toEqual({
      stable: 'https://api.mahoshojo.colanns.me',
      primary: 'https://homura.colanns.me',
      dr: 'https://mahoshojo.colanns.me',
      preview: 'https://homura-preview.colanns.me',
    });

    const dr = createHostedDrReadinessService({
      placement: 'next-dr',
      provider: createProvider('cloudflare-d1-binding'),
    });
    const drRequest = vi.fn((request: Request) => dr(request));
    const response = selected === 'next-dr'
      ? await drRequest(new Request('https://stable.test/api/hosted/dr-readiness'))
      : new Response(null, { status: 500 });
    expect(primaryProbe).toHaveBeenCalledOnce();
    expect(drRequest).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      contractVersion: 'g25e1-v1',
      placement: 'next-dr',
      databaseProvider: 'cloudflare-d1-binding',
      consistency: 'replica-ok',
    });
  });

  it('G25E2-VERSION-SKEW：Hono/Next readiness 保持同一 public contract', async () => {
    const [hono, dr] = await Promise.all([
      createHostedDrReadinessService({
        placement: 'hono-primary',
        provider: createProvider('hono-d1-primary'),
      })(new Request('https://primary.test/api/hosted/dr-readiness')),
      createHostedDrReadinessService({
        placement: 'next-dr',
        provider: createProvider('cloudflare-d1-binding'),
      })(new Request('https://dr.test/api/hosted/dr-readiness')),
    ]);
    const [honoPayload, drPayload] = await Promise.all([hono.json(), dr.json()]);

    expect(honoPayload).toMatchObject({ ok: true, contractVersion: 'g25e1-v1', consistency: 'replica-ok' });
    expect(drPayload).toMatchObject({ ok: true, contractVersion: 'g25e1-v1', consistency: 'replica-ok' });
    expect(honoPayload).not.toHaveProperty('bookmark');
    expect(drPayload).not.toHaveProperty('bookmark');
  });

  it('G25E2-CUTBACK：primary 恢复只影响新请求，旧 non-idempotent operation 不重发', () => {
    const primaryDispatch = vi.fn();
    const drDispatch = vi.fn();
    const newRead = selectHostedDrRuntime({
      requestClass: 'safe-read',
      dispatchState: 'not-dispatched',
      primaryHealth: 'healthy',
      hasDurableIdempotencyProof: false,
    });
    const inFlight = selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'unknown',
      primaryHealth: 'healthy',
      hasDurableIdempotencyProof: false,
    });
    const previousDispatch = selectHostedDrRuntime({
      requestClass: 'non-idempotent-operation',
      dispatchState: 'dispatched',
      primaryHealth: 'healthy',
      hasDurableIdempotencyProof: false,
    });

    expect(newRead).toBe('hono-primary');
    expect(inFlight).toBe('fail-closed');
    expect(previousDispatch).toBe('fail-closed');
    if (newRead === 'hono-primary') primaryDispatch('safe-read');
    if (inFlight === 'next-dr') drDispatch('non-idempotent-operation');
    if (previousDispatch === 'next-dr') drDispatch('non-idempotent-operation');
    expect(primaryDispatch).toHaveBeenCalledWith('safe-read');
    expect(drDispatch).not.toHaveBeenCalled();
  });
});
