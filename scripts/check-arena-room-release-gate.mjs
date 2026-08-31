import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  ARENA_ROOM_CHECKPOINT_CONTRACT,
  validateArenaRoomReleaseGate,
} from './arena-room-release-gate-schema.mjs';

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
const failures = validateArenaRoomReleaseGate(manifest, { expectedSchemaVersion: 2 });
const fail = (message) => failures.push(message);
const expectedContract = ARENA_ROOM_CHECKPOINT_CONTRACT;
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
