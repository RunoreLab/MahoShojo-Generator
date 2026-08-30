import { appendFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { isExpectedClientDisconnect } from '@mahoshojo/hosted-runtime/node-runtime';
import { Hono } from 'hono';
import { wireGracefulShutdownSignals } from '../../src/runtime/execution-context';

const recordMarker = (marker: string): void => {
  process.stdout.write(`${marker}\n`);
  const markerPath = process.env.SHUTDOWN_MARKER_PATH;
  if (markerPath) appendFileSync(markerPath, `${marker}\n`, 'utf8');
};

const encoder = new TextEncoder();
const app = new Hono();

app.get('/stream', (context) => {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('chunk'));
    },
    cancel() {
      void Promise.reject(new Error('Client connection prematurely closed.'));
    },
  }));
});

app.get('/health', (context) => context.json({ ok: true }));

const server = serve({
  fetch: app.fetch,
  hostname: '127.0.0.1',
  port: 0,
}, (info) => {
  recordMarker(`ready:${info.port}`);
});

wireGracefulShutdownSignals({
  expectedRejectionLogger: () => recordMarker('disconnect-handled'),
  isExpectedUnhandledRejection: isExpectedClientDisconnect,
  shutdown: async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  },
});
