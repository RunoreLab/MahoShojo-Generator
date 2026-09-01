import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const deployScriptPath = path.resolve('apps/api/deploy/deploy-bundle.sh');
const temporaryDirectories: string[] = [];
const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex');

type Fixture = {
  activeFile: string;
  binDirectory: string;
  candidateId: string;
  curlLog: string;
  dockerLog: string;
  previousId: string;
  rootDirectory: string;
};

function writeRelease(
  rootDirectory: string,
  label: string,
  extraFiles: Readonly<Record<string, string>> = {},
): string {
  const files = {
    'index.mjs': `console.info(${JSON.stringify(label)});\n`,
    'compose.yml': `services:\n  hono:\n    image: ${label}\n`,
    'deploy-bundle.sh': readFileSync(deployScriptPath, 'utf8'),
    ...extraFiles,
  };
  const manifest = Object.entries(files)
    .map(([name, content]) => `${sha256(content)}  ${name}`)
    .join('\n') + '\n';
  const releaseId = sha256(manifest);
  const releaseDirectory = path.join(rootDirectory, 'releases', releaseId);
  mkdirSync(releaseDirectory);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(releaseDirectory, name), content);
  }
  chmodSync(path.join(releaseDirectory, 'deploy-bundle.sh'), 0o755);
  writeFileSync(path.join(releaseDirectory, 'release.manifest'), manifest);
  writeFileSync(
    path.join(releaseDirectory, 'release.sha256'),
    `${releaseId}  release.manifest\n`,
  );
  return releaseId;
}

function writeExecutable(filePath: string, source: string): void {
  writeFileSync(filePath, source);
  chmodSync(filePath, 0o755);
}

function createFixture(options: {
  candidateExtraFiles?: Readonly<Record<string, string>>;
  previousExtraFiles?: Readonly<Record<string, string>>;
} = {}): Fixture {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'mahoshojo-deploy-test-'));
  temporaryDirectories.push(temporaryDirectory);
  const rootDirectory = path.join(temporaryDirectory, 'root');
  const binDirectory = path.join(temporaryDirectory, 'bin');
  const activeFile = path.join(temporaryDirectory, 'active-release');
  const curlLog = path.join(temporaryDirectory, 'curl.log');
  const dockerLog = path.join(temporaryDirectory, 'docker.log');
  mkdirSync(path.join(rootDirectory, 'releases'), { recursive: true });
  mkdirSync(binDirectory);
  writeFileSync(path.join(rootDirectory, '.env.hono'), [
    'ARENA_MULTIPLAYER_ENABLED=true',
    'ARENA_ROOM_ALLOWED_ORIGINS=https://mahoshojo.colanns.me',
    '',
  ].join('\n'), { mode: 0o600 });

  writeExecutable(path.join(binDirectory, 'docker'), `#!/bin/sh
set -eu
printf '%s|%s\n' "\${HONO_RELEASE_DIR:-}" "$*" >> "$DEPLOY_TEST_DOCKER_LOG"
case "$*" in
  compose*' config'*) exit 0 ;;
  run*) exit 0 ;;
  compose*' up -d --force-recreate hono'*)
    printf '%s\n' "\${HONO_RELEASE_DIR:-}" > "$DEPLOY_TEST_ACTIVE_FILE"
    exit 0
    ;;
  compose*' down'*)
    : > "$DEPLOY_TEST_ACTIVE_FILE"
    exit 0
    ;;
esac
exit 0
`);
  writeExecutable(path.join(binDirectory, 'sleep'), '#!/bin/sh\nexit 0\n');
  writeExecutable(path.join(binDirectory, 'curl'), `#!/bin/sh
set -eu
headers=''
body=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dump-header) headers="$2"; shift 2 ;;
    --output) body="$2"; shift 2 ;;
    --write-out|--request|--header|--data|--connect-timeout|--max-time|--retry|--retry-delay)
      shift 2
      ;;
    --*) shift ;;
    *) url="$1"; shift ;;
  esac
done
active="$(cat "$DEPLOY_TEST_ACTIVE_FILE" 2>/dev/null || true)"
active_id="\${active##*/}"
printf '%s|%s\n' "$active_id" "$url" >> "$DEPLOY_TEST_CURL_LOG"
if [ -n "\${DEPLOY_TEST_FAIL_LOCAL_RELEASE:-}" ] \
  && [ "$active_id" = "$DEPLOY_TEST_FAIL_LOCAL_RELEASE" ] \
  && [ "$url" = "http://127.0.0.1:18080/health/ready" ]; then
  exit 22
fi
if [ -n "\${DEPLOY_TEST_FAIL_PUBLIC_RELEASE:-}" ] \
  && [ "$active_id" = "$DEPLOY_TEST_FAIL_PUBLIC_RELEASE" ] \
  && [ "$url" = "https://example.test/api/health/ready" ]; then
  exit 22
fi
case "$url" in
  */api/generate-magical-girl)
    [ -z "$headers" ] || printf 'Access-Control-Allow-Origin: https://mahoshojo.colanns.me\r\n' > "$headers"
    [ -z "$body" ] || printf '{"error":"Name is required"}\n' > "$body"
    printf '400'
    ;;
  */api/arena/rooms/v1|*/api/arena/rooms/v1/ws)
    [ -z "$headers" ] || printf 'Access-Control-Allow-Origin: https://mahoshojo.colanns.me\r\n' > "$headers"
    [ -z "$body" ] || printf '{"code":"ROOM_AUTHENTICATION_REQUIRED"}\n' > "$body"
    printf '401'
    ;;
  *) printf '{"status":"ready"}\n' ;;
esac
`);

  const previousId = writeRelease(
    rootDirectory,
    'previous',
    options.previousExtraFiles,
  );
  const candidateId = writeRelease(
    rootDirectory,
    'candidate',
    options.candidateExtraFiles,
  );
  symlinkSync(
    path.join(rootDirectory, 'releases', previousId),
    path.join(rootDirectory, 'current'),
  );
  writeFileSync(activeFile, `${path.join(rootDirectory, 'releases', previousId)}\n`);
  writeFileSync(curlLog, '');
  writeFileSync(dockerLog, '');
  return {
    activeFile,
    binDirectory,
    candidateId,
    curlLog,
    dockerLog,
    previousId,
    rootDirectory,
  };
}

