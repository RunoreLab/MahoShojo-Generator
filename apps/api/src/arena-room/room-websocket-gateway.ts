import {
  ARENA_ROOM_WEBSOCKET_PROTOCOL,
  MAX_CONTROL_FRAME_BYTES,
  parseRoomClientTransportFrame,
  type RoomClientTransportMessage,
  type RoomServerTransportMessage,
} from '@mahoshojo/contracts/arena-room';
import type { WebSocketLike } from '@hono/node-server';
import type { WSEvents, WSMessageReceive } from 'hono/ws';
import WebSocket from 'ws';

export const ARENA_ROOM_WEBSOCKET_PATH = '/api/arena/rooms/v1/ws';

const CLOSE_BINARY_NOT_SUPPORTED = 1003;
const CLOSE_INVALID_MESSAGE = 1008;
const CLOSE_MESSAGE_TOO_LARGE = 1009;
const CLOSE_SERVICE_RESTART = 1012;
const CLOSE_TRY_AGAIN_LATER = 1013;

const DEFAULT_CONNECTION_MESSAGE_LIMIT = 30;
const DEFAULT_CLOSE_GRACE_MS = 5_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CONNECTIONS_PER_USER = 4;
const DEFAULT_OUTBOUND_QUEUE_MAX_BYTES = 256 * 1024;
const DEFAULT_RATE_WINDOW_MS = 10_000;
const DEFAULT_RESERVATION_TTL_MS = 10_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;
const DEFAULT_USER_MESSAGE_LIMIT = 120;
const WEBSOCKET_KEY_PATTERN = /^[+/0-9A-Za-z]{22}==$/u;
const WEBSOCKET_PROTOCOL_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const ROOM_WEBSOCKET_GRANT_STATE = Symbol('room-websocket-grant-state');

export type RoomWebSocketAuthorization =
  | {
    accepted: true;
    roomId: string;
    userId: string;
    connectionKey?: string;
    role?: 'host' | 'member';
    connectionAuthority?: RoomWebSocketConnectionAuthority;
  }
  | {
    accepted: false;
    code: string;
    status: 401 | 403 | 503;
  };

export type RoomWebSocketAuthorizer = (
  request: Request,
) => Promise<RoomWebSocketAuthorization> | RoomWebSocketAuthorization;

export const denyRoomWebSocketAuthorization: RoomWebSocketAuthorizer = () => ({
  accepted: false,
  code: 'ROOM_WEBSOCKET_AUTH_UNAVAILABLE',
  status: 503,
});

export interface RoomWebSocketGatewayOptions {
  allowedBrowserOrigins: readonly string[];
  authorize?: RoomWebSocketAuthorizer;
  closeGraceMs?: number;
  connectionMessageLimit?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxConnectionsPerUser?: number;
  now?: () => number;
  outboundQueueMaxBytes?: number;
  rateWindowMs?: number;
  reservationTtlMs?: number;
  shutdownGraceMs?: number;
  userMessageLimit?: number;
}

export interface RoomWebSocketReservation {
  readonly [ROOM_WEBSOCKET_GRANT_STATE]: { claimed: boolean };
  readonly connectionKey: string;
  readonly createdAt: number;
  readonly roomId: string;
  readonly userId: string;
  readonly connectionAuthority?: RoomWebSocketConnectionAuthority;
}

export type RoomWebSocketPeer = {
  send(message: RoomServerTransportMessage): boolean;
  close(code: number, reason: string): void;
};

export type RoomWebSocketConnection = {
  onMessage?(message: RoomClientTransportMessage): unknown;
  dispose?(): unknown;
};

export type RoomWebSocketConnectionAuthority = {
  activate(peer: RoomWebSocketPeer): Promise<RoomWebSocketConnection> | RoomWebSocketConnection;
};

export type RoomWebSocketUpgradeDecision =
  | { accepted: true; reservation: RoomWebSocketReservation }
  | { accepted: false; response: Response };

interface RateWindow {
  count: number;
  startedAt: number;
}

interface OutboundFrame {
  bytes: number;
  data: string;
}

const assertPositiveInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
};

const createRejection = (status: number, code: string): RoomWebSocketUpgradeDecision => ({
  accepted: false,
  response: Response.json({ code }, { status }),
});

const parseOfferedProtocols = (request: Request): ReadonlySet<string> | undefined => {
  const offered = request.headers.get('sec-websocket-protocol');
  if (!offered) return undefined;
  const protocols = new Set<string>();
  for (const rawProtocol of offered.split(',')) {
    const protocol = rawProtocol.trim();
    if (
      !WEBSOCKET_PROTOCOL_TOKEN_PATTERN.test(protocol)
      || protocols.has(protocol)
    ) {
      return undefined;
    }
    protocols.add(protocol);
  }
  return protocols;
};

