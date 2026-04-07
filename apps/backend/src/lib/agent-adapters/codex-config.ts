import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";

import type { Project } from "../../../../../packages/contracts/src/index.js";
import { resolveWalleyBoardPath } from "../walleyboard-paths.js";
import {
  normalizeMcpServerNames,
  selectEnabledMcpServers,
} from "./mcp-server-config.js";

export function resolveCodexConfigHome(): string {
  return join(homedir(), ".codex");
}

const codexConfigPath = join(resolveCodexConfigHome(), "config.toml");

function readCodexConfigToml(configPath: string): string | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    return readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
}

export function listConfiguredCodexMcpServersInConfig(
  configToml: string,
): string[] {
  try {
    const parsed = parse(configToml) as Record<string, unknown>;
    const mcpServers = parsed.mcp_servers;
    if (!mcpServers || typeof mcpServers !== "object") {
      return [];
    }
    return Object.keys(mcpServers).sort((left, right) =>
      left.localeCompare(right),
    );
  } catch {
    return [];
  }
}

export function listConfiguredCodexMcpServers(): string[] {
  return listConfiguredCodexMcpServersInConfigPath(codexConfigPath);
}

export function listConfiguredCodexMcpServersInConfigPath(
  configPath: string,
): string[] {
  const configToml = readCodexConfigToml(configPath);
  if (!configToml) {
    return [];
  }

  return listConfiguredCodexMcpServersInConfig(configToml);
}

export function selectEnabledCodexMcpServers(
  configuredServers: readonly string[],
  disabledServers: readonly string[],
): string[] {
  return selectEnabledMcpServers(configuredServers, disabledServers);
}

export function listEnabledProjectCodexMcpServers(project: Project): string[] {
  return listEnabledProjectCodexMcpServersInConfigPath(
    codexConfigPath,
    project,
  );
}

export function listEnabledProjectCodexMcpServersInConfigPath(
  configPath: string,
  project: Project,
): string[] {
  return selectEnabledCodexMcpServers(
    listConfiguredCodexMcpServersInConfigPath(configPath),
    project.disabled_mcp_servers,
  );
}

export function filterCodexConfigToml(
  configToml: string,
  disabledServers: readonly string[],
): string {
  const disabled = new Set(normalizeMcpServerNames(disabledServers));
  if (disabled.size === 0) {
    return configToml;
  }

  const parsed = parse(configToml) as Record<string, unknown>;
  const mcpServers = parsed.mcp_servers as Record<string, unknown> | undefined;
  if (mcpServers && typeof mcpServers === "object") {
    for (const serverName of Object.keys(mcpServers)) {
      if (disabled.has(serverName)) {
        delete mcpServers[serverName];
      }
    }
  }

  return stringify(parsed);
}

export function writeCodexConfigOverride(project: Project): string | null {
  return writeCodexConfigOverrideForConfigPath(
    codexConfigPath,
    resolveWalleyBoardPath("agent-config-overrides", "codex", project.id),
    project,
  );
}

export function writeCodexConfigOverrideForConfigPath(
  configPath: string,
  overrideDir: string,
  project: Project,
): string | null {
  const disabledServers = normalizeMcpServerNames(project.disabled_mcp_servers);
  if (disabledServers.length === 0) {
    return null;
  }

  const configToml = readCodexConfigToml(configPath);
  if (!configToml) {
    return null;
  }

  mkdirSync(overrideDir, { recursive: true });
  const overridePath = join(overrideDir, "config.toml");
  writeFileSync(
    overridePath,
    filterCodexConfigToml(configToml, disabledServers),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  return overridePath;
}
