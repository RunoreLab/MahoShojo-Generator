import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  ArenaRoomSnapshotSchema,
  DataCardRefSchema,
  parseArenaRoomSnapshot,
} from '@mahoshojo/contracts/arena-room';

const fixturePath = fileURLToPath(new URL('./fixtures/arena-room-v1.json', import.meta.url));

describe('Arena Room v1 wire contract', () => {
  it('round-trips the current v1 snapshot fixture through a strict schema', async () => {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
    const parsed = parseArenaRoomSnapshot(fixture);

    expect(parsed.protocolVersion).toBe(1);
    expect(parsed.sharedConfig.combatants).toHaveLength(2);
    expect(ArenaRoomSnapshotSchema.parse(parsed)).toEqual(parsed);
  });

  it('requires an opaque versionToken on every online data-card reference', () => {
    expect(() => DataCardRefSchema.parse({ id: 'c1', kind: 'character' })).toThrow(z.ZodError);
  });
});
