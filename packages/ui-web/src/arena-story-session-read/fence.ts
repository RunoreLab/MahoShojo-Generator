/** A publication token, not cancellation of the host's underlying I/O. */
export type BattleStoryReadToken = {
  /** Still the newest intent in this lane, within the original scope. */
  isCurrent(): boolean;
  /** A newer intent may have won this lane; the owner has not invalidated/disposed it. */
  isInScope(): boolean;
};

export type BattleStoryReadFence<Channel extends string> = {
  begin(channel: Channel): BattleStoryReadToken | null;
  capture(channel: Channel): BattleStoryReadToken;
  invalidate(): void;
  dispose(): void;
};

/**
 * Shared ordering for complete Web reads and paged Desktop reads. Hosts choose independent
 * lanes (list, selection, selected chapter, export) and retain their own data/IO contracts.
 * Reserve before awaiting, check before publishing, and invalidate on owner/scope changes.
 * dispose is terminal; a remounted owner must create a new fence.
 */
export function createBattleStoryReadFence<Channel extends string>(): BattleStoryReadFence<Channel> {
  let disposed = false;
  let scope = 0;
  const generations = new Map<Channel, number>();
  const capture = (channel: Channel): BattleStoryReadToken => {
    const capturedScope = scope;
    const generation = generations.get(channel) ?? 0;
    const isInScope = () => !disposed && capturedScope === scope;
    return {
      isInScope,
      isCurrent: () => isInScope() && generation === (generations.get(channel) ?? 0),
    };
  };
  return {
    capture,
    begin: (channel) => {
      if (disposed) return null;
      generations.set(channel, (generations.get(channel) ?? 0) + 1);
      return capture(channel);
    },
    invalidate: () => { scope += 1; },
    dispose: () => { disposed = true; scope += 1; },
  };
}
