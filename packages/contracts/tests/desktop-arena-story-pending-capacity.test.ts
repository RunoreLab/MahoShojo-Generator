import { describe, expect, it } from 'vitest';
import {
  STORY_PENDING_LIMITS, StoryPendingInputSchema, StoryPendingHeaderSchema,
  StoryPendingMetaSchema, StoryPendingRoleResponseSchema,
} from '../src/desktop-arena-story';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const input = (userGuidance: string) => ({
  version: 1, sessionId: 'session', generationRequestId: 'story_request_1234', action: 'start', chapterIndex: 1,
  userGuidance, chapterContext: { recentWindow: [], workingCombatants: [{ name: '雪' }] },
  seed: { combatants: [{ name: '雪' }], mode: 'daily', storyLength: 'default', language: 'zh-CN', settings: {
    readArenaHistory: false, writeArenaHistory: false, readCurrentState: false, writeCurrentState: false,
    readNarrativeHistory: false, writeNarrativeHistory: false,
  } },
});

/** Real serialized carrier boundaries, separate from tiny declaration tests so
 * memory-heavy Native capacity runs can use their own reserved execution window. */
describe('durable pending exact original JSON capacity', () => {
  it.each(['x', '雪', '\u0000', '\ud800'])('keeps the exact 12 MiB input boundary and rejects +1 for %j', (character) => {
    const available = STORY_PENDING_LIMITS.inputBytes - bytes(input(''));
    const unitBytes = bytes(character) - 2;
    const text = character.repeat(Math.floor(available / unitBytes)) + 'x'.repeat(available % unitBytes);
    const value = input(text);
    expect(bytes(value)).toBe(STORY_PENDING_LIMITS.inputBytes);
    const parsed = StoryPendingInputSchema.parse(value);
    expect(parsed.userGuidance).toBe(text);
    expect(bytes(parsed)).toBe(STORY_PENDING_LIMITS.inputBytes);
    expect(StoryPendingInputSchema.safeParse(input(text + 'x')).success).toBe(false);
  });
  it('bounds the exact parsed header JSON at 64 KiB', () => {
    const header = (text: string) => ({ reportFormat: 'markdown', reporterInfo: { text } });
    const text = 'x'.repeat(STORY_PENDING_LIMITS.headerBytes - bytes(header('')));
    expect(bytes(header(text))).toBe(STORY_PENDING_LIMITS.headerBytes);
    expect(StoryPendingHeaderSchema.parse(header(text)).reporterInfo?.text).toBe(text);
    expect(StoryPendingHeaderSchema.safeParse(header(text + 'x')).success).toBe(false);
  });
  it('bounds the exact meta-event JSON, independently of the SSE envelope', () => {
    const meta = (text: string) => ({ id: '1-0', event: 'meta', data: { parseOk: true, meta: { text }, raw: '', rawTruncated: false } });
    const text = 'x'.repeat(STORY_PENDING_LIMITS.metaBytes - bytes(meta('')));
    expect(bytes(meta(text))).toBe(STORY_PENDING_LIMITS.metaBytes);
    expect(StoryPendingMetaSchema.safeParse(meta(text)).success).toBe(true);
    expect(StoryPendingMetaSchema.safeParse(meta(text + 'x')).success).toBe(false);
  });
  it('bounds one complete accepted role response at 16 MiB without trimming card extensions', () => {
    const response = (text: string) => ({ version: 'arena-reconciliation-v1', generationId: 'generation_1234', success: true,
      updatedCombatants: [{ combatantIndex: 0, data: { extension: { text } }, isNative: false }], warnings: [] });
    const text = 'x'.repeat(STORY_PENDING_LIMITS.roleResponseBytes - bytes(response('')));
    expect(bytes(response(text))).toBe(STORY_PENDING_LIMITS.roleResponseBytes);
    const parsed = StoryPendingRoleResponseSchema.parse(response(text));
    expect(parsed.updatedCombatants[0]!.data).toEqual({ extension: { text } });
    expect(StoryPendingRoleResponseSchema.safeParse(response(text + 'x')).success).toBe(false);
  });
});
