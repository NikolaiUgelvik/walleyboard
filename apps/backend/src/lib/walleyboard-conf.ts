import { readFile } from "node:fs/promises";

import { parse } from "smol-toml";

import {
  type AgentAdapter,
  agentAdapterSchema,
} from "../../../../packages/contracts/src/index.js";
import { resolveWalleyBoardPath } from "./walleyboard-paths.js";

let cachedEnvOverrides: Record<string, Record<string, string>> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

function extractStringEntries(section: unknown): Record<string, string> {
  if (section === null || typeof section !== "object") {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    section as Record<string, unknown>,
  )) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

function applyParsedConf(content: string): void {
  try {
    const parsed = parse(content);
    const overrides: Record<string, Record<string, string>> = {};
    for (const key of Object.keys(parsed)) {
      if (!agentAdapterSchema.safeParse(key).success) {
        console.warn(
          `[walleyboard-conf] Unrecognized section [${key}] in walleyboard.conf — expected one of: ${agentAdapterSchema.options.join(", ")}`,
        );
      }
      overrides[key] = extractStringEntries(parsed[key]);
    }
    cachedEnvOverrides = overrides;
  } catch (error) {
    console.error(
      "[walleyboard-conf] Failed to parse walleyboard.conf:",
      error instanceof Error ? error.message : error,
    );
    cachedEnvOverrides = {};
  }
  cacheTimestamp = Date.now();
}

export async function loadAgentEnvOverrides(): Promise<
  Record<string, Record<string, string>>
> {
  const now = Date.now();
  if (cachedEnvOverrides !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedEnvOverrides;
  }

  const confPath = resolveWalleyBoardPath("walleyboard.conf");
  try {
    const content = await readFile(confPath, "utf8");
    applyParsedConf(content);
  } catch {
    cachedEnvOverrides = {};
    cacheTimestamp = now;
  }

  return cachedEnvOverrides ?? {};
}

export async function getAgentEnvOverrides(
  agentType: AgentAdapter,
): Promise<Record<string, string>> {
  const overrides = await loadAgentEnvOverrides();
  return overrides[agentType] ?? {};
}

export function getAgentEnvOverridesCached(
  agentType: AgentAdapter,
): Record<string, string> {
  if (cachedEnvOverrides === null) {
    return {};
  }
  const now = Date.now();
  if (now - cacheTimestamp >= CACHE_TTL_MS) {
    void loadAgentEnvOverrides();
  }
  return cachedEnvOverrides[agentType] ?? {};
}

export function resetConfCache(): void {
  cachedEnvOverrides = null;
  cacheTimestamp = 0;
}
