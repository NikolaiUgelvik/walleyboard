#!/usr/bin/env node

import { createServer } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  createWalleyboardToolCallResult,
  createWalleyboardToolsListResult,
  parseWalleyboardToolSpec,
  validateWalleyboardToolCall,
  walleyboardMcpServerInfo,
  writeWalleyboardToolCallOutput,
} from "./walleyboard-mcp.mjs";

function parsePort(rawPort) {
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid WalleyBoard MCP HTTP port: ${String(rawPort)}`);
  }
  return port;
}

function createErrorResponse(res, statusCode, code, message) {
  res.status(statusCode).json({
    jsonrpc: "2.0",
    error: {
      code,
      message,
    },
    id: null,
  });
}

function createWalleyboardHttpServer(options) {
  const host = process.env.WALLEYBOARD_MCP_BIND_HOST ?? "127.0.0.1";
  const app = createMcpExpressApp({ host });
  const mcpPath = `/mcp/${options.token}`;
  const healthPath = `/health/${options.token}`;

  app.get(healthPath, (_req, res) => {
    res.status(204).end();
  });

  app.post(mcpPath, async (req, res) => {
    const server = new Server(walleyboardMcpServerInfo, {
      capabilities: {
        tools: {},
      },
    });

    server.setRequestHandler(ListToolsRequestSchema, async () =>
      createWalleyboardToolsListResult(options.toolSpec),
    );

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = validateWalleyboardToolCall(
        request.params,
        options.toolSpec.name,
      );
      writeWalleyboardToolCallOutput(options.outputPath, args);
      return createWalleyboardToolCallResult();
    });

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      if (!res.headersSent) {
        const message =
          error instanceof Error ? error.message : "Internal server error";
        createErrorResponse(res, 500, -32603, message);
      }
      void server.close();
    }
  });

  app.get(mcpPath, (_req, res) => {
    createErrorResponse(res, 405, -32000, "Method not allowed.");
  });

  app.delete(mcpPath, (_req, res) => {
    createErrorResponse(res, 405, -32000, "Method not allowed.");
  });

  return createServer(app);
}

export function startWalleyboardMcpHttpServer(
  outputPath,
  encodedSpec,
  rawPort,
  token,
) {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error("WalleyBoard MCP HTTP token is required.");
  }

  const server = createWalleyboardHttpServer({
    outputPath,
    token,
    port: parsePort(rawPort),
    toolSpec: parseWalleyboardToolSpec(encodedSpec),
  });

  const bindHost = process.env.WALLEYBOARD_MCP_BIND_HOST ?? "127.0.0.1";
  server.listen(parsePort(rawPort), bindHost);

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file://").href;

if (invokedDirectly) {
  const [, , outputPath, encodedSpec, rawPort, token] = process.argv;
  if (!outputPath || !encodedSpec || !rawPort || !token) {
    throw new Error(
      "Usage: walleyboard-mcp-http.mjs <output-path> <encoded-tool-spec> <port> <token>",
    );
  }

  startWalleyboardMcpHttpServer(outputPath, encodedSpec, rawPort, token);
}
