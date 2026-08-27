import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import {
  parseArenaRoomAuthorityState,
  transitionArenaRoom,
} from '../src/index';
import { TEST_TIMESTAMP, createRoomCommand, hostAuthority } from './state-machine-fixtures';

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
      authorityStateVersion: 1,
      lifecycle: {
        status: 'open',
        createdAt: TEST_TIMESTAMP,
        updatedAt: TEST_TIMESTAMP,
      },
      snapshot,
    });
    const currentSnapshot = current as { members: Array<Record<string, unknown>> };
    const currentAuthority = {
      ...wrap(current),
      memberAuthority: currentSnapshot.members.map((member, index) => ({
        accountUserId: 101 + index,
        member,
      })),
    };

    const parsedCurrent = parseArenaRoomAuthorityState(currentAuthority);
    expect(parsedCurrent).toMatchObject({
      snapshot: { protocolVersion: 1, schemaVersion: 1, revision: 7 },
    });
    const transitioned = transitionArenaRoom(parsedCurrent, {
      type: 'publish-config',
      expectedRoomEpoch: 'epoch_01JARENA',
      expectedRevision: 7,
      sharedConfig: {
        ...parsedCurrent.snapshot.sharedConfig,
        userGuidance: 'current fixture transition',
      },
      timestamp: '2026-08-27T16:10:00.000Z',
    }, {
      kind: 'authenticated-user',
      actorUserId: 'user-host',
      accountUserId: 101,
    });
    expect(transitioned).toMatchObject({
      ok: true,
      nextState: { snapshot: { revision: 8 } },
      events: [{ type: 'room.config.updated', controlSeq: 25 }],
    });
    expect(() => parseArenaRoomAuthorityState(wrap(old))).toThrowError(
      expect.objectContaining({ code: 'invalid-input' }),
    );
    expect(() => parseArenaRoomAuthorityState(wrap(next))).toThrowError(
      expect.objectContaining({ code: 'invalid-input' }),
    );

    const prePersistenceInternalShape = structuredClone(currentAuthority) as Record<string, unknown>;
    delete prePersistenceInternalShape.authorityStateVersion;
    expect(() => parseArenaRoomAuthorityState(prePersistenceInternalShape)).toThrowError(
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
    const result = transitionArenaRoom(invalidState, createRoomCommand(), hostAuthority());
    expect(result).toMatchObject({ ok: false, code: 'validation-failed', reason: 'invalid-state' });
    expect(JSON.stringify(result)).not.toContain(secret);

    const created = transitionArenaRoom(null, createRoomCommand(), hostAuthority());
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('expected room creation');
    const invalidAuthority = transitionArenaRoom(created.nextState, {
      type: 'publish-config',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig: created.nextState.snapshot.sharedConfig,
      timestamp: TEST_TIMESTAMP,
    }, {
      ...hostAuthority(),
      apiKey: secret,
    });
    expect(invalidAuthority).toMatchObject({
      ok: false,
      code: 'forbidden',
      reason: 'invalid-authority-context',
    });
    expect(JSON.stringify(invalidAuthority)).not.toContain(secret);
  });
});
