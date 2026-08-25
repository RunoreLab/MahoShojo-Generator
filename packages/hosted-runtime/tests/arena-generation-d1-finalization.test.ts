import { describe, expect, it, vi } from 'vitest';

import {
  createNodeArenaGenerationFinalizationPorts,
  createNodeArenaGenerationTerminalStore,
} from '../src/arena-generation/d1-finalization';
import type { NodeDataD1Client } from '../src/node-runtime/data-ports';

const result = (
  results: Record<string, unknown>[] = [],
  changes = 0,
) => ({ success: true, results, meta: { changes } });

const sequentialD1 = (
  steps: Array<ReturnType<typeof result> | Error>,
): NodeDataD1Client => ({
  prepare: vi.fn((sql: string) => {
    let params: unknown[] = [];
    return {
      bind(...next: unknown[]) {
        params = next;
        void params;
        return this;
      },
      run: vi.fn(async () => {
        expect(params).toHaveLength((sql.match(/\?/gu) ?? []).length);
        const step = steps.shift() ?? result();
        if (step instanceof Error) throw step;
        return step;
      }),
      all: vi.fn(async () => {
        expect(params).toHaveLength((sql.match(/\?/gu) ?? []).length);
        const step = steps.shift() ?? result();
        if (step instanceof Error) throw step;
        return step;
      }),
    };
  }),
});

const claimInput = {
  generationId: 'generation-1',
  generationRequestId: 'request-1',
  actorKey: 'user:42',
  payload: {
    mode: 'classic',
    language: 'zh-CN',
    combatants: [
      { type: 'magical-girl', data: { name: 'A' } },
      { type: 'magical-girl', data: { name: 'B' } },
    ],
  },
  metadata: {
    streamMeta: { report: { headline: '战报标题', winner: 'A' } },
  },
  markdown: '# 战报标题\n\n## 胜利者\nA',
  telemetry: { model: 'model-1', usage: { totalTokens: 9 } },
  status: 'completed' as const,
  errorCode: null,
  resultRef: 'r2:v1/battle-report-generations/2026/08/25/generation-1/output.md',
};

describe('Arena D1/R2 finalization ports', () => {
  it('claims the D1 terminal row with INSERT OR IGNORE and distinguishes retries', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('user:42'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const stored = {
      id: 'generation-1',
      status: 'completed',
      extra_json: JSON.stringify({
        generationRequestId: 'request-1',
        generationOwnerHash: ownerHash,
        resultRef: claimInput.resultRef,
      }),
    };
    const client = sequentialD1([
      result([], 1),
      result([], 0),
      result([stored]),
    ]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });

    await expect(ports.claimTerminal(claimInput)).resolves.toEqual({
      kind: 'created',
      resultRef: claimInput.resultRef,
    });
    await expect(ports.claimTerminal(claimInput)).resolves.toEqual({
      kind: 'existing',
      resultRef: claimInput.resultRef,
    });
    expect(client.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE'));
  });

  it('reconciles an indeterminate INSERT error before reporting terminal failure', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('user:42'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const client = sequentialD1([
      new Error('D1_TRANSPORT_TIMEOUT'),
      result([{
        id: 'generation-1',
        status: 'completed',
        extra_json: JSON.stringify({
          generationRequestId: 'request-1',
          generationOwnerHash: ownerHash,
          resultRef: claimInput.resultRef,
        }),
      }]),
    ]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
    });

    await expect(ports.claimTerminal(claimInput)).resolves.toEqual({
      kind: 'existing',
      resultRef: claimInput.resultRef,
    });
  });

  it('stores the full terminal object and indexes the deterministic R2 key', async () => {
    const put = vi.fn(async () => ({ bytes: 4, storedBytes: 4, contentEncoding: null }));
    const client = sequentialD1([result([], 1)]);
    const ports = createNodeArenaGenerationFinalizationPorts({
      getD1Client: () => client,
      now: () => new Date('2026-08-25T04:00:00.000Z'),
      objectStore: { put, getText: vi.fn() },
    });

    await expect(ports.storeOutput({
      generationId: 'generation-1',
      actorKey: 'user:42',
      markdown: 'body',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      resultRef: 'r2:v1/battle-report-generations/2026/08/25/generation-1/output.md',
    });
    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      key: 'v1/battle-report-generations/2026/08/25/generation-1/output.md',
      body: 'body',
    }));
    expect(client.prepare).toHaveBeenCalledWith(expect.stringContaining('large_objects'));
  });

  it('authorizes terminal fallback by actor hash and reads full R2 output', async () => {
    const ownerHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('anonymous:anon-id-1'),
    ).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const client = sequentialD1([result([{
      id: 'generation-1',
      status: 'completed',
      updated_at: '2026-08-25T04:00:00.000Z',
      output_preview: 'preview',
      extra_json: JSON.stringify({
        generationRequestId: 'request-1',
        generationOwnerHash: ownerHash,
        resultRef: 'r2:key',
      }),
      r2_key: 'key',
    }])]);
    const store = createNodeArenaGenerationTerminalStore({
      getD1Client: () => client,
      objectStore: { put: vi.fn(), getText: vi.fn(async () => 'full body') },
    });

    await expect(store.readOwnedTerminal({
      generationId: 'generation-1',
      actorKey: 'anonymous:anon-id-1',
    })).resolves.toMatchObject({ markdown: 'full body', generationRequestId: 'request-1' });
    await expect(store.readOwnedTerminal({
      generationId: 'generation-1',
      actorKey: 'anonymous:other-id',
    })).resolves.toBeNull();
  });
});
