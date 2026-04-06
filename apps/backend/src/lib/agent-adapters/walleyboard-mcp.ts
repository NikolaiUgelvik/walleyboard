import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { toJSONSchema, type z } from "zod";

import { dockerWorkspacePath } from "../docker-runtime.js";

export const walleyboardMcpServerName = "walleyboard";
export const inspectOnlyBuiltInTools = "Read,Glob,Grep";
export const walleyboardMcpHttpPort = 8765;

const adapterDir = dirname(fileURLToPath(import.meta.url));

const walleyboardMcpScriptPath = `${dockerWorkspacePath}/apps/backend/src/lib/agent-adapters/walleyboard-mcp.mjs`;
export const walleyboardMcpHttpScriptPath = join(
  adapterDir,
  "walleyboard-mcp-http.mjs",
);

export type WalleyboardPromptKind =
  | "draft_refine"
  | "draft_questions"
  | "review"
  | "pull_request_body";

type WalleyboardToolDefinition = {
  description: string;
  name: string;
  schema: z.ZodType<unknown>;
};

function buildEncodedSpec(tool: WalleyboardToolDefinition): string {
  return Buffer.from(
    JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: toJSONSchema(tool.schema),
    }),
    "utf8",
  ).toString("base64");
}

export function buildWalleyboardEncodedSpec(
  tool: WalleyboardToolDefinition,
): string {
  return buildEncodedSpec(tool);
}

export function buildWalleyboardToolDefinition(input: {
  promptKind: WalleyboardPromptKind;
  schema: z.ZodType<unknown>;
}): WalleyboardToolDefinition {
  switch (input.promptKind) {
    case "draft_refine":
      return {
        name: "submit_refined_draft",
        description:
          "Submit the refined WalleyBoard draft by filling the named tool input fields directly for this draft refinement run.",
        schema: input.schema,
      };
    case "draft_questions":
      return {
        name: "submit_draft_feasibility_assessment",
        description:
          "Submit the WalleyBoard draft feasibility assessment by filling the named tool input fields directly for this questions run.",
        schema: input.schema,
      };
    case "review":
      return {
        name: "submit_review_report",
        description:
          "Submit the WalleyBoard review report by filling the named tool input fields directly for this review run.",
        schema: input.schema,
      };
    case "pull_request_body":
      return {
        name: "submit_pull_request_body",
        description:
          "Submit the WalleyBoard pull request body fields by filling the named tool input fields directly for this pull request body run.",
        schema: input.schema,
      };
  }
}

export function buildWalleyboardToolRef(toolName: string): string {
  return `mcp__${walleyboardMcpServerName}__${toolName}`;
}

export function buildWalleyboardMcpServerConfig(input: {
  outputPath: string;
  tool: WalleyboardToolDefinition;
}): {
  command: string;
  args: string[];
} {
  return {
    command: "node",
    args: [
      walleyboardMcpScriptPath,
      input.outputPath,
      buildEncodedSpec(input.tool),
    ],
  };
}

export function buildClaudeWalleyboardMcpConfig(input: {
  outputPath: string;
  tool: WalleyboardToolDefinition;
}): string {
  return JSON.stringify({
    mcpServers: {
      [walleyboardMcpServerName]: buildWalleyboardMcpServerConfig(input),
    },
  });
}

export function buildClaudeWalleyboardHttpMcpUrl(input: {
  host?: string;
  port: number;
  token: string;
}): string {
  const host = input.host ?? "127.0.0.1";
  return `http://${host}:${input.port}/mcp/${input.token}`;
}

export function buildClaudeWalleyboardHttpMcpConfig(input: {
  host?: string;
  port: number;
  token: string;
}): string {
  return JSON.stringify({
    mcpServers: {
      [walleyboardMcpServerName]: {
        type: "http",
        url: buildClaudeWalleyboardHttpMcpUrl(input),
      },
    },
  });
}

export function buildWalleyboardHttpServerConfig(input: {
  outputPath: string;
  port: number;
  token: string;
  tool: WalleyboardToolDefinition;
}): {
  command: string;
  args: string[];
} {
  return {
    command: "node",
    args: [
      walleyboardMcpHttpScriptPath,
      input.outputPath,
      buildEncodedSpec(input.tool),
      String(input.port),
      input.token,
    ],
  };
}

export function buildCodexWalleyboardConfigOverrides(input: {
  outputPath: string;
  tool: WalleyboardToolDefinition;
}): string[] {
  const serverConfig = buildWalleyboardMcpServerConfig(input);
  return [
    `mcp_servers.${walleyboardMcpServerName}.command=${JSON.stringify(serverConfig.command)}`,
    `mcp_servers.${walleyboardMcpServerName}.args=${JSON.stringify(serverConfig.args)}`,
  ];
}

export function buildWalleyboardAllowedTools(
  enabledMcpServers: readonly string[],
  toolName: string,
): string {
  return [
    ...new Set([
      "Read",
      "Glob",
      "Grep",
      buildWalleyboardToolRef(toolName),
      ...enabledMcpServers.map((serverName) => `mcp__${serverName}__*`),
    ]),
  ].join(",");
}
