import { readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(repositoryRoot, 'config/arena-production-activation-gate.json');
const args = process.argv.slice(2);
const requireApproved = args.includes('--require-approved');
const commitFlagIndex = args.indexOf('--commit');
const commit = commitFlagIndex >= 0 ? args[commitFlagIndex + 1] : undefined;
const knownArgs = new Set(['--require-approved', '--commit']);

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (!arg || knownArgs.has(arg)) {
    if (arg === '--commit') index += 1;
    continue;
  }
  console.error(`[arena-production-activation] 未知参数：${arg}`);
  process.exit(2);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`[arena-production-activation] manifest 无法读取：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const failures = [];
if (manifest?.schemaVersion !== 1) failures.push('schemaVersion 必须为 1');
if (manifest?.goal !== 'GMR-11') failures.push('goal 必须为 GMR-11');
if (!['READY', 'APPROVED'].includes(manifest?.reviewStatus)) {
  failures.push('reviewStatus 必须为 READY 或 APPROVED');
}

const approved = manifest?.reviewStatus === 'APPROVED';
if (approved) {
  if (typeof manifest.reviewedCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(manifest.reviewedCommit)) {
    failures.push('APPROVED 必须绑定 40 位 reviewedCommit');
  }
  if (typeof manifest.approvedAt !== 'string' || Number.isNaN(Date.parse(manifest.approvedAt))) {
    failures.push('APPROVED 必须记录 approvedAt');
  }
  if (typeof manifest.approvalEvidence !== 'string' || !manifest.approvalEvidence.startsWith('docs/')) {
    failures.push('APPROVED 必须绑定 docs/ 下的独立审查证据');
  }
} else if (
  manifest?.reviewedCommit !== null
  || manifest?.approvedAt !== null
  || manifest?.approvalEvidence !== null
) {
  failures.push('READY 不得携带伪批准信息');
}

if (requireApproved) {
  if (!approved) failures.push('GMR-11 独立审查未批准，禁止启用 production Arena multiplayer');
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/u.test(commit)) {
    failures.push('--require-approved 必须提供 40 位 --commit');
  } else if (approved && manifest.reviewedCommit !== commit) {
    failures.push('当前 release commit 与 GMR-11 reviewedCommit 不一致');
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[arena-production-activation] ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  gate: 'ARENA_PRODUCTION_ACTIVATION_GATE',
  goal: manifest.goal,
  reviewStatus: manifest.reviewStatus,
  mode: requireApproved ? 'require-approved' : 'validate',
  status: 'PASS',
}));
