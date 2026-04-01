import type { FastifyPluginAsync } from "fastify";

import type { EventHub } from "../lib/event-hub.js";

type WebSocketRouteOptions = {
  eventHub: EventHub;
};

export const websocketRoutes: FastifyPluginAsync<WebSocketRouteOptions> = async (
  app,
  { eventHub }
) => {
  app.get("/ws", { websocket: true }, (connection) => {
    const unsubscribe = eventHub.subscribe((event) => {
      connection.socket.send(JSON.stringify(event));
    });

    connection.socket.once("close", unsubscribe);
  });
};
