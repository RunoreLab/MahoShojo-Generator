import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const executorSource = readFileSync(
  new URL('../packages/hosted-runtime/src/arena-generation/node-executor.ts', import.meta.url),
  'utf8',
);
const runtimeSource = readFileSync(
  new URL('../packages/hosted-runtime/src/arena-generation/runtime.ts', import.meta.url),
  'utf8',
);
const serviceSource = readFileSync(
  new URL('../packages/hosted-api/src/arena-generation/service.ts', import.meta.url),
  'utf8',
);

describe('arena stream resource limits', () => {
  test('server-side Arena generation 使用 hard upstream timeout 与 generation-owned abort', () => {
    expect(executorSource).toContain("streamReadTimeoutMode: 'hard'");
    expect(executorSource).not.toContain("streamReadTimeoutMode: 'soft'");
    expect(runtimeSource).toContain('reader.cancel(signal.reason)');
    expect(serviceSource).toContain('const controller = new AbortController()');
  });

  test('replay subscriber 使用有界阻塞轮询且不含 5ms busy poll', () => {
    expect(serviceSource).not.toContain('setTimeout(resolve, 5)');
    expect(serviceSource).toContain('dependencies.replayPollMs ?? 1_000');
    expect(serviceSource).toContain('blockMs: replayPollMs');
  });
});
