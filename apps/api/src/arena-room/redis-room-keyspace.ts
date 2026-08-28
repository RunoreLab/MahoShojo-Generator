import { createHash } from 'node:crypto';

const ROOM_CHECKPOINT_KEY_PREFIX = 'mahoshojo:room:v1';
const ROOM_DIRECTORY_KEY_PREFIX = 'mahoshojo:room-directory:v1';

const validRoomId = (value: string): boolean => (
  value.length >= 1 && value.length <= 256 && value.trim() === value
);

const validHash = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);

export const hashArenaRoomId = (roomId: string): string => {
  if (!validRoomId(roomId)) throw new Error('REDIS_ROOM_ID_INVALID');
  return createHash('sha256').update(roomId).digest('hex');
};

export type ArenaRoomRedisKeyspace = {
  readonly checkpointPrefix: string;
  readonly directoryPrefix: string;
  readonly directoryRecordPrefix: string;
  readonly directoryPublicIndexKey: string;
  roomHash(roomId: string): string;
  roomCheckpointKey(roomId: string): string;
  roomIncarnationFenceKey(roomId: string): string;
  roomDirectoryRecordKey(roomId: string): string;
  roomDirectoryRecordKeyFromHash(roomHash: string): string;
};

export const createArenaRoomRedisKeyspace = (inputPrefix?: string): ArenaRoomRedisKeyspace => {
  const environmentPrefix = inputPrefix?.trim();
  if (environmentPrefix && !/^[a-z0-9_-]{1,32}$/u.test(environmentPrefix)) {
    throw new Error('keyPrefix 必须是安全的环境标识');
  }
  const checkpointPrefix = environmentPrefix
    ? `${ROOM_CHECKPOINT_KEY_PREFIX}:${environmentPrefix}`
    : ROOM_CHECKPOINT_KEY_PREFIX;
  const directoryPrefix = environmentPrefix
    ? `${ROOM_DIRECTORY_KEY_PREFIX}:${environmentPrefix}`
    : ROOM_DIRECTORY_KEY_PREFIX;
  const directoryRecordPrefix = `${directoryPrefix}:entry:`;
  const roomDirectoryRecordKeyFromHash = (roomHash: string): string => {
    if (!validHash(roomHash)) throw new Error('REDIS_ROOM_HASH_INVALID');
    return `${directoryRecordPrefix}${roomHash}`;
  };
  return Object.freeze({
    checkpointPrefix,
    directoryPrefix,
    directoryRecordPrefix,
    directoryPublicIndexKey: `${directoryPrefix}:public`,
    roomHash: hashArenaRoomId,
    roomCheckpointKey: (roomId) => `${checkpointPrefix}:${hashArenaRoomId(roomId)}:checkpoint`,
    roomIncarnationFenceKey: (roomId) => (
      `${checkpointPrefix}:${hashArenaRoomId(roomId)}:incarnations`
    ),
    roomDirectoryRecordKey: (roomId) => roomDirectoryRecordKeyFromHash(hashArenaRoomId(roomId)),
    roomDirectoryRecordKeyFromHash,
  });
};
