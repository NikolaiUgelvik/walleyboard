import type { FastifyPluginAsync } from "fastify";

import type { EventHub } from "../lib/event-hub.js";

type WebSocketRouteOptions = {
  eventHub: EventHub;
};

export const websocketRoutes: FastifyPluginAsync<WebSocketRouteOptions> = async (
  app,
  { eventHub }
) => {
  app.get("/ws", { websocket: true }, (socket) => {
    const unsubscribe = eventHub.subscribe((event) => {
      socket.send(JSON.stringify(event));
    });

    socket.once("close", unsubscribe);
  });
};
