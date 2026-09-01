import { readFileSync } from 'node:fs';
import path from 'node:path';

import { computeArenaProductParitySourceDigest } from './lib/arena-product-parity-source-digest.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const expectedSliceIds = Array.from(
  { length: 7 },
  (_, index) => `GMR-10Q-${String.fromCharCode('A'.charCodeAt(0) + index)}`,
);
const allowedSliceStatuses = new Set(['BLOCKED', 'READY', 'IN_PROGRESS', 'DONE']);

const argumentValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少值`);
  return value;
};

const requireReady = process.argv.includes('--require-ready');
const printSourceDigest = process.argv.includes('--print-source-digest');
const knownArguments = new Set(['--', '--manifest', '--require-ready', '--print-source-digest']);
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value.startsWith('--')) continue;
  if (!knownArguments.has(value)) throw new Error(`未知参数：${value}`);
  if (value === '--manifest') index += 1;
}

const manifestPath = path.resolve(repositoryRoot, argumentValue(
  '--manifest',
  'config/arena-product-parity-gate.json',
));

if (printSourceDigest) {
  console.log(computeArenaProductParitySourceDigest(repositoryRoot));
  process.exit(0);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`[arena-product-parity] manifest 无法读取或不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const failures = [];
const fail = (message) => failures.push(message);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

if (!isRecord(manifest)) fail('manifest 必须是 object');
if (manifest.schemaVersion !== 3) fail('schemaVersion 必须为 3');
if (manifest.goal !== 'GMR-10Q') fail('goal 必须为 GMR-10Q');
if (manifest.acceptedSpec !== 'SPEC-arena-multiplayer-gate-minimization-parity-v1') {
  fail('acceptedSpec 必须绑定 accepted gate minimization parity spec');
}
if (
  !isRecord(manifest.prerequisiteGoals)
  || Object.keys(manifest.prerequisiteGoals).length !== 1
  || manifest.prerequisiteGoals['GMR-10P'] !== 'DONE'
) {
  fail('prerequisiteGoals 必须精确记录 GMR-10P=DONE');
}
if (!['IN_PROGRESS', 'DONE'].includes(manifest.overallStatus)) {
  fail('overallStatus 只能为 IN_PROGRESS 或 DONE');
}
if (!['BLOCKED', 'READY'].includes(manifest.productionReadiness)) {
  fail('productionReadiness 只能为 BLOCKED 或 READY');
}
if (!isRecord(manifest.slices)) {
  fail('slices 必须是 object');
} else {
  const actualSliceIds = Object.keys(manifest.slices).sort();
  if (JSON.stringify(actualSliceIds) !== JSON.stringify(expectedSliceIds)) {
    fail('slices 必须精确枚举 GMR-10Q-A 至 GMR-10Q-G');
  }
  for (const sliceId of expectedSliceIds) {
    if (!allowedSliceStatuses.has(manifest.slices[sliceId])) {
      fail(`${sliceId} 状态非法`);
    }
  }
}
if (typeof manifest.blockedReason !== 'string' || manifest.blockedReason.trim() === '') {
  fail('blockedReason 必须是非空字符串');
}

const allSlicesDone = isRecord(manifest.slices)
  && expectedSliceIds.every((sliceId) => manifest.slices[sliceId] === 'DONE');
const ready = manifest.overallStatus === 'DONE'
  && manifest.productionReadiness === 'READY'
  && allSlicesDone;

const exitEvidence = isRecord(manifest.exitEvidence) ? manifest.exitEvidence : null;
if (!exitEvidence) {
  fail('manifest 必须声明 exitEvidence');
} else {
  if (ready) {
    if (
      typeof exitEvidence.sourceDigest !== 'string'
      || !/^[a-f0-9]{64}$/u.test(exitEvidence.sourceDigest)
    ) fail('READY 时 exitEvidence.sourceDigest 必须是 SHA-256');
  } else if (
    exitEvidence.sourceDigest !== null
    && (
      typeof exitEvidence.sourceDigest !== 'string'
      || !/^[a-f0-9]{64}$/u.test(exitEvidence.sourceDigest)
    )
  ) fail('exitEvidence.sourceDigest 只能为 null 或 SHA-256');
  if (
    typeof exitEvidence.auditLog !== 'string'
    || !/^docs\/logs\/[^/]+\.md$/u.test(exitEvidence.auditLog)
  ) fail('exitEvidence.auditLog 必须指向 docs/logs 下的 Markdown');
  if (!isRecord(exitEvidence.independentReview)) {
    fail('exitEvidence.independentReview 必须是 object');
  } else if (ready && (
    exitEvidence.independentReview.status !== 'PASS'
      || exitEvidence.independentReview.critical !== 0
      || exitEvidence.independentReview.important !== 0
  )) {
    fail('独立复审必须 PASS 且 Critical/Important 均为 0');
  } else if (!ready && !['PENDING', 'PASS'].includes(exitEvidence.independentReview.status)) {
    fail('未 READY 时 independentReview.status 只能为 PENDING 或 PASS');
  }
}

if (ready && manifest.blockedReason !== 'none') {
  fail('production READY 时 blockedReason 必须为 none');
}
if (ready && exitEvidence) {
  const currentDigest = computeArenaProductParitySourceDigest(repositoryRoot);
  if (exitEvidence.sourceDigest !== currentDigest) {
    fail(`READY sourceDigest 已失效：expected=${exitEvidence.sourceDigest} actual=${currentDigest}`);
  }
  try {
    const audit = readFileSync(path.resolve(repositoryRoot, exitEvidence.auditLog), 'utf8');
    for (const marker of [
      'GMR10Q_EXIT_REVIEW_STATUS: PASS',
      'GMR10Q_EXIT_REVIEW_CRITICAL: 0',
      'GMR10Q_EXIT_REVIEW_IMPORTANT: 0',
      'GMR10Q_EXIT_VERIFICATION: PASS',
    ]) {
      if (!audit.includes(marker)) fail(`exit audit 缺少证据标记：${marker}`);
    }
  } catch (error) {
    fail(`exitEvidence.auditLog 无法读取：${error instanceof Error ? error.message : String(error)}`);
  }
}
if (!ready && manifest.productionReadiness !== 'BLOCKED') {
  fail('GMR-10Q 未完整 DONE 时 productionReadiness 必须为 BLOCKED');
}
if (requireReady && !ready) {
  fail('GMR-10Q 未 DONE，production readiness 必须 fail closed');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[arena-product-parity] ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  gate: 'ARENA_PRODUCT_PARITY_GATE',
  goal: manifest.goal,
  overallStatus: manifest.overallStatus,
  productionReadiness: manifest.productionReadiness,
  mode: requireReady ? 'require-ready' : 'verify',
  status: 'PASS',
}));
