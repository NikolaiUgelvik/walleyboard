import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  buildClaudeWalleyboardHttpMcpConfig,
  buildClaudeWalleyboardHttpMcpUrl,
  buildWalleyboardHttpServerConfig,
  buildWalleyboardToolDefinition,
} from "./walleyboard-mcp.js";

type WalleyboardToolSpec = {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
};

type WalleyboardMcpModule = {
  consumeWalleyboardJsonLineBuffer: (buffer: string) => {
    messages: unknown[];
    remainder: string;
  };
  createWalleyboardInitializeResult: (protocolVersion: unknown) => {
    capabilities: {
      tools: {};
    };
    protocolVersion: string;
    serverInfo: {
      name: string;
      version: string;
    };
  };
  createWalleyboardToolCallResult: () => {
    content: Array<{
      text: string;
      type: "text";
    }>;
  };
  createWalleyboardToolsListResult: (toolSpec: WalleyboardToolSpec) => {
    tools: WalleyboardToolSpec[];
  };
  parseWalleyboardToolSpec: (encodedSpec: string) => WalleyboardToolSpec;
  validateWalleyboardToolCall: (
    params: { arguments?: unknown; name?: string } | null | undefined,
    expectedToolName: string,
  ) => Record<string, unknown>;
  walleyboardMcpServerInfo: {
    name: string;
    version: string;
  };
  walleyboardMcpToolCallSuccessText: string;
  writeWalleyboardToolCallOutput: (
    outputPath: string,
    args: Record<string, unknown>,
  ) => void;
};

// @ts-expect-error -- The runtime uses a plain .mjs module so the test types it locally.
const walleyboardMcpModuleImport = await import("./walleyboard-mcp.mjs");

const {
  consumeWalleyboardJsonLineBuffer,
  createWalleyboardInitializeResult,
  createWalleyboardToolCallResult,
  createWalleyboardToolsListResult,
  parseWalleyboardToolSpec,
  validateWalleyboardToolCall,
  walleyboardMcpServerInfo,
  walleyboardMcpToolCallSuccessText,
  writeWalleyboardToolCallOutput,
} = walleyboardMcpModuleImport as WalleyboardMcpModule;

async function allocatePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a test port.");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
}

async function waitForHealthcheck(url: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === 204) {
        return;
      }
    } catch {
      // Retry until the sidecar is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test("WalleyBoard MCP helpers decode the tool spec and expose protocol metadata", () => {
  const schema = {
    type: "object",
    properties: {
      answer: {
        type: "string",
      },
    },
    required: ["answer"],
    additionalProperties: false,
  };
  const encodedSpec = Buffer.from(
    JSON.stringify({
      name: "submit_refined_draft",
      description: "Return the refined draft fields for the current run.",
      inputSchema: schema,
    }),
    "utf8",
  ).toString("base64");

  const toolSpec = parseWalleyboardToolSpec(encodedSpec);
  assert.deepEqual(toolSpec, {
    name: "submit_refined_draft",
    description: "Return the refined draft fields for the current run.",
    inputSchema: schema,
  });
  assert.deepEqual(createWalleyboardInitializeResult("2024-11-05"), {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {},
    },
    serverInfo: walleyboardMcpServerInfo,
  });
  assert.deepEqual(createWalleyboardToolsListResult(toolSpec), {
    tools: [toolSpec],
  });
});

test("WalleyBoard MCP helpers validate tool input and persist the payload", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-mcp-"));
  const outputPath = join(tempDir, "result.json");

  try {
    const args = validateWalleyboardToolCall(
      {
        name: "submit_refined_draft",
        arguments: {
          answer: "ready",
        },
      },
      "submit_refined_draft",
    );
    assert.deepEqual(args, {
      answer: "ready",
    });

    writeWalleyboardToolCallOutput(outputPath, args);
    assert.equal(
      readFileSync(outputPath, "utf8"),
      '{\n  "answer": "ready"\n}\n',
    );
    assert.deepEqual(createWalleyboardToolCallResult(), {
      content: [
        {
          type: "text",
          text: walleyboardMcpToolCallSuccessText,
        },
      ],
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("WalleyBoard MCP helpers reject malformed tool calls", () => {
  assert.throws(
    () =>
      validateWalleyboardToolCall(
        {
          name: "submit_review_report",
          arguments: {
            answer: "ready",
          },
        },
        "submit_refined_draft",
      ),
    /Unknown tool/,
  );

  assert.throws(
    () =>
      validateWalleyboardToolCall(
        {
          name: "submit_refined_draft",
          arguments: ["ready"],
        },
        "submit_refined_draft",
      ),
    /Tool arguments must be a JSON object/,
  );
});

test("WalleyBoard MCP helpers consume newline-delimited JSON-RPC messages", () => {
  const buffer = [
    "",
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
      },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }),
    '{"jsonrpc":"2.0","id":3,"method":"tools/call"',
  ].join("\n");

  assert.deepEqual(consumeWalleyboardJsonLineBuffer(buffer), {
    messages: [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      },
    ],
    remainder: '{"jsonrpc":"2.0","id":3,"method":"tools/call"',
  });
});

