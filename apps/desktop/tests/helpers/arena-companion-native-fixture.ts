import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { DesktopArenaHostedJsonCreateRequestSchema } from '@mahoshojo/contracts/desktop-arena-hosted-json';
import { openArenaHostedJson, type ArenaHostedJsonReply } from '../../src/platform/arena-hosted-json-bridge';
import type { ArenaHostedChannel } from '../../src/platform/arena-hosted-bridge';

/** Streams actual Native sink records unchanged into the production bridge. No full event array or raw JSON copy. */
export const consumeArenaCompanionNativeFixture = async (path: string) => {
  const lines = path.endsWith('.jsonl') ? createInterface({ input: createReadStream(path), crlfDelay: Infinity }) : null;
  const records = async function* () {
    if (lines) { for await (const line of lines) if (line.trim()) yield JSON.parse(line) as unknown; }
    else {
      if (statSync(path).size > 4 * 1024 * 1024) throw new Error('large Native fixtures must be streamed JSONL');
      const values: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!Array.isArray(values)) throw new Error('invalid Native fixture array');
      yield* values;
    }
  };
  const channel: ArenaHostedChannel = { onmessage: () => undefined };
  let finishNative!: () => void;
  const nativeDone = new Promise<void>(yes => { finishNative = yes; });
  let observed: Promise<{ reply: ArenaHostedJsonReply } | { error: unknown }> | undefined;
  let eventCount = 0, fragments = 0, bytes = 0, invokeCount = 0;
  const wireHash = createHash('sha256');
  try {
    for await (const message of records()) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('invalid Native fixture');
      const event = message as Record<string, unknown>;
      if (!observed) {
        const request = DesktopArenaHostedJsonCreateRequestSchema.parse({ operation: 'create-json', product: 'battle', requestId: event.requestId,
          actor: { kind: 'anonymous' }, body: { mode: 'daily', reportFormat: 'web', combatants: [{ type: 'general-character', data: { name: 'synthetic fixture' } }],
            writeArenaHistory: false, writeCurrentState: false, arenaFreeRankingEnabled: false } });
        observed = openArenaHostedJson(async command => { invokeCount += 1; if (command !== 'arena_hosted_stream') throw new Error('fixture unexpectedly detached'); await nativeDone; }, request,
          { createChannel: () => channel }).then(reply => ({ reply }), error => ({ error }));
      }
      if (event.kind === 'json-fragment' && typeof event.text === 'string') {
        fragments += 1; bytes += Buffer.byteLength(event.text); wireHash.update(event.text);
      }
      eventCount += 1; channel.onmessage(message);
    }
  } finally { lines?.close(); finishNative(); }
  if (!observed) throw new Error('empty Native fixture');
  const result = await observed;
  if ('error' in result) throw result.error;
  return { ...result, eventCount, fragments, bytes, wireSha256: wireHash.digest('hex'), invokeCount };
};
