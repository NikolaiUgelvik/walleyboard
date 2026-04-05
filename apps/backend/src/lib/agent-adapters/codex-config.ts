import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Project } from "../../../../../packages/contracts/src/index.js";
import { resolveWalleyBoardPath } from "../walleyboard-paths.js";
import {
  normalizeMcpServerNames,
  selectEnabledMcpServers,
} from "./mcp-server-config.js";

const codexConfigPath = join(homedir(), ".codex", "config.toml");
const mcpServerHeaderPattern = /^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/;
const mcpServerSectionPattern = /^\[mcp_servers\.([A-Za-z0-9_-]+)(?:[.\]])/;

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
  const servers = new Set<string>();
  for (const line of configToml.split(/\r?\n/)) {
    const match = line.trim().match(mcpServerHeaderPattern);
    if (match?.[1]) {
      servers.add(match[1]);
    }
  }

  return Array.from(servers).sort((left, right) => left.localeCompare(right));
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

  const filteredLines: string[] = [];
  let keepCurrentSection = true;

  for (const line of configToml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const match = trimmed.match(mcpServerSectionPattern);
      keepCurrentSection = match?.[1] ? !disabled.has(match[1]) : true;
    }

    if (keepCurrentSection) {
      filteredLines.push(line);
    }
  }

  const normalized = filteredLines.join("\n").replace(/\n{3,}/g, "\n\n");
  return configToml.endsWith("\n") ? `${normalized.trimEnd()}\n` : normalized;
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
