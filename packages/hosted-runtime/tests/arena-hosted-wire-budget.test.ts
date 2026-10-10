import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DESKTOP_ARENA_HOSTED_LIMITS, DesktopArenaHostedBodySchema, parseDesktopArenaHostedSseBlock } from '@mahoshojo/contracts/desktop-arena-hosted';
import { encodeGenerationSseEvent, projectArenaGenerationEventForClient } from '@mahoshojo/hosted-api/arena-generation/sse';
import { createArenaGenerationService } from '@mahoshojo/hosted-api/arena-generation/service';
import { createMemoryGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/memory-replay-store';
import { createUnavailableGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/unavailable-replay-store';
import { normalizeUsage } from '../src/node-runtime/usage';
import { createArenaGenerationRuntime } from '../src/arena-generation/runtime';
import { createArenaStreamProjector } from '../src/arena-generation/stream-projector';

// Shared data fixture only; no cross-package source import.
const fixture = JSON.parse(readFileSync(new URL('../../contracts/fixtures/desktop-arena-hosted.json', import.meta.url), 'utf8'));
const textDecoder = new TextDecoder();
describe('Arena Hosted real producer/wire budget evidence', () => {
  it('keeps the actual normalized Gemini/reasoning usage fields through public wire projection', () => {
    const usage = normalizeUsage({ usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 7, thoughtsTokenCount: 3, completionTokensIncludesReasoning: true } });
    expect(usage).toMatchObject({ textTokens: 7, completionTokensIncludesReasoning: true });
    const projected = projectArenaGenerationEventForClient({ id: '3-0', type: 'telemetry', data: { model: 'synthetic', usage, providerName: 'private' } });
    const parsed = parseDesktopArenaHostedSseBlock(textDecoder.decode(encodeGenerationSseEvent(projected)));
    expect(parsed.data).toMatchObject({ aiModel: 'synthetic', usage: { textTokens: 7, completionTokensIncludesReasoning: true } });
    const snapshot = projectArenaGenerationEventForClient({ id: '3-1', type: 'snapshot', data: { status: 'completed', markdown: 'x', reasoning: '', lastEventId: null, updatedAt: '2026-10-10T00:00:00.000Z', telemetry: projected.data } });
    expect(parseDesktopArenaHostedSseBlock(textDecoder.decode(encodeGenerationSseEvent(snapshot))).event).toBe('snapshot');
  });
  it('retains real Arena reference capacity above fifty items per collection', async () => {
    const payload = { ...fixture.validOperations[0]!.body!,
      readNarrativeHistory: true, narrativeHistoryReadLimit: null,
      narrativeHistory: Array.from({ length: 51 }, () => ({ title: 't', content: 'body', createdAt: '2026-10-10T00:00:00.000Z' })),
      questionnaires: Array.from({ length: 51 }, () => ({ loreMarkdown: 'lore' })),
    };
    const runtime = createArenaGenerationRuntime({
      checkSafety: async () => null, buildPrompt: async () => ({ prompt: 'synthetic', metadata: { mode: 'daily' } }),
      generate: async () => { throw new Error('must not run model'); }, finalize: async () => ({ resultRef: null, ranking: null }),
    });
    const prepared = await runtime.prepare!({ request: new Request('https://synthetic.test'), actorKey: 'user:42', generationRequestId: 'arena_request_1234', payload });
    expect(prepared).not.toBeInstanceOf(Response);
    expect(DesktopArenaHostedBodySchema.safeParse(payload).success).toBe(true);
  });
  it('accepts the actual producer exception telemetry before its failed terminal', async () => {
    const service = createArenaGenerationService({
      store: createMemoryGenerationReplayStore(),
      executor: { execute: async () => { throw new TypeError('synthetic private message'); } },
      resolveActor: async () => ({ actorKey: 'user:42' }), deriveGenerationId: async () => `arena_${'a'.repeat(64)}`,
      hashPayload: async () => 'a'.repeat(64), now: () => new Date(), replayPollMs: 1,
    });
    const response = await service.create(new Request('https://synthetic.test/api/arena/generate-stream', {
      method: 'POST', body: JSON.stringify({ generationRequestId: 'arena_request_1234' }),
    }));
    expect(response.status).toBe(200);
    const wire = await response.text();
    const events = wire.split('\n\n').filter(Boolean).map((block) => parseDesktopArenaHostedSseBlock(block + '\n\n'));
    expect(events).toContainEqual(expect.objectContaining({ event: 'telemetry', data: { errorClass: 'TypeError' } }));
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { status: 'failed', ok: false } });
    expect(wire).not.toContain('synthetic private message');
  });
  it('real durable fallback and SSE encoder retain a full 4 MiB worst-escaping body', async () => {
    const recipe = fixture.boundaryRecipes.snapshot;
    const markdown = recipe.character.repeat(recipe.repeat);
    const generationId = `arena_${'a'.repeat(64)}`;
    const terminal = { generationId, generationRequestId: 'arena_request_1234', status: 'completed' as const,
      updatedAt: recipe.updatedAt, payloadHash: 'a'.repeat(64), resultRef: null, markdown, reasoning: '', contentAvailable: true,
      telemetry: { model: 'synthetic-model', usage: { completionTokens: 1 }, reasoning: 'private-duplicate-reasoning', providerName: 'private-provider' },
    };
    const service = createArenaGenerationService({
      store: createUnavailableGenerationReplayStore(), terminalStore: { readOwnedTerminal: async () => terminal },
      executor: { execute: async () => { throw new Error('must never create while resuming'); } },
      resolveActor: async () => ({ actorKey: 'user:42' }), deriveGenerationId: async () => generationId,
      hashPayload: async () => 'a'.repeat(64), now: () => new Date(recipe.updatedAt),
    });
    const response = await service.resume(new Request(`https://synthetic.test/api/arena/generations/${generationId}/stream`), { generationId });
    expect(response.status, response.status !== 200 ? await response.clone().text() : '').toBe(200);
    const blocks = (await response.text()).split('\n\n').filter(Boolean).map((block) => block + '\n\n');
    const events = blocks.map(parseDesktopArenaHostedSseBlock);
    expect(events.map((event) => event.event)).toEqual(['snapshot', 'done']);
    const snapshot = events[0]!;
    expect(snapshot.event).toBe('snapshot');
    if (snapshot.event !== 'snapshot') throw new Error('missing snapshot');
    expect(snapshot.data.markdown).toBe(markdown); expect(snapshot.data.reasoning).toBe('');
    expect(snapshot.data.telemetry).toEqual({ version: 1, aiModel: 'synthetic-model', usage: { completionTokens: 1 } });
    expect(new TextEncoder().encode(blocks[0]!).byteLength).toBeGreaterThan(6 * DESKTOP_ARENA_HOSTED_LIMITS.outputContentBytes);
    expect(new TextEncoder().encode(blocks[0]!).byteLength).toBeLessThanOrEqual(DESKTOP_ARENA_HOSTED_LIMITS.eventWireBytes);
    expect(blocks.join('')).not.toContain('private-duplicate-reasoning');
  });
  it('real control-tail projector preserves a near-source-limit meta and its raw summary within the independent wire budget', () => {
    const recipe = fixture.boundaryRecipes.meta;
    const wrap = (headline: string) => `<!-- MAHOSHOJO_ARENA_META ${JSON.stringify({ report: { headline } })} -->`;
    const overhead = new TextEncoder().encode(wrap('')).byteLength;
    expect(recipe.headlineRepeat + overhead).toBe(recipe.sourceBytes);
    const raw = wrap(recipe.headlineCharacter.repeat(recipe.headlineRepeat));
    expect(new TextEncoder().encode(raw).byteLength).toBe(DESKTOP_ARENA_HOSTED_LIMITS.outputContentBytes);
    const projector = createArenaStreamProjector({ expectsMeta: true, strictTrailer: true });
    expect(projector.push(raw)).toEqual([]); expect(projector.finish().markdown).toEqual([]);
    const produced = projector.result().metaEvent!;
    const wire = encodeGenerationSseEvent(projectArenaGenerationEventForClient({ id: recipe.id, ...produced }));
    expect(wire.byteLength).toBe(recipe.wireBytes);
    expect(wire.byteLength).toBeLessThanOrEqual(DESKTOP_ARENA_HOSTED_LIMITS.eventWireBytes);
    const event = parseDesktopArenaHostedSseBlock(textDecoder.decode(wire));
    expect(event.event).toBe('meta');
    if (event.event !== 'meta') throw new Error('missing meta');
    expect(event.data.raw.length).toBe(recipe.rawCodeUnits); expect(event.data.rawTruncated).toBe(true);
    expect(event.data.meta).toEqual({ report: { headline: 'x'.repeat(DESKTOP_ARENA_HOSTED_LIMITS.outputContentBytes - overhead) } });
  });
});
