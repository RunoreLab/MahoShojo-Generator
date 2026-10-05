import { describe, expect, it } from 'vitest';

import {
  ARENA_ROOM_GENERATION_PRESET_REFS,
  ArenaRoomGenerationPresetResolverError,
  createArenaRoomGenerationPresetResolver,
} from '#/arena-room/room-generation-preset-registry';

describe('Arena Room server-known preset registry', () => {
  it('以 filename/id + kind + canonical SHA-256 exact 解析角色与情景资产', async () => {
    const resolver = createArenaRoomGenerationPresetResolver();
    const characterRef = ARENA_ROOM_GENERATION_PRESET_REFS.find((entry) => (
      entry.id === 'M00_white_lily.json' && entry.kind === 'character'
    ));
    const scenarioRef = ARENA_ROOM_GENERATION_PRESET_REFS.find((entry) => (
      entry.id === 'S01_queen_will.json' && entry.kind === 'scenario'
    ));
    expect(characterRef?.versionToken).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(scenarioRef?.versionToken).toMatch(/^sha256:[a-f0-9]{64}$/u);

    await expect(resolver.resolve({ ref: characterRef! })).resolves.toMatchObject({
      ref: characterRef,
      payload: expect.objectContaining({}),
    });
    await expect(resolver.resolve({ ref: scenarioRef! })).resolves.toMatchObject({
      ref: scenarioRef,
      payload: expect.objectContaining({}),
    });
  });

  it.each([
    ['unknown', { id: 'unknown.json', kind: 'character', versionToken: `sha256:${'a'.repeat(64)}` }, 'ARENA_ROOM_PRESET_NOT_FOUND'],
    ['wrong kind', { id: 'M00_white_lily.json', kind: 'scenario', versionToken: `sha256:${'a'.repeat(64)}` }, 'ARENA_ROOM_PRESET_NOT_FOUND'],
    ['stale digest', { id: 'M00_white_lily.json', kind: 'character', versionToken: `sha256:${'a'.repeat(64)}` }, 'ARENA_ROOM_PRESET_VERSION_MISMATCH'],
  ])('%s preset fail closed', async (_name, ref, code) => {
    const resolver = createArenaRoomGenerationPresetResolver();
    await expect(resolver.resolve({ ref: ref as never })).rejects.toMatchObject({ code });
  });

  it('返回独立 safe payload，调用方不能篡改 registry truth', async () => {
    const resolver = createArenaRoomGenerationPresetResolver();
    const ref = ARENA_ROOM_GENERATION_PRESET_REFS.find((entry) => (
      entry.id === 'M00_white_lily.json' && entry.kind === 'character'
    ))!;
    const first = await resolver.resolve({ ref });
    expect(() => {
      (first.payload as Record<string, unknown>).tampered = true;
    }).toThrow();
    const second = await resolver.resolve({ ref });
    expect(second.payload).not.toHaveProperty('tampered');
    expect(first).not.toBeInstanceOf(ArenaRoomGenerationPresetResolverError);
  });
});
