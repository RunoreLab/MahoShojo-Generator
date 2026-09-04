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
  ArenaRoomGenerationHistoryViewResponse,
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
import { useArenaRoomLatestCompletedHistory } from './useArenaRoomLatestCompletedHistory';
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
}>;

export type ArenaRoomGenerationHistoryReader = Readonly<{
  list(): Promise<ArenaRoomGenerationHistoryResponse>;
  read(generationId: string): Promise<ArenaRoomGenerationHistoryViewResponse>;
}>;

/**
 * 房间面板 UI 桥：房间配置/提案 Modal 的开关状态放在页面级 runtime 上，
 * 供顶部入口（ArenaMultiplayerPanelView）与底部大按钮（BattleActions）共享，
 * 避免复制两套 modal state 和业务逻辑。
 */
export type ArenaRoomPanelUi = Readonly<{
  configOpen: boolean;
  proposalsOpen: boolean;
  setConfigOpen(open: boolean): void;
  setProposalsOpen(open: boolean): void;
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
  const [panelUiState, setPanelUiState] = useState<{ configOpen: boolean; proposalsOpen: boolean }>({
    configOpen: false,
    proposalsOpen: false,
  });

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
        const result = await client.getGenerationHistoryView(captured.roomId, generationId);
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

  const activeGeneration = state.session?.snapshot.activeGeneration;
  // 服务端历史列表只投影 completed ledger；failed/cancelled 不会改变计数，
  // 因此只有 completed 终态才触发计数刷新。
  const latestHistoryRefreshKey = activeGeneration?.state === 'completed'
    ? activeGeneration.generationId
    : '';

  const latestGenerationHistory = useArenaRoomLatestCompletedHistory({
    reader: generationHistory,
    sessionKey: state.session
      ? `${state.session.roomId}\n${state.session.roomEpoch}\n${state.session.self.userId}`
      : null,
    refreshKey: latestHistoryRefreshKey,
    enabled: state.generation.phase === 'idle' && !state.generation.markdown,
  });

  const panelUi = useMemo<ArenaRoomPanelUi>(() => Object.freeze({
    configOpen: panelUiState.configOpen,
    proposalsOpen: panelUiState.proposalsOpen,
    setConfigOpen: (open: boolean) => {
      setPanelUiState((current) => ({ ...current, configOpen: open }));
    },
    setProposalsOpen: (open: boolean) => {
      setPanelUiState((current) => ({ ...current, proposalsOpen: open }));
    },
  }), [panelUiState]);

  return {
    controller,
    state,
    hostWorkspace,
    hostReconciliation,
    proposalWorkspace,
    generationHistory,
    latestGenerationHistory,
    panelUi,
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
