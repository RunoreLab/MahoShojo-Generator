import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const readJson = (relativePath) => JSON.parse(readFileSync(
  path.join(repositoryRoot, relativePath),
  'utf8',
));
const contracts = readJson('config/user-visible-contracts.json');
const routeInventory = readJson('config/hono-api-routes.json');
const hostedDrDrills = readJson('config/hosted-dr-drills.json');
const capabilities = readJson('config/hosted-dr-capabilities.json');
const failures = [];

const fail = (message) => failures.push(message);
const isStringArray = (value) => (
  Array.isArray(value)
  && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
);
const assertUnique = (values, label) => {
  if (!isStringArray(values)) {
    fail(`${label} 必须为非空字符串数组`);
    return;
  }
  if (new Set(values).size !== values.length) fail(`${label} 不得包含重复项`);
};
const assertSameSet = (actual, expected, label) => {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = [...expectedSet].filter((entry) => !actualSet.has(entry));
  const unexpected = [...actualSet].filter((entry) => !expectedSet.has(entry));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`${label} 不一致；缺少 [${missing.join(', ')}]，多出 [${unexpected.join(', ')}]`);
  }
};

if (contracts.schemaVersion !== 1) fail('schemaVersion 必须为 1');
if (!/^[0-9a-f]{40}$/u.test(contracts.baseline?.commit ?? '')) {
  fail('baseline.commit 必须固定为完整 40 位 commit SHA');
}
if (
  contracts.auditCoverage?.status !== 'partial'
  || !isStringArray(contracts.auditCoverage?.automated)
  || !isStringArray(contracts.auditCoverage?.open)
  || contracts.auditCoverage.open.length === 0
) {
  fail('auditCoverage 必须诚实登记为 partial，并列出 automated/open 维度');
}

for (const [label, values] of [
  ['defaultRouteIds', contracts.defaultRouteIds],
  ['sharedWithDefaultRouteIds', contracts.sharedWithDefaultRouteIds],
  ['refactorOnlySharedRouteIds', contracts.refactorOnlySharedRouteIds],
  ['requiredEvidenceTests', contracts.requiredEvidenceTests],
]) {
  assertUnique(values, label);
}

const exitedRoutes = Array.isArray(contracts.exitedRoutes) ? contracts.exitedRoutes : [];
const exitedRouteIds = exitedRoutes.map((entry) => entry?.id);
assertUnique(exitedRouteIds, 'exitedRoutes[].id');
assertSameSet(
  contracts.defaultRouteIds ?? [],
  [...(contracts.sharedWithDefaultRouteIds ?? []), ...exitedRouteIds],
  '默认分支 route inventory 与 shared/exited 分解',
);
assertSameSet(
  routeInventory.sharedRouteIds ?? [],
  [
    ...(contracts.sharedWithDefaultRouteIds ?? []),
    ...(contracts.refactorOnlySharedRouteIds ?? []),
  ],
  '当前 shared route inventory',
);
assertSameSet(routeInventory.exitedRouteIds ?? [], exitedRouteIds, '当前 exited route inventory');
if ((routeInventory.legacyRouteIds ?? []).length !== 0) {
  fail('legacyRouteIds 必须保持为空');
}

const methodMap = new Map((capabilities.capabilities ?? []).map((capability) => [
  capability.id,
  (capability.operations ?? []).map((operation) => operation.method),
]));
for (const routeId of contracts.sharedWithDefaultRouteIds ?? []) {
  if (!methodMap.get(routeId)?.includes('POST')) {
    fail(`${routeId}: 与默认分支共用的生成 route 必须继续接受 POST`);
  }
}

for (const route of exitedRoutes) {
  if (!Array.isArray(route?.files) || route.files.length === 0) {
    fail(`${route?.id ?? '<unknown>'}: exited route 必须固定当前 source/handler hash`);
    continue;
  }
  for (const file of route.files) {
    const relativePath = file?.path;
    const expectedHash = file?.sha256;
    if (typeof relativePath !== 'string' || !/^[0-9a-f]{64}$/u.test(expectedHash ?? '')) {
      fail(`${route.id}: exited file path/hash 非法`);
      continue;
    }
    const absolutePath = path.resolve(repositoryRoot, relativePath);
    if (!absolutePath.startsWith(`${repositoryRoot}${path.sep}`) || !existsSync(absolutePath)) {
      fail(`${route.id}: exited file 不存在或越出仓库：${relativePath}`);
      continue;
    }
    const actualHash = createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
    if (actualHash !== expectedHash) {
      fail(`${route.id}: ${relativePath} 已偏离默认分支固定内容；请补 runtime differential evidence 后显式更新契约`);
    }
  }
}

for (const evidencePath of contracts.requiredEvidenceTests ?? []) {
  if (!existsSync(path.join(repositoryRoot, evidencePath))) {
    fail(`用户可感知契约 evidence test 不存在：${evidencePath}`);
  }
}

const plainStreamDecision = (contracts.intentionalChanges ?? []).find(
  (entry) => entry.id === 'arena-fetch-sse-only',
);
if (plainStreamDecision?.decision !== 'plain-stream-retired') {
  fail('plain-stream 必须明确记录为 retired，不得静默消失');
} else {
  const authorityPath = path.join(repositoryRoot, plainStreamDecision.authority ?? '');
  if (!existsSync(authorityPath)) {
    fail(`plain-stream accepted authority 不存在：${plainStreamDecision.authority ?? '<missing>'}`);
  } else {
    const authority = readFileSync(authorityPath, 'utf8');
    if (!authority.includes('plain-stream') || !authority.includes('MUST 单调迁移为 `sse`')) {
      fail('plain-stream authority 未固定 sse 单调迁移要求');
    }
  }
}

if (
  hostedDrDrills.controlPlaneProvisioning !== 'not-provisioned'
  || hostedDrDrills.productionStatus !== 'deferred'
  || hostedDrDrills.productionDrill?.status !== 'deferred'
) {
  fail('production stable control plane 未闭合前必须保持 not-provisioned/deferred');
}

if (failures.length > 0) {
  console.error('User-visible contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `User-visible structural contracts OK (${contracts.auditCoverage.status.toUpperCase()} coverage): `
  + `${contracts.sharedWithDefaultRouteIds.length} shared, `
  + `${exitedRoutes.length} exited, ${contracts.requiredEvidenceTests.length} evidence suites; `
  + `${contracts.auditCoverage.open.length} dimensions remain open; `
  + 'production control plane remains fail-closed/deferred.',
);
