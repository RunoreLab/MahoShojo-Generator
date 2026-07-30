import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const handlerSource = readFileSync(
  new URL('../app/api/arena/generate-stream/handler.ts', import.meta.url),
  'utf8',
);

describe('arena stream ranking event', () => {
  test('成功流先完成关键收尾，再发送 ranking，最后发送 done', () => {
    expect(handlerSource).toContain('readGenerationRankingForGeneration');

    const completionStart = handlerSource.indexOf("await finalizeOnce('completed')");
    const rankingEvent = handlerSource.indexOf("encodeEvent('ranking'", completionStart);
    const doneEvent = handlerSource.indexOf("encodeEvent('done', { ok: true })", completionStart);

    expect(completionStart).toBeGreaterThan(-1);
    expect(rankingEvent).toBeGreaterThan(completionStart);
    expect(doneEvent).toBeGreaterThan(rankingEvent);
  });

  test('ranking 读取失败不会阻止 done 事件', () => {
    expect(handlerSource).toContain('排位结果读取失败（降级为恢复查询）');
    expect(handlerSource).toContain("encodeEvent('done', { ok: true })");
  });
});
