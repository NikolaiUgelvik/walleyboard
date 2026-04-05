export function normalizeMcpServerNames(servers: readonly string[]): string[] {
  return Array.from(
    new Set(
      servers
        .map((server) => server.trim())
        .filter((server) => server.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function selectEnabledMcpServers(
  configuredServers: readonly string[],
  disabledServers: readonly string[],
): string[] {
  const disabled = new Set(normalizeMcpServerNames(disabledServers));

  return normalizeMcpServerNames(configuredServers).filter(
    (server) => !disabled.has(server),
  );
}
