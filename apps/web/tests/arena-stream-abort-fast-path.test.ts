import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const serviceSource = readFileSync(
  new URL('../../../packages/hosted-api/src/arena-generation/service.ts', import.meta.url),
  'utf8',
);
const runtimeSource = readFileSync(
  new URL('../../../packages/hosted-runtime/src/arena-generation/runtime.ts', import.meta.url),
  'utf8',
);
const battleEngineSource = readFileSync(
  new URL('../components/arena/hooks/useBattleEngine.ts', import.meta.url),
  'utf8',
);

describe('arena stream server-owned cancellation', () => {
  test('subscriber cancel 只停止 replay pump，不触发 producer AbortController', () => {
    expect(serviceSource).toContain('cancelled = true');
    expect(serviceSource).not.toMatch(/cancel\(\)\s*\{[^}]*controller\.abort/su);
    expect(serviceSource).not.toContain('signal: request.signal');
  });

  test('只有显式 cancel contract 会请求取消并中断活动 producer', () => {
    const cancelStart = serviceSource.indexOf('async cancel(request: Request');
    const cancelSource = serviceSource.slice(cancelStart);
    expect(cancelSource).toContain('dependencies.store.requestCancel');
    expect(cancelSource).toContain('controller.abort(result.cancelReason)');
    expect(cancelSource).toContain("status: 'cancelling'");
  });

  test('R2/finalization 获得 generation-owned signal，而非订阅请求 signal', () => {
    expect(runtimeSource).toContain('signal: input.signal');
    expect(runtimeSource).not.toContain('request.signal');
  });

  test('客户端敏感输出命中会显式 abort generation，而非只取消 subscriber reader', () => {
    expect(battleEngineSource).toContain(
      'abortController.abort(STREAM_ABORT_REASON_CONTENT_POLICY)',
    );
    expect(battleEngineSource).not.toContain(
      'sharedGenerationAbortController?.abort(STREAM_ABORT_REASON_CONTENT_POLICY)',
    );
    expect(battleEngineSource).not.toContain("reader.cancel('sensitive')");
  });
});
