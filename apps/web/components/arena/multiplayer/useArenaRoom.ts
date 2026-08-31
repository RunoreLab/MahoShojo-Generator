'use client';

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  createRoomProposalArenaEditorSession,
  type RoomProposalArenaEditorSession,
} from '@/components/arena/editor';

import { createArenaRoomClient } from '@/lib/arena-room/client';
import {
  arenaRoomHostWorkspaceAuthorityFromSession,
  createArenaRoomHostWorkspace,
} from '@/lib/arena-room/host-workspace';
import {
  createArenaRoomController,
  type ArenaRoomController,
  type ArenaRoomSocket,
} from '@/lib/arena-room/controller';
import { useArenaRoomHostReconciliation } from './useArenaRoomHostReconciliation';

type UseArenaRoomOptions = {
  readonly enabled: boolean;
  readonly authenticated: boolean;
  readonly origin: string;
};

type LifecycleToken = {
  readonly controller: ArenaRoomController;
  readonly token: symbol;
};

export type ArenaRoomProposalWorkspace = Readonly<{
  editor: RoomProposalArenaEditorSession | null;
  syncFromRoom(): void;
  discard(): void;
}>;

export const useArenaRoom = (options: UseArenaRoomOptions) => {
  const { controller, hostWorkspace } = useMemo(() => {
    const client = createArenaRoomClient({ origin: options.origin });
    const nextController = createArenaRoomController({
      client,
      createSocket: (url, protocol) => (
        new WebSocket(url, protocol) as unknown as ArenaRoomSocket
      ),
    });
    return {
      controller: nextController,
      hostWorkspace: createArenaRoomHostWorkspace(),
    };
  }, [options.origin]);
  const lifecycle = useRef<LifecycleToken | null>(null);
  const proposalEditorRef = useRef<RoomProposalArenaEditorSession | null>(null);
  const [proposalEditor, setProposalEditor] = useState<RoomProposalArenaEditorSession | null>(null);

  useEffect(() => {
    controller.setAccess({
      enabled: options.enabled,
      authenticated: options.authenticated,
    });
  }, [controller, options.authenticated, options.enabled]);

  useEffect(() => {
    const token = Symbol('arena-room-controller-lifecycle');
    lifecycle.current = { controller, token };
    return () => {
      queueMicrotask(() => {
        const active = lifecycle.current;
        if (
          !active
          || active.controller !== controller
          || active.token === token
        ) {
          controller.dispose();
        }
      });
    };
  }, [controller]);

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    hostWorkspace.retainFor(arenaRoomHostWorkspaceAuthorityFromSession(state.session));
  }, [hostWorkspace, state.session]);

  useEffect(() => {
    const session = state.session;
    const editor = proposalEditorRef.current;
    if (!session || session.self.role !== 'member') {
      if (editor) {
        editor.dispose();
        proposalEditorRef.current = null;
        setProposalEditor(null);
      }
      return;
    }
    if (editor) editor.sync(session.snapshot);
  }, [state.session]);

  useEffect(() => () => {
    proposalEditorRef.current?.dispose();
    proposalEditorRef.current = null;
  }, []);

  const proposalWorkspace = useMemo<ArenaRoomProposalWorkspace>(() => Object.freeze({
    editor: proposalEditor,
    syncFromRoom() {
      const session = controller.getSnapshot().session;
      if (!session || session.self.role !== 'member') return;
      proposalEditorRef.current?.dispose();
      const next = createRoomProposalArenaEditorSession(session.snapshot);
      proposalEditorRef.current = next;
      setProposalEditor(next);
    },
    discard() {
      proposalEditorRef.current?.dispose();
      proposalEditorRef.current = null;
      setProposalEditor(null);
    },
  }), [controller, proposalEditor]);

  const hostReconciliation = useArenaRoomHostReconciliation({
    controller,
    controllerState: state,
    hostWorkspace,
  });

  return {
    controller,
    state,
    hostWorkspace,
    hostReconciliation,
    proposalWorkspace,
  };
};

export type ArenaRoomRuntime = ReturnType<typeof useArenaRoom>;

const ArenaRoomContext = createContext<ArenaRoomRuntime | null>(null);

export const ArenaRoomProvider = ({
  children,
  ...options
}: UseArenaRoomOptions & { readonly children: ReactNode }) => {
  const runtime = useArenaRoom(options);
  return createElement(ArenaRoomContext.Provider, { value: runtime }, children);
};

export const useArenaRoomContext = (): ArenaRoomRuntime | null => (
  useContext(ArenaRoomContext)
);
