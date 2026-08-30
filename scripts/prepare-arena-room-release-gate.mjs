import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ARENA_ROOM_CHECKPOINT_CONTRACT,
  validateArenaRoomReleaseGate,
} from './arena-room-release-gate-schema.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const arguments_ = process.argv.slice(2);
const readArgument = (name, fallback) => {
  const index = arguments_.indexOf(name);
  if (index < 0) return fallback;
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少值`);
  return value;
};
const allowedArguments = new Set(['--source', '--output', '--writer']);
for (let index = 0; index < arguments_.length; index += 2) {
  const name = arguments_[index];
  if (!allowedArguments.has(name) || index + 1 >= arguments_.length) {
    throw new Error(`未知或不完整参数：${name ?? ''}`);
  }
}

const sourcePath = path.resolve(repositoryRoot, readArgument(
  '--source',
  'config/arena-room-release-gate.json',
));
const outputPath = path.resolve(repositoryRoot, readArgument(
  '--output',
  'apps/api/dist/arena-room-release-gate.json',
));
const writerActivation = readArgument('--writer', 'disabled');
if (!['disabled', 'enabled'].includes(writerActivation)) {
  throw new Error('--writer 必须为 disabled 或 enabled');
}

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const sourceFailures = validateArenaRoomReleaseGate(source);
if (sourceFailures.length > 0) {
  throw new Error(`source release gate 非法：${sourceFailures.join('；')}`);
}
const candidate = { ...source, writerActivation };
const candidateFailures = validateArenaRoomReleaseGate(candidate, {
  expectedWriterActivation: writerActivation,
});
if (candidateFailures.length > 0) {
  throw new Error(`candidate release gate 非法：${candidateFailures.join('；')}`);
}
if (writerActivation === 'enabled') {
  if (process.env.ARENA_ROOM_READER_ROLLOUT_CONTRACT !== ARENA_ROOM_CHECKPOINT_CONTRACT) {
    throw new Error('writer activation 前缺少 compatible reader rollout attestation');
  }
  if (process.env.ARENA_ROOM_PRODUCTION_GO_NO_GO !== 'approved') {
    throw new Error('writer activation 前缺少独立 production go/no-go');
  }
}

await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  gate: 'ARENA_ROOM_RELEASE_GATE_PREPARED',
  writerActivation,
  checkpointContract: candidate.checkpointContract,
  status: 'PASS',
}));
