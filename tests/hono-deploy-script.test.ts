import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
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
const realIdPath = spawnSync('which', ['id'], { encoding: 'utf8' }).stdout.trim();
const realMvPath = spawnSync('which', ['mv'], { encoding: 'utf8' }).stdout.trim();
const realRmPath = spawnSync('which', ['rm'], { encoding: 'utf8' }).stdout.trim();
const realSleepPath = spawnSync('which', ['sleep'], { encoding: 'utf8' }).stdout.trim();

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex');

const writeExecutable = (filePath: string, content: string): void => {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
};

const createRelease = (
  rootDirectory: string,
  label = 'fixture',
): { releaseDirectory: string; releaseId: string } => {
  const files = {
    'index.mjs': `console.info(${JSON.stringify(label)});\n`,
    'compose.yml': `services:\n  hono:\n    image: node:22-alpine\n    labels:\n      fixture: ${label}\n`,
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
  chmodSync(path.join(rootDirectory, '.env.hono'), 0o600);

  const previousRelease = createRelease(rootDirectory, 'previous');
  writeFileSync(
    path.join(rootDirectory, '.env'),
    `HONO_RELEASE_DIR=${previousRelease.releaseDirectory}\n`,
  );
  symlinkSync(previousRelease.releaseDirectory, path.join(rootDirectory, 'current'));
  writeFileSync(path.join(rootDirectory, 'deployment-format'), 'release-tuple-v2\n');

  writeExecutable(path.join(commandDirectory, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$HONO_DEPLOY_TEST_COMMAND_LOG"
if [ -n "\${HONO_DEPLOY_TEST_HOLD_DOCKER_MATCH:-}" ]; then
  case "$*" in
    *"$HONO_DEPLOY_TEST_HOLD_DOCKER_MATCH"*)
      : > "$HONO_DEPLOY_TEST_HOLD_DOCKER_FILE.started"
      while [ ! -f "$HONO_DEPLOY_TEST_HOLD_DOCKER_FILE.release" ]; do
        "$HONO_DEPLOY_TEST_REAL_SLEEP" 0.05
      done
      ;;
  esac
fi
if [ -n "\${HONO_DEPLOY_TEST_HOLD_RUNTIME_CALL:-}" ]; then
  case "$*" in
    run\\ --rm\\ *)
      runtime_call=0
      if [ -f "$HONO_DEPLOY_TEST_HOLD_RUNTIME_COUNTER" ]; then
        runtime_call="$(cat "$HONO_DEPLOY_TEST_HOLD_RUNTIME_COUNTER")"
      fi
      runtime_call=$((runtime_call + 1))
      printf '%s\\n' "$runtime_call" > "$HONO_DEPLOY_TEST_HOLD_RUNTIME_COUNTER"
      if [ "$runtime_call" = "$HONO_DEPLOY_TEST_HOLD_RUNTIME_CALL" ]; then
        : > "$HONO_DEPLOY_TEST_HOLD_RUNTIME_FILE.started"
        while [ ! -f "$HONO_DEPLOY_TEST_HOLD_RUNTIME_FILE.release" ]; do
          "$HONO_DEPLOY_TEST_REAL_SLEEP" 0.05
        done
      fi
      ;;
  esac
fi
if [ -n "\${HONO_DEPLOY_TEST_FAIL_CONFIG_FOR:-}" ]; then
  case "$*" in
    *"-f $HONO_DEPLOY_TEST_FAIL_CONFIG_FOR/compose.yml config"*) exit 74 ;;
  esac
fi
if [ -n "\${HONO_DEPLOY_TEST_FAIL_RUNTIME_FOR:-}" ]; then
  case "$*" in
    *"-v $HONO_DEPLOY_TEST_FAIL_RUNTIME_FOR/index.mjs:/app/index.mjs:ro"*) exit 76 ;;
  esac
fi
if [ -n "\${HONO_DEPLOY_TEST_FAIL_DOWN_FOR:-}" ]; then
  case "$*" in
    *"-f $HONO_DEPLOY_TEST_FAIL_DOWN_FOR/compose.yml down"*) exit 75 ;;
  esac
fi
exit 0
`);
  writeExecutable(path.join(commandDirectory, 'id'), `#!/bin/sh
if [ "$1" = '-u' ] && [ -n "\${HONO_DEPLOY_TEST_DEPLOY_UID:-}" ]; then
  printf '%s\n' "$HONO_DEPLOY_TEST_DEPLOY_UID"
  exit 0
fi
exec "$HONO_DEPLOY_TEST_REAL_ID" "$@"
`);
  writeExecutable(path.join(commandDirectory, 'mv'), `#!/bin/sh
last=''
for argument in "$@"; do
  last="$argument"
done
if [ -n "\${HONO_DEPLOY_TEST_RACE_ADOPTION_CANARY:-}" ]; then
  case "$*" in
    *"$HONO_DEPLOY_ROOT_DIR"/releases/.legacy-adopt.*)
      ln -s "$HONO_DEPLOY_TEST_RACE_ADOPTION_CANARY" "$last" || exit 72
      ;;
  esac
fi
if [ "\${HONO_DEPLOY_TEST_FAIL_PROMOTION:-false}" = true ] \
  && [ "$last" = "$HONO_DEPLOY_ROOT_DIR/current" ]; then
  exit 73
fi
exec "$HONO_DEPLOY_TEST_REAL_MV" "$@"
`);
  writeExecutable(path.join(commandDirectory, 'rm'), `#!/bin/sh
