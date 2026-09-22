import { z } from './zod';

import { ArenaContractError } from './errors';
import { MAX_SNAPSHOT_DIGEST_LENGTH } from './limits';
import { OpaqueKeySchema, ParticipantUserIdsSchema } from './primitives';
import { ArenaRoomSharedConfigSchema } from './shared-config';

export const ArenaMultiplayerGenerationSnapshotSchema = z
  .object({
    roomId: OpaqueKeySchema,
    generationRequestId: OpaqueKeySchema,
    configRevision: z.number().int().nonnegative(),
    snapshotDigest: z.string().trim().min(1).max(MAX_SNAPSHOT_DIGEST_LENGTH),
    collaborativeInfluence: z.boolean(),
    participantUserIds: ParticipantUserIdsSchema,
    // Optional only for checkpoints created before participant roles were frozen.
    hostAccountUserId: z.number().int().positive().optional(),
    sharedConfig: ArenaRoomSharedConfigSchema,
  })
  .strict()
  .refine((snapshot) => snapshot.hostAccountUserId === undefined
    || snapshot.participantUserIds.includes(snapshot.hostAccountUserId), {
    path: ['hostAccountUserId'], message: 'host must be a frozen participant',
  });
export type ArenaMultiplayerGenerationSnapshot = z.infer<typeof ArenaMultiplayerGenerationSnapshotSchema>;

export const parseArenaMultiplayerGenerationSnapshot = (input: unknown): ArenaMultiplayerGenerationSnapshot => {
  try {
    return ArenaMultiplayerGenerationSnapshotSchema.parse(input);
  } catch (error) {
    throw new ArenaContractError('validation-failed', 'invalid Arena generation snapshot', undefined, error);
  }
};
