import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

const CONTENT_TYPES = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".ttf", "font/ttf"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function createNotFoundPayload(method: string, url: string) {
  return {
    error: "Not Found",
    message: `Route ${method}:${url} not found`,
    statusCode: 404,
  };
}

function resolveRequestedPath(
  staticAssetDir: string,
  requestUrl: string,
): string | null {
  const pathname = new URL(requestUrl, "http://walleyboard.local").pathname;
  const relativePath =
    pathname === "/" || pathname === ""
      ? "index.html"
      : pathname.replace(/^\/+/, "");

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    return null;
  }

  const staticRoot = resolve(staticAssetDir);
  const candidatePath = resolve(staticRoot, decodedPath);
  const insideStaticRoot =
    candidatePath === staticRoot ||
    candidatePath.startsWith(`${staticRoot}${sep}`);

  return insideStaticRoot ? candidatePath : null;
}

function resolveContentType(filePath: string): string {
  return (
    CONTENT_TYPES.get(extname(filePath).toLowerCase()) ??
    "application/octet-stream"
  );
}

async function trySendStaticFile(
  reply: FastifyReply,
  filePath: string,
): Promise<boolean> {
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      return false;
    }
  } catch {
    return false;
  }

  reply.type(resolveContentType(filePath));
  await reply.send(createReadStream(filePath));
  return true;
}

export function registerFrontendStaticRoutes(
  app: FastifyInstance,
  staticAssetDir: string,
): void {
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      reply.code(404).send(createNotFoundPayload(request.method, request.url));
      return;
    }

    const requestedFile = resolveRequestedPath(
      staticAssetDir,
      request.raw.url ?? request.url,
    );
    if (requestedFile && (await trySendStaticFile(reply, requestedFile))) {
      return;
    }

    reply.code(404).send(createNotFoundPayload(request.method, request.url));
  });
}
