const DEFAULT_VITE_DEV_PORT = 5173;
const DEFAULT_VITE_PREVIEW_PORT = 4173;

function readConfiguredHost(
  env: Record<string, string | undefined>,
): string | undefined {
  const configuredHost = env.HOST?.trim();
  return configuredHost && configuredHost.length > 0
    ? configuredHost
    : undefined;
}

function readConfiguredPort(
  env: Record<string, string | undefined>,
  fallbackPort: number,
): number {
  const configuredPort = env.PORT?.trim();
  if (!configuredPort) {
    return fallbackPort;
  }

  const parsedPort = Number.parseInt(configuredPort, 10);
  if (!Number.isFinite(parsedPort) || parsedPort < 1) {
    return fallbackPort;
  }

  return parsedPort;
}

function buildServerOptions(
  env: Record<string, string | undefined>,
  fallbackPort: number,
): { host?: string; port: number } {
  const host = readConfiguredHost(env);
  const port = readConfiguredPort(env, fallbackPort);

  return host ? { host, port } : { port };
}

export function resolveViteServerOptions(
  env: Record<string, string | undefined>,
): { host?: string; port: number } {
  return buildServerOptions(env, DEFAULT_VITE_DEV_PORT);
}

export function resolveVitePreviewOptions(
  env: Record<string, string | undefined>,
): { host?: string; port: number } {
  return buildServerOptions(env, DEFAULT_VITE_PREVIEW_PORT);
}