const hasValidHandshakeHeaders = (request: Request): boolean => {
  return WEBSOCKET_KEY_PATTERN.test(request.headers.get('sec-websocket-key') ?? '')
    && request.headers.get('sec-websocket-version') === '13';
};

type RoomWebSocketActivation =
  | { accepted: true; session: RoomWebSocketSession }
  | { accepted: false; code: number; reason: string };

const isNonEmptyIdentity = (value: string): boolean => {
  return value.length > 0 && value.length <= 256;
};

class RoomWebSocketSession {
  private awaitingPongSince: number | undefined;
  private closing = false;
  private closeTimer: NodeJS.Timeout | null = null;
  private connectionRate: RateWindow;
  private outboundBytes = 0;
  private readonly outboundQueue: OutboundFrame[] = [];
  private sending = false;
  private connection: RoomWebSocketConnection | null = null;
  private activationPromise: Promise<void> | null = null;
  private disposeStarted = false;
  private messageChain: Promise<void> = Promise.resolve();

  constructor(
    readonly reservation: RoomWebSocketReservation,
    private readonly socket: WebSocket,
    private readonly gateway: RoomWebSocketGateway,
    now: number,
  ) {
    this.connectionRate = { count: 0, startedAt: now };
    this.socket.on('pong', this.handlePong);
    this.socket.once('close', this.handleSocketClose);
  }

  start(): void {
    const authority = this.reservation.connectionAuthority;
    if (!authority) return;
    const activation = Promise.resolve()
      .then(() => authority.activate(this.peer))
      .then((connection) => {
        if (this.closing) {
          this.disposeConnection(connection);
          return;
        }
        this.connection = connection;
      })
      .catch(() => {
        if (!this.closing) this.close(CLOSE_TRY_AGAIN_LATER, 'authority-unavailable');
      });
    this.activationPromise = activation;
    this.gateway.trackTask(activation);
  }

  handleMessage(data: WSMessageReceive): void {
    if (this.closing || this.socket.readyState !== WebSocket.OPEN) return;
    if (typeof data !== 'string') {
      this.close(CLOSE_BINARY_NOT_SUPPORTED, 'binary-not-supported');
      return;
    }
    if (Buffer.byteLength(data, 'utf8') > MAX_CONTROL_FRAME_BYTES) {
      this.close(CLOSE_MESSAGE_TOO_LARGE, 'message-too-large');
      return;
    }
    const now = this.gateway.currentTime();
    if (
      !this.consumeConnectionRate(now)
      || !this.gateway.consumeUserRate(this.reservation.connectionKey, now)
    ) {
      this.close(CLOSE_INVALID_MESSAGE, 'rate-limit');
      return;
    }
    try {
      const message = parseRoomClientTransportFrame(data);
      if (this.reservation.connectionAuthority) {
        this.messageChain = this.messageChain
          .then(() => this.activationPromise)
          .then(async () => {
            if (this.closing || !this.connection?.onMessage) return;
            await this.connection.onMessage(message);
          })
          .catch(() => {
            if (!this.closing) this.close(CLOSE_TRY_AGAIN_LATER, 'authority-unavailable');
          });
        this.gateway.trackTask(this.messageChain);
      } else if (message.type === 'room.resync.request') {
        this.enqueue({
          protocolVersion: 1,
          reason: 'state-not-attached',
          type: 'room.resync.required',
        });
      }
    } catch {
      this.close(CLOSE_INVALID_MESSAGE, 'invalid-message');
    }
  }

  heartbeat(now: number): void {
    if (this.closing) return;
    if (this.socket.readyState !== WebSocket.OPEN) {
      this.cleanup();
      return;
    }
    if (this.awaitingPongSince !== undefined) {
      if (now - this.awaitingPongSince >= this.gateway.heartbeatTimeoutMs) {
        this.terminate();
      }
      return;
    }
    try {
      this.socket.ping();
      this.awaitingPongSince = now;
    } catch {
      this.terminate();
    }
  }

  requestShutdown(): void {
    this.close(CLOSE_SERVICE_RESTART, 'service-restart');
  }

  terminate(): void {
    if (this.socket.readyState !== WebSocket.CLOSED) {
      try {
        this.socket.terminate();
      } catch {
        // Cleanup is authoritative even when a broken socket throws while terminating.
      }
    }
    this.cleanup();
  }