function runDeploy(
  fixture: Fixture,
  mode: 'publish' | 'rollback' = 'publish',
  targetId = fixture.candidateId,
  extraEnvironment: NodeJS.ProcessEnv = {},
) {
  return spawnSync(
    'sh',
    [
      path.join(fixture.rootDirectory, 'releases', targetId, 'deploy-bundle.sh'),
      mode,
      targetId,
      'https://example.test',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixture.binDirectory}:${process.env.PATH ?? ''}`,
        HONO_DEPLOY_ROOT_DIR: fixture.rootDirectory,
        HONO_BIND_PORT: '18080',
        HONO_HOSTED_API_ENVIRONMENT: 'test',
        DEPLOY_TEST_ACTIVE_FILE: fixture.activeFile,
        DEPLOY_TEST_CURL_LOG: fixture.curlLog,
        DEPLOY_TEST_DOCKER_LOG: fixture.dockerLog,
        ...extraEnvironment,
      },
    },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Hono release deployment', () => {
  test('checksum 不匹配时在启动容器前拒绝 candidate', () => {
    const fixture = createFixture();
    writeFileSync(
      path.join(fixture.rootDirectory, 'releases', fixture.candidateId, 'index.mjs'),
      'tampered\n',
    );

    const result = runDeploy(fixture);

    expect(result.status).not.toBe(0);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toContain(fixture.previousId);
    expect(readFileSync(fixture.dockerLog, 'utf8')).not.toContain(fixture.candidateId);
  });

  test('smoke 全部通过后才切换 current，并覆盖多人 HTTP/WSS 鉴权入口', () => {
    const fixture = createFixture();

    const result = runDeploy(fixture);

    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      path.join(fixture.rootDirectory, 'releases', fixture.candidateId),
    );
    expect(readFileSync(fixture.activeFile, 'utf8').trim()).toContain(fixture.candidateId);
    expect(result.stdout).toContain(`RELEASE_ID=${fixture.candidateId}`);
    const curlLog = readFileSync(fixture.curlLog, 'utf8');
    expect(curlLog).toContain('/api/arena/rooms/v1');
    expect(curlLog).toContain('/api/arena/rooms/v1/ws');
  });

  test.each([
    ['已退役 gate 资产', {
      'arena-room-release-gate.json': '{}\n',
      'arena-room-release-gate-schema.mjs': 'export {};\n',
    }],
    ['legacy adoption marker', {
      'legacy-layout': `root-release-layout-v1:${'a'.repeat(64)}\n`,
    }],
  ] as const)('可从包含%s的 checksum previous release 直接发布', (_label, previousExtraFiles) => {
    const fixture = createFixture({
      previousExtraFiles,
    });

    const result = runDeploy(fixture);

    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      path.join(fixture.rootDirectory, 'releases', fixture.candidateId),
    );
  });

  test('candidate 失败时可直接恢复 checksum 历史 previous release', () => {
    const fixture = createFixture({
      previousExtraFiles: {
        'arena-room-release-gate.json': '{}\n',
        'arena-room-release-gate-schema.mjs': 'export {};\n',
      },
    });

    const result = runDeploy(fixture, 'publish', fixture.candidateId, {
      DEPLOY_TEST_FAIL_PUBLIC_RELEASE: fixture.candidateId,
    });

    expect(result.status).not.toBe(0);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toContain(fixture.previousId);
    expect(readFileSync(fixture.activeFile, 'utf8').trim()).toContain(fixture.previousId);
  });

  test('历史资产兼容不放宽新 candidate manifest', () => {
    const fixture = createFixture({
      candidateExtraFiles: {
        'arena-room-release-gate.json': '{}\n',
        'arena-room-release-gate-schema.mjs': 'export {};\n',
      },
    });

    const result = runDeploy(fixture);

    expect(result.status).not.toBe(0);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toContain(fixture.previousId);
    expect(readFileSync(fixture.dockerLog, 'utf8')).not.toContain(fixture.candidateId);
  });

  test('candidate 本机 readiness 失败时恢复 previous release', () => {
    const fixture = createFixture();

    const result = runDeploy(fixture, 'publish', fixture.candidateId, {
      DEPLOY_TEST_FAIL_LOCAL_RELEASE: fixture.candidateId,
    });

    expect(result.status).not.toBe(0);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toContain(fixture.previousId);
    expect(readFileSync(fixture.activeFile, 'utf8').trim()).toContain(fixture.previousId);
    const dockerLog = readFileSync(fixture.dockerLog, 'utf8');
    expect(dockerLog.indexOf(fixture.candidateId)).toBeLessThan(
      dockerLog.lastIndexOf(fixture.previousId),
    );
  });

  test('candidate 公网 smoke 失败时恢复 previous release', () => {
    const fixture = createFixture();

    const result = runDeploy(fixture, 'publish', fixture.candidateId, {
      DEPLOY_TEST_FAIL_PUBLIC_RELEASE: fixture.candidateId,
    });

    expect(result.status).not.toBe(0);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toContain(fixture.previousId);
    expect(readFileSync(fixture.activeFile, 'utf8').trim()).toContain(fixture.previousId);
  });

  test('显式 rollback 可以选择并激活历史 release', () => {
    const fixture = createFixture();
    rmSync(path.join(fixture.rootDirectory, 'current'));
    symlinkSync(
      path.join(fixture.rootDirectory, 'releases', fixture.candidateId),
      path.join(fixture.rootDirectory, 'current'),
    );
    writeFileSync(
      fixture.activeFile,
      `${path.join(fixture.rootDirectory, 'releases', fixture.candidateId)}\n`,
    );

    const result = runDeploy(fixture, 'rollback', fixture.previousId);

    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toContain(fixture.previousId);
    expect(result.stdout).toContain(`ROLLBACK_RELEASE_ID=${fixture.previousId}`);
  });

  test('拒绝非 HTTPS probe、相对部署根和非法 release id', () => {
    const fixture = createFixture();
    const script = path.join(
      fixture.rootDirectory,
      'releases',
      fixture.candidateId,
      'deploy-bundle.sh',
    );
    const baseEnvironment = {
      ...process.env,
      PATH: `${fixture.binDirectory}:${process.env.PATH ?? ''}`,
      HONO_BIND_PORT: '18080',
      HONO_HOSTED_API_ENVIRONMENT: 'test',
      DEPLOY_TEST_ACTIVE_FILE: fixture.activeFile,
      DEPLOY_TEST_CURL_LOG: fixture.curlLog,
      DEPLOY_TEST_DOCKER_LOG: fixture.dockerLog,
    };

    const insecureOrigin = spawnSync('sh', [script, 'publish', fixture.candidateId, 'http://example.test'], {
      encoding: 'utf8',
      env: { ...baseEnvironment, HONO_DEPLOY_ROOT_DIR: fixture.rootDirectory },
    });
    const relativeRoot = spawnSync('sh', [script, 'publish', fixture.candidateId, 'https://example.test'], {
      encoding: 'utf8',
      env: { ...baseEnvironment, HONO_DEPLOY_ROOT_DIR: 'relative' },
    });
    const invalidId = spawnSync('sh', [script, 'publish', 'not-a-sha', 'https://example.test'], {
      encoding: 'utf8',
      env: { ...baseEnvironment, HONO_DEPLOY_ROOT_DIR: fixture.rootDirectory },
    });

    expect(insecureOrigin.status).not.toBe(0);
    expect(relativeRoot.status).not.toBe(0);
    expect(invalidId.status).not.toBe(0);
    expect(readFileSync(fixture.dockerLog, 'utf8')).toBe('');
  });
});
