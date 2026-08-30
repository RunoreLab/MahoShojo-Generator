import type { ChallengeRunRecord } from './types';

export const createAcceptedChallengeRunRecord = (
  baseRecord: ChallengeRunRecord,
  acceptedPatch: Partial<ChallengeRunRecord>,
  checkpointId: string,
): ChallengeRunRecord => Object.assign({}, baseRecord, acceptedPatch, {
  lastCheckpointId: checkpointId,
});