  cleanup(): void {
    if (this.gateway.removeSession(this)) {
      this.closing = true;
      this.outboundQueue.length = 0;
      this.outboundBytes = 0;
      if (this.closeTimer !== null) clearTimeout(this.closeTimer);
      this.closeTimer = null;
      this.socket.off('pong', this.handlePong);
      this.socket.off('close', this.handleSocketClose);
      if (this.connection) this.disposeConnection(this.connection);
    }
  }

  private readonly peer: RoomWebSocketPeer = Object.freeze({
    send: (message: RoomServerTransportMessage): boolean => this.enqueue(message),
    close: (code: number, reason: string): void => this.close(code, reason),
  });

  private readonly handlePong = (): void => {
    this.awaitingPongSince = undefined;
  };

  private readonly handleSocketClose = (): void => {
    this.cleanup();
  };

  private consumeConnectionRate(now: number): boolean {
    if (now - this.connectionRate.startedAt >= this.gateway.rateWindowMs) {
      this.connectionRate = { count: 0, startedAt: now };
    }
    this.connectionRate.count += 1;
    return this.connectionRate.count <= this.gateway.connectionMessageLimit;
  }

  private enqueue(message: RoomServerTransportMessage): boolean {
    if (this.closing || this.socket.readyState !== WebSocket.OPEN) return false;
    const data = JSON.stringify(message);
    const bytes = Buffer.byteLength(data, 'utf8');
    if (
      this.socket.bufferedAmount + this.outboundBytes + bytes
      > this.gateway.outboundQueueMaxBytes
    ) {
      this.close(CLOSE_TRY_AGAIN_LATER, 'resync-required');
      return false;
    }
    this.outboundQueue.push({ bytes, data });
    this.outboundBytes += bytes;
    this.drainOutbound();
    return true;
  }

  private drainOutbound(): void {
    if (this.sending || this.closing || this.socket.readyState !== WebSocket.OPEN) return;
    const frame = this.outboundQueue.shift();
    if (!frame) return;
    this.sending = true;
    try {
      this.socket.send(frame.data, { compress: false }, (error) => {
        this.sending = false;
        this.outboundBytes = Math.max(0, this.outboundBytes - frame.bytes);
        if (error) {
          this.terminate();
          return;
        }
        this.drainOutbound();
      });
    } catch {
      this.sending = false;
      this.terminate();
    }
  }

  private close(code: number, reason: string): void {
    if (this.closing) return;
    this.closing = true;
    this.closeTimer = setTimeout(() => this.terminate(), this.gateway.closeGraceMs);
    this.closeTimer.unref();
    try {
      this.socket.close(code, reason);
    } catch {
      this.terminate();
    }
  }

  private disposeConnection(connection: RoomWebSocketConnection): void {
    if (this.disposeStarted) return;
    this.disposeStarted = true;
    if (!connection.dispose) return;
    const disposal = Promise.resolve().then(() => connection.dispose?.()).then(() => undefined);
    this.gateway.trackTask(disposal);
  }
}

export class RoomWebSocketGateway {
  readonly closeGraceMs: number;
  readonly connectionMessageLimit: number;
  readonly heartbeatTimeoutMs: number;
  readonly outboundQueueMaxBytes: number;
  readonly rateWindowMs: number;

  private accepting = true;
  private readonly allowedBrowserOrigins: ReadonlySet<string>;
  private readonly authorize: RoomWebSocketAuthorizer;
  private readonly heartbeatInterval: NodeJS.Timeout;
  private readonly maxConnectionsPerUser: number;
  private readonly now: () => number;
  private readonly reservationTtlMs: number;
  private readonly sessions = new Set<RoomWebSocketSession>();
  private readonly shutdownGraceMs: number;
  private shutdownPromise: Promise<void> | undefined;
  private readonly userMessageLimit: number;
  private readonly userOccupancy = new Map<string, number>();
  private readonly userRates = new Map<string, RateWindow>();
  private readonly emptyWaiters = new Set<() => void>();
  private readonly tasks = new Set<Promise<void>>();

