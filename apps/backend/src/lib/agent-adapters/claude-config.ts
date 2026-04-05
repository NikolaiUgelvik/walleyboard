import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Project } from "../../../../../packages/contracts/src/index.js";
import { resolveWalleyBoardPath } from "../walleyboard-paths.js";
import { resolveClaudeConfigHome } from "./claude-code-runtime.js";
import { selectEnabledMcpServers } from "./mcp-server-config.js";

const claudeSettingsFiles = ["settings.json", "settings.local.json"] as const;

type JsonRecord = Record<string, unknown>;

type ConfigFileOverride = {
  hostPath: string;
  relativePath: string;
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function listMcpServersInSettingsObject(settings: JsonRecord): string[] {
  const servers = new Set<string>();

  for (const key of ["mcpServers", "mcp_servers"] as const) {
    const value = settings[key];
    if (!isJsonRecord(value)) {
      continue;
    }

    for (const serverName of Object.keys(value)) {
      if (serverName.trim().length > 0) {
        servers.add(serverName);
      }
    }
  }

  return Array.from(servers).sort((left, right) => left.localeCompare(right));
}

export function listConfiguredClaudeMcpServersInSettings(
  settingsJson: string,
): string[] {
  try {
    const parsed = JSON.parse(settingsJson);
    return isJsonRecord(parsed) ? listMcpServersInSettingsObject(parsed) : [];
  } catch {
    return [];
  }
}

export function listConfiguredClaudeMcpServers(): string[] {
  return listConfiguredClaudeMcpServersInConfigHome(resolveClaudeConfigHome());
}

export function listConfiguredClaudeMcpServersInConfigHome(
  configHomePath: string,
): string[] {
  const servers = new Set<string>();

  for (const relativePath of claudeSettingsFiles) {
    const settingsPath = join(configHomePath, relativePath);
    if (!existsSync(settingsPath)) {
      continue;
    }

    const settingsJson = readFileSync(settingsPath, "utf8");
    if (!settingsJson) {
      continue;
    }

    for (const serverName of listConfiguredClaudeMcpServersInSettings(
      settingsJson,
    )) {
      servers.add(serverName);
    }
  }

  return Array.from(servers).sort((left, right) => left.localeCompare(right));
}

export function listEnabledProjectClaudeMcpServers(project: Project): string[] {
  return listEnabledProjectClaudeMcpServersInConfigHome(
    resolveClaudeConfigHome(),
    project,
  );
}

export function listEnabledProjectClaudeMcpServersInConfigHome(
  configHomePath: string,
  project: Project,
): string[] {
  return selectEnabledMcpServers(
    listConfiguredClaudeMcpServersInConfigHome(configHomePath),
    project.disabled_mcp_servers,
  );
}

function filterClaudeSettingsJson(
  settingsJson: string,
  disabledServers: readonly string[],
): string | null {
  try {
    const parsed = JSON.parse(settingsJson);
    if (!isJsonRecord(parsed)) {
      return null;
    }

    const filteredSettings: JsonRecord = { ...parsed };
    for (const key of ["mcpServers", "mcp_servers"] as const) {
      const servers = filteredSettings[key];
      if (!isJsonRecord(servers)) {
        continue;
      }

      const filteredServers = Object.fromEntries(
        Object.entries(servers).filter(
          ([serverName]) => !disabledServers.includes(serverName),
        ),
      );
      filteredSettings[key] = filteredServers;
    }

    const normalized = JSON.stringify(filteredSettings, null, 2);
    return settingsJson.endsWith("\n") ? `${normalized}\n` : normalized;
  } catch {
    return null;
  }
}

export function writeClaudeConfigOverrides(
  project: Project,
): ConfigFileOverride[] {
  return writeClaudeConfigOverridesInConfigHome(
    resolveClaudeConfigHome(),
    resolveWalleyBoardPath("agent-config-overrides", "claude", project.id),
    project,
  );
}

export function writeClaudeConfigOverridesInConfigHome(
  configHomePath: string,
  overrideDir: string,
  project: Project,
): ConfigFileOverride[] {
  if (project.disabled_mcp_servers.length === 0) {
    return [];
  }
  const overrides: ConfigFileOverride[] = [];

  for (const relativePath of claudeSettingsFiles) {
    const settingsPath = join(configHomePath, relativePath);
    if (!existsSync(settingsPath)) {
      continue;
    }

    const settingsJson = readFileSync(settingsPath, "utf8");
    if (!settingsJson) {
      continue;
    }

    const filteredSettings = filterClaudeSettingsJson(
      settingsJson,
      project.disabled_mcp_servers,
    );
    if (!filteredSettings || filteredSettings === settingsJson) {
      continue;
    }

    mkdirSync(overrideDir, { recursive: true });
    const overridePath = join(overrideDir, relativePath);
    writeFileSync(overridePath, filteredSettings, {
      encoding: "utf8",
      mode: 0o600,
    });
    overrides.push({
      hostPath: overridePath,
      relativePath,
    });
  }

  return overrides;
}
