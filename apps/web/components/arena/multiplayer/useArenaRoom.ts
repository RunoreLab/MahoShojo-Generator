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
import type {
  ArenaRoomGenerationHistoryResponse,
  ArenaRoomGenerationViewResponse,
} from '@mahoshojo/contracts/arena-room';

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
import { useArenaRoomNarrativeHistoryResultWriter } from './useArenaRoomNarrativeHistoryResultWriter';

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

export type ArenaRoomGenerationHistoryReader = Readonly<{
  list(): Promise<ArenaRoomGenerationHistoryResponse>;
  read(generationId: string): Promise<ArenaRoomGenerationViewResponse>;
}>;

export const useArenaRoom = (options: UseArenaRoomOptions) => {
  const { client, controller, hostWorkspace } = useMemo(() => {
    const client = createArenaRoomClient({ origin: options.origin });
    const nextController = createArenaRoomController({
      client,
      createSocket: (url, protocol) => (
        new WebSocket(url, protocol) as unknown as ArenaRoomSocket
      ),
    });
    return {
      client,
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
  useArenaRoomNarrativeHistoryResultWriter(state);

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
    if (editor) {
      editor.sync(session.snapshot);
      return;
    }
    const next = createRoomProposalArenaEditorSession(session.snapshot);
    proposalEditorRef.current = next;
    setProposalEditor(next);
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

  const generationHistory = useMemo<ArenaRoomGenerationHistoryReader>(() => {
    const captureSession = () => {
      const session = controller.getSnapshot().session;
      if (!session) throw new Error('当前不在多人房间中');
      return session;
    };
    const assertSameSession = (captured: ReturnType<typeof captureSession>) => {
      const current = controller.getSnapshot().session;
      if (
        !current
        || current.roomId !== captured.roomId
        || current.roomEpoch !== captured.roomEpoch
        || current.self.userId !== captured.self.userId
      ) throw new Error('房间会话已变化，请重新打开历史战报');
      return current;
    };
    return Object.freeze({
      async list() {
        const captured = captureSession();
        const result = await client.listGenerationHistory(captured.roomId);
        assertSameSession(captured);
        if (result.roomEpoch !== captured.roomEpoch) {
          throw new Error('历史战报属于其他房间实例，已拒绝显示');
        }
        return result;
      },
      async read(generationId) {
        const captured = captureSession();
        const result = await client.getGenerationView(captured.roomId, generationId);
        assertSameSession(captured);
        if (result.roomEpoch !== captured.roomEpoch) {
          throw new Error('历史战报属于其他房间实例，已拒绝显示');
        }
        return result;
      },
    });
  }, [client, controller]);

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
    generationHistory,
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