  constructor(options: RoomWebSocketGatewayOptions) {
    this.allowedBrowserOrigins = new Set(options.allowedBrowserOrigins);
    this.authorize = options.authorize ?? denyRoomWebSocketAuthorization;
    this.closeGraceMs = assertPositiveInteger(
      'closeGraceMs',
      options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS,
    );
    this.connectionMessageLimit = assertPositiveInteger(
      'connectionMessageLimit',
      options.connectionMessageLimit ?? DEFAULT_CONNECTION_MESSAGE_LIMIT,
    );
    const heartbeatIntervalMs = assertPositiveInteger(
      'heartbeatIntervalMs',
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    );
    this.heartbeatTimeoutMs = assertPositiveInteger(
      'heartbeatTimeoutMs',
      options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
    );
    this.maxConnectionsPerUser = assertPositiveInteger(
      'maxConnectionsPerUser',
      options.maxConnectionsPerUser ?? DEFAULT_MAX_CONNECTIONS_PER_USER,
    );
    this.now = options.now ?? Date.now;
    this.outboundQueueMaxBytes = assertPositiveInteger(
      'outboundQueueMaxBytes',
      options.outboundQueueMaxBytes ?? DEFAULT_OUTBOUND_QUEUE_MAX_BYTES,
    );
    this.rateWindowMs = assertPositiveInteger(
      'rateWindowMs',
      options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS,
    );
    this.reservationTtlMs = assertPositiveInteger(
      'reservationTtlMs',
      options.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS,
    );
    this.shutdownGraceMs = assertPositiveInteger(
      'shutdownGraceMs',
      options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
    );
    this.userMessageLimit = assertPositiveInteger(
      'userMessageLimit',
      options.userMessageLimit ?? DEFAULT_USER_MESSAGE_LIMIT,
    );
    this.heartbeatInterval = setInterval(() => {
      this.sweep();
    }, heartbeatIntervalMs);
    this.heartbeatInterval.unref();
  }

  async prepareUpgrade(request: Request): Promise<RoomWebSocketUpgradeDecision> {
    if (new URL(request.url).pathname !== ARENA_ROOM_WEBSOCKET_PATH) {
      return createRejection(404, 'ROOM_WEBSOCKET_NOT_FOUND');
    }
    if (request.method !== 'GET') {
      return createRejection(405, 'ROOM_WEBSOCKET_METHOD_NOT_ALLOWED');
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return createRejection(426, 'ROOM_WEBSOCKET_UPGRADE_REQUIRED');
    }
    if (!hasValidHandshakeHeaders(request)) {
      return createRejection(400, 'ROOM_WEBSOCKET_INVALID_HANDSHAKE');
    }
    const protocols = parseOfferedProtocols(request);
    if (!protocols) {
      return createRejection(400, 'ROOM_WEBSOCKET_INVALID_PROTOCOL_HEADER');
    }
    if (!protocols.has(ARENA_ROOM_WEBSOCKET_PROTOCOL)) {
      return createRejection(426, 'ROOM_WEBSOCKET_PROTOCOL_REQUIRED');
    }
    const origin = request.headers.get('origin');
    if (origin !== null && !this.allowedBrowserOrigins.has(origin)) {
      return createRejection(403, 'ROOM_WEBSOCKET_ORIGIN_DENIED');
    }
    if (!this.accepting) {
      return createRejection(503, 'ROOM_WEBSOCKET_DRAINING');
    }

    let authorization: RoomWebSocketAuthorization;
    try {
      authorization = await this.authorize(request);
    } catch {
      return createRejection(503, 'ROOM_WEBSOCKET_AUTH_UNAVAILABLE');
    }
    if (!authorization.accepted) {
      return createRejection(authorization.status, authorization.code);
    }
    if (
      !isNonEmptyIdentity(authorization.userId)
      || !isNonEmptyIdentity(authorization.roomId)
      || !isNonEmptyIdentity(authorization.connectionKey ?? authorization.userId)
    ) {
      return createRejection(403, 'ROOM_WEBSOCKET_INVALID_AUTHORITY');
    }
    if (!this.accepting) {
      return createRejection(503, 'ROOM_WEBSOCKET_DRAINING');
    }
    const connectionKey = authorization.connectionKey ?? authorization.userId;
    if ((this.userOccupancy.get(connectionKey) ?? 0) >= this.maxConnectionsPerUser) {
      return createRejection(429, 'ROOM_WEBSOCKET_CONNECTION_LIMIT');
    }

    const reservation: RoomWebSocketReservation = {
      [ROOM_WEBSOCKET_GRANT_STATE]: { claimed: false },
      connectionKey,
      createdAt: this.currentTime(),
      roomId: authorization.roomId,
      userId: authorization.userId,
      ...(authorization.connectionAuthority
        ? { connectionAuthority: authorization.connectionAuthority }
        : {}),
    };
    return { accepted: true, reservation };
  }

