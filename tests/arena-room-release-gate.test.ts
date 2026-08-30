import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/check-arena-room-release-gate.mjs');
const schemaScript = resolve(process.cwd(), 'scripts/arena-room-release-gate-schema.mjs');
const prepareScript = resolve(process.cwd(), 'scripts/prepare-arena-room-release-gate.mjs');
const manifestPath = resolve(process.cwd(), 'config/arena-room-release-gate.json');

const run = (args: string[], env: NodeJS.ProcessEnv = {}) => {
  const childEnv = {
    PATH: process.env.PATH,
    ...env,
  };
  return spawnSync(
    process.execPath,
    [script, ...args],
    { cwd: process.cwd(), encoding: 'utf8', env: childEnv },
  );
};

const runSchema = (manifest: string, extraArgs: string[] = []) => {
  const directory = mkdtempSync(join(tmpdir(), 'arena-room-release-gate-schema.'));
  const candidatePath = join(directory, 'candidate.json');
  writeFileSync(candidatePath, manifest);
  return spawnSync(
    process.execPath,
    [schemaScript, '--manifest', candidatePath, ...extraArgs],
    { cwd: process.cwd(), encoding: 'utf8', env: { PATH: process.env.PATH } },
  );
};

describe('Arena Room release gate', () => {
  it('keeps current writer disabled while executable reader/rollback evidence remains present', () => {
    const result = run([]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      gate: 'ARENA_ROOM_RELEASE_GATE',
      mode: 'verify',
      writerActivation: 'disabled',
      status: 'PASS',
    });
  });

  it('fails writer activation closed without reader rollout and production go/no-go attestations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arena-room-release-gate.'));
    const enabledManifest = join(directory, 'enabled.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(enabledManifest, JSON.stringify({ ...manifest, writerActivation: 'enabled' }));

    const rejected = run(['--mode', 'deploy', '--manifest', enabledManifest]);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toMatch(/compatible reader rollout.*production go\/no-go/su);

    const accepted = run(['--mode', 'deploy', '--manifest', enabledManifest], {
      ARENA_ROOM_READER_ROLLOUT_CONTRACT: String(manifest.checkpointContract),
      ARENA_ROOM_PRODUCTION_GO_NO_GO: 'approved',
    });
    expect(accepted.status, accepted.stderr).toBe(0);
  });

  it('requires generation start disabled and a compatible target reader before rollback', () => {
    expect(run(['--mode', 'rollback']).status).toBe(1);
    expect(run(['--mode', 'rollback'], {
      ARENA_MULTIPLAYER_GENERATION_START_STATE: 'disabled',
      ARENA_ROOM_TARGET_READER_CONTRACT: 'legacy-reader',
    }).status).toBe(1);
    expect(run(['--mode', 'rollback'], {
      ARENA_MULTIPLAYER_GENERATION_START_STATE: 'disabled',
      ARENA_ROOM_TARGET_READER_CONTRACT: 'arena-room-authority-v2-generation-payload-digest-v1',
    }).status).toBe(0);
  });

  it('prepares an immutable writer-enabled candidate only with exact attestations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arena-room-release-gate-prepare.'));
    const output = join(directory, 'candidate.json');
    const runPrepare = (env: NodeJS.ProcessEnv = {}) => spawnSync(
      process.execPath,
      [prepareScript, '--writer', 'enabled', '--output', output],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { PATH: process.env.PATH, ...env },
      },
    );

    expect(runPrepare().status).toBe(1);
    const accepted = runPrepare({
      ARENA_ROOM_READER_ROLLOUT_CONTRACT:
        'arena-room-authority-v2-generation-payload-digest-v1',
      ARENA_ROOM_PRODUCTION_GO_NO_GO: 'approved',
    });
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
      writerActivation: 'enabled',
      checkpointContract: 'arena-room-authority-v2-generation-payload-digest-v1',
    });
    expect(readFileSync(manifestPath, 'utf8')).toContain('"writerActivation": "disabled"');
  });

  it('validates the complete release-gate JSON schema instead of matching nested text', () => {
    const canonical = readFileSync(manifestPath, 'utf8');
    expect(runSchema(canonical).status).toBe(0);

    const malformed = runSchema('{"writerActivation":"disabled"');
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toMatch(/JSON/u);

    const nestedOnly = runSchema(JSON.stringify({
      metadata: {
        writerActivation: 'disabled',
        checkpointContract: 'arena-room-authority-v2-generation-payload-digest-v1',
      },
    }));
    expect(nestedOnly.status).toBe(1);
    expect(nestedOnly.stderr).toMatch(/字段/u);

    const withUnexpectedField = JSON.parse(canonical) as Record<string, unknown>;
    withUnexpectedField.untrusted = true;
    expect(runSchema(JSON.stringify(withUnexpectedField)).status).toBe(1);

    const wrongContract = JSON.parse(canonical) as Record<string, unknown>;
    wrongContract.checkpointContract = 'legacy-reader';
    expect(runSchema(JSON.stringify(wrongContract), [
      '--expect-contract',
      'arena-room-authority-v2-generation-payload-digest-v1',
    ]).status).toBe(1);
  });
});
