import {
  io,
  type ManagerOptions,
  type Socket,
  type SocketOptions,
} from "socket.io-client";

import { apiBaseUrl } from "./api-base-url.js";

type SocketFactory = typeof io;

declare global {
  var __WALLEYBOARD_SOCKET_IO_FACTORY__: SocketFactory | undefined;
}

function resolveSocketFactory(): SocketFactory {
  return globalThis.__WALLEYBOARD_SOCKET_IO_FACTORY__ ?? io;
}

export function connectWalleyboardSocket(
  namespace: `/${string}`,
  options?: Partial<ManagerOptions & SocketOptions>,
): Socket {
  return resolveSocketFactory()(`${apiBaseUrl}${namespace}`, {
    transports: ["websocket"],
    ...options,
  });
}
