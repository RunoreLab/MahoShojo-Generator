'use client';

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

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

type UseArenaRoomOptions = {
  readonly enabled: boolean;
  readonly authenticated: boolean;
  readonly origin: string;
};

type LifecycleToken = {
  readonly controller: ArenaRoomController;
  readonly token: symbol;
};

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

  return { controller, state, hostWorkspace };
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
