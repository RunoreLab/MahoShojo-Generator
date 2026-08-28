'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import { createArenaRoomClient } from '@/lib/arena-room/client';
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
  const controller = useMemo(() => {
    const client = createArenaRoomClient({ origin: options.origin });
    return createArenaRoomController({
      client,
      createSocket: (url, protocol) => (
        new WebSocket(url, protocol) as unknown as ArenaRoomSocket
      ),
    });
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

  return { controller, state };
};
