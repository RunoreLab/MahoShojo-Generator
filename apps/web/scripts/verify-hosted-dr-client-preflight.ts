import assert from 'node:assert/strict';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { honoApiConfig } from '../config/hono-api';
import { hostedDrClientRouting } from '../config/hosted-dr-client.generated';
import {
  createGenerationApiIntent,
  type GenerationApiClientError,
} from '../lib/hono-api-client';
import { selectHostedDrPlacement } from '../lib/hosted-dr/client-preflight';
import type { HostedDrClientTelemetryEvent } from '../lib/hosted-dr/client-preflight-telemetry';

type PrimaryMode = 'ready' | 'transport-down' | 'post-disconnect';
type Counters = {
  primaryProbeCount: number;
  drProbeCount: number;
  primaryPostCount: number;
  drPostCount: number;
};
type EvidenceCase = Counters & {
  id: string;
  passed: boolean;
  operationId: string;
  selectedPlacement: string;
  terminalClass: string;
  primaryProbeDurationMs: number;
  drProbeDurationMs: number | null;
};

const emptyCounters = (): Counters => ({
  primaryProbeCount: 0,
  drProbeCount: 0,
  primaryPostCount: 0,
  drPostCount: 0,
});

const sendJson = (
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
) => {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(body));
};

const operationIdOf = (request: IncomingMessage): string => (
  typeof request.headers['x-operation-id'] === 'string'
    ? request.headers['x-operation-id']
    : 'missing'
);

let primaryMode: PrimaryMode = 'ready';
let counters = emptyCounters();
let expectedOperationId = '';

const primaryServer = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === hostedDrClientRouting.primaryProbePath) {
    counters.primaryProbeCount += 1;
    if (primaryMode === 'transport-down') {
      request.socket.destroy();
      return;
    }
    sendJson(response, 200, {
      ok: true,
      service: 'mahoshojo-hono',
      placement: 'hono-primary',
      contractVersion: hostedDrClientRouting.contractVersion,
    });
    return;
  }
  if (request.method === 'POST') {
    counters.primaryPostCount += 1;
    assert.equal(operationIdOf(request), expectedOperationId);
    if (primaryMode === 'post-disconnect') {
      request.socket.destroy();
      return;
    }
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { ok: false });
});

const drServer = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === hostedDrClientRouting.drProbePath) {
    counters.drProbeCount += 1;
    sendJson(response, 200, {
      ok: true,
      placement: 'next-dr',
      contractVersion: hostedDrClientRouting.contractVersion,
    });
    return;
  }
  if (request.method === 'POST') {
    counters.drPostCount += 1;
    assert.equal(operationIdOf(request), expectedOperationId);
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { ok: false });
});

const listen = async (server: http.Server): Promise<string> => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
};

const close = async (server: http.Server): Promise<void> => {
  server.close();
  await once(server, 'close');
};

const anonymousAuth = {
  async getAuthHeader() { return null; },
  async getActivityHeaders() { return {}; },
};

const expectedByCase = {
  'PRIMARY-READY': {
    primaryProbeCount: 1,
    drProbeCount: 0,
    primaryPostCount: 1,
    drPostCount: 0,
    selectedPlacement: 'hono-primary',
    terminalClass: 'response-ok',
  },
  'PRIMARY-UNAVAILABLE-ELIGIBLE': {
    primaryProbeCount: 1,
    drProbeCount: 1,
    primaryPostCount: 0,
    drPostCount: 1,
    selectedPlacement: 'next-dr',
    terminalClass: 'response-ok',
  },
  'PRIMARY-UNAVAILABLE-FAIL-CLOSED': {
    primaryProbeCount: 1,
    drProbeCount: 0,
    primaryPostCount: 0,
    drPostCount: 0,
    selectedPlacement: 'unavailable',
    terminalClass: 'not-dispatched',
  },
  'POST-DISCONNECT-NO-REPLAY': {
    primaryProbeCount: 1,
    drProbeCount: 0,
    primaryPostCount: 1,
    drPostCount: 0,
    selectedPlacement: 'hono-primary',
    terminalClass: 'ambiguous',
  },
} as const;

const main = async () => {
  const primaryOrigin = await listen(primaryServer);
  const drOrigin = await listen(drServer);
  const original = { ...honoApiConfig };
  const evidence: EvidenceCase[] = [];

  try {
    honoApiConfig.enabled = true;
    honoApiConfig.origin = primaryOrigin;
    honoApiConfig.routingMode = 'client-preflight';
    const routing = {
      ...hostedDrClientRouting,
      primaryOrigin,
      drOrigin,
    };
    const fetcher = (input: string, init?: RequestInit) => fetch(
      input.startsWith('/') ? `${drOrigin}${input}` : input,
      init,
    );

    const runCase = async (
      id: keyof typeof expectedByCase,
      mode: PrimaryMode,
      route: string,
    ) => {
      primaryMode = mode;
      counters = emptyCounters();
      expectedOperationId = `client-preflight-${id.toLowerCase()}`;
      const telemetry: HostedDrClientTelemetryEvent[] = [];
      const intent = createGenerationApiIntent({
        auth: anonymousAuth,
        fetcher,
        observe: (event) => telemetry.push(event),
        selectPlacement: (input) => selectHostedDrPlacement({ ...input, routing }),
      });

      try {
        const response = await intent.dispatch(route, {
          method: 'POST',
          headers: { 'x-operation-id': expectedOperationId },
          body: JSON.stringify({ inputClass: 'synthetic' }),
        });
        await response.text();
      } catch (error) {
        const expectedCode = id === 'PRIMARY-UNAVAILABLE-FAIL-CLOSED'
          ? 'DR_NOT_ELIGIBLE'
          : 'AMBIGUOUS_OPERATION_OUTCOME';
        assert.equal((error as GenerationApiClientError).code, expectedCode);
      }

      const selection = telemetry.find((event) => event.phase === 'selection');
      const terminal = telemetry.find((event) => event.phase === 'dispatch-terminal');
      assert.ok(selection && selection.phase === 'selection');
      assert.ok(terminal && terminal.phase === 'dispatch-terminal');
      const actual = {
        ...counters,
        selectedPlacement: selection.selectedPlacement,
        terminalClass: terminal.terminalClass,
      };
      assert.deepEqual(actual, expectedByCase[id]);
      evidence.push({
        id,
        passed: true,
        operationId: expectedOperationId,
        ...actual,
        primaryProbeDurationMs: selection.primaryProbeDurationMs,
        drProbeDurationMs: selection.drProbeDurationMs,
      });
    };

    await runCase('PRIMARY-READY', 'ready', '/api/generate-free');
    await runCase(
      'PRIMARY-UNAVAILABLE-ELIGIBLE',
      'transport-down',
      '/api/generate-free',
    );
    await runCase(
      'PRIMARY-UNAVAILABLE-FAIL-CLOSED',
      'transport-down',
      '/api/arena/generate',
    );
    await runCase(
      'POST-DISCONNECT-NO-REPLAY',
      'post-disconnect',
      '/api/generate-free',
    );

    process.stdout.write(`${JSON.stringify({
      event: 'hosted.dr.client-preflight.evidence',
      environment: 'isolated-loopback',
      cases: evidence,
    })}\n`);
  } finally {
    Object.assign(honoApiConfig, original);
    await Promise.all([close(primaryServer), close(drServer)]);
  }
};

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
