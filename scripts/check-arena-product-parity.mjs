import { readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const expectedSliceIds = Array.from(
  { length: 7 },
  (_, index) => `GMR-10P-${String.fromCharCode('A'.charCodeAt(0) + index)}`,
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
const knownArguments = new Set(['--manifest', '--require-ready']);
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
if (manifest.schemaVersion !== 1) fail('schemaVersion 必须为 1');
if (manifest.goal !== 'GMR-10P') fail('goal 必须为 GMR-10P');
if (manifest.acceptedSpec !== 'SPEC-arena-multiplayer-product-parity-amendment-v1') {
  fail('acceptedSpec 必须绑定 accepted product parity spec');
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
    fail('slices 必须精确枚举 GMR-10P-A 至 GMR-10P-G');
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

if (ready && manifest.blockedReason !== 'none') {
  fail('production READY 时 blockedReason 必须为 none');
}
if (!ready && manifest.productionReadiness !== 'BLOCKED') {
  fail('GMR-10P 未完整 DONE 时 productionReadiness 必须为 BLOCKED');
}
if (requireReady && !ready) {
  fail('GMR-10P 未 DONE，production readiness 必须 fail closed');
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
