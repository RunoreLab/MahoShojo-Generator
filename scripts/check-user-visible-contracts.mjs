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
const canonicalAutomatedEvidence = Object.freeze({
  'route-inventory-and-method-wire': [
    'apps/api/tests/user-visible-contract.test.ts',
  ],
  'family-level-success-and-error-projection': [
    'apps/api/tests/regular-generation-hono-success.test.ts',
    'apps/api/tests/regular-generation-adapters.test.ts',
    'packages/hosted-api/tests/regular-generation.test.ts',
  ],
  'exited-source-hash-and-basic-error-wire': [
    'apps/web/tests/exited-api-contract.test.ts',
  ],
  'arena-service-client-replay-cancel-seams': [
    'apps/web/tests/arena-generation-fault-injection.test.ts',
    'apps/web/tests/resumable-arena-generation-client.test.ts',
    'packages/hosted-api/tests/arena-generation-service.test.ts',
    'packages/hosted-runtime/tests/arena-generation-prompt.test.ts',
    'packages/hosted-runtime/tests/arena-generation-node-executor.test.ts',
    'packages/hosted-runtime/tests/arena-companion-service.test.ts',
    'packages/hosted-runtime/tests/structured-ai-compatibility.test.ts',
    'apps/web/tests/arena-generation-prompt-parity.test.ts',
    'apps/web/tests/ai-structured-output-boundary.test.ts',
  ],
  'arena-resource-budget-and-single-parse': [
    'packages/hosted-api/tests/arena-generation-resource-budget.test.ts',
    'packages/hosted-api/tests/arena-generation-service.test.ts',
    'packages/hosted-runtime/tests/arena-generation-runtime.test.ts',
    'packages/hosted-runtime/tests/arena-generation-node-executor.test.ts',
    'packages/hosted-runtime/tests/arena-companion-service.test.ts',
    'packages/hosted-runtime/tests/arena-companion-session.test.ts',
    'packages/hosted-runtime/tests/arena-generation-actor.test.ts',
  ],
  'provider-public-error-and-secret-canaries': [
    'apps/web/tests/ai-error-extraction.test.ts',
    'packages/hosted-api/tests/public-ai-error.test.ts',
    'packages/hosted-api/tests/regular-generation.test.ts',
  ],
  'infrastructure-copy-map': [
    'apps/api/tests/hosted-dr-fault-matrix.test.ts',
    'apps/web/tests/api-error-message.test.ts',
  ],
  'client-preflight-routing-and-zero-replay': [
    'apps/web/tests/hosted-dr-client-preflight.test.ts',
    'apps/web/tests/hono-api-client.test.ts',
    'tests/hosted-dr-client-bundle.test.ts',
  ],
});
const canonicalAutomatedCoverage = Object.keys(canonicalAutomatedEvidence);
const canonicalOpenCoverage = [
  'all-18-shared-routes-default-vs-refactor-post-success-and-error-runtime-differential',
  'all-6-exited-routes-auth-success-and-upstream-error-runtime-differential',
  'real-browser-network-transition-and-background-suspension-journey',
  'production-client-preflight-observability-and-authorized-fault-drill',
];

const fail = (message) => failures.push(message);
const isStringArray = (value) => (
  Array.isArray(value)
  && value.length > 0
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
) {
  fail('auditCoverage 必须诚实登记为 partial，并列出 automated/open 维度');
} else {
  assertUnique(contracts.auditCoverage.automated, 'auditCoverage.automated');
  assertUnique(contracts.auditCoverage.open, 'auditCoverage.open');
  assertSameSet(
    contracts.auditCoverage.automated,
    canonicalAutomatedCoverage,
    'auditCoverage.automated canonical dimensions',
  );
  assertSameSet(
    contracts.auditCoverage.open,
    canonicalOpenCoverage,
    'auditCoverage.open canonical dimensions',
  );
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

const automatedEvidence = contracts.auditCoverage?.automatedEvidence;
if (!automatedEvidence || typeof automatedEvidence !== 'object' || Array.isArray(automatedEvidence)) {
  fail('auditCoverage.automatedEvidence 必须把每个 automated dimension 绑定到实际 evidence suite');
} else {
  assertSameSet(
    Object.keys(automatedEvidence),
    canonicalAutomatedCoverage,
    'auditCoverage.automatedEvidence keys',
  );
  const requiredEvidence = new Set(contracts.requiredEvidenceTests ?? []);
  for (const dimension of canonicalAutomatedCoverage) {
    const evidencePaths = automatedEvidence[dimension];
    if (!isStringArray(evidencePaths)) {
      fail(`${dimension}: 必须绑定至少一个 evidence suite`);
      continue;
    }
    assertUnique(evidencePaths, `${dimension} evidence suites`);
    assertSameSet(
      evidencePaths,
      canonicalAutomatedEvidence[dimension],
      `${dimension} canonical evidence suites`,
    );
    for (const evidencePath of evidencePaths) {
      if (!requiredEvidence.has(evidencePath)) {
        fail(`${dimension}: evidence 未登记到 requiredEvidenceTests：${evidencePath}`);
      }
    }
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

const arenaResourceBudgetDecision = (contracts.intentionalChanges ?? []).find(
  (entry) => entry.id === 'arena-generation-resource-budget',
);
const expectedArenaResourceBudgetDecision = 'hosted-system-final-prompt-budget-is-128k-estimated-tokens-hosted-byok-is-1m-while-12mib-body-32-combatant-100-adjudication-256-reference-item-and-4mib-output-budgets-remain-common';
if (arenaResourceBudgetDecision?.decision !== expectedArenaResourceBudgetDecision) {
  fail('Arena resource budget 必须明确区分 system/BYOK Prompt 预算并保留共同基础设施硬边界');
} else {
  const authorityPath = path.join(repositoryRoot, arenaResourceBudgetDecision.authority ?? '');
  if (!existsSync(authorityPath)) {
    fail(`Arena resource budget accepted authority 不存在：${arenaResourceBudgetDecision.authority ?? '<missing>'}`);
  } else {
    const authority = readFileSync(authorityPath, 'utf8');
    for (const requiredText of [
      '`hosted-system` 为 `128,000`',
      '`hosted-byok`\n   为 `1,000,000`',
      '合计最多 `256` 项',
      '合计最多 `4 MiB`',
      'typed parsed-payload seam',
    ]) {
      if (!authority.includes(requiredText)) {
        fail(`Arena resource budget authority 缺少规范文本：${requiredText}`);
      }
    }
  }
}

if (
  hostedDrDrills.controlPlaneProvisioning !== 'not-provisioned'
  || hostedDrDrills.productionStatus !== 'deferred'
  || hostedDrDrills.productionDrill?.status !== 'deferred'
) {
  fail('optional managed control plane 未授权开通时必须保持 not-provisioned/deferred');
}
if (
  capabilities.controlPlane?.defaultMode !== 'client-preflight'
  || capabilities.controlPlane?.managedControlPlane !== 'optional-disabled'
) {
  fail('低成本 production 默认必须为 client-preflight，managed control plane 必须保持 optional-disabled');
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
  + 'client-preflight is the production default; optional managed control plane remains disabled/deferred.',
);
