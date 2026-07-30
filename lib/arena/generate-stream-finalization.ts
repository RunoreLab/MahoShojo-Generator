export const isArenaAbortFastPathEnabled = (): boolean =>
  process.env.ARENA_ABORT_FAST_PATH !== 'false';
