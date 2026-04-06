#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const walleyboardMcpServerInfo = {
  name: "walleyboard-mcp",
  version: "1.0.0",
};

export const walleyboardMcpToolCallSuccessText =
  "WalleyBoard MCP tool input recorded.";

export function parseWalleyboardToolSpec(encodedSpec) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(encodedSpec, "base64").toString("utf8"));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not parse tool spec.";
    throw new Error(message);
  }

  if (
    typeof parsed?.name !== "string" ||
    parsed.name.trim().length === 0 ||
    typeof parsed?.description !== "string" ||
    parsed.description.trim().length === 0 ||
    !parsed?.inputSchema ||
    typeof parsed.inputSchema !== "object" ||
    Array.isArray(parsed.inputSchema)
  ) {
    throw new Error("Tool spec is missing required fields.");
  }

  return {
    description: parsed.description,
    inputSchema: parsed.inputSchema,
    name: parsed.name,
  };
}

export function createWalleyboardInitializeResult(protocolVersion) {
  return {
    protocolVersion:
      typeof protocolVersion === "string" ? protocolVersion : "2024-11-05",
    capabilities: {
      tools: {},
    },
    serverInfo: walleyboardMcpServerInfo,
  };
}

export function createWalleyboardToolsListResult(toolSpec) {
  return {
    tools: [
      {
        name: toolSpec.name,
        description: toolSpec.description,
        inputSchema: toolSpec.inputSchema,
      },
    ],
  };
}

class WalleyboardToolCallError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function validateWalleyboardToolCall(params, expectedToolName) {
  const name = params?.name;
  const args = params?.arguments;

  if (name !== expectedToolName) {
    throw new WalleyboardToolCallError(-32601, `Unknown tool: ${String(name)}`);
  }

  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new WalleyboardToolCallError(
      -32602,
      "Tool arguments must be a JSON object.",
    );
  }

  return args;
}

export function writeWalleyboardToolCallOutput(outputPath, args) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(args, null, 2)}\n`, "utf8");
}

export function createWalleyboardToolCallResult() {
  return {
    content: [
      {
        type: "text",
        text: walleyboardMcpToolCallSuccessText,
      },
    ],
  };
}

function sendMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export function consumeWalleyboardJsonLineBuffer(buffer) {
  const messages = [];
  let remainder = buffer;

  while (true) {
    const newlineIndex = remainder.indexOf("\n");
    if (newlineIndex === -1) {
      return {
        messages,
        remainder,
      };
    }

    const line = remainder.slice(0, newlineIndex).trim();
    remainder = remainder.slice(newlineIndex + 1);
    if (line.length === 0) {
      continue;
    }

    messages.push(JSON.parse(line));
  }
}

function sendResult(id, result) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function sendError(id, code, message) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
}

function handleToolCall(id, params, outputPath, toolSpec) {
  try {
    const args = validateWalleyboardToolCall(params, toolSpec.name);
    writeWalleyboardToolCallOutput(outputPath, args);
    sendResult(id, createWalleyboardToolCallResult());
  } catch (error) {
    if (error instanceof WalleyboardToolCallError) {
      sendError(id, error.code, error.message);
      return;
    }
    throw error;
  }
}

function handleMessage(message, outputPath, toolSpec) {
  if (!message || typeof message !== "object") {
    return;
  }

  const { id, method, params } = message;

  if (method === "initialize") {
    sendResult(id, createWalleyboardInitializeResult(params?.protocolVersion));
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    sendResult(id, createWalleyboardToolsListResult(toolSpec));
    return;
  }

  if (method === "tools/call") {
    handleToolCall(id, params, outputPath, toolSpec);
    return;
  }

  if (id !== undefined) {
    sendError(id, -32601, `Method not found: ${String(method)}`);
  }
}

function processContentLengthMessages(state, outputPath, toolSpec) {
  while (true) {
    const headerEnd = state.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return false;
    }

    const header = state.buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      throw new Error("Missing Content-Length header.");
    }

    const contentLength = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const messageEnd = bodyStart + contentLength;
    if (state.buffer.length < messageEnd) {
      return false;
    }

    const body = state.buffer.slice(bodyStart, messageEnd);
    state.buffer = state.buffer.slice(messageEnd);
    handleMessage(JSON.parse(body), outputPath, toolSpec);
  }
}

function processJsonLineMessages(state, outputPath, toolSpec) {
  const { messages, remainder } = consumeWalleyboardJsonLineBuffer(
    state.buffer,
  );
  state.buffer = remainder;
  for (const message of messages) {
    handleMessage(message, outputPath, toolSpec);
  }
  return messages.length > 0;
}

function processBuffer(state, outputPath, toolSpec) {
  const trimmedStart = state.buffer.trimStart();
  if (trimmedStart.length === 0) {
    state.buffer = "";
    return;
  }

  if (/^Content-Length:/i.test(trimmedStart)) {
    if (trimmedStart !== state.buffer) {
      state.buffer = trimmedStart;
    }
    processContentLengthMessages(state, outputPath, toolSpec);
    return;
  }

  processJsonLineMessages(state, outputPath, toolSpec);
}

export function startWalleyboardMcpServer(outputPath, encodedSpec) {
  const toolSpec = parseWalleyboardToolSpec(encodedSpec);
  const state = {
    buffer: "",
  };

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    state.buffer += chunk;
    processBuffer(state, outputPath, toolSpec);
  });
  process.stdin.on("end", () => {
    processBuffer(state, outputPath, toolSpec);
  });
}

function main() {
  const [, , outputPath, encodedSpec] = process.argv;

  if (!outputPath || !encodedSpec) {
    process.stderr.write(
      "Usage: walleyboard-mcp.mjs <output-path> <base64-tool-spec>\n",
    );
    process.exit(1);
  }

  try {
    startWalleyboardMcpServer(outputPath, encodedSpec);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start WalleyBoard MCP server.";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
