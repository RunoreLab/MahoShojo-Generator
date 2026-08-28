import {
  parseRoomServerTransportFrame,
  type ArenaRoomCreateRequest,
  type ArenaRoomSessionResponse,
  type RoomControlCursor,
  type RoomDirectoryEntry,
  type RoomEvent,
  type RoomServerTransportMessage,
} from '@mahoshojo/contracts/arena-room';

import {
  ArenaRoomClientError,
  type ArenaRoomClient,
} from './client';

export type ArenaRoomControllerPhase =
  | 'closed'
  | 'connected'
  | 'connecting'
  | 'degraded'
  | 'disabled'
  | 'listing'
  | 'ready'
  | 'reconnecting'
  | 'replacement'
  | 'unknown'
  | 'unauthenticated';

export type ArenaRoomControllerState = {
  readonly phase: ArenaRoomControllerPhase;
  readonly rooms: readonly RoomDirectoryEntry[];
  readonly session: ArenaRoomSessionResponse | null;
  readonly notice: string | null;
  readonly error: string | null;
  readonly unknownOperation: 'create' | 'join' | null;
};

export type ArenaRoomSocket = {
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

type ArenaRoomControllerOptions = {
  readonly client: ArenaRoomClient;
  readonly createSocket: (url: string, protocol: string) => ArenaRoomSocket;
  readonly initialAccess?: { readonly enabled: boolean; readonly authenticated: boolean };
  readonly maxReconnectAttempts?: number;
  readonly reconnectDelayMs?: (attempt: number) => number;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
};

export type ArenaRoomController = {
  getSnapshot(): ArenaRoomControllerState;
  subscribe(listener: () => void): () => void;
  setAccess(access: { readonly enabled: boolean; readonly authenticated: boolean }): void;
  discover(): Promise<void>;
  create(request: ArenaRoomCreateRequest): Promise<void>;
  join(roomId: string, displayName: string): Promise<void>;
  leave(): Promise<void>;
  close(): Promise<void>;
  reconnect(): void;
  reset(): void;
  dispose(): void;
};

const READY_STATE: ArenaRoomControllerState = Object.freeze({
  phase: 'ready',
  rooms: [],
  session: null,
  notice: null,
  error: null,
  unknownOperation: null,
});

const phaseForAccess = (access: { enabled: boolean; authenticated: boolean }) => (
  !access.enabled ? 'disabled' as const
    : !access.authenticated ? 'unauthenticated' as const
      : 'ready' as const
);

const safeErrorMessage = (error: unknown): string => (
  error instanceof ArenaRoomClientError ? error.message : '房间运行时暂不可用'
);

const defaultReconnectDelay = (attempt: number): number => (
  Math.min(4_000, 500 * (2 ** Math.max(0, attempt - 1)))
);

const replaceMember = (
  session: ArenaRoomSessionResponse,
  event: Extract<RoomEvent, {
    type: 'room.host.offline' | 'room.host.online' | 'room.member.joined' | 'room.member.left';
  }>,
): ArenaRoomSessionResponse => {
  const incoming = event.payload.member;
  const existing = session.snapshot.members.findIndex((member) => member.userId === incoming.userId);
  const members = [...session.snapshot.members];
  if (existing >= 0) members[existing] = incoming;
  else members.push(incoming);
  const self = incoming.userId === session.self.userId ? incoming : session.self;
  return {
    ...session,
    self,
    snapshot: {
      ...session.snapshot,
      controlSeq: event.controlSeq,
      members,
    },
  };
};

export const createArenaRoomController = (
  options: ArenaRoomControllerOptions,
): ArenaRoomController => {
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
  if (!Number.isSafeInteger(maxReconnectAttempts) || maxReconnectAttempts < 1) {
    throw new Error('maxReconnectAttempts 必须是正安全整数');
  }
  const reconnectDelayMs = options.reconnectDelayMs ?? defaultReconnectDelay;
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let access = options.initialAccess ?? { enabled: false, authenticated: false };
  let state: ArenaRoomControllerState = {
    ...READY_STATE,
    phase: phaseForAccess(access),
  };
  let socket: ArenaRoomSocket | null = null;
  let reconnectTimer: unknown = null;
  let reconnectAttempts = 0;
  let operationGeneration = 0;
  let disposed = false;
  let unresolvedCreateResult = false;
  let unresolvedCreateNotice: string | null = null;
  let controlCursor: RoomControlCursor | undefined;
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<ArenaRoomControllerState>): void => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const operationIsCurrent = (generation: number): boolean => (
    !disposed
    && generation === operationGeneration
    && access.enabled
    && access.authenticated
  );

  const clearReconnectTimer = (): void => {
    if (reconnectTimer === null) return;
    clearTimer(reconnectTimer);
    reconnectTimer = null;
  };

  const detachSocket = (close = false): void => {
    const current = socket;
    socket = null;
    if (!current) return;
    current.onopen = null;
    current.onmessage = null;
    current.onclose = null;
    current.onerror = null;
    if (close) current.close(1000, 'client-disconnect');
  };

  const enterReplacement = (): void => {
    clearReconnectTimer();
    detachSocket(true);
    publish({
      phase: 'replacement',
      notice: '原房间无法恢复，请房主创建新房间',
      error: null,
    });
  };

  const scheduleReconnect = (degraded: boolean): void => {
    if (disposed || !access.enabled || !access.authenticated || !state.session) return;
    clearReconnectTimer();
    detachSocket(true);
    if (reconnectAttempts >= maxReconnectAttempts) {
      enterReplacement();
      return;
    }
    reconnectAttempts += 1;
    publish({
      phase: degraded ? 'degraded' : 'reconnecting',
      notice: degraded ? '房间运行时暂不可用，正在重试' : '正在重新连接…',
      error: null,
    });
    const generation = operationGeneration;
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      if (disposed || generation !== operationGeneration || !state.session) return;
      void connectSession(state.session, true, generation);
    }, reconnectDelayMs(reconnectAttempts));
  };

  const applyControlEvent = (event: Exclude<RoomEvent, { type: 'story.delta' }>): void => {
    const current = state.session;
    if (!current) return;
    if (event.roomId !== current.roomId) {
      enterReplacement();
      return;
    }
    if (event.type !== 'room.snapshot' && event.roomEpoch !== current.roomEpoch) {
      scheduleReconnect(false);
      return;
    }
    if (
      event.roomEpoch === current.roomEpoch
      && event.type === 'room.snapshot'
      && event.controlSeq < current.snapshot.controlSeq
    ) return;
    if (event.type !== 'room.snapshot' && event.controlSeq <= current.snapshot.controlSeq) return;
    if (
      event.type !== 'room.snapshot'
      && event.controlSeq !== current.snapshot.controlSeq + 1
    ) {
      scheduleReconnect(false);
      return;
    }
    controlCursor = { roomEpoch: event.roomEpoch, controlSeq: event.controlSeq };
    reconnectAttempts = 0;

    if (event.type === 'room.snapshot') {
      const self = event.payload.members.find((member) => member.userId === current.self.userId);
      if (!self || self.membershipState !== 'active') {
        enterReplacement();
        return;
      }
      const epochChanged = current.roomEpoch !== event.roomEpoch;
      publish({
        session: {
          protocolVersion: 1,
          roomId: event.roomId,
          roomEpoch: event.roomEpoch,
          self,
          snapshot: event.payload,
        },
        ...(epochChanged ? { notice: '房间已由服务器恢复，需要重新同步' } : {}),
      });
      return;
    }

    if (
      event.type === 'room.member.joined'
      || event.type === 'room.member.left'
      || event.type === 'room.host.offline'
      || event.type === 'room.host.online'
    ) {
      const next = replaceMember(current, event);
      if (event.type === 'room.member.left' && event.payload.member.userId === current.self.userId) {
        detachSocket(true);
        publish({
          phase: 'closed',
          session: next,
          notice: '房间成员资格已结束',
          error: null,
        });
        return;
      }
      publish({ session: next });
      return;
    }

    if (event.type === 'room.config.updated') {
      publish({
        session: {
          ...current,
          snapshot: {
            ...current.snapshot,
            controlSeq: event.controlSeq,
            revision: event.payload.revision,
            sharedConfig: event.payload.sharedConfig,
          },
        },
      });
      return;
    }

    if (event.type === 'room.closing') {
      detachSocket(true);
      publish({ phase: 'closed', notice: '房间已关闭', error: null });
      return;
    }

    publish({
      session: {
        ...current,
        snapshot: { ...current.snapshot, controlSeq: event.controlSeq },
      },
    });
  };

  const handleMessage = (raw: unknown): void => {
    let message: RoomServerTransportMessage;
    try {
      if (typeof raw !== 'string' && !(raw instanceof Uint8Array)) {
        throw new Error('unsupported websocket frame');
      }
      message = parseRoomServerTransportFrame(raw);
    } catch {
      scheduleReconnect(true);
      return;
    }
    if (message.type === 'room.resync.required') {
      scheduleReconnect(false);
      return;
    }
    if (message.type === 'story.delta') return;
    applyControlEvent(message);
  };

  async function connectSession(
    session: ArenaRoomSessionResponse,
    reconnecting: boolean,
    generation: number,
  ): Promise<void> {
    if (disposed || generation !== operationGeneration) return;
    publish({
      session,
      phase: reconnecting ? 'reconnecting' : 'connecting',
      notice: reconnecting ? '正在重新连接…' : '正在连接房间…',
      error: null,
    });
    try {
      const issued = await options.client.issueTicket(session.roomId, {
        ...(reconnecting && controlCursor
          ? { reconnect: { control: controlCursor } }
          : {}),
      });
      if (disposed || generation !== operationGeneration) return;
      const current = options.createSocket(
        options.client.buildWebSocketUrl(issued),
        issued.websocket.protocol,
      );
      detachSocket(true);
      socket = current;
      current.onopen = () => {
        if (socket !== current || disposed) return;
        publish({ phase: 'connected', notice: null, error: null });
      };
      current.onmessage = (event) => {
        if (socket === current && !disposed) handleMessage(event.data);
      };
      current.onerror = () => {
        if (socket === current && !disposed) {
          publish({ notice: '房间运行时暂不可用，正在重试' });
        }
      };
      current.onclose = (event) => {
        if (socket !== current || disposed) return;
        socket = null;
        if (event.code === 1000) {
          publish({ phase: 'closed', notice: '房间已关闭', error: null });
          return;
        }
        if (event.code === 1008 && event.reason === 'membership-revoked') {
          enterReplacement();
          return;
        }
        scheduleReconnect(event.code === 1008 && event.reason !== 'room-epoch-stale');
      };
    } catch {
      if (disposed || generation !== operationGeneration) return;
      scheduleReconnect(true);
    }
  }

  const startSession = async (session: ArenaRoomSessionResponse): Promise<void> => {
    const generation = operationGeneration;
    if (!operationIsCurrent(generation)) return;
    if (!unresolvedCreateResult) publish({ unknownOperation: null });
    reconnectAttempts = 0;
    controlCursor = {
      roomEpoch: session.roomEpoch,
      controlSeq: session.snapshot.controlSeq,
    };
    await connectSession(session, false, generation);
  };

  const failOperation = (
    error: unknown,
    generation: number,
    operation?: 'create' | 'join',
  ): void => {
    if (!operationIsCurrent(generation)) return;
    if (error instanceof ArenaRoomClientError && error.code === 'ROOM_RESULT_UNKNOWN') {
      if (operation === 'create') {
        unresolvedCreateResult = true;
        unresolvedCreateNotice = error.message;
      }
      publish({
        phase: 'unknown',
        notice: unresolvedCreateResult ? unresolvedCreateNotice : error.message,
        error: null,
        unknownOperation: unresolvedCreateResult ? 'create' : operation ?? null,
      });
      return;
    }
    if (unresolvedCreateResult) {
      publish({
        phase: 'unknown',
        notice: unresolvedCreateNotice,
        error: safeErrorMessage(error),
        unknownOperation: 'create',
      });
      return;
    }
    publish({
      phase: state.session ? 'degraded' : 'ready',
      notice: null,
      error: safeErrorMessage(error),
      unknownOperation: null,
    });
  };

  return Object.freeze({
    getSnapshot: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setAccess(nextAccess) {
      if (
        access.enabled === nextAccess.enabled
        && access.authenticated === nextAccess.authenticated
      ) return;
      access = nextAccess;
      operationGeneration += 1;
      clearReconnectTimer();
      detachSocket(true);
      reconnectAttempts = 0;
      controlCursor = undefined;
      unresolvedCreateResult = false;
      unresolvedCreateNotice = null;
      publish({
        ...READY_STATE,
        phase: phaseForAccess(access),
      });
    },

    async discover() {
      if (disposed || !access.enabled || !access.authenticated) return;
      operationGeneration += 1;
      const generation = operationGeneration;
      publish({ phase: 'listing', error: null });
      try {
        const page = await options.client.discover({ limit: 20 });
        if (!operationIsCurrent(generation)) return;
        publish({
          phase: unresolvedCreateResult ? 'unknown' : 'ready',
          rooms: page.items,
          error: null,
        });
      } catch (error) {
        if (unresolvedCreateResult && operationIsCurrent(generation)) {
          publish({ phase: 'unknown', error: safeErrorMessage(error) });
        } else {
          failOperation(error, generation);
        }
      }
    },

    async create(request) {
      if (disposed || !access.enabled || !access.authenticated) return;
      if (unresolvedCreateResult) return;
      operationGeneration += 1;
      const generation = operationGeneration;
      clearReconnectTimer();
      detachSocket(true);
      publish({ phase: 'connecting', session: null, notice: '正在创建房间…', error: null });
      try {
        const nextSession = await options.client.create(request);
        if (!operationIsCurrent(generation)) return;
        await startSession(nextSession);
      } catch (error) {
        failOperation(error, generation, 'create');
      }
    },

    async join(roomId, displayName) {
      if (disposed || !access.enabled || !access.authenticated) return;
      operationGeneration += 1;
      const generation = operationGeneration;
      clearReconnectTimer();
      detachSocket(true);
      publish({ phase: 'connecting', session: null, notice: '正在加入房间…', error: null });
      try {
        const nextSession = await options.client.join(roomId, { displayName });
        if (!operationIsCurrent(generation)) return;
        await startSession(nextSession);
      } catch (error) {
        failOperation(error, generation, 'join');
      }
    },

    async leave() {
      if (!state.session || disposed) return;
      operationGeneration += 1;
      const generation = operationGeneration;
      const { roomId, roomEpoch } = state.session;
      clearReconnectTimer();
      detachSocket(true);
      try {
        await options.client.leave(roomId, roomEpoch);
        if (!operationIsCurrent(generation)) return;
        publish({ phase: 'closed', notice: '已离开房间', error: null });
      } catch (error) {
        failOperation(error, generation);
      }
    },

    async close() {
      if (!state.session || state.session.self.role !== 'host' || disposed) return;
      operationGeneration += 1;
      const generation = operationGeneration;
      const { roomId, roomEpoch } = state.session;
      clearReconnectTimer();
      detachSocket(true);
      try {
        await options.client.close(roomId, roomEpoch);
        if (!operationIsCurrent(generation)) return;
        publish({ phase: 'closed', notice: '房间已关闭', error: null });
      } catch (error) {
        failOperation(error, generation);
      }
    },

    reconnect() {
      if (!state.session || disposed || !access.enabled || !access.authenticated) return;
      operationGeneration += 1;
      reconnectAttempts = 0;
      scheduleReconnect(false);
    },

    reset() {
      operationGeneration += 1;
      clearReconnectTimer();
      detachSocket(true);
      reconnectAttempts = 0;
      controlCursor = undefined;
      unresolvedCreateResult = false;
      unresolvedCreateNotice = null;
      publish({ ...READY_STATE, phase: phaseForAccess(access) });
    },

    dispose() {
      if (disposed) return;
      operationGeneration += 1;
      clearReconnectTimer();
      detachSocket(true);
      listeners.clear();
      disposed = true;
    },
  });
};
