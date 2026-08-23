import { describe, expect, it } from 'vitest';

import { createHttpD1Client, type D1HttpTransport } from '@mahoshojo/hosted-runtime/d1-http-client';
import {
  registerHostedRuntimeObserver,
  resetHostedRuntimeObserverForTests,
  type D1RoundTripObservation,
} from '@mahoshojo/hosted-runtime/telemetry';

describe('package-owned D1 HTTP transport', () => {
  it('executes with an injected query provider and records each round trip', async () => {
    const observations: D1RoundTripObservation[] = [];
    registerHostedRuntimeObserver({
      beginAiUpstream: () => ({ recordTtfb: () => undefined, finish: () => undefined }),
      observeD1RoundTrip: (observation) => observations.push(observation),
    });
    const transport: D1HttpTransport = {
      query: async (_sql) => ({
        success: true,
        result: [{ success: true, results: [{ id: 1 }], meta: {} }],
      }),
      queryRaw: async () => ({
        success: true,
        result: [{ success: true, results: { columns: ['id'], rows: [[1]] }, meta: {} }],
      }),
      queryBatch: async () => ({
        success: true,
        result: [{ success: true, results: [], meta: { changes: 1 } }],
      }),
    };

    try {
      const client = createHttpD1Client(transport) as {
        prepare: (_sql: string) => { all: () => Promise<unknown> };
      };
      await client.prepare('SELECT id FROM users').all();
      expect(observations).toEqual([{
        durationMs: expect.any(Number),
        rowsRead: 1,
        rowsWritten: 0,
        outcome: 'ok',
        errorClass: 'none',
      }]);
    } finally {
      resetHostedRuntimeObserverForTests();
    }
  });
});