for argument in "$@"; do
  if [ "\${HONO_DEPLOY_TEST_FAIL_ENV_REMOVAL:-false}" = true ] \
    && [ "$argument" = "$HONO_DEPLOY_ROOT_DIR/.env" ]; then
    exit 77
  fi
  if [ "\${HONO_DEPLOY_TEST_FAIL_CURRENT_NEXT_REMOVAL:-false}" = true ] \
    && [ "$argument" = "$HONO_DEPLOY_ROOT_DIR/current.next" ]; then
    exit 78
  fi
  if [ "\${HONO_DEPLOY_TEST_FAIL_FORMAT_REMOVAL:-false}" = true ] \
    && [ "$argument" = "$HONO_DEPLOY_ROOT_DIR/deployment-format" ]; then
    exit 79
  fi
  if [ "\${HONO_DEPLOY_TEST_FAIL_TRANSACTION_REMOVAL:-false}" = true ] \
    && [ "$argument" = "$HONO_DEPLOY_ROOT_DIR/deploy.transaction" ]; then
    exit 80
  fi
done
exec "$HONO_DEPLOY_TEST_REAL_RM" "$@"
`);
  writeExecutable(path.join(commandDirectory, 'sleep'), `#!/bin/sh
if [ "$1" = 5 ] && [ -n "\${HONO_DEPLOY_TEST_HOLD_SLEEP_FILE:-}" ]; then
  : > "$HONO_DEPLOY_TEST_HOLD_SLEEP_FILE.started"
  while [ ! -f "$HONO_DEPLOY_TEST_HOLD_SLEEP_FILE.release" ]; do
    "$HONO_DEPLOY_TEST_REAL_SLEEP" 0.05
  done
  exit 0
fi
exec "$HONO_DEPLOY_TEST_REAL_SLEEP" "$@"
`);
  writeExecutable(path.join(commandDirectory, 'curl'), `#!/bin/sh
all_arguments="$*"
headers=''
body=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dump-header) shift; headers="$1" ;;
    --output) shift; body="$1" ;;
  esac
  shift
done
case "$all_arguments" in
  *"http://127.0.0.1:8080/health/ready"*)
    if [ -n "\${HONO_DEPLOY_TEST_FAIL_LOCAL_ONCE_FILE:-}" ] \
      && [ ! -f "$HONO_DEPLOY_TEST_FAIL_LOCAL_ONCE_FILE" ]; then
      : > "$HONO_DEPLOY_TEST_FAIL_LOCAL_ONCE_FILE"
      exit 1
    fi
    ;;
esac
if [ -n "$headers" ] && [ -n "\${HONO_DEPLOY_TEST_HOLD_FILE:-}" ]; then
  : > "$HONO_DEPLOY_TEST_HOLD_FILE.started"
  while [ ! -f "$HONO_DEPLOY_TEST_HOLD_FILE.release" ]; do
    sleep 0.05
  done
fi
if [ -n "$headers" ]; then
  printf 'Access-Control-Allow-Origin: https://mahoshojo.colanns.me\\r\\n' > "$headers"
fi
if [ -n "$body" ]; then
  printf '%s' '{"error":"Name is required"}' > "$body"
