import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, test } from 'vitest';

import { isArenaAbortFastPathEnabled } from '@/lib/arena/generate-stream-finalization';

const handlerSource = readFileSync(
  new URL('../app/api/arena/generate-stream/handler.ts', import.meta.url),
  'utf8',
);

describe('arena stream abort fast path', () => {
  const originalFlag = process.env.ARENA_ABORT_FAST_PATH;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.ARENA_ABORT_FAST_PATH;
    else process.env.ARENA_ABORT_FAST_PATH = originalFlag;
  });

  test('默认开启并可通过环境变量关闭', () => {
    delete process.env.ARENA_ABORT_FAST_PATH;
    expect(isArenaAbortFastPathEnabled()).toBe(true);

    process.env.ARENA_ABORT_FAST_PATH = 'false';
    expect(isArenaAbortFastPathEnabled()).toBe(false);
  });

  test('aborted 分支在完整收尾前进入专用轻量函数', () => {
    const branch = handlerSource.indexOf("normalizedStatus === 'aborted' && isArenaAbortFastPathEnabled()")
    const fullPreview = handlerSource.indexOf('previewCollector.finish()', branch);
    const fastFinalize = handlerSource.indexOf('finalizeAborted(', branch);

    expect(branch).toBeGreaterThan(-1);
    expect(fastFinalize).toBeGreaterThan(branch);
    expect(fastFinalize).toBeLessThan(fullPreview);
  });

  test('轻量函数不执行摘要、输出扫描、角色写入、排位或 R2 索引', () => {
    const start = handlerSource.indexOf('const finalizeAborted = async');
    const end = handlerSource.indexOf('const finalizeOnce = async', start);
    const source = handlerSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(source).toContain("status: 'aborted'");
    expect(source).toContain('r2UploadAbortController?.abort');
    expect(source).not.toContain('summarizeStreamBattleReportPreview');
    expect(source).not.toContain('quickCheck');
    expect(source).not.toContain('createBattleReportGenerationCombatants');
    expect(source).not.toContain('settleArenaRatingsForGeneration');
    expect(source).not.toContain('upsertLargeObjectByOwnerRef');
  });

  test('SSE 与普通流都让客户端取消同时终止上游和 R2', () => {
    expect(handlerSource.match(/signal: r2UploadAbortController\.signal/g)).toHaveLength(2);
    expect(handlerSource.match(/const \[clientUpstream, r2Body\] = originalBody\.tee\(\)/g)).toHaveLength(2);
    expect(handlerSource).not.toContain('wrappedBody.tee()');
  });
});
