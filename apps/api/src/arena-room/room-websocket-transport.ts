import {
  upgradeWebSocket,
  type Http2Bindings,
  type HttpBindings,
} from '@hono/node-server';
import {
  ARENA_ROOM_WEBSOCKET_PROTOCOL,
  MAX_CONTROL_FRAME_BYTES,
} from '@mahoshojo/contracts/arena-room';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';

import {
  ARENA_ROOM_WEBSOCKET_PATH,
  type RoomWebSocketGateway,
} from './room-websocket-gateway';

type NodeBindings = HttpBindings | Http2Bindings;

interface NodeFetchApp {
  fetch(request: Request, env: NodeBindings): Promise<unknown> | unknown;
}

export const createRoomWebSocketServer = (): WebSocketServer => {
  return new WebSocketServer({
    handleProtocols: (protocols) => {
      return protocols.has(ARENA_ROOM_WEBSOCKET_PROTOCOL)
        ? ARENA_ROOM_WEBSOCKET_PROTOCOL
        : false;
    },
    maxPayload: MAX_CONTROL_FRAME_BYTES,
    noServer: true,
    perMessageDeflate: false,
  });
};

export const createRoomWebSocketApp = (gateway: RoomWebSocketGateway): NodeFetchApp => {
  const app = new Hono();

  app.all(ARENA_ROOM_WEBSOCKET_PATH, async (context) => {
    const decision = await gateway.prepareUpgrade(context.req.raw);
    if (!decision.accepted) return decision.response;
    return upgradeWebSocket(
      context,
      gateway.createEvents(decision.reservation),
      {
        onError: () => {
          console.error('[hono][room-websocket] event handler failed');
        },
      },
    );
  });

  return app;
};

export const createRoomRequestDispatcher = (
  httpApp: NodeFetchApp,
  websocketApp: NodeFetchApp,
) => {
  return (request: Request, env: NodeBindings): Promise<unknown> | unknown => {
    if (new URL(request.url).pathname === ARENA_ROOM_WEBSOCKET_PATH) {
      return websocketApp.fetch(request, env);
    }
    return httpApp.fetch(request, env);
  };
};
