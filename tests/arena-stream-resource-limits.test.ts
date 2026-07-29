import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const handlerSource = readFileSync(
  new URL('../app/api/arena/generate-stream/handler.ts', import.meta.url),
  'utf8',
);

describe('arena stream resource limits', () => {
  test('server-side arena streams use hard timeouts and cancel upstream readers', () => {
    expect(handlerSource).not.toContain("streamReadTimeoutMode: 'soft'");
    expect(handlerSource).not.toContain("mode: 'soft'");
    expect(handlerSource.match(/onTimeout:/g)).toHaveLength(2);
    expect(handlerSource.match(/reader\.cancel\(error\.message\)/g)).toHaveLength(2);
  });

  test('SSE backpressure does not poll every 5ms', () => {
    expect(handlerSource).not.toContain('setTimeout(resolve, 5)');
    expect(handlerSource).toContain('setTimeout(resolve, 100)');
  });
});
