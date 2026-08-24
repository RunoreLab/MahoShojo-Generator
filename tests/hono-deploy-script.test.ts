import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const deployScriptPath = path.resolve('apps/api/deploy/deploy-bundle.sh');
const temporaryDirectories: string[] = [];

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex');

const writeExecutable = (filePath: string, content: string): void => {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
};

const createRelease = (rootDirectory: string): { releaseDirectory: string; releaseId: string } => {
  const files = {
    'index.mjs': 'console.info("fixture");\n',
    'compose.yml': 'services:\n  hono:\n    image: node:22-alpine\n',
    'deploy-bundle.sh': readFileSync(deployScriptPath, 'utf8'),
  };
  const manifest = Object.entries(files)
    .map(([name, content]) => `${sha256(content)}  ${name}`)
    .join('\n') + '\n';
  const releaseId = sha256(manifest);
  const releaseDirectory = path.join(rootDirectory, 'releases', releaseId);
  mkdirSync(releaseDirectory, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(releaseDirectory, name), content);
  }
  chmodSync(path.join(releaseDirectory, 'deploy-bundle.sh'), 0o755);
  writeFileSync(path.join(releaseDirectory, 'release.manifest'), manifest);
  writeFileSync(
    path.join(releaseDirectory, 'release.sha256'),
    `${releaseId}  release.manifest\n`,
  );
  return { releaseDirectory, releaseId };
};

const createFixture = () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'mahoshojo-deploy-test-'));
  temporaryDirectories.push(temporaryDirectory);
  const rootDirectory = path.join(temporaryDirectory, 'root');
  const commandDirectory = path.join(temporaryDirectory, 'bin');
  const commandLog = path.join(temporaryDirectory, 'commands.log');
  mkdirSync(path.join(rootDirectory, 'releases'), { recursive: true });
  mkdirSync(commandDirectory, { recursive: true });
  writeFileSync(path.join(rootDirectory, '.env.hono'), 'FIXTURE=true\n');

  const previousReleaseDirectory = path.join(rootDirectory, 'releases', 'previous-release');
  mkdirSync(previousReleaseDirectory, { recursive: true });
  writeFileSync(
    path.join(previousReleaseDirectory, 'compose.yml'),
    'services:\n  hono:\n    image: node:20-alpine\n',
  );
  writeFileSync(
    path.join(rootDirectory, '.env'),
    `HONO_RELEASE_DIR=${previousReleaseDirectory}\n`,
  );
  symlinkSync(previousReleaseDirectory, path.join(rootDirectory, 'current'));

  writeExecutable(path.join(commandDirectory, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$HONO_DEPLOY_TEST_COMMAND_LOG"
exit 0
`);
  writeExecutable(path.join(commandDirectory, 'curl'), `#!/bin/sh
headers=''
body=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dump-header) shift; headers="$1" ;;
    --output) shift; body="$1" ;;
  esac
  shift
done
if [ -n "$headers" ]; then
  printf 'Access-Control-Allow-Origin: https://mahoshojo.colanns.me\\r\\n' > "$headers"
fi
if [ -n "$body" ]; then
  printf '%s' '{"error":"Name is required"}' > "$body"
fi
printf '%s' "\${HONO_DEPLOY_TEST_PROBE_STATUS:-400}"
exit 0
`);

  const release = createRelease(rootDirectory);
  return {
    ...release,
    commandDirectory,
    commandLog,
    previousReleaseDirectory,
    rootDirectory,
  };
};

const runDeployment = (
  fixture: ReturnType<typeof createFixture>,
  probeStatus = '400',
) => spawnSync(
  'sh',
  [path.join(fixture.releaseDirectory, 'deploy-bundle.sh'), fixture.releaseId, 'https://example.test'],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      HONO_DEPLOY_ROOT_DIR: fixture.rootDirectory,
      HONO_DEPLOY_TEST_COMMAND_LOG: fixture.commandLog,
      HONO_DEPLOY_TEST_PROBE_STATUS: probeStatus,
      PATH: `${fixture.commandDirectory}:${process.env.PATH ?? ''}`,
    },
  },
);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Hono release-local deployment transaction', () => {
  test('完整 contract 通过后才原子 promotion 当前 release', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture);

    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.releaseDirectory,
    );
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${fixture.releaseDirectory}\n`,
    );
    expect(readFileSync(fixture.commandLog, 'utf8')).toContain(
      `-f ${fixture.releaseDirectory}/compose.yml up -d --force-recreate hono`,
    );
  });

  test('公网 retained-route contract 失败时恢复 previous release-local tuple', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, '500');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('开始回滚 tuple');
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${fixture.previousReleaseDirectory}\n`,
    );
    expect(readFileSync(fixture.commandLog, 'utf8')).toContain(
      `-f ${fixture.previousReleaseDirectory}/compose.yml up -d --force-recreate hono`,
    );
  });

  test('tuple 内容与 release manifest 不匹配时在 Docker 激活前 fail closed', () => {
    const fixture = createFixture();
    copyFileSync(
      path.join(fixture.previousReleaseDirectory, 'compose.yml'),
      path.join(fixture.releaseDirectory, 'compose.yml'),
    );

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(existsSync(fixture.commandLog)).toBe(false);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
  });

  test('promotion 文件系统操作失败时仍恢复 previous compose 与环境', () => {
    const fixture = createFixture();
    unlinkSync(path.join(fixture.rootDirectory, 'current'));
    mkdirSync(path.join(fixture.rootDirectory, 'current'));

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('开始回滚 tuple');
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${fixture.previousReleaseDirectory}\n`,
    );
    expect(readFileSync(fixture.commandLog, 'utf8')).toContain(
      `-f ${fixture.previousReleaseDirectory}/compose.yml up -d --force-recreate hono`,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'current.next'))).toBe(false);
  });

  test('首次发布 contract 失败时停止新 compose 并清理 active env', () => {
    const fixture = createFixture();
    rmSync(path.join(fixture.rootDirectory, '.env'));
    unlinkSync(path.join(fixture.rootDirectory, 'current'));

    const result = runDeployment(fixture, '500');

    expect(result.status).toBe(1);
    expect(existsSync(path.join(fixture.rootDirectory, '.env'))).toBe(false);
    expect(readFileSync(fixture.commandLog, 'utf8')).toContain(
      `-f ${fixture.releaseDirectory}/compose.yml down`,
    );
  });
});
