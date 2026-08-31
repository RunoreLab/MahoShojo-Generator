import type { DataCardRef } from '@mahoshojo/contracts/arena-room';

import {
  createArenaRoomGenerationMaterializer,
  type ArenaRoomGenerationCanonicalContent,
  type ArenaRoomGenerationMaterializer,
} from '../src/arena-room/room-generation-materializer';

const canonicalVerifierContent = (ref: DataCardRef): ArenaRoomGenerationCanonicalContent => {
  const displayName = `Verifier ${ref.id}`;
  const payload = ref.kind === 'character'
    ? { name: displayName, content: '本地 Redis 验证角色' }
    : { title: displayName, content: `本地 Redis 验证 ${ref.kind}` };
  return Object.freeze({
    ref: Object.freeze({ ...ref }),
    displayName,
    sourceType: ref.kind,
    payload: Object.freeze(payload),
  });
};

export const createRoomGenerationVerifierMaterializer = (
  onMaterialize?: () => void,
): ArenaRoomGenerationMaterializer => {
  const materializer = createArenaRoomGenerationMaterializer({
    content: {
      resolveOnline: async ({ ref }) => canonicalVerifierContent(ref),
      resolvePreset: async ({ ref }) => canonicalVerifierContent(ref),
    },
  });
  return Object.freeze({
    async materialize(input) {
      onMaterialize?.();
      return materializer.materialize(input);
    },
  });
};
