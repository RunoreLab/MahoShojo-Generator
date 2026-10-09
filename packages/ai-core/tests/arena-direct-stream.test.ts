import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const fixture = JSON.parse(readFileSync(new URL('../../contracts/fixtures/arena-direct-execution.json', import.meta.url), 'utf8')) as {
  request: unknown;
  events: Array<{ type: string; sequence: number; result?: unknown } & Record<string, unknown>>;
  contentBoundaries: Array<{ name: string; character: string; repeat: number; suffix: string; accepted: boolean }>;
};
import { AiExecutionRequestSchema } from '@mahoshojo/contracts/ai-execution';
import { ArenaAiStreamEventSchema, AiStreamEventSchema, collectAiStreamResult } from '../src/stream-events';
import { parseStructuredJsonWithSchema } from '../src/structured-json';
import { z } from 'zod/v3';

const request = AiExecutionRequestSchema.parse(fixture.request);
const identity = { requestId: request.requestId, contractVersion: request.contractVersion, mode: request.mode };
const events = (text: string, reasoning = '') => [
  { ...identity, type: 'started', sequence: 0 },
  ...((reasoning + text).match(/[\s\S]{1,60000}/g) ?? []).map((delta, index) => ({ ...identity, type: 'text-delta', sequence: index + 1, delta })),
  { ...identity, type: 'result', sequence: Math.ceil((text.length + reasoning.length) / 60000) + 1,
    result: { ...identity, status: 'completed', output: { text, ...(reasoning ? { reasoning } : {}) }, finishReason: 'stop' } },
];

describe('Arena request-selected stream policy', () => {
  it('shares the native round-trip fixture', async () => {
    for (const event of fixture.events) expect(ArenaAiStreamEventSchema.parse(event)).toEqual(event);
    expect(await collectAiStreamResult(request, fixture.events)).toEqual(fixture.events.at(-1)!.result);
  });
  it.each(fixture.contentBoundaries)('$name honors decoded UTF8 content', async ({character, repeat, suffix, accepted}) => {
    const text = character.repeat(repeat) + suffix;
    if (accepted) expect((await collectAiStreamResult(request, events(text))).status).toBe('completed');
    else await expect(collectAiStreamResult(request, events(text))).rejects.toMatchObject({ code: 'limit-exceeded' });
  });
  it('retains the six-family result/stream/parser defaults', async () => {
    const legacy = { ...request, requestKind: undefined, arenaInputJson: undefined };
    const large = events('x'.repeat(1_000_001));
    expect(AiStreamEventSchema.safeParse(large.at(-1)).success).toBe(false);
    await expect(collectAiStreamResult(legacy, large)).rejects.toMatchObject({ code: 'limit-exceeded' });
    expect(() => parseStructuredJsonWithSchema(JSON.stringify({ text: 'x'.repeat(250000) }), z.object({text: z.string()}))).toThrow();
  });
  it.each([
    ['sequence-mismatch', fixture.events.map((e, i) => i === 1 ? { ...e, sequence: 8 } : e)],
    ['identity-mismatch', fixture.events.map((e, i) => i === 1 ? { ...e, requestId: 'wrong' } : e)],
    ['event-after-terminal', [...fixture.events, fixture.events.at(-1)]],
    ['missing-terminal', fixture.events.slice(0, -1)],
  ])('fails closed for %s', async (code, source) => {
    await expect(collectAiStreamResult(request, source as unknown[])).rejects.toMatchObject({ code });
  });
});

const nativeDirectory = process.env.MAHO_NATIVE_EVENT_FIXTURE_DIR;
it.skipIf(!nativeDirectory)('accepts actual Rust loopback-produced boundary events through the TS consumer', async () => {
  for (const boundary of fixture.contentBoundaries) {
    const produced = JSON.parse(readFileSync(join(nativeDirectory!, `arena-${boundary.name}.json`), 'utf8')) as unknown[];
    const result = await collectAiStreamResult({ ...request, requestId: 'arena-boundary' }, produced);
    expect(result.status).toBe(boundary.accepted ? 'completed' : 'failed');
    if (result.status === 'completed') expect(result.output.text).toBe(boundary.character.repeat(boundary.repeat) + boundary.suffix);
  }
});
