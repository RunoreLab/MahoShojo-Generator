import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AI_STREAM_MAX_DELTA_CHARS, AiStreamEventSchema } from '@mahoshojo/ai-core/stream-events';
import { AiExecutionFinishReasonSchema } from '@mahoshojo/contracts/ai-execution';

/**
 * 跨运行时一致性门禁（`SPEC-desktop-client-v1` DESK-033）。
 *
 * 同一份 fixture 由两侧消费：Rust 在编译期 `include_str!` 读入并断言反序列化后重新序列化
 * 能逐字节复现原文；这里用 `@mahoshojo/ai-core` 的权威 schema 校验同一份文件。任何一侧新增、
 * 改名或收紧事件字段，另一侧都会失败。
 */
const fixture = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '..', '..', '..', 'packages', 'contracts', 'fixtures', 'ai-stream-events.json'),
    'utf8',
  ),
) as { identity: Record<string, unknown>; events: unknown[]; finishReasons: string[]; maxDeltaChars: number };

describe('AiStreamEvent cross-runtime fixture', () => {
  it('shares the UTF-16 delta size boundary with native', () => {
    expect(fixture.maxDeltaChars).toBe(AI_STREAM_MAX_DELTA_CHARS);
  });

  it('covers every finish reason with the same wire spelling as native', () => {
    expect(fixture.finishReasons).toEqual(AiExecutionFinishReasonSchema.options);
    for (const reason of fixture.finishReasons) {
      expect(AiExecutionFinishReasonSchema.parse(reason)).toBe(reason);
    }
  });

  it('validates every event with the authoritative ai-core schema', () => {
    expect(fixture.events.length).toBeGreaterThanOrEqual(5);

    for (const event of fixture.events) {
      const parsed = AiStreamEventSchema.safeParse(event);
      expect(parsed.success, JSON.stringify(event)).toBe(true);
    }
  });

  it('covers every event variant the native side must emit', () => {
    const types = new Set(fixture.events.map((event) => (event as { type: string }).type));
    for (const required of [
      'started',
      'text-delta',
      'reasoning-delta',
      'usage',
      'result',
    ]) {
      expect(types.has(required), `fixture must cover ${required}`).toBe(true);
    }
  });

  it('covers all three terminal statuses', () => {
    const statuses = new Set(
      fixture.events
        .filter((event) => (event as { type: string }).type === 'result')
        .map((event) => (event as { result: { status: string } }).result.status),
    );
    expect([...statuses].sort()).toEqual(['cancelled', 'completed', 'failed']);
  });

  it('rejects an event carrying a field the contract does not define', () => {
    const polluted = { ...(fixture.events[0] as object), unexpected: true };
    // strict schema 会拒绝多余字段，因此 fixture 里的字段集合本身就是受控的。
    expect(AiStreamEventSchema.safeParse(polluted).success).toBe(false);
  });
});
