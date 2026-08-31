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
  it('defaults to an automatic writer-enabled v2 release without activation attestations', () => {
    const verified = run(['--mode', 'deploy']);

    expect(verified.status, verified.stderr).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      gate: 'ARENA_ROOM_RELEASE_GATE',
      mode: 'deploy',
      writerActivation: 'enabled',
      status: 'PASS',
    });

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({ schemaVersion: 2, writerActivation: 'enabled' });
    expect(manifest).not.toHaveProperty('compatibleReaderRolloutRequired');
    expect(manifest).not.toHaveProperty('productionGoNoGoRequired');
    expect(manifest).not.toHaveProperty('rolloutOrder');
    expect(manifest).not.toHaveProperty('evidence');
  });

  it('prepares the default writer-enabled release without operator environment evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arena-room-release-gate-automatic.'));
    const output = join(directory, 'candidate.json');
    const result = spawnSync(
      process.execPath,
      [prepareScript, '--output', output],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { PATH: process.env.PATH },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      writerActivation: 'enabled',
    });
  });

  it('allows an explicit writer-disabled rollback artifact without operator attestations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arena-room-release-gate.'));
    const output = join(directory, 'disabled.json');
    const prepared = spawnSync(
      process.execPath,
      [prepareScript, '--writer', 'disabled', '--output', output],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { PATH: process.env.PATH },
      },
    );

    expect(prepared.status, prepared.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      writerActivation: 'disabled',
    });
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
    expect(nestedOnly.stderr).toMatch(/schemaVersion|字段/u);

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
