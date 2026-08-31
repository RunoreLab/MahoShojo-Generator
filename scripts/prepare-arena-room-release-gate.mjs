import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
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
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const sourceFailures = validateArenaRoomReleaseGate(source, { expectedSchemaVersion: 2 });
if (sourceFailures.length > 0) {
  throw new Error(`source release gate 非法：${sourceFailures.join('；')}`);
}
const writerActivation = readArgument('--writer', source.writerActivation);
if (!['disabled', 'enabled'].includes(writerActivation)) {
  throw new Error('--writer 必须为 disabled 或 enabled');
}
const candidate = { ...source, writerActivation };
const candidateFailures = validateArenaRoomReleaseGate(candidate, {
  expectedWriterActivation: writerActivation,
  expectedSchemaVersion: 2,
});
if (candidateFailures.length > 0) {
  throw new Error(`candidate release gate 非法：${candidateFailures.join('；')}`);
}
await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  gate: 'ARENA_ROOM_RELEASE_GATE_PREPARED',
  writerActivation,
  checkpointContract: candidate.checkpointContract,
  status: 'PASS',
}));
