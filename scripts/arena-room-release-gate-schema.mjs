import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ARENA_ROOM_CHECKPOINT_CONTRACT =
  'arena-room-authority-v2-generation-payload-digest-v1';

const expectedV2TopLevelKeys = [
  'checkpointContract',
  'rollback',
  'schemaVersion',
  'writerActivation',
];
const expectedV1TopLevelKeys = [
  'checkpointContract',
  'compatibleReaderRolloutRequired',
  'evidence',
  'productionGoNoGoRequired',
  'rollback',
  'rolloutOrder',
  'schemaVersion',
  'writerActivation',
];
const expectedRollbackKeys = [
  'generationStartMustBeDisabled',
  'minimumReaderContract',
];
const expectedEvidence = Object.freeze({
  legacyCheckpointReaderTest: 'GMR-09 mixed-version checkpoint gate',
  productionFeatureGateTest: 'GMR-09 mixed-version gate',
  rollbackShellGate: 'verify_arena_room_rollback_gate',
});
const expectedEvidenceKeys = Object.keys(expectedEvidence).sort();
const expectedRolloutOrder = [
  'compatible-reader',
  'writer-disabled-validation',
  'production-go-no-go',
  'writer-activation',
];

const isRecord = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

const hasExactKeys = (value, expectedKeys) => (
  isRecord(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys)
);

export const validateArenaRoomReleaseGate = (
  candidate,
  {
    expectedWriterActivation,
    expectedContract = ARENA_ROOM_CHECKPOINT_CONTRACT,
    expectedSchemaVersion,
  } = {},
) => {
  const failures = [];
  const fail = (message) => failures.push(message);

  if (!isRecord(candidate) || ![1, 2].includes(candidate.schemaVersion)) {
    fail('schemaVersion 必须为受支持的 1 或 2');
    return failures;
  }
  if (
    expectedSchemaVersion !== undefined
    && candidate.schemaVersion !== expectedSchemaVersion
  ) {
    fail(`schemaVersion 必须为 ${expectedSchemaVersion}`);
  }
  const expectedTopLevelKeys = candidate.schemaVersion === 1
    ? expectedV1TopLevelKeys
    : expectedV2TopLevelKeys;
  if (!hasExactKeys(candidate, expectedTopLevelKeys)) {
    fail('顶层字段必须与 Arena Room release gate schema 精确一致');
    return failures;
  }
  if (candidate.checkpointContract !== expectedContract) {
    fail('checkpointContract 与期望 reader contract 不一致');
  }
  if (!['disabled', 'enabled'].includes(candidate.writerActivation)) {
    fail('writerActivation 必须是 disabled 或 enabled');
  }
  if (
    expectedWriterActivation !== undefined
    && candidate.writerActivation !== expectedWriterActivation
  ) {
    fail(`writerActivation 必须为 ${expectedWriterActivation}`);
  }
  if (!hasExactKeys(candidate.rollback, expectedRollbackKeys)) {
    fail('rollback 字段必须与 schema 精确一致');
  } else {
    if (candidate.rollback.minimumReaderContract !== expectedContract) {
      fail('rollback.minimumReaderContract 与期望 reader contract 不一致');
    }
    if (candidate.rollback.generationStartMustBeDisabled !== true) {
      fail('rollback.generationStartMustBeDisabled 必须为 true');
    }
  }
  if (candidate.schemaVersion === 1) {
    if (candidate.compatibleReaderRolloutRequired !== true) {
      fail('legacy compatibleReaderRolloutRequired 必须为 true');
    }
    if (candidate.productionGoNoGoRequired !== true) {
      fail('legacy productionGoNoGoRequired 必须为 true');
    }
    if (JSON.stringify(candidate.rolloutOrder) !== JSON.stringify(expectedRolloutOrder)) {
      fail('legacy rolloutOrder 不兼容');
    }
    if (!hasExactKeys(candidate.evidence, expectedEvidenceKeys)) {
      fail('legacy evidence 字段必须与 schema 精确一致');
    } else {
      for (const [key, value] of Object.entries(expectedEvidence)) {
        if (candidate.evidence[key] !== value) fail(`legacy evidence.${key} 非法`);
      }
    }
  }
  return failures;
};

const readArgument = (arguments_, name, fallback) => {
  const index = arguments_.indexOf(name);
  if (index < 0) return fallback;
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少值`);
  return value;
};

export const runArenaRoomReleaseGateSchemaCli = (arguments_ = process.argv.slice(2)) => {
  const allowedArguments = new Set([
    '--manifest',
    '--expect-writer',
    '--expect-contract',
    '--expect-schema',
  ]);
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    if (!allowedArguments.has(name) || index + 1 >= arguments_.length) {
      throw new Error(`未知或不完整参数：${name ?? ''}`);
    }
  }
  const manifestPath = readArgument(arguments_, '--manifest');
  if (!manifestPath) throw new Error('--manifest 缺少值');
  const expectedWriterActivation = readArgument(arguments_, '--expect-writer');
  if (
    expectedWriterActivation !== undefined
    && !['disabled', 'enabled'].includes(expectedWriterActivation)
  ) {
    throw new Error('--expect-writer 必须是 disabled 或 enabled');
  }
  const expectedContract = readArgument(
    arguments_,
    '--expect-contract',
    ARENA_ROOM_CHECKPOINT_CONTRACT,
  );
  const rawExpectedSchemaVersion = readArgument(arguments_, '--expect-schema');
  const expectedSchemaVersion = rawExpectedSchemaVersion === undefined
    ? undefined
    : Number(rawExpectedSchemaVersion);
  if (
    expectedSchemaVersion !== undefined
    && ![1, 2].includes(expectedSchemaVersion)
  ) {
    throw new Error('--expect-schema 必须是 1 或 2');
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`release gate JSON 无法解析：${detail}`);
  }
  const failures = validateArenaRoomReleaseGate(manifest, {
    expectedWriterActivation,
    expectedContract,
    expectedSchemaVersion,
  });
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[arena-room-release-gate-schema] ${failure}`);
    }
    return 1;
  }
  console.log(JSON.stringify({
    gate: 'ARENA_ROOM_RELEASE_GATE_SCHEMA',
    writerActivation: manifest.writerActivation,
    checkpointContract: manifest.checkpointContract,
    status: 'PASS',
  }));
  return 0;
};

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = runArenaRoomReleaseGateSchemaCli();
  } catch (error) {
    console.error(`[arena-room-release-gate-schema] ${
      error instanceof Error ? error.message : String(error)
    }`);
    process.exitCode = 1;
  }
}
