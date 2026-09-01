import { describe, expect, it, vi } from 'vitest';

import * as generationApiClient from '@/lib/hono-api-client';
import { withArenaGenerationActorToken } from '@/lib/arena/resumable-generation-client';
import {
  createArenaGenerationActorResolver,
} from '@mahoshojo/hosted-runtime/arena-generation';
import * as arenaGenerationRuntime from '@mahoshojo/hosted-runtime/arena-generation';
import { createSignatureService } from '@mahoshojo/hosted-runtime/signature';

type D1Client = {
  prepare(_sql: string): {
    bind(..._values: unknown[]): unknown;
    all(): Promise<{ success: boolean; results: Record<string, unknown>[]; meta: Record<string, unknown> }>;
  };
};

const sequentialD1 = (rows: Record<string, unknown>[][]): D1Client => ({
  prepare: vi.fn(() => {
    const statement = {
      bind: vi.fn(() => statement),
      all: vi.fn(async () => ({
        success: true,
        results: rows.shift() ?? [],
        meta: {},
      })),
    };
    return statement;
  }),
});

const createSignatures = async () => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('arena-reconciliation-auth-test-key'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return createSignatureService({ getSigningKey: async () => key });
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('Arena reconciliation authentication continuity', () => {
  it('preserves legacy user ownership from browser headers through the owned D1 manifest', async () => {
    const buildGenerationApiHeaders = (
      generationApiClient as typeof generationApiClient & {
        buildGenerationApiHeaders?: (
          auth: {
            getAuthHeader(): Promise<string | null>;
            getActivityHeaders(): Promise<Record<string, string>>;
          },
          headersInit?: HeadersInit,
        ) => Promise<Headers>;
      }
    ).buildGenerationApiHeaders;
    const readOwnedReconciliation = (
      arenaGenerationRuntime as typeof arenaGenerationRuntime & {
        readOwnedNodeArenaGenerationReconciliation?: (input: {
          client: D1Client;
          generationId: string;
          actorKey: string;
        }) => Promise<unknown>;
      }
    ).readOwnedNodeArenaGenerationReconciliation;
    expect(buildGenerationApiHeaders).toBeTypeOf('function');
    expect(readOwnedReconciliation).toBeTypeOf('function');
    if (!buildGenerationApiHeaders || !readOwnedReconciliation) return;

    const manifest = { writeArenaHistory: true };
    const roster = [{ sortIndex: 0, name: 'A', type: 'magical-girl' }];
    const terminalRow = {
      status: 'completed',
      extra_json: JSON.stringify({
        generationOwnerHash: await sha256('user:42'),
        finalizationCompleted: true,
        localCardReconciliation: manifest,
        combatantsFallback: roster,
      }),
    };
    const client = sequentialD1([
      [{ id: 42, username: 'legacy-user', isBanned: null }],
      [terminalRow],
    ]);
    const signatures = await createSignatures();
    const resolveActor = createArenaGenerationActorResolver({
      env: { HONO_AUTH_MODE: 'bearer' },
      signatures,
      getD1Client: () => client as never,
      createAnonymousId: () => 'must-not-win-auth-precedence',
    });
    const actorStorage = new MemoryStorage();
    const headers = withArenaGenerationActorToken(await buildGenerationApiHeaders({
      getAuthHeader: async () => 'Bearer legacy-secret',
      getActivityHeaders: async () => ({ 'x-mahoshojo-user-id': '42' }),
    }, { 'Content-Type': 'application/json' }), { storage: actorStorage });
    const request = new Request('https://example.test/api/arena/update-combatants-after-stream', {
      method: 'POST',
      headers,
      body: '{}',
    });

    const actor = await resolveActor(request);
    expect(actor).toEqual({ actorKey: 'user:42' });
    expect(headers.get('Authorization')).toBe('Bearer legacy-secret');
    expect(headers.get('X-Mahoshojo-Generation-Actor-Token')).toMatch(/^bootstrap\./u);
    await expect(readOwnedReconciliation({
      client,
      generationId: 'generation-1234',
      actorKey: actor!.actorKey,
    })).resolves.toEqual({
      kind: 'found',
      reconciliation: { ...manifest, roster },
    });

    const anonymousClient = sequentialD1([[terminalRow]]);
    const anonymousActor = await createArenaGenerationActorResolver({
      env: { HONO_AUTH_MODE: 'bearer' },
      signatures,
      getD1Client: () => anonymousClient as never,
    })(new Request('https://example.test/api/arena/update-combatants-after-stream', {
      headers: {
        'X-Mahoshojo-Generation-Actor-Token': headers.get('X-Mahoshojo-Generation-Actor-Token')!,
      },
    }));
    expect(anonymousActor?.actorKey).toMatch(/^anonymous:/u);
    await expect(readOwnedReconciliation({
      client: anonymousClient,
      generationId: 'generation-1234',
      actorKey: anonymousActor!.actorKey,
    })).resolves.toEqual({ kind: 'not-found', reason: 'owner_mismatch' });
  });
});
