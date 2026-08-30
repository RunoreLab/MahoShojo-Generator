import type { GenerationReplayStore } from './service';

const unavailable = async (): Promise<never> => {
  throw new Error('GENERATION_REPLAY_STORE_UNAVAILABLE');
};

/**
 * Fail-closed adapter for a runtime that cannot reach the shared Redis lifecycle backend.
 * Durable terminal reads remain available through ArenaGenerationTerminalStore, but this
 * adapter can never reserve a generation or start a second process-local producer.
 */
export const createUnavailableGenerationReplayStore = (): GenerationReplayStore => ({
  reserve: unavailable,
  markRunning: unavailable,
  claimFinalization: unavailable,
  claimLeaseExpiry: unavailable,
  releaseReservation: unavailable,
  heartbeat: unavailable,
  appendEvents: unavailable,
  writeSnapshot: unavailable,
  readSnapshot: unavailable,
  readEvent: unavailable,
  readAfter: unavailable,
  markTerminal: unavailable,
  readState: unavailable,
  requestCancel: unavailable,
});