test("WalleyBoard MCP HTTP helpers build loopback-only Claude config and sidecar command", () => {
  const tool = buildWalleyboardToolDefinition({
    promptKind: "draft_refine",
    schema: z.object({
      title: z.string(),
    }),
  });
  const url = buildClaudeWalleyboardHttpMcpUrl({
    port: 8765,
    token: "secret-token",
  });
  assert.equal(url, "http://127.0.0.1:8765/mcp/secret-token");
  assert.deepEqual(
    JSON.parse(
      buildClaudeWalleyboardHttpMcpConfig({
        port: 8765,
        token: "secret-token",
      }),
    ),
    {
      mcpServers: {
        walleyboard: {
          type: "http",
          url,
        },
      },
    },
  );
  const serverConfig = buildWalleyboardHttpServerConfig({
    outputPath: "/walleyboard-home/output.json",
    port: 8765,
    token: "secret-token",
    tool,
  });
  assert.equal(serverConfig.command, "node");
  assert.match(serverConfig.args[0] ?? "", /walleyboard-mcp-http\.mjs$/);
  assert.equal(serverConfig.args[1], "/walleyboard-home/output.json");
  assert.equal(!!serverConfig.args[2]?.length, true);
  assert.equal(serverConfig.args[3], "8765");
  assert.equal(serverConfig.args[4], "secret-token");
});

test("WalleyBoard MCP HTTP sidecar serves tools and records tool input", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-mcp-http-"));
  const outputPath = join(tempDir, "result.json");
  let port: number;
  try {
    port = await allocatePort();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EPERM"
    ) {
      t.skip("Local sandbox blocks loopback listeners.");
      return;
    }
    throw error;
  }
  const token = "test-token";
  const encodedSpec = Buffer.from(
    JSON.stringify({
      name: "submit_refined_draft",
      description: "Return the refined draft fields for the current run.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    }),
    "utf8",
  ).toString("base64");
  const sidecarPath = fileURLToPath(
    new URL("./walleyboard-mcp-http.mjs", import.meta.url),
  );
  const child = spawn(
    process.execPath,
    [sidecarPath, outputPath, encodedSpec, String(port), token],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitForHealthcheck(`http://127.0.0.1:${port}/health/${token}`);

    const initializeResponse = await fetch(
      `http://127.0.0.1:${port}/mcp/${token}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
              name: "test",
              version: "1.0.0",
            },
          },
        }),
      },
    );
    const initializePayload = (await initializeResponse.json()) as Record<
      string,
      any
    >;
    assert.equal(initializePayload.result.serverInfo.name, "walleyboard-mcp");

    const listResponse = await fetch(`http://127.0.0.1:${port}/mcp/${token}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    const listPayload = (await listResponse.json()) as Record<string, any>;
    assert.equal(listPayload.result.tools[0].name, "submit_refined_draft");

    const callResponse = await fetch(`http://127.0.0.1:${port}/mcp/${token}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "submit_refined_draft",
          arguments: {
            title: "Add CONTRIBUTING.md",
          },
        },
      }),
    });
    const callPayload = (await callResponse.json()) as Record<string, any>;
    assert.equal(
      callPayload.result.content[0].text,
      walleyboardMcpToolCallSuccessText,
    );
    assert.equal(
      readFileSync(outputPath, "utf8"),
      '{\n  "title": "Add CONTRIBUTING.md"\n}\n',
    );
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
    rmSync(tempDir, { recursive: true, force: true });
  }
});
