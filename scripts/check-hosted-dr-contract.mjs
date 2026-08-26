import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { renderHostedDrClientConfig } from './hosted-dr-client-config.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const failures = [];
const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'DELETE']);
const allowedRequestClasses = new Set([
  'safe-read',
  'durably-idempotent-command',
  'non-idempotent-operation',
]);
const allowedDrModes = new Set(['safe-read', 'new-request-only', 'fail-closed']);
const allowedReplayPolicies = new Set([
  'safe-read-only',
  'operation-id-required',
  'never-after-dispatch',
]);

const fail = (message) => failures.push(message);
const readJson = (relativePath) => JSON.parse(readFileSync(
  path.join(repositoryRoot, relativePath),
  'utf8',
));
const unique = (values) => new Set(values).size === values.length;
const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right));
const sameValues = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

const argumentValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} 缺少路径参数`);
  return path.isAbsolute(value) ? value : path.join(repositoryRoot, value);
};
const readInputJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'));

const inventory = readInputJson(argumentValue(
  '--inventory',
  path.join(repositoryRoot, 'config/hono-api-routes.json'),
));
const manifest = readInputJson(argumentValue(
  '--manifest',
  path.join(repositoryRoot, 'config/hosted-dr-capabilities.json'),
));

if (manifest.schemaVersion !== 1) {
  fail('schemaVersion 必须为 1');
}
if (!/^g25e1-v\d+$/u.test(manifest.contractVersion ?? '')) {
  fail('contractVersion 必须使用 g25e1-vN');
}
const hostedDrServiceSource = readFileSync(
  path.join(repositoryRoot, 'packages/hosted-api/src/hosted-dr.ts'),
  'utf8',
);
const applicationContractVersion = hostedDrServiceSource.match(
  /HOSTED_DR_CONTRACT_VERSION\s*=\s*['"]([^'"]+)['"]/u,
)?.[1];
if (applicationContractVersion !== manifest.contractVersion) {
  fail('application contractVersion 必须与 Hosted DR manifest 一致');
}
if (inventory.legacyRouteIds?.length !== 0) {
  fail('legacyRouteIds 必须保持为空');
}

const { controlPlane = {} } = manifest;
if (controlPlane.mode !== 'active-passive') {
  fail('controlPlane.mode 必须为 active-passive');
}
if (controlPlane.corsOriginsEnvironment !== 'HONO_CORS_ORIGINS') {
  fail('controlPlane.corsOriginsEnvironment 必须与双 runtime CORS contract 一致');
}
if (!['not-provisioned', 'preview', 'production'].includes(controlPlane.provisioning)) {
  fail('controlPlane.provisioning 非法');
}
if (
  controlPlane.provisioning === 'production'
  && !existsSync(path.join(repositoryRoot, 'config/hosted-dr-production-evidence.json'))
) {
  fail('production provisioning 缺少显式生产证据文件');
}

const origins = [
  controlPlane.stableOrigin,
  controlPlane.primaryOrigin,
  controlPlane.drOrigin,
];
if (!unique(origins)) {
  fail('stable/primary/DR origin 必须互不相同');
}
for (const origin of origins) {
  try {
    const parsed = new URL(origin);
    if (
      parsed.protocol !== 'https:'
      || parsed.pathname !== '/'
      || parsed.search !== ''
      || parsed.hash !== ''
    ) {
      fail(`origin 必须是无 path/query/hash 的 HTTPS origin: ${origin}`);
    }
  } catch {
    fail(`origin 非法: ${String(origin)}`);
  }
}
for (const [name, probePath] of [
  ['primaryProbePath', controlPlane.primaryProbePath],
  ['drProbePath', controlPlane.drProbePath],
]) {
  if (typeof probePath !== 'string' || !probePath.startsWith('/api/')) {
    fail(`${name} 必须是 /api/ 下的绝对路径`);
  }
}

const databaseProviders = manifest.databaseProviders ?? [];
const providerIds = databaseProviders.map(({ id }) => id);
if (!sameValues(providerIds, ['hono-d1-primary', 'cloudflare-d1-binding'])) {
  fail('databaseProviders 必须且只能包含 Hono primary 与 Cloudflare D1 binding');
}
if (!unique(providerIds)) {
  fail('databaseProviders.id 不得重复');
}
const cloudflareProvider = databaseProviders.find(({ id }) => id === 'cloudflare-d1-binding');
if (
  cloudflareProvider?.transport !== 'd1-binding-sessions'
  || cloudflareProvider?.authority !== 'd1'
  || cloudflareProvider?.supportsBookmarks !== true
) {
  fail('cloudflare-d1-binding 必须声明 D1 Sessions/bookmark 权威');
}
const honoProvider = databaseProviders.find(({ id }) => id === 'hono-d1-primary');
if (
  honoProvider?.transport !== 'd1-gateway-or-management-api'
  || honoProvider?.authority !== 'd1'
  || honoProvider?.supportsBookmarks !== false
) {
  fail('hono-d1-primary provider 声明不一致');
}

const capabilities = manifest.capabilities ?? [];
const capabilityIds = capabilities.map(({ id }) => id);
const capabilityRoutes = capabilities.map(({ route }) => route);
if (!unique(capabilityIds)) {
  fail('capability.id 不得重复');
}
if (!unique(capabilityRoutes)) {
  fail('capability.route 不得重复');
}
if (!sameValues(capabilityIds, inventory.sharedRouteIds ?? [])) {
  fail('DR capability 必须与 sharedRouteIds 双向完全覆盖');
}
const generatedRoutesSource = readFileSync(argumentValue(
  '--generated-routes',
  path.join(repositoryRoot, 'apps/api/src/generated/routes.ts'),
), 'utf8');
const generatedRouteIds = [...generatedRoutesSource.matchAll(
  /^\s+id:\s*"([^"]+)",$/gmu,
)].map((match) => match[1]);
if (!sameValues(generatedRouteIds, capabilityIds)) {
  fail('generated Hono route registry 必须与 DR capability 双向完全覆盖');
}
for (const exitedRouteId of [
  ...(inventory.exitedRouteIds ?? []),
  ...(inventory.legacyRouteIds ?? []),
]) {
  if (capabilityIds.includes(exitedRouteId)) {
    fail(`exited/legacy route 不得进入 DR capability: ${exitedRouteId}`);
  }
}

for (const capability of capabilities) {
  const label = capability.id ?? '<missing-id>';
  if (!/^[a-z0-9-]+(?:\/(?:[a-z0-9-]+|\[[A-Za-z][A-Za-z0-9]*\]))*$/u.test(label)) {
    fail(`capability.id 非法: ${label}`);
  }
  if (capability.route !== `/api/${label}`) {
    fail(`${label}: route 必须等于 /api/{id}`);
  }
  if (capability.primaryDatabaseProvider !== 'hono-d1-primary') {
    fail(`${label}: primaryDatabaseProvider 非法`);
  }
  if (capability.drDatabaseProvider !== 'cloudflare-d1-binding') {
    fail(`${label}: drDatabaseProvider 非法`);
  }
  if (!['replica-ok', 'primary'].includes(capability.consistency)) {
    fail(`${label}: consistency 非法`);
  }
  if (!['verified', 'fail-closed-verified', 'pending'].includes(capability.contractStatus)) {
    fail(`${label}: contractStatus 非法`);
  }
  if (!['pending-g25e-2', 'verified'].includes(capability.drillStatus)) {
    fail(`${label}: drillStatus 非法`);
  }

  const operations = capability.operations ?? [];
  const methods = operations.map(({ method }) => method);
  if (operations.length === 0 || !unique(methods)) {
    fail(`${label}: operations 必须非空且 method 不重复`);
  }
  for (const operation of operations) {
    if (!allowedMethods.has(operation.method)) {
      fail(`${label}: method 非法: ${operation.method}`);
    }
    if (!allowedRequestClasses.has(operation.requestClass)) {
      fail(`${label}: requestClass 非法: ${operation.requestClass}`);
    }
    if (!allowedDrModes.has(operation.drMode)) {
      fail(`${label}: drMode 非法: ${operation.drMode}`);
    }
    if (!allowedReplayPolicies.has(operation.replayPolicy)) {
      fail(`${label}: replayPolicy 非法: ${operation.replayPolicy}`);
    }
    if (
      operation.requestClass === 'safe-read'
      && (operation.drMode !== 'safe-read' || operation.replayPolicy !== 'safe-read-only')
    ) {
      fail(`${label}: safe-read 必须使用 safe-read-only`);
    }
    if (
      operation.requestClass === 'durably-idempotent-command'
      && operation.replayPolicy !== 'operation-id-required'
    ) {
      fail(`${label}: 幂等命令必须要求稳定 operation ID`);
    }
    if (
      operation.requestClass === 'non-idempotent-operation'
      && (
        operation.drMode === 'safe-read'
        || operation.replayPolicy !== 'never-after-dispatch'
      )
    ) {
      fail(`${label}: 非幂等 operation 不得配置 safe replay`);
    }
  }

  for (const secret of capability.requiredSecrets ?? []) {
    const keys = Object.keys(secret);
    if (!keys.every((key) => key === 'name' || key === 'minLength')) {
      fail(`${label}: requiredSecrets 只能保存 name/minLength，不得保存值`);
    }
    if (!/^[A-Z][A-Z0-9_]+$/u.test(secret.name ?? '')) {
      fail(`${label}: secret 名称非法`);
    }
    if (
      secret.minLength !== undefined
      && (!Number.isInteger(secret.minLength) || secret.minLength < 1)
    ) {
      fail(`${label}: secret minLength 必须为正整数`);
    }
  }
  const requiredBindings = capability.requiredBindings ?? [];
  if (!requiredBindings.includes('DB')) {
    fail(`${label}: shared Hosted capability 必须声明 DB binding`);
  }
  if (!requiredBindings.every((binding) => ['DB', 'R2_OBJECT_STORE'].includes(binding))) {
    fail(`${label}: requiredBindings 包含未知 logical binding`);
  }
  if (requiredBindings.includes('R2_OBJECT_STORE')) {
    const secretNames = (capability.requiredSecrets ?? []).map(({ name }) => name);
    if (!['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].every((name) => secretNames.includes(name))) {
      fail(`${label}: R2_OBJECT_STORE 必须声明最小 R2 secret contract`);
    }
  }

  const adapterPaths = [
    `apps/api/src/adapters/${label}.ts`,
    `apps/web/app/api/${label}/route.ts`,
  ];
  for (const adapterPath of adapterPaths) {
    if (!existsSync(path.join(repositoryRoot, adapterPath))) {
      fail(`${label}: 缺少 adapter ${adapterPath}`);
    }
  }
  const nextRoutePath = `apps/web/app/api/${label}/route.ts`;
  if (existsSync(path.join(repositoryRoot, nextRoutePath))) {
    const nextRouteSource = readFileSync(path.join(repositoryRoot, nextRoutePath), 'utf8');
    if (
      !nextRouteSource.includes('withNextDrCapability')
      || !nextRouteSource.includes(`'${label}'`)
    ) {
      fail(`${label}: Next route 未显式包裹 Hosted DR capability guard`);
    }
  }
  if (!Array.isArray(capability.contractTests) || capability.contractTests.length === 0) {
    fail(`${label}: contractTests 不得为空`);
  }
  for (const testPath of capability.contractTests ?? []) {
    if (!existsSync(path.join(repositoryRoot, testPath))) {
      fail(`${label}: contract test 不存在 ${testPath}`);
    }
  }
}

const clientConfig = readFileSync(
  path.join(repositoryRoot, 'apps/web/config/hono-api.ts'),
  'utf8',
);
const clientProjectionPath = path.join(
  repositoryRoot,
  'apps/web/config/hosted-dr-client.generated.ts',
);
if (!existsSync(clientProjectionPath)) {
  fail('客户端 stable-origin 投影不存在');
} else {
  const clientProjection = readFileSync(clientProjectionPath, 'utf8');
  const expectedProjection = renderHostedDrClientConfig(controlPlane.stableOrigin);
  if (clientProjection !== expectedProjection) {
    fail('客户端 stable-origin 投影与 DR manifest drift；运行 pnpm generate:hosted-dr-client');
  }
  if (
    clientProjection.includes(controlPlane.primaryOrigin)
    || clientProjection.includes(controlPlane.drOrigin)
  ) {
    fail('客户端投影不得包含物理 primary/DR origin');
  }
}
if (
  !clientConfig.includes('hosted-dr-client.generated')
  || clientConfig.includes('hosted-dr-capabilities.json')
) {
  fail('客户端配置必须只消费生成后的 stable-origin 安全投影');
}

const webPackage = readJson('apps/web/package.json');
for (const scriptName of ['build', 'build:cf']) {
  if (!webPackage.scripts?.[scriptName]?.includes('pnpm run check:hosted-dr')) {
    fail(`apps/web ${scriptName} 必须先执行 Hosted DR validator`);
  }
}
const nextGuardSource = readFileSync(
  path.join(repositoryRoot, 'apps/web/lib/hosted-dr/capability-guard.ts'),
  'utf8',
);
if (!nextGuardSource.includes('isExecutableHostedDrMode(operation.drMode)')) {
  fail('Next DR guard 必须对未知 drMode 运行时 fail closed');
}
const clientLiteralOrigins = [...clientConfig.matchAll(/['"](https:\/\/[^'"]+)['"]/gu)]
  .map((match) => match[1]);
for (const origin of clientLiteralOrigins) {
  if (origin === controlPlane.primaryOrigin || origin === controlPlane.drOrigin) {
    fail(`客户端配置不得编码物理 origin: ${origin}`);
  }
}

if (failures.length > 0) {
  console.error('Hosted DR contract check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Hosted DR contract OK: ${capabilities.length} capabilities, `
  + `${controlPlane.provisioning} control plane.`,
);