  createEvents(reservation: RoomWebSocketReservation): WSEvents<WebSocketLike> {
    let session: RoomWebSocketSession | undefined;
    return {
      onOpen: (_event, context) => {
        // This gateway is constructed only with the official Node adapter backed by `ws`.
        const socket = context.raw as WebSocket | undefined;
        if (!socket) return;
        const activation = this.activateReservation(reservation, socket);
        if (!activation.accepted) {
          socket.close(activation.code, activation.reason);
          return;
        }
        session = activation.session;
      },
      onMessage: (event) => {
        session?.handleMessage(event.data);
      },
      onClose: () => {
        session?.cleanup();
      },
      onError: () => {
        // `ws` owns protocol-error close codes (for example 1009 for maxPayload)
        // and follows its error event with close. The close hook performs cleanup.
      },
    };
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopAccepting();
    clearInterval(this.heartbeatInterval);
    for (const session of this.sessions) session.requestShutdown();
    this.shutdownPromise = (async () => {
      if (this.sessions.size > 0) {
        await Promise.race([
          this.waitUntilEmpty(),
          new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, this.shutdownGraceMs);
            timeout.unref();
          }),
        ]);
      }
      for (const session of [...this.sessions]) session.terminate();
      if (this.tasks.size > 0) {
        await Promise.race([
          Promise.allSettled([...this.tasks]).then(() => undefined),
          new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, this.shutdownGraceMs);
            timeout.unref();
          }),
        ]);
      }
      this.userRates.clear();
    })();
    return this.shutdownPromise;
  }

  forceClose(): void {
    this.stopAccepting();
    clearInterval(this.heartbeatInterval);
    for (const session of [...this.sessions]) session.terminate();
    this.userRates.clear();
  }

  currentTime(): number {
    return this.now();
  }

  consumeUserRate(userId: string, now: number): boolean {
    let rate = this.userRates.get(userId);
    if (!rate || now - rate.startedAt >= this.rateWindowMs) {
      rate = { count: 0, startedAt: now };
      this.userRates.set(userId, rate);
    }
    rate.count += 1;
    return rate.count <= this.userMessageLimit;
  }

  trackTask(task: Promise<void>): void {
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task)).catch(() => undefined);
  }

  removeSession(session: RoomWebSocketSession): boolean {
    if (!this.sessions.delete(session)) return false;
    this.decrementOccupancy(session.reservation.connectionKey);
    if (this.sessions.size === 0) {
      for (const resolve of this.emptyWaiters) resolve();
      this.emptyWaiters.clear();
    }
    return true;
  }

  private activateReservation(
    reservation: RoomWebSocketReservation,
    socket: WebSocket,
  ): RoomWebSocketActivation {
    const grantState = reservation[ROOM_WEBSOCKET_GRANT_STATE];
    if (!grantState || grantState.claimed) {
      return { accepted: false, code: CLOSE_INVALID_MESSAGE, reason: 'invalid-reservation' };
    }
    grantState.claimed = true;
    if (!this.accepting) {
      return { accepted: false, code: CLOSE_SERVICE_RESTART, reason: 'service-restart' };
    }
    if (this.currentTime() - reservation.createdAt >= this.reservationTtlMs) {
      return { accepted: false, code: CLOSE_INVALID_MESSAGE, reason: 'authorization-expired' };
    }
    if ((this.userOccupancy.get(reservation.connectionKey) ?? 0) >= this.maxConnectionsPerUser) {
      return { accepted: false, code: CLOSE_TRY_AGAIN_LATER, reason: 'connection-limit' };
    }
    this.incrementOccupancy(reservation.connectionKey);
    const session = new RoomWebSocketSession(
      reservation,
      socket,
      this,
      this.currentTime(),
    );
    this.sessions.add(session);
    session.start();
    return { accepted: true, session };
  }

  private sweep(): void {
    const now = this.currentTime();
    for (const session of [...this.sessions]) session.heartbeat(now);
    for (const [userId, rate] of this.userRates) {
      if (
        now - rate.startedAt >= this.rateWindowMs
        && (this.userOccupancy.get(userId) ?? 0) === 0
      ) {
        this.userRates.delete(userId);
      }
    }
  }

  private incrementOccupancy(userId: string): void {
    this.userOccupancy.set(userId, (this.userOccupancy.get(userId) ?? 0) + 1);
  }

  private decrementOccupancy(userId: string): void {
    const next = (this.userOccupancy.get(userId) ?? 1) - 1;
    if (next <= 0) this.userOccupancy.delete(userId);
    else this.userOccupancy.set(userId, next);
  }

  private waitUntilEmpty(): Promise<void> {
    if (this.sessions.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.emptyWaiters.add(resolve);
    });
  }
}
