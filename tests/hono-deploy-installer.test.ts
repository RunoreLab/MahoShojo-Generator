import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const installerPath = path.resolve('apps/api/deploy/install-bundle.sh');
const arenaRoomReleaseGatePath = path.resolve('config/arena-room-release-gate.json');
const temporaryDirectories: string[] = [];
const realMvPath = spawnSync('which', ['mv'], { encoding: 'utf8' }).stdout.trim();
const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex');

const createFixture = () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'mahoshojo-installer-test-'));
  temporaryDirectories.push(temporaryDirectory);
  const rootDirectory = path.join(temporaryDirectory, 'root');
  mkdirSync(path.join(rootDirectory, 'releases'), { recursive: true });
  return { rootDirectory, temporaryDirectory };
};

const runInstaller = (
  rootDirectory: string,
  arguments_: string[],
  extraEnvironment: NodeJS.ProcessEnv = {},
) => spawnSync(
  'sh',
  [installerPath, ...arguments_],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      HONO_DEPLOY_ROOT_DIR: rootDirectory,
      ...extraEnvironment,
    },
  },
);

const writeTuple = (directory: string, label = 'fixture') => {
  const files = {
    'index.mjs': `console.info(${JSON.stringify(label)});\n`,
    'compose.yml': `services:\n  hono:\n    image: ${label}\n`,
    'deploy-bundle.sh': '#!/bin/sh\nexit 0\n',
    'arena-room-release-gate.json': readFileSync(arenaRoomReleaseGatePath, 'utf8'),
  };
  const manifest = Object.entries(files)
    .map(([name, content]) => `${sha256(content)}  ${name}`)
    .join('\n') + '\n';
  const releaseId = sha256(manifest);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(directory, name), content);
  }
  chmodSync(path.join(directory, 'deploy-bundle.sh'), 0o755);
  writeFileSync(path.join(directory, 'release.manifest'), manifest);
  writeFileSync(path.join(directory, 'release.sha256'), `${releaseId}  release.manifest\n`);
  return releaseId;
};

