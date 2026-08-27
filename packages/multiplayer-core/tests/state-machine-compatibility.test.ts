import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import {
  parseArenaRoomAuthorityState,
  transitionArenaRoom,
} from '../src/index';
import { TEST_TIMESTAMP, createRoomCommand } from './state-machine-fixtures';

const fixtureDirectory = fileURLToPath(new URL('../../contracts/tests/fixtures', import.meta.url));
const sourceDirectory = fileURLToPath(new URL('../src', import.meta.url));

const loadFixture = async (name: string): Promise<unknown> => JSON.parse(
  await readFile(join(fixtureDirectory, name), 'utf8'),
);

describe('Arena Room state-machine compatibility and portability', () => {
  it('accepts the current snapshot fixture and rejects old/new protocol fixtures', async () => {
    const current = await loadFixture('arena-room-v1.json');
    const old = await loadFixture('arena-room-v0-unsupported.json');
    const next = await loadFixture('arena-room-v2-unsupported.json');
    const wrap = (snapshot: unknown) => ({
      lifecycle: {
        status: 'open',
        createdAt: TEST_TIMESTAMP,
        updatedAt: TEST_TIMESTAMP,
      },
      snapshot,
    });

    expect(parseArenaRoomAuthorityState(wrap(current))).toMatchObject({
      snapshot: { protocolVersion: 1, schemaVersion: 1, revision: 7 },
    });
    expect(() => parseArenaRoomAuthorityState(wrap(old))).toThrowError(
      expect.objectContaining({ code: 'invalid-input' }),
    );
    expect(() => parseArenaRoomAuthorityState(wrap(next))).toThrowError(
      expect.objectContaining({ code: 'invalid-input' }),
    );
  });

  it.each(['browser', 'node', 'neutral'] as const)('bundles the public entry for %s without runtime globals', async (platform) => {
    const result = await build({
      bundle: true,
      entryPoints: [join(sourceDirectory, 'index.ts')],
      format: 'esm',
      logLevel: 'silent',
      platform,
      write: false,
    });
    const output = result.outputFiles.map((file) => file.text).join('\n');
    expect(output).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it('keeps source imports free of Hono, Redis, WebSocket, D1, Node, and Cloudflare runtimes', async () => {
    const files = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.ts'));
    for (const file of files) {
      const source = await readFile(join(sourceDirectory, file), 'utf8');
      expect(source, file).not.toMatch(/from\s+['"](?:@hono\/|hono(?:\/|['"])|ioredis(?:\/|['"])|redis(?:\/|['"])|ws(?:\/|['"])|node:|cloudflare:)/);
      expect(source, file).not.toMatch(/\b(?:process\.env|import\.meta\.env)\b/);
    }
  });

  it('returns a fixed validation error rather than serializing malformed state or command data', () => {
    const secret = 'state-machine-secret-canary';
    const invalidState = {
      lifecycle: { status: 'open', createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP },
      snapshot: { protocolVersion: 1, apiKey: secret },
    };
    const result = transitionArenaRoom(invalidState, createRoomCommand());
    expect(result).toMatchObject({ ok: false, code: 'validation-failed', reason: 'invalid-state' });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
