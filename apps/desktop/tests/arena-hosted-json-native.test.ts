import { describe, expect, it } from 'vitest';
import { consumeArenaCompanionNativeFixture } from './helpers/arena-companion-native-fixture';
const maximum = process.env.MAHO_ARENA_COMPANION_NATIVE_JSONL;
const utf16 = process.env.MAHO_ARENA_COMPANION_UTF16_EVENTS;
const errorUtf16 = process.env.MAHO_ARENA_COMPANION_ERROR_UTF16_EVENTS;
describe('actual Native HTTP companion sink through the production TypeScript bridge', () => {
  it.skipIf(!maximum)('reassembles the same maximum producer wire without accumulating an event array', async () => {
    const value = await consumeArenaCompanionNativeFixture(maximum!);
    expect(value.invokeCount).toBe(1); expect(value.eventCount).toBe(value.fragments + 2);
    expect(value.bytes).toBe(75497013);
    expect(value.wireSha256).toBe('8a4668ad8319b06e99fcad61607a0e9b10167388f55e45748ddc8d0c9ffe8482');
    expect(value.reply.response.status).toBe(200); expect(value.reply.envelope.metadata?.reportFormat).toBe('web');
    if (!('report' in value.reply.envelope.body)) throw new Error('fixture report missing');
    expect(value.reply.envelope.body.report.webHtml).toBe(value.reply.envelope.body.report.article.body);
    expect(value.reply.envelope.body.updatedCombatants).toEqual([]);
  }, 120000);
  it.skipIf(!utf16)('preserves actual producer isolated UTF-16 guidance code units through Native and strict TS parsing', async () => {
    const value = await consumeArenaCompanionNativeFixture(utf16!);
    if (!('report' in value.reply.envelope.body)) throw new Error('fixture report missing');
    const report = value.reply.envelope.body.report;
    expect(report.userGuidance?.length).toBe(200); expect(report.userGuidance?.charCodeAt(199)).toBe(0xd83d);
    expect(report.characterGuidances?.[0]?.guidance.length).toBe(100);
    expect(report.characterGuidances?.[0]?.guidance.charCodeAt(99)).toBe(0xd83d);
    expect(value.reply.envelope.metadata?.userGuidance).toBe(report.userGuidance); expect(value.invokeCount).toBe(1);
  });
  it.skipIf(!errorUtf16)('preserves checked public errors containing isolated UTF-16 without turning them into reports', async () => {
    const value = await consumeArenaCompanionNativeFixture(errorUtf16!);
    expect(value.reply.response.status).toBe(502);
    expect(value.reply.envelope.body).toMatchObject({ error: '失败\ud800', message: '提示\ud800', resultRef: 'r2:\ud800' });
    expect(value.reply.envelope.body).not.toHaveProperty('report');
  });

});
