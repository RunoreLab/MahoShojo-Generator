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
  let disposed = false;
  let selectionGeneration = 0;
  let listGeneration = 0;
  let scopeGeneration = 0;
  const isCurrentSelection = (generation: number) => !disposed && generation === selectionGeneration;

  const refreshList = async (): Promise<S[] | null> => {
    if (disposed) return null;
    const generation = ++listGeneration;
    const scope = scopeGeneration;
    try {
      const sessions = await ports.listSessions({ limit: 100, direction: 'prev' });
      if (disposed || scope !== scopeGeneration) return null;
      if (generation === listGeneration) publish.list(sessions);
      return sessions;
    } catch (error) {
      if (disposed || generation !== listGeneration) return null;
      throw error;
    }
  };

  const readSelection = async (id: string | null, generation: number, onError?: (error: unknown) => void) => {
    try {
      const [session, chapters, checkpoints] = id
        ? await Promise.all([
          ports.getSession(id),
          ports.listChapters(id, { direction: 'next', limit: 200, includeSuperseded: false }),
          ports.listCheckpoints(id, { direction: 'next', limit: 400 }),
        ])
        : [null, [], []] as const;
      if (!isCurrentSelection(generation)) return;
      const sortedChapters = session ? [...chapters].sort((left, right) => left.index - right.index) : [];
      const sortedCheckpoints = session ? [...checkpoints].sort((left, right) => left.boundaryIndex - right.boundaryIndex) : [];
      // Publish the whole Promise.all snapshot together; a rejected read preserves the old selection.
      publish.selection({
        session,
        chapters: sortedChapters,
        checkpoints: sortedCheckpoints,
        selectedChapterId: session?.lastChapterId ?? sortedChapters.at(-1)?.id ?? null,
      });
      if (isCurrentSelection(generation)) ports.writePreferredId(session?.id ?? null);
    } catch (error) {
      if (!isCurrentSelection(generation)) return;
      // Interactive errors publish inside the fence, rather than in a later host catch microtask.
      if (onError) onError(error);
      else throw error;
    }
  };

  return {
    refreshList,
    select: (id, onError) => {
      if (disposed) return Promise.resolve();
      // Reserve the intent before the first await, including explicit clear.
      return readSelection(id, ++selectionGeneration, onError);
    },
    captureSelection: () => {
      const generation = selectionGeneration;
      return (id) => isCurrentSelection(generation)
        ? readSelection(id, ++selectionGeneration)
        : Promise.resolve();
    },
    restore: async ({ onError, onReady }) => {
      if (disposed) return;
      // This SAME intent spans list + detail. A late list cannot supersede a manual selection.
      const generation = ++selectionGeneration;
      const scope = scopeGeneration;
      try {
        const pendingList = refreshList();
        const restoreListGeneration = listGeneration;
        const sessions = await pendingList;
        if (!sessions || restoreListGeneration !== listGeneration || !isCurrentSelection(generation)) return;
        // No preference chooses the first row; a missing preferred record must not fall back.
        const id = ports.readPreferredId() ?? sessions[0]?.id ?? null;
        await readSelection(id, generation, onError);
      } catch (error) {
        if (isCurrentSelection(generation)) onError(error);
      } finally {
        // A manual selection may supersede restoration, but initialization has still settled.
        if (!disposed && scope === scopeGeneration) onReady();
      }
    },
    invalidate: () => { scopeGeneration += 1; selectionGeneration += 1; listGeneration += 1; },
    dispose: () => { disposed = true; scopeGeneration += 1; selectionGeneration += 1; listGeneration += 1; },
  };
}
