import { describe, expect, test } from 'bun:test';

import {
  createStreamOutputSafetyController,
  STREAM_ABORT_REASON_OUTPUT_SAFETY,
} from '@/lib/stream/output-safety';

const buildSensitiveCheck = (needle: string) => async (text: string) => {
  const index = text.indexOf(needle);
  return {
    hasSensitiveWords: index >= 0,
    filteredText: index >= 0 ? text.replaceAll(needle, '*'.repeat(needle.length)) : text,
    detectedWords: index >= 0 ? [needle] : [],
    matchDetails: index >= 0 ? [{ word: needle, startIndex: index, endIndex: index + needle.length }] : [],
  };
};

describe('stream/output-safety', () => {
  test('finalize 会把输出敏感词截断为安全前缀并追加逮捕令', async () => {
    const controller = createStreamOutputSafetyController({
      checkText: buildSensitiveCheck('危险词'),
    });

    const result = await controller.finalize('第一段安全内容。\n第二段包含危险词，应被截断。');

    expect(result.status).toBe('blocked');
    expect(result.safeText).toContain('第一段安全内容。');
    expect(result.safeText).toContain('## 逮捕令');
    expect(result.safeText).toContain('系统已自动截断');
    expect(result.safeText).not.toContain('危险词');
    expect(result.truncatedAt).toBeNumber();
  });

  test('output-safety 中断后会返回已截断快照而不是抛出普通停止错误', async () => {
    let blockedPreview = '';
    const controller = createStreamOutputSafetyController({
      checkText: buildSensitiveCheck('危险词'),
      delayMs: 0,
      onBlocked: (safeText) => {
        blockedPreview = safeText;
      },
    });

    controller.ingest('安全开头。\n危险词触发截断。');
    await new Promise((resolve) => setTimeout(resolve, 5));

    const result = await controller.finalizeAfterAbort(STREAM_ABORT_REASON_OUTPUT_SAFETY);

    expect(blockedPreview).toContain('## 逮捕令');
    expect(result.status).toBe('blocked');
    expect(result.safeText).toContain('## 逮捕令');
    expect(result.safeText).not.toContain('危险词');
  });
});
