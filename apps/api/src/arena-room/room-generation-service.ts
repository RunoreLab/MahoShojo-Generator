import type {
  ArenaRoomGenerationStartRequest,
  ArenaRoomGenerationViewResponse,
} from '@mahoshojo/contracts/arena-room';

export type ArenaRoomGenerationErrorCode =
  | 'ROOM_EPOCH_STALE'
  | 'ROOM_GENERATION_CONFLICT'
  | 'ROOM_GENERATION_NOT_FOUND'
  | 'ROOM_GENERATION_UNAVAILABLE'
  | 'ROOM_GENERATION_INPUT_INVALID'
  | 'ROOM_PERMISSION_DENIED'
  | 'ROOM_REFERENCE_DENIED'
  | 'ROOM_REFERENCE_STALE'
  | 'ROOM_REFERENCE_UNAVAILABLE'
  | 'ROOM_REVISION_STALE'
  | 'ROOM_OPERATION_UNKNOWN';

export class ArenaRoomGenerationError extends Error {
  constructor(readonly code: ArenaRoomGenerationErrorCode) {
    super(code);
    this.name = 'ArenaRoomGenerationError';
  }
}

export type ArenaRoomGenerationService = {
  start(input: {
    readonly roomId: string;
    readonly accountUserId: number;
    readonly request: ArenaRoomGenerationStartRequest;
    readonly sourceRequest: Request;
  }): Promise<ArenaRoomGenerationViewResponse>;
  read(input: {
    readonly roomId: string;
    readonly generationId: string;
    readonly accountUserId: number;
  }): Promise<ArenaRoomGenerationViewResponse>;
};
