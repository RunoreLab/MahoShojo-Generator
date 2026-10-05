'use client';

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { createSingleArenaEditorSession } from './single-session';
import type {
  ArenaEditorActions,
  ArenaEditorSession,
  ArenaEditorState,
} from './types';

const ArenaEditorSessionContext = createContext<ArenaEditorSession | null>(null);

let defaultSingleSession: ArenaEditorSession | null = null;

export const getDefaultSingleArenaEditorSession = (): ArenaEditorSession => {
  defaultSingleSession ??= createSingleArenaEditorSession();
  return defaultSingleSession;
};

export const ArenaEditorSessionProvider = ({
  session,
  children,
}: Readonly<{
  session: ArenaEditorSession;
  children: ReactNode;
}>) => (
  <ArenaEditorSessionContext.Provider value={session}>
    {children}
  </ArenaEditorSessionContext.Provider>
);

export const useArenaEditorSession = (): ArenaEditorSession => (
  useContext(ArenaEditorSessionContext) ?? getDefaultSingleArenaEditorSession()
);

export const useArenaEditorSelector = <T,>(
  selector: (state: ArenaEditorState) => T,
): T => {
  const session = useArenaEditorSession();
  const state = useSyncExternalStore(
    session.store.subscribe,
    session.store.getState,
    session.store.getInitialState,
  );
  return selector(state);
};

export const useArenaEditorActions = (): ArenaEditorActions => (
  useArenaEditorSelector((state) => state.actions)
);