const waitForFile = async (filePath: string, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(filePath)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const waitForProcessClose = (
  child: ReturnType<typeof spawn>,
  timeoutMs = 2_000,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for process ${child.pid ?? 'unknown'}`));
    }, timeoutMs);
    child.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Hono remote release installer', () => {
  test('随机 staging 通过完整校验后才原子纳管最终 release', () => {
    const fixture = createFixture();
    const created = runInstaller(fixture.rootDirectory, ['create']);
    const stagingDirectory = created.stdout.trim();

    expect(created.status, created.stderr).toBe(0);
    expect(stagingDirectory).toMatch(/\/releases\/\.upload\.[A-Za-z0-9]+$/u);
    const releaseId = writeTuple(stagingDirectory);

    const installed = runInstaller(fixture.rootDirectory, [
      'install',
      releaseId,
      stagingDirectory,
    ]);
    const finalDirectory = path.join(fixture.rootDirectory, 'releases', releaseId);

    expect(installed.status, installed.stderr).toBe(0);
    expect(installed.stdout.trim()).toBe(finalDirectory);
    expect(existsSync(stagingDirectory)).toBe(false);
    expect(readFileSync(path.join(finalDirectory, 'release.sha256'), 'utf8')).toBe(
      `${releaseId}  release.manifest\n`,
    );
  });

  test('最终 release 路径是 symlink 时不覆盖链接目标并保留 staging', () => {
    const fixture = createFixture();
    const created = runInstaller(fixture.rootDirectory, ['create']);
    const stagingDirectory = created.stdout.trim();

    expect(created.status, created.stderr).toBe(0);
    const releaseId = writeTuple(stagingDirectory);
    const canaryDirectory = path.join(fixture.temporaryDirectory, 'canary');
    mkdirSync(canaryDirectory);
    writeFileSync(path.join(canaryDirectory, 'sentinel'), 'must-stay\n');
    symlinkSync(
      canaryDirectory,
      path.join(fixture.rootDirectory, 'releases', releaseId),
      'dir',
    );

    const installed = runInstaller(fixture.rootDirectory, [
      'install',
      releaseId,
      stagingDirectory,
    ]);

    expect(installed.status).toBe(1);
    expect(readFileSync(path.join(canaryDirectory, 'sentinel'), 'utf8')).toBe('must-stay\n');
    expect(existsSync(stagingDirectory)).toBe(true);
  });

  test('deploy lock 被占用时最终 release 不可见且 staging 保留', async () => {
    const fixture = createFixture();
    const created = runInstaller(fixture.rootDirectory, ['create']);
    expect(created.status, created.stderr).toBe(0);
    const stagingDirectory = created.stdout.trim();
    const releaseId = writeTuple(stagingDirectory);
    const readyFile = path.join(fixture.temporaryDirectory, 'lock-ready');
    const releaseFile = path.join(fixture.temporaryDirectory, 'lock-release');
    const holder = spawn('flock', [
      '-n',
      path.join(fixture.rootDirectory, 'deploy.lock'),
      'sh',
      '-c',
      ': > "$1"; while [ ! -f "$2" ]; do sleep 0.05; done',
      'lock-holder',
      readyFile,
      releaseFile,
    ]);
    let installed: ReturnType<typeof runInstaller> | null = null;
    try {
      await waitForFile(readyFile);
      installed = runInstaller(fixture.rootDirectory, [
        'install',
        releaseId,
        stagingDirectory,
      ]);
    } finally {
      const holderClosed = waitForProcessClose(holder);
      writeFileSync(releaseFile, 'release\n');
      holder.kill('SIGTERM');
      await holderClosed.catch(() => {
        holder.kill('SIGKILL');
      });
    }

    expect(installed?.status).toBe(1);
    expect(existsSync(path.join(fixture.rootDirectory, 'releases', releaseId))).toBe(false);
    expect(existsSync(stagingDirectory)).toBe(true);
  });

  test('上传完成后 tuple 被篡改时拒绝纳管', () => {
    const fixture = createFixture();
    const created = runInstaller(fixture.rootDirectory, ['create']);
    expect(created.status, created.stderr).toBe(0);
    const stagingDirectory = created.stdout.trim();
    const releaseId = writeTuple(stagingDirectory);
    writeFileSync(path.join(stagingDirectory, 'index.mjs'), 'console.info("tampered");\n');

    const installed = runInstaller(fixture.rootDirectory, [
      'install',
      releaseId,
      stagingDirectory,
    ]);

    expect(installed.status).toBe(1);
    expect(existsSync(path.join(fixture.rootDirectory, 'releases', releaseId))).toBe(false);
    expect(existsSync(stagingDirectory)).toBe(true);
  });

  test('最终路径在 rename 前竞态出现时不跟随目录链接且保留 staging', () => {
    const fixture = createFixture();
    const created = runInstaller(fixture.rootDirectory, ['create']);
    expect(created.status, created.stderr).toBe(0);
    const stagingDirectory = created.stdout.trim();
    const releaseId = writeTuple(stagingDirectory);
    const finalDirectory = path.join(fixture.rootDirectory, 'releases', releaseId);
    const canaryDirectory = path.join(fixture.temporaryDirectory, 'race-canary');
    const commandDirectory = path.join(fixture.temporaryDirectory, 'race-bin');
    mkdirSync(canaryDirectory);
    mkdirSync(commandDirectory);
    writeFileSync(path.join(canaryDirectory, 'sentinel'), 'must-stay\n');
    const fakeMv = path.join(commandDirectory, 'mv');
    writeFileSync(fakeMv, `#!/bin/sh
ln -s "$HONO_INSTALL_TEST_RACE_CANARY" "$HONO_INSTALL_TEST_RACE_FINAL"
exec "$HONO_INSTALL_TEST_REAL_MV" "$@"
`);
    chmodSync(fakeMv, 0o755);

    const installed = runInstaller(
      fixture.rootDirectory,
      ['install', releaseId, stagingDirectory],
      {
        HONO_INSTALL_TEST_RACE_CANARY: canaryDirectory,
        HONO_INSTALL_TEST_RACE_FINAL: finalDirectory,
        HONO_INSTALL_TEST_REAL_MV: realMvPath,
        PATH: `${commandDirectory}:${process.env.PATH ?? ''}`,
      },
    );

    expect(installed.status).toBe(1);
    expect(existsSync(stagingDirectory)).toBe(true);
    expect(readFileSync(path.join(canaryDirectory, 'sentinel'), 'utf8')).toBe('must-stay\n');
    expect(existsSync(path.join(canaryDirectory, path.basename(stagingDirectory)))).toBe(false);
  });

  test('既有最终 tuple 损坏时拒绝覆盖并保留新 staging', () => {
    const fixture = createFixture();
    const firstCreated = runInstaller(fixture.rootDirectory, ['create']);
    expect(firstCreated.status, firstCreated.stderr).toBe(0);
    const firstStaging = firstCreated.stdout.trim();
    const releaseId = writeTuple(firstStaging);
    const firstInstalled = runInstaller(fixture.rootDirectory, [
      'install',
      releaseId,
      firstStaging,
    ]);
    expect(firstInstalled.status, firstInstalled.stderr).toBe(0);
    const finalDirectory = path.join(fixture.rootDirectory, 'releases', releaseId);
    writeFileSync(path.join(finalDirectory, 'compose.yml'), 'services: {}\n');

    const secondCreated = runInstaller(fixture.rootDirectory, ['create']);
    expect(secondCreated.status, secondCreated.stderr).toBe(0);
    const secondStaging = secondCreated.stdout.trim();
    writeTuple(secondStaging);

    const secondInstalled = runInstaller(fixture.rootDirectory, [
      'install',
      releaseId,
      secondStaging,
    ]);

    expect(secondInstalled.status).toBe(1);
    expect(readFileSync(path.join(finalDirectory, 'compose.yml'), 'utf8')).toBe('services: {}\n');
    expect(existsSync(secondStaging)).toBe(true);
  });

  test('既有最终 tuple 完全一致时复用且清理 staging', () => {
    const fixture = createFixture();
    const firstCreated = runInstaller(fixture.rootDirectory, ['create']);
    expect(firstCreated.status, firstCreated.stderr).toBe(0);
    const firstStaging = firstCreated.stdout.trim();
    const releaseId = writeTuple(firstStaging);
    expect(runInstaller(fixture.rootDirectory, [
      'install',
      releaseId,
      firstStaging,
    ]).status).toBe(0);

    const secondCreated = runInstaller(fixture.rootDirectory, ['create']);
    expect(secondCreated.status, secondCreated.stderr).toBe(0);
    const secondStaging = secondCreated.stdout.trim();
    writeTuple(secondStaging);

    const reused = runInstaller(fixture.rootDirectory, [
      'install',
      releaseId,
      secondStaging,
    ]);

    expect(reused.status, reused.stderr).toBe(0);
    expect(existsSync(secondStaging)).toBe(false);
  });
});
