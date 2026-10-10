import { createBattleStoryReadFence, type BattleStoryReadToken } from './fence';

export { createBattleStoryReadFence } from './fence';
export type { BattleStoryReadFence, BattleStoryReadToken } from './fence';

/** The reader retains each host's complete records; these are read/sort keys, not a storage schema. */
type SessionKeys = { id: string; lastChapterId?: string | null };
type ChapterKeys = { id: string; index: number };
type CheckpointKeys = { boundaryIndex: number };

export type BattleStorySelectionSnapshot<S, C, K> = {
  session: S | null;
  chapters: C[];
  checkpoints: K[];
  selectedChapterId: string | null;
};

export type BattleStorySessionReadPorts<S, C, K> = {
  listSessions(options: { limit: 100; direction: 'prev' }): Promise<S[]>;
  getSession(id: string): Promise<S | null>;
  listChapters(id: string, options: { direction: 'next'; limit: 200; includeSuperseded: false }): Promise<C[]>;
  listCheckpoints(id: string, options: { direction: 'next'; limit: 400 }): Promise<K[]>;
  readPreferredId(): string | null;
  writePreferredId(id: string | null): void;
};

export type BattleStorySessionReader<S> = {
  /** Success remains available to the original caller even if a newer list won publication.
   * null means invalidated/disposed or a superseded failure, never an empty storage snapshot. */
  refreshList(): Promise<S[] | null>;
  select(id: string | null, onError?: (error: unknown) => void): Promise<void>;
  /** Capture eligibility for a post-delete reload; later selection intents take precedence. */
  captureSelection(): (id: string | null) => Promise<void>;
  restore(callbacks: { onError(error: unknown): void; onReady(): void }): Promise<void>;
  invalidate(): void;
  dispose(): void;
};

/**
 * Feature-local read ordering only. Hosts own storage, errors and React state.
 * Invalidation suppresses publication; it does not cancel IndexedDB or other I/O.
 * A disposed reader is terminal: effect remounts must create a fresh reader.
 */
export function createBattleStorySessionReader<S extends SessionKeys, C extends ChapterKeys, K extends CheckpointKeys>(
  ports: BattleStorySessionReadPorts<S, C, K>,
  publish: {
    list(sessions: S[]): void;
    selection(snapshot: BattleStorySelectionSnapshot<S, C, K>): void;
  },
): BattleStorySessionReader<S> {
  const fence = createBattleStoryReadFence<'list' | 'selection'>();

  const refreshList = async (): Promise<S[] | null> => {
    const token = fence.begin('list');
    if (!token) return null;
    try {
      const sessions = await ports.listSessions({ limit: 100, direction: 'prev' });
      if (!token.isInScope()) return null;
      if (token.isCurrent()) publish.list(sessions);
      return sessions;
    } catch (error) {
      if (!token.isCurrent()) return null;
      throw error;
    }
  };

  const readSelection = async (id: string | null, token: BattleStoryReadToken, onError?: (error: unknown) => void) => {
    try {
      const [session, chapters, checkpoints] = id
        ? await Promise.all([
          ports.getSession(id),
          ports.listChapters(id, { direction: 'next', limit: 200, includeSuperseded: false }),
          ports.listCheckpoints(id, { direction: 'next', limit: 400 }),
        ])
        : [null, [], []] as const;
      if (!token.isCurrent()) return;
      const sortedChapters = session ? [...chapters].sort((left, right) => left.index - right.index) : [];
      const sortedCheckpoints = session ? [...checkpoints].sort((left, right) => left.boundaryIndex - right.boundaryIndex) : [];
      // Publish the whole Promise.all snapshot together; a rejected read preserves the old selection.
      publish.selection({
        session,
        chapters: sortedChapters,
        checkpoints: sortedCheckpoints,
        selectedChapterId: session?.lastChapterId ?? sortedChapters.at(-1)?.id ?? null,
      });
      if (token.isCurrent()) ports.writePreferredId(session?.id ?? null);
    } catch (error) {
      if (!token.isCurrent()) return;
      // Interactive errors publish inside the fence, rather than in a later host catch microtask.
      if (onError) onError(error);
      else throw error;
    }
  };

  return {
    refreshList,
    select: (id, onError) => {
      // Reserve the intent before the first await, including explicit clear.
      const token = fence.begin('selection');
      return token ? readSelection(id, token, onError) : Promise.resolve();
    },
    captureSelection: () => {
      const captured = fence.capture('selection');
      return (id) => {
        if (!captured.isCurrent()) return Promise.resolve();
        const token = fence.begin('selection');
        return token ? readSelection(id, token) : Promise.resolve();
      };
    },
    restore: async ({ onError, onReady }) => {
      // This SAME intent spans list + detail. A late list cannot supersede a manual selection.
      const token = fence.begin('selection');
      if (!token) return;
      try {
        const pendingList = refreshList();
        const listToken = fence.capture('list');
        const sessions = await pendingList;
        if (!sessions || !listToken.isCurrent() || !token.isCurrent()) return;
        // No preference chooses the first row; a missing preferred record must not fall back.
        const id = ports.readPreferredId() ?? sessions[0]?.id ?? null;
        await readSelection(id, token, onError);
      } catch (error) {
        if (token.isCurrent()) onError(error);
      } finally {
        // A manual selection may supersede restoration, but initialization has still settled.
        if (token.isInScope()) onReady();
      }
    },
    invalidate: fence.invalidate,
    dispose: fence.dispose,
  };
}
