import { appendFileSync } from 'node:fs';
import { wireGracefulShutdownSignals } from '../../src/runtime/execution-context';

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const recordMarker = (marker: string): void => {
  process.stdout.write(`${marker}\n`);
  const markerPath = process.env.SHUTDOWN_MARKER_PATH;
  if (markerPath) appendFileSync(markerPath, `${marker}\n`, 'utf8');
};

wireGracefulShutdownSignals({
  shutdown: async (signal) => {
    recordMarker(`shutdown-started:${signal}`);
    await sleep(250);
    recordMarker('cleanup-marker');
  },
});

recordMarker('ready');
setInterval(() => undefined, 1_000);
