export type ArenaMultiplayerCoreErrorCode =
  | 'unsupported-change'
  | 'array-reorder'
  | 'invalid-input';

export class ArenaMultiplayerCoreError extends Error {
  public readonly code: ArenaMultiplayerCoreErrorCode;

  public constructor(code: ArenaMultiplayerCoreErrorCode, message: string) {
    super(message);
    this.name = 'ArenaMultiplayerCoreError';
    this.code = code;
  }
}

export const unsupportedChange = (message: string): never => {
  throw new ArenaMultiplayerCoreError('unsupported-change', message);
};

export const arrayReorder = (target: string): never => {
  throw new ArenaMultiplayerCoreError('array-reorder', `unsupported ${target} array reorder`);
};
