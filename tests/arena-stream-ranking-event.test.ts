import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const runtimeSource = readFileSync(
  new URL('../packages/hosted-runtime/src/arena-generation/runtime.ts', import.meta.url),
  'utf8',
);
const finalizationSource = readFileSync(
  new URL('../packages/hosted-runtime/src/arena-generation/finalization.ts', import.meta.url),
  'utf8',
);

describe('arena stream ranking event', () => {
  test('成功流先完成幂等 finalization，再发送 ranking，由 service 追加 terminal done', () => {
    const completionStart = runtimeSource.indexOf("await finalizeOnce('completed', null)");
    const rankingEvent = runtimeSource.indexOf("type: 'ranking'", completionStart);
    const terminalReturn = runtimeSource.indexOf("status: 'completed'", rankingEvent);

    expect(completionStart).toBeGreaterThan(-1);
    expect(rankingEvent).toBeGreaterThan(completionStart);
    expect(terminalReturn).toBeGreaterThan(rankingEvent);
  });

  test('ranking 读取失败降级为 null，不阻止 completed terminal', () => {
    expect(finalizationSource).toContain('ports.readRanking');
    expect(finalizationSource).toContain('.catch(() => null)');
    expect(runtimeSource).toContain("return { status: 'completed', resultRef: finalization.resultRef }");
  });
});
