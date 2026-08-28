import { readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} 缺少值`);
  return value;
};
const mode = argument('--mode', 'verify');
const manifestPath = path.resolve(repositoryRoot, argument(
  '--manifest',
  'config/arena-room-release-gate.json',
));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const failures = [];
const fail = (message) => failures.push(message);
const expectedContract = 'arena-room-authority-v2-generation-payload-digest-v1';
const expectedOrder = [
  'compatible-reader',
  'writer-disabled-validation',
  'production-go-no-go',
  'writer-activation',
];

if (manifest.schemaVersion !== 1) fail('schemaVersion 必须为 1');
if (manifest.checkpointContract !== expectedContract) {
  fail('checkpointContract 必须保持 GMR-09 generation payload digest reader contract');
}
if (!['disabled', 'enabled'].includes(manifest.writerActivation)) {
  fail('writerActivation 必须是 disabled 或 enabled');
}
if (manifest.compatibleReaderRolloutRequired !== true) {
  fail('compatible reader rollout 必须是强制门禁');
}
if (manifest.productionGoNoGoRequired !== true) fail('production go/no-go 必须是强制门禁');
if (JSON.stringify(manifest.rolloutOrder) !== JSON.stringify(expectedOrder)) {
  fail('rolloutOrder 必须保持 reader-first 与显式 production go/no-go');
}
if (
  manifest.rollback?.minimumReaderContract !== expectedContract
  || manifest.rollback?.generationStartMustBeDisabled !== true
) fail('rollback 必须要求 compatible reader 且先关闭 generation start');

const sourceEvidence = [
  [
    'packages/multiplayer-core/tests/state-machine-review-regressions.test.ts',
    manifest.evidence?.legacyCheckpointReaderTest,
  ],
  ['apps/api/tests/config.test.ts', manifest.evidence?.productionFeatureGateTest],
  ['apps/api/deploy/deploy-bundle.sh', manifest.evidence?.rollbackShellGate],
];
for (const [relativePath, marker] of sourceEvidence) {
  const source = readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
  if (typeof marker !== 'string' || !marker || !source.includes(marker)) {
    fail(`${relativePath} 缺少 release gate evidence marker`);
  }
}

if (mode === 'deploy' && manifest.writerActivation === 'enabled') {
  if (process.env.ARENA_ROOM_READER_ROLLOUT_CONTRACT !== expectedContract) {
    fail('writer activation 前缺少 compatible reader rollout attestation');
  }
  if (process.env.ARENA_ROOM_PRODUCTION_GO_NO_GO !== 'approved') {
    fail('writer activation 前缺少独立 production go/no-go');
  }
}
if (mode === 'rollback') {
  if (process.env.ARENA_MULTIPLAYER_GENERATION_START_STATE !== 'disabled') {
    fail('rollback 前必须关闭 Arena multiplayer generation start');
  }
  if (process.env.ARENA_ROOM_TARGET_READER_CONTRACT !== expectedContract) {
    fail('rollback target 必须支持 GMR-09 checkpoint contract');
  }
}
if (!['verify', 'deploy', 'rollback'].includes(mode)) fail('未知 release gate mode');

if (failures.length > 0) {
  for (const failure of failures) console.error(`[arena-room-release-gate] ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({
  gate: 'ARENA_ROOM_RELEASE_GATE',
  mode,
  writerActivation: manifest.writerActivation,
  checkpointContract: manifest.checkpointContract,
  status: 'PASS',
}));
