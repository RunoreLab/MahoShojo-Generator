/** Optional real Next producer → Rust loopback/IPC → production TS bridge capacity evidence. */
import { createReadStream, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { applyArenaReconciliationUpdates } from '@mahoshojo/domain/arena-reconciliation';
import { ARENA_RECONCILIATION_LIMITS } from '@mahoshojo/contracts/arena-reconciliation';
import { reconcileArenaHosted } from '../src/platform/arena-reconciliation-bridge';
import type { ArenaHostedChannel } from '../src/platform/arena-hosted-bridge';
const maximum = process.env.MAHO_ARENA_RECONCILIATION_NATIVE_JSONL;
const producer = process.env.MAHO_ARENA_RECONCILIATION_PRODUCER_JSON;
const failure = process.env.MAHO_ARENA_RECONCILIATION_ERROR_JSONL;
const overflow = process.env.MAHO_ARENA_RECONCILIATION_OVERFLOW_JSONL;
const generationId = `arena_${'a'.repeat(64)}`;
async function fileHash(path: string) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex');
}
async function consume(path: string) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  const channel: ArenaHostedChannel = { onmessage: () => undefined };
  let finishNative!: () => void, requestId = '', byteCount = 0, events = 0, invokeCount = 0;
  const nativeDone = new Promise<void>(resolve => { finishNative = resolve; });
  let observed: Promise<{ reply: Awaited<ReturnType<typeof reconcileArenaHosted>> } | { error: unknown }> | undefined;
  const hash = createHash('sha256');
  try {
    for await (const line of lines) {
      if (!line.trim()) continue; const event = JSON.parse(line) as Record<string, unknown>;
      if (!observed) {
        if (typeof event.requestId !== 'string') throw new Error('Native fixture lacks request identity'); requestId = event.requestId;
        observed = reconcileArenaHosted(async command => { invokeCount += 1; if (command !== 'arena_hosted_stream') throw new Error('unexpected detach'); await nativeDone; },
          { product: 'battle', requestId, actor: { kind: 'anonymous' } },
          { generationId, combatants: [{ type: 'general-character', data: { name: 'capacity' } }] }, { createChannel: () => channel })
          .then(reply => ({ reply }), error => ({ error }));
      }
      if (event.kind === 'json-fragment' && typeof event.text === 'string') { byteCount += Buffer.byteLength(event.text); hash.update(event.text); }
      events += 1; channel.onmessage(event);
    }
  } finally { lines.close(); finishNative(); }
  if (!observed) throw new Error('empty Native fixture');
  const result = await observed; if ('error' in result) throw result.error;
  return { ...result, byteCount, events, invokeCount, sha256: hash.digest('hex') };
}
describe('actual bounded role wire across all three runtimes', () => {
  it.skipIf(!maximum || !producer)('reassembles the exact 16MiB real producer response and applies through the shared domain seam', async () => {
    const expectedHash = await fileHash(producer!); expect(statSync(producer!).size).toBe(ARENA_RECONCILIATION_LIMITS.responseBodyBytes);
    const value = await consume(maximum!); expect(value.byteCount).toBe(ARENA_RECONCILIATION_LIMITS.responseBodyBytes); expect(value.sha256).toBe(expectedHash); expect(value.invokeCount).toBe(1);
    if (!('success' in value.reply)) throw new Error('producer result missing');
    const original = [{ type: 'general-character', data: { name: 'original' }, isValid: false }];
    const updated = applyArenaReconciliationUpdates(original, value.reply.updatedCombatants);
    expect(updated.updatedCombatants).toHaveLength(1); expect(updated.combatants[0]!.data).toEqual(value.reply.updatedCombatants[0]!.data); expect(original[0]!.data).toEqual({ name: 'original' });
  }, 120_000);
  it.skipIf(!failure)('retains the real producer +1 rejection without partially applying any update', async () => {
    const value = await consume(failure!); expect(value.reply).toMatchObject({ code: 'ARENA_RECONCILIATION_RESPONSE_TOO_LARGE' }); expect(value.reply).not.toHaveProperty('updatedCombatants'); expect(value.invokeCount).toBe(1);
  });
  it.skipIf(!overflow)('Native independently rejects the +1 raw producer body with zero IPC to apply', () => { expect(statSync(overflow!).size).toBe(0); });
});