fi
printf '%s' "\${HONO_DEPLOY_TEST_PROBE_STATUS:-400}"
exit 0
`);

  const release = createRelease(rootDirectory, 'target');
  return {
    ...release,
    commandDirectory,
    commandLog,
    previousReleaseDirectory: previousRelease.releaseDirectory,
    rootDirectory,
  };
};

const runDeployment = (
  fixture: ReturnType<typeof createFixture>,
  options: {
    failConfigFor?: string;
    failCurrentNextRemoval?: boolean;
    failDownFor?: string;
    failEnvRemoval?: boolean;
    failFormatRemoval?: boolean;
    failPromotion?: boolean;
    failRuntimeFor?: string;
    failTransactionRemoval?: boolean;
    deployUid?: string;
    holdFile?: string;
    hostedApiEnvironment?: string | null;
    probeStatus?: string;
    publicBaseUrl?: string;
    raceAdoptionCanary?: string;
    redisKeyPrefix?: string;
  } = {},
) => spawnSync(
  'sh',
  [
    path.join(fixture.releaseDirectory, 'deploy-bundle.sh'),
    fixture.releaseId,
    options.publicBaseUrl ?? 'https://example.test',
  ],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      HONO_DEPLOY_ROOT_DIR: fixture.rootDirectory,
      HONO_HOSTED_API_ENVIRONMENT: options.hostedApiEnvironment === null
        ? ''
        : options.hostedApiEnvironment ?? 'test',
      HONO_REDIS_KEY_PREFIX: options.redisKeyPrefix ?? '',
      HONO_DEPLOY_TEST_FAIL_CONFIG_FOR: options.failConfigFor ?? '',
      HONO_DEPLOY_TEST_FAIL_CURRENT_NEXT_REMOVAL:
        options.failCurrentNextRemoval ? 'true' : 'false',
      HONO_DEPLOY_TEST_FAIL_DOWN_FOR: options.failDownFor ?? '',
      HONO_DEPLOY_TEST_FAIL_ENV_REMOVAL: options.failEnvRemoval ? 'true' : 'false',
      HONO_DEPLOY_TEST_FAIL_FORMAT_REMOVAL: options.failFormatRemoval ? 'true' : 'false',
      HONO_DEPLOY_TEST_FAIL_PROMOTION: options.failPromotion ? 'true' : 'false',
      HONO_DEPLOY_TEST_FAIL_RUNTIME_FOR: options.failRuntimeFor ?? '',
      HONO_DEPLOY_TEST_FAIL_TRANSACTION_REMOVAL:
        options.failTransactionRemoval ? 'true' : 'false',
      HONO_DEPLOY_TEST_DEPLOY_UID: options.deployUid ?? '',
      HONO_DEPLOY_TEST_HOLD_FILE: options.holdFile ?? '',
      HONO_DEPLOY_TEST_COMMAND_LOG: fixture.commandLog,
      HONO_DEPLOY_TEST_PROBE_STATUS: options.probeStatus ?? '400',
      HONO_DEPLOY_TEST_RACE_ADOPTION_CANARY: options.raceAdoptionCanary ?? '',
      HONO_DEPLOY_TEST_REAL_ID: realIdPath,
      HONO_DEPLOY_TEST_REAL_MV: realMvPath,
      HONO_DEPLOY_TEST_REAL_RM: realRmPath,
      HONO_DEPLOY_TEST_REAL_SLEEP: realSleepPath,
      PATH: `${fixture.commandDirectory}:${process.env.PATH ?? ''}`,
    },
  },
);

const spawnDeployment = (
  fixture: ReturnType<typeof createFixture>,
  extraEnvironment: NodeJS.ProcessEnv = {},
) => spawn(
  'sh',
  [path.join(fixture.releaseDirectory, 'deploy-bundle.sh'), fixture.releaseId, 'https://example.test'],
  {
    env: {
      ...process.env,
      HONO_DEPLOY_ROOT_DIR: fixture.rootDirectory,
      HONO_HOSTED_API_ENVIRONMENT: 'test',
      HONO_DEPLOY_TEST_COMMAND_LOG: fixture.commandLog,
      HONO_DEPLOY_TEST_FAIL_PROMOTION: 'false',
      HONO_DEPLOY_TEST_PROBE_STATUS: '400',
      HONO_DEPLOY_TEST_REAL_ID: realIdPath,
      HONO_DEPLOY_TEST_REAL_MV: realMvPath,
      HONO_DEPLOY_TEST_REAL_RM: realRmPath,
      HONO_DEPLOY_TEST_REAL_SLEEP: realSleepPath,
      PATH: `${fixture.commandDirectory}:${process.env.PATH ?? ''}`,
      ...extraEnvironment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

const installDocumentedLegacyLayout = (
  fixture: ReturnType<typeof createFixture>,
  options: { preserveFormatMarker?: boolean } = {},
) => {
  rmSync(path.join(fixture.rootDirectory, '.env'), { force: true });
  rmSync(path.join(fixture.rootDirectory, 'current'), { force: true });
  if (!options.preserveFormatMarker) {
    rmSync(path.join(fixture.rootDirectory, 'deployment-format'), { force: true });
  }

  const index = 'console.info("documented legacy release");\n';
  const legacyReleaseId = sha256(index);
  const legacyReleaseDirectory = path.join(
    fixture.rootDirectory,
    'releases',
    legacyReleaseId,
  );
  mkdirSync(legacyReleaseDirectory, { recursive: true });
  writeFileSync(path.join(legacyReleaseDirectory, 'index.mjs'), index);
  writeFileSync(
    path.join(legacyReleaseDirectory, 'index.mjs.sha256'),
    `${legacyReleaseId}  index.mjs\n`,
  );
  writeFileSync(
    path.join(fixture.rootDirectory, 'compose.yml'),
    'services:\n  hono:\n    image: node:20-alpine\n',
  );
  writeExecutable(
    path.join(fixture.rootDirectory, 'deploy-bundle.sh'),
    '#!/bin/sh\nexit 0\n',
  );
  writeFileSync(
    path.join(fixture.rootDirectory, '.env'),
    `HONO_RELEASE_DIR=${legacyReleaseDirectory}\n`,
  );
  return { legacyReleaseDirectory, legacyReleaseId };
};

const getLegacyAdoptionDirectory = (
  fixture: ReturnType<typeof createFixture>,
  legacy: ReturnType<typeof installDocumentedLegacyLayout>,
): string => {
  const files = {
    'index.mjs': readFileSync(path.join(legacy.legacyReleaseDirectory, 'index.mjs'), 'utf8'),
    'compose.yml': readFileSync(path.join(fixture.rootDirectory, 'compose.yml'), 'utf8'),
    'deploy-bundle.sh': readFileSync(
      path.join(fixture.releaseDirectory, 'deploy-bundle.sh'),
      'utf8',
    ),
    'legacy-layout': `root-release-layout-v1:${legacy.legacyReleaseId}\n`,
  };
  const manifest = Object.entries(files)
    .map(([name, content]) => `${sha256(content)}  ${name}`)
    .join('\n') + '\n';
  return path.join(fixture.rootDirectory, 'releases', sha256(manifest));
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
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> => new Promise(
  (resolveResult, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for process ${child.pid ?? 'unknown'}`));
    }, timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolveResult({ code, signal });
    });
  },
);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Hono release-local deployment transaction', () => {
  test('runtime env 权限过宽时在 Docker 与 metadata 前 fail closed', () => {
    const fixture = createFixture();
    chmodSync(path.join(fixture.rootDirectory, '.env.hono'), 0o644);

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('0600');
    expect(existsSync(fixture.commandLog)).toBe(false);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
  });

  test('runtime env 不属于部署用户时在 Docker 与 metadata 前 fail closed', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, {
      deployUid: String((process.getuid?.() ?? 0) + 1),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('当前部署用户所有');
    expect(existsSync(fixture.commandLog)).toBe(false);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
  });

  test('缺失显式 deployment target 时在 Docker 与 metadata 前 fail closed', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, { hostedApiEnvironment: null });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('HONO_HOSTED_API_ENVIRONMENT');
    expect(existsSync(fixture.commandLog)).toBe(false);
  });

  test('production target 拒绝 preview public origin', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, {
      hostedApiEnvironment: 'production',
      publicBaseUrl: 'https://homura-preview.colanns.me',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('production target');
    expect(existsSync(fixture.commandLog)).toBe(false);
  });

  test('production target 拒绝 preview Redis namespace', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, {
      hostedApiEnvironment: 'production',
      publicBaseUrl: 'https://homura.colanns.me',
      redisKeyPrefix: 'preview',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('production target 必须保持 HONO_REDIS_KEY_PREFIX 为空');
    expect(existsSync(fixture.commandLog)).toBe(false);
  });

  test('production target 拒绝非 canonical root', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, {
      hostedApiEnvironment: 'production',
      publicBaseUrl: 'https://homura.colanns.me',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('production target 必须使用 /opt/mahoshojo-hono');
    expect(existsSync(fixture.commandLog)).toBe(false);
  });

  test('preview target 缺少固定 Redis prefix 时 fail closed', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, {
      hostedApiEnvironment: 'preview',
      publicBaseUrl: 'https://homura-preview.colanns.me',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('HONO_REDIS_KEY_PREFIX=preview');
    expect(existsSync(fixture.commandLog)).toBe(false);
  });

  test('preview target 拒绝非 canonical Redis prefix', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, {
      hostedApiEnvironment: 'preview',
      publicBaseUrl: 'https://homura-preview.colanns.me',
      redisKeyPrefix: 'preview-other',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('HONO_REDIS_KEY_PREFIX=preview');
    expect(existsSync(fixture.commandLog)).toBe(false);
  });

  test('preview target 拒绝 production public origin', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, {
      hostedApiEnvironment: 'preview',
      publicBaseUrl: 'https://homura.colanns.me',
      redisKeyPrefix: 'preview',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('preview target 必须使用 https://homura-preview.colanns.me');
    expect(existsSync(fixture.commandLog)).toBe(false);
  });

  test('preview target 拒绝非 canonical root', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, {
      hostedApiEnvironment: 'preview',
      publicBaseUrl: 'https://homura-preview.colanns.me',
      redisKeyPrefix: 'preview',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('preview target 必须使用 /opt/mahoshojo-hono-preview');
    expect(existsSync(fixture.commandLog)).toBe(false);
  });

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
    const commandLog = readFileSync(fixture.commandLog, 'utf8');
    expect(commandLog).toContain('-e HOSTED_API_ENVIRONMENT=test');
    expect(commandLog).toContain(
      `-f ${fixture.releaseDirectory}/compose.yml up -d --force-recreate hono`,
    );
  });

  test('公网 retained-route contract 失败时恢复 previous release-local tuple', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, { probeStatus: '500' });

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

    const result = runDeployment(fixture, { failPromotion: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('开始回滚 tuple');
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${fixture.previousReleaseDirectory}\n`,
    );
    expect(readFileSync(fixture.commandLog, 'utf8')).toContain(
      `-f ${fixture.previousReleaseDirectory}/compose.yml up -d --force-recreate hono`,
    );
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'current.next'))).toBe(false);
  });

  test('首次发布 contract 失败时停止新 compose 并清理 active env', () => {
    const fixture = createFixture();
    rmSync(path.join(fixture.rootDirectory, '.env'));
    unlinkSync(path.join(fixture.rootDirectory, 'current'));
    rmSync(path.join(fixture.rootDirectory, 'deployment-format'));

    const result = runDeployment(fixture, { probeStatus: '500' });

    expect(result.status).toBe(1);
    expect(existsSync(path.join(fixture.rootDirectory, '.env'))).toBe(false);
    expect(readFileSync(fixture.commandLog, 'utf8')).toContain(
      `-f ${fixture.releaseDirectory}/compose.yml down`,
    );

  });

  test('首次发布停止 compose 失败时保留 active metadata 与 journal 供恢复', () => {
    const fixture = createFixture();
    rmSync(path.join(fixture.rootDirectory, '.env'));
    unlinkSync(path.join(fixture.rootDirectory, 'current'));
    rmSync(path.join(fixture.rootDirectory, 'deployment-format'));

    const result = runDeployment(fixture, {
      failDownFor: fixture.releaseDirectory,
      probeStatus: '500',
    });

    expect(result.status).toBe(1);
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${fixture.releaseDirectory}\n`,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(true);
    expect(readFileSync(fixture.commandLog, 'utf8')).toContain(
      `-f ${fixture.releaseDirectory}/compose.yml down`,
    );

    const recovered = runDeployment(fixture);

    expect(recovered.status, recovered.stderr).toBe(0);
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(false);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.releaseDirectory,
    );
  });

  test('首次发布删除 active env 失败时保留 journal 并传播回滚失败', () => {
    const fixture = createFixture();
    rmSync(path.join(fixture.rootDirectory, '.env'));
    unlinkSync(path.join(fixture.rootDirectory, 'current'));
    rmSync(path.join(fixture.rootDirectory, 'deployment-format'));

    const result = runDeployment(fixture, {
      failEnvRemoval: true,
      probeStatus: '500',
    });

    expect(result.status).toBe(1);
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${fixture.releaseDirectory}\n`,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(true);
  });

  test('首次发布清理 current.next 失败时不继续伪装成功回滚', () => {
    const fixture = createFixture();
    rmSync(path.join(fixture.rootDirectory, '.env'));
    unlinkSync(path.join(fixture.rootDirectory, 'current'));
    rmSync(path.join(fixture.rootDirectory, 'deployment-format'));

    const result = runDeployment(fixture, {
      failCurrentNextRemoval: true,
      probeStatus: '500',
    });

    expect(result.status).toBe(1);
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(true);
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${fixture.releaseDirectory}\n`,
    );
    expect(readFileSync(fixture.commandLog, 'utf8')).toContain(
      `-f ${fixture.releaseDirectory}/compose.yml down`,
    );
  });

  test('首次发布删除 deployment-format 失败时保留 journal 并可恢复', () => {
    const fixture = createFixture();
    rmSync(path.join(fixture.rootDirectory, '.env'));
    unlinkSync(path.join(fixture.rootDirectory, 'current'));
    rmSync(path.join(fixture.rootDirectory, 'deployment-format'));

    const failed = runDeployment(fixture, {
      failFormatRemoval: true,
      probeStatus: '500',
    });

    expect(failed.status).toBe(1);
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(true);
    expect(existsSync(path.join(fixture.rootDirectory, '.env'))).toBe(false);

    const recovered = runDeployment(fixture);

    expect(recovered.status, recovered.stderr).toBe(0);
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(false);
  });

  test('成功 promotion 后 journal 删除失败时不报告成功并由下次启动恢复', () => {
    const fixture = createFixture();

    const failed = runDeployment(fixture, { failTransactionRemoval: true });

    expect(failed.status).not.toBe(0);
    expect(failed.stdout).not.toContain('Hono 已发布');
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(true);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.releaseDirectory,
    );

    const recovered = runDeployment(fixture);

    expect(recovered.status, recovered.stderr).toBe(0);
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(false);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.releaseDirectory,
    );
  });

  test('上次进程留下 pending journal 时，先恢复 previous tuple 再开始新事务', () => {
    const fixture = createFixture();
    writeFileSync(
      path.join(fixture.rootDirectory, '.env'),
      `HONO_RELEASE_DIR=${fixture.releaseDirectory}\n`,
    );
    unlinkSync(path.join(fixture.rootDirectory, 'current'));
    symlinkSync(fixture.releaseDirectory, path.join(fixture.rootDirectory, 'current'));
    writeFileSync(path.join(fixture.rootDirectory, 'deploy.transaction'), [
      'TRANSACTION_STATE=pending',
      `TARGET_RELEASE_DIR=${fixture.releaseDirectory}`,
      'HAD_PREVIOUS=true',
      `PREVIOUS_RELEASE_DIR=${fixture.previousReleaseDirectory}`,
      '',
    ].join('\n'));

    const result = runDeployment(fixture);
    const commands = readFileSync(fixture.commandLog, 'utf8');

    expect(result.status, result.stderr).toBe(0);
    expect(commands.indexOf(`-f ${fixture.previousReleaseDirectory}/compose.yml up`)).toBeLessThan(
      commands.lastIndexOf(`-f ${fixture.releaseDirectory}/compose.yml up`),
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(false);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.releaseDirectory,
    );
  });

  test('previous tuple checksum 损坏时在激活新版本前 fail closed', () => {
    const fixture = createFixture();
    writeFileSync(
      path.join(fixture.previousReleaseDirectory, 'compose.yml'),
      'services:\n  hono:\n    image: tampered\n',
    );

    const result = runDeployment(fixture);
    const commands = readFileSync(fixture.commandLog, 'utf8');

    expect(result.status).toBe(1);
    expect(commands).toContain(`-f ${fixture.releaseDirectory}/compose.yml config`);
    expect(commands).not.toContain(' run ');
    expect(commands).not.toContain(' up ');
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
  });

  test('managed 元数据损坏时即使残留 legacy 根文件也不得降级纳管', () => {
    const fixture = createFixture();
    installDocumentedLegacyLayout(fixture, { preserveFormatMarker: true });
    writeFileSync(
      path.join(fixture.rootDirectory, '.env'),
      `HONO_RELEASE_DIR=${fixture.previousReleaseDirectory}\n`,
    );
    symlinkSync(fixture.previousReleaseDirectory, path.join(fixture.rootDirectory, 'current'));
    writeFileSync(
      path.join(fixture.previousReleaseDirectory, 'compose.yml'),
      'services:\n  hono:\n    image: tampered\n',
    );
    const releaseDirectoriesBefore = readdirSync(path.join(fixture.rootDirectory, 'releases'));

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${fixture.previousReleaseDirectory}\n`,
    );
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
    expect(readdirSync(path.join(fixture.rootDirectory, 'releases'))).toEqual(
      releaseDirectoriesBefore,
    );
  });

  test('managed format marker 存在且 env/current 同时丢失时不得重新纳管旧布局', () => {
    const fixture = createFixture();
    installDocumentedLegacyLayout(fixture, { preserveFormatMarker: true });
    rmSync(path.join(fixture.rootDirectory, '.env'));

    const releaseDirectoriesBefore = readdirSync(path.join(fixture.rootDirectory, 'releases'));
    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(existsSync(path.join(fixture.rootDirectory, '.env'))).toBe(false);
    expect(existsSync(path.join(fixture.rootDirectory, 'current'))).toBe(false);
    expect(readdirSync(path.join(fixture.rootDirectory, 'releases'))).toEqual(
      releaseDirectoriesBefore,
    );
  });

  test('previous tuple compose config 无效时在激活前 fail closed', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, {
      failConfigFor: fixture.previousReleaseDirectory,
    });
    const commands = readFileSync(fixture.commandLog, 'utf8');

    expect(result.status).toBe(74);
    expect(commands).toContain(`-f ${fixture.previousReleaseDirectory}/compose.yml config`);
    expect(commands).not.toContain(' run ');
    expect(commands).not.toContain(' up ');
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
  });

  test('previous tuple production runtime config 无效时在激活前 fail closed', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, {
      failRuntimeFor: fixture.previousReleaseDirectory,
    });
    const commands = readFileSync(fixture.commandLog, 'utf8');

    expect(result.status).toBe(76);
    expect(commands).toContain(
      `-v ${fixture.previousReleaseDirectory}/index.mjs:/app/index.mjs:ro`,
    );
    expect(commands).not.toContain(`-f ${fixture.releaseDirectory}/compose.yml up`);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
  });

  test('release 目录是符号链接时在 Docker 预检前 fail closed', () => {
    const fixture = createFixture();
    const actualReleaseDirectory = `${fixture.releaseDirectory}.actual`;
    renameSync(fixture.releaseDirectory, actualReleaseDirectory);
    symlinkSync(actualReleaseDirectory, fixture.releaseDirectory, 'dir');

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(existsSync(fixture.commandLog)).toBe(false);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
  });

  test('releases 父目录是符号链接时在任何控制文件写入前 fail closed', () => {
    const fixture = createFixture();
    const actualReleasesDirectory = path.join(
      path.dirname(fixture.rootDirectory),
      'actual-releases',
    );
    renameSync(path.join(fixture.rootDirectory, 'releases'), actualReleasesDirectory);
    symlinkSync(actualReleasesDirectory, path.join(fixture.rootDirectory, 'releases'), 'dir');

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(existsSync(fixture.commandLog)).toBe(false);
  });

  test('deploy.lock 是符号链接时不覆盖 canary 并 fail closed', () => {
    const fixture = createFixture();
    const canary = path.join(path.dirname(fixture.rootDirectory), 'lock-canary');
    writeFileSync(canary, 'must-stay\n');
    symlinkSync(canary, path.join(fixture.rootDirectory, 'deploy.lock'));

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(readFileSync(canary, 'utf8')).toBe('must-stay\n');
    expect(existsSync(fixture.commandLog)).toBe(false);
  });

  test('固定旧 sidecar 符号链接不会被随机 metadata 临时文件覆盖', () => {
    const fixture = createFixture();
    const canary = path.join(path.dirname(fixture.rootDirectory), 'sidecar-canary');
    writeFileSync(canary, 'must-stay\n');
    symlinkSync(canary, path.join(fixture.rootDirectory, '.env.next'));
    symlinkSync(canary, path.join(fixture.rootDirectory, 'deploy.transaction.next'));

    const result = runDeployment(fixture);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(canary, 'utf8')).toBe('must-stay\n');
    expect(readlinkSync(path.join(fixture.rootDirectory, '.env.next'))).toBe(canary);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'deploy.transaction.next'))).toBe(canary);
  });

  test('managed release 环境文件是符号链接时 fail closed', () => {
    const fixture = createFixture();
    const externalEnvironment = path.join(fixture.rootDirectory, '.env.external');
    writeFileSync(
      externalEnvironment,
      `HONO_RELEASE_DIR=${fixture.previousReleaseDirectory}\n`,
    );
    unlinkSync(path.join(fixture.rootDirectory, '.env'));
    symlinkSync(externalEnvironment, path.join(fixture.rootDirectory, '.env'));

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(readlinkSync(path.join(fixture.rootDirectory, '.env'))).toBe(externalEnvironment);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
  });

  test('release-local compose config 无效时在预检阶段 fail closed', () => {
    const fixture = createFixture();

    const result = runDeployment(fixture, { failConfigFor: fixture.releaseDirectory });
    const commands = readFileSync(fixture.commandLog, 'utf8');

    expect(result.status).toBe(74);
    expect(commands).toContain(`-f ${fixture.releaseDirectory}/compose.yml config`);
    expect(commands).not.toContain(`-f ${fixture.releaseDirectory}/compose.yml up`);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
  });

  test('旧文档布局遇到新 release compose 无效时不提前改写纳管元数据', () => {
    const fixture = createFixture();
    const legacy = installDocumentedLegacyLayout(fixture);

    const result = runDeployment(fixture, { failConfigFor: fixture.releaseDirectory });

    expect(result.status).toBe(74);
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${legacy.legacyReleaseDirectory}\n`,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'current'))).toBe(false);
    expect(existsSync(path.join(fixture.rootDirectory, 'deployment-format'))).toBe(false);
  });

  test('旧文档布局遇到 candidate runtime config 无效时不提前改写纳管元数据', () => {
    const fixture = createFixture();
    const legacy = installDocumentedLegacyLayout(fixture);

    const result = runDeployment(fixture, { failRuntimeFor: fixture.releaseDirectory });

    expect(result.status).toBe(76);
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${legacy.legacyReleaseDirectory}\n`,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'current'))).toBe(false);
    expect(existsSync(path.join(fixture.rootDirectory, 'deployment-format'))).toBe(false);
  });

  test('旧文档 release checksum 损坏时拒绝纳管且不改 metadata', () => {
    const fixture = createFixture();
    const legacy = installDocumentedLegacyLayout(fixture);
    writeFileSync(
      path.join(legacy.legacyReleaseDirectory, 'index.mjs'),
      'console.info("tampered legacy");\n',
    );

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${legacy.legacyReleaseDirectory}\n`,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'current'))).toBe(false);
    expect(existsSync(path.join(fixture.rootDirectory, 'deployment-format'))).toBe(false);
  });

  test('持久 journal 含额外字段时保留证据并 fail closed', () => {
    const fixture = createFixture();
    writeFileSync(
      path.join(fixture.rootDirectory, '.env'),
      `HONO_RELEASE_DIR=${fixture.releaseDirectory}\n`,
    );
    writeFileSync(path.join(fixture.rootDirectory, 'deploy.transaction'), [
      'TRANSACTION_STATE=pending',
      `TARGET_RELEASE_DIR=${fixture.releaseDirectory}`,
      'HAD_PREVIOUS=true',
      `PREVIOUS_RELEASE_DIR=${fixture.previousReleaseDirectory}`,
      'UNEXPECTED_FIELD=must-not-be-ignored',
      '',
    ].join('\n'));

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(true);
    expect(existsSync(fixture.commandLog)).toBe(false);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
  });

  test('持久 journal 是 dangling symlink 时保留证据并 fail closed', () => {
    const fixture = createFixture();
    const danglingTarget = path.join(path.dirname(fixture.rootDirectory), 'missing-journal');
    symlinkSync(danglingTarget, path.join(fixture.rootDirectory, 'deploy.transaction'));

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(
      danglingTarget,
    );
    expect(existsSync(fixture.commandLog)).toBe(false);
  });

  test('旧文档布局会先纳管为可校验 tuple，新版失败后回滚到该 tuple', () => {
    const fixture = createFixture();
    const legacy = installDocumentedLegacyLayout(fixture);

    const result = runDeployment(fixture, { probeStatus: '500' });
    const adoptedDirectory = readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')
      .trim()
      .slice('HONO_RELEASE_DIR='.length);

    expect(result.status).toBe(1);
    expect(adoptedDirectory).toMatch(new RegExp(`^${fixture.rootDirectory}/releases/[0-9a-f]{64}$`, 'u'));
    expect(readFileSync(path.join(adoptedDirectory, 'legacy-layout'), 'utf8')).toBe(
      `root-release-layout-v1:${legacy.legacyReleaseId}\n`,
    );
    expect(readFileSync(path.join(fixture.rootDirectory, 'deployment-format'), 'utf8')).toBe(
      'release-tuple-v2\n',
    );
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(adoptedDirectory);
    expect(readFileSync(fixture.commandLog, 'utf8')).toContain(
      `-f ${adoptedDirectory}/compose.yml up -d --force-recreate hono`,
    );
  });

  test('legacy 纳管目标是 dangling symlink 时保留链接与旧 metadata 并 fail closed', () => {
    const fixture = createFixture();
    const legacy = installDocumentedLegacyLayout(fixture);
    const adoptionDirectory = getLegacyAdoptionDirectory(fixture, legacy);
    const danglingTarget = path.join(path.dirname(fixture.rootDirectory), 'missing-adoption');
    symlinkSync(danglingTarget, adoptionDirectory, 'dir');

    const result = runDeployment(fixture);

    expect(result.status).toBe(1);
    expect(readlinkSync(adoptionDirectory)).toBe(danglingTarget);
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${legacy.legacyReleaseDirectory}\n`,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'current'))).toBe(false);
    expect(readdirSync(path.join(fixture.rootDirectory, 'releases')).some(
      (entry) => entry.startsWith('.legacy-adopt.'),
    )).toBe(true);
  });

  test('legacy 纳管 rename 竞态出现目录链接时不跟随目标并 fail closed', () => {
    const fixture = createFixture();
    const legacy = installDocumentedLegacyLayout(fixture);
    const canaryDirectory = path.join(path.dirname(fixture.rootDirectory), 'adoption-canary');
    mkdirSync(canaryDirectory);
    writeFileSync(path.join(canaryDirectory, 'sentinel'), 'must-stay\n');

    const result = runDeployment(fixture, { raceAdoptionCanary: canaryDirectory });

    expect(result.status).toBe(1);
    expect(readFileSync(path.join(canaryDirectory, 'sentinel'), 'utf8')).toBe('must-stay\n');
    expect(readdirSync(canaryDirectory)).toEqual(['sentinel']);
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${legacy.legacyReleaseDirectory}\n`,
    );
    expect(readdirSync(path.join(fixture.rootDirectory, 'releases')).some(
      (entry) => entry.startsWith('.legacy-adopt.'),
    )).toBe(true);
  });

  test('TERM 中断 legacy 纳管 runtime 预检时在 deadline 内终止且不改 metadata', async () => {
    const fixture = createFixture();
    const legacy = installDocumentedLegacyLayout(fixture);
    const holdFile = path.join(path.dirname(fixture.rootDirectory), 'legacy-runtime-hold');
    const counterFile = path.join(path.dirname(fixture.rootDirectory), 'runtime-call-count');
    const child = spawnDeployment(fixture, {
      HONO_DEPLOY_TEST_HOLD_RUNTIME_CALL: '2',
      HONO_DEPLOY_TEST_HOLD_RUNTIME_COUNTER: counterFile,
      HONO_DEPLOY_TEST_HOLD_RUNTIME_FILE: holdFile,
    });

    let result: Awaited<ReturnType<typeof waitForProcessClose>>;
    try {
      await waitForFile(`${holdFile}.started`);
      child.kill('SIGTERM');
      try {
        result = await waitForProcessClose(child);
      } catch (error) {
        child.kill('SIGKILL');
        throw error;
      }
    } finally {
      writeFileSync(`${holdFile}.release`, 'release\n');
    }

    expect(result).toEqual({ code: 143, signal: null });
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${legacy.legacyReleaseDirectory}\n`,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'current'))).toBe(false);
    expect(existsSync(path.join(fixture.rootDirectory, 'deployment-format'))).toBe(false);
  });

  test('legacy 纳管的 current 原子切换中断后可在下次启动完成恢复', () => {
    const fixture = createFixture();
    const legacy = installDocumentedLegacyLayout(fixture);

    const interrupted = runDeployment(fixture, { failPromotion: true });
    const adoptedDirectory = readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')
      .trim()
      .slice('HONO_RELEASE_DIR='.length);

    expect(interrupted.status).not.toBe(0);
    expect(existsSync(path.join(fixture.rootDirectory, 'current'))).toBe(false);
    expect(readFileSync(path.join(adoptedDirectory, 'legacy-layout'), 'utf8')).toBe(
      `root-release-layout-v1:${legacy.legacyReleaseId}\n`,
    );

    const recovered = runDeployment(fixture);

    expect(recovered.status, recovered.stderr).toBe(0);
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.releaseDirectory,
    );
  });

  test('部署锁已被占用时第二个事务 fail closed', async () => {
    const fixture = createFixture();
    const lockPath = path.join(fixture.rootDirectory, 'deploy.lock');
    const holderReady = path.join(path.dirname(fixture.rootDirectory), 'lock-holder-ready');
    const holder = spawn('flock', [
      '-n',
      lockPath,
      'sh',
      '-c',
      ': > "$1"; sleep 5',
      'lock-holder',
      holderReady,
    ]);
    try {
      await waitForFile(holderReady);

      const result = runDeployment(fixture);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('另一个部署事务正在执行');
      expect(existsSync(fixture.commandLog)).toBe(false);
    } finally {
      holder.kill('SIGTERM');
    }
  });

  test('TERM 中断事务内 compose up 时在 deadline 内回滚', async () => {
    const fixture = createFixture();
    const holdFile = path.join(path.dirname(fixture.rootDirectory), 'compose-up-hold');
    const child = spawnDeployment(fixture, {
      HONO_DEPLOY_TEST_HOLD_DOCKER_FILE: holdFile,
      HONO_DEPLOY_TEST_HOLD_DOCKER_MATCH:
        `-f ${fixture.releaseDirectory}/compose.yml up -d --force-recreate hono`,
    });

    await waitForFile(`${holdFile}.started`);
    child.kill('SIGTERM');
    let result: Awaited<ReturnType<typeof waitForProcessClose>>;
    try {
      result = await waitForProcessClose(child);
    } catch (error) {
      child.kill('SIGKILL');
      throw error;
    } finally {
      writeFileSync(`${holdFile}.release`, 'release\n');
    }

    expect(result).toEqual({ code: 143, signal: null });
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(false);
  });

  test('TERM 中断 readiness backoff 时在 deadline 内回滚', async () => {
    const fixture = createFixture();
    const holdFile = path.join(path.dirname(fixture.rootDirectory), 'readiness-sleep-hold');
    const failedOnceFile = path.join(path.dirname(fixture.rootDirectory), 'readiness-failed-once');
    const child = spawnDeployment(fixture, {
      HONO_DEPLOY_TEST_FAIL_LOCAL_ONCE_FILE: failedOnceFile,
      HONO_DEPLOY_TEST_HOLD_SLEEP_FILE: holdFile,
    });

    await waitForFile(`${holdFile}.started`);
    child.kill('SIGTERM');
    let result: Awaited<ReturnType<typeof waitForProcessClose>>;
    try {
      result = await waitForProcessClose(child);
    } catch (error) {
      child.kill('SIGKILL');
      throw error;
    } finally {
      writeFileSync(`${holdFile}.release`, 'release\n');
    }

    expect(result).toEqual({ code: 143, signal: null });
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(false);
  });

  test('TERM 中断已激活的事务时回滚 previous tuple 并清理 journal', async () => {
    const fixture = createFixture();
    const holdFile = path.join(path.dirname(fixture.rootDirectory), 'public-probe-hold');
    const child = spawnDeployment(fixture, { HONO_DEPLOY_TEST_HOLD_FILE: holdFile });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    await waitForFile(`${holdFile}.started`);
    child.kill('SIGTERM');
    let result: Awaited<ReturnType<typeof waitForProcessClose>>;
    try {
      result = await waitForProcessClose(child);
    } catch (error) {
      child.kill('SIGKILL');
      throw error;
    }

    expect(result, stderr).toEqual({ code: 143, signal: null });
    expect(readlinkSync(path.join(fixture.rootDirectory, 'current'))).toBe(
      fixture.previousReleaseDirectory,
    );
    expect(readFileSync(path.join(fixture.rootDirectory, '.env'), 'utf8')).toBe(
      `HONO_RELEASE_DIR=${fixture.previousReleaseDirectory}\n`,
    );
    expect(existsSync(path.join(fixture.rootDirectory, 'deploy.transaction'))).toBe(false);
    expect(readFileSync(fixture.commandLog, 'utf8')).toContain(
      `-f ${fixture.previousReleaseDirectory}/compose.yml up -d --force-recreate hono`,
    );
  });
});
