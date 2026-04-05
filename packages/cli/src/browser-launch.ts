import { type SpawnOptions, spawn } from "node:child_process";

type BrowserCommand = {
  args: string[];
  command: string;
};

type SpawnResult = {
  unref(): void;
};

type SpawnImpl = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => SpawnResult;

export function resolveBrowserUrl(input: {
  host?: string;
  port?: string;
}): string {
  const rawHost = input.host?.trim() || "127.0.0.1";
  const port = input.port?.trim() || "4000";
  let host = normalizeBrowserHost(rawHost);

  if (host.includes(":") && !host.startsWith("[")) {
    host = `[${host}]`;
  }

  return `http://${host}:${port}`;
}

export function shouldAutoOpenBrowser(env: NodeJS.ProcessEnv): boolean {
  if (env.WALLEYBOARD_NO_OPEN === "1") {
    return false;
  }

  return env.BROWSER !== "none";
}

export function getBrowserOpenCommands(input: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  url: string;
}): BrowserCommand[] {
  const { env, platform, url } = input;

  if (platform === "darwin") {
    return [{ command: "open", args: [url] }];
  }

  if (platform === "win32") {
    return [{ command: "cmd", args: ["/c", "start", "", url] }];
  }

  if (isWslEnvironment(env)) {
    return [
      { command: "cmd.exe", args: ["/c", "start", "", url] },
      { command: "wslview", args: [url] },
      { command: "xdg-open", args: [url] },
    ];
  }

  return [{ command: "xdg-open", args: [url] }];
}

export function tryOpenBrowser(
  url: string,
  input?: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    spawnImpl?: SpawnImpl;
  },
): boolean {
  const platform = input?.platform ?? process.platform;
  const env = input?.env ?? process.env;
  const spawnImpl = input?.spawnImpl ?? spawn;
  const commands = getBrowserOpenCommands({ env, platform, url });

  for (const candidate of commands) {
    try {
      const child = spawnImpl(candidate.command, candidate.args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return true;
    } catch (error) {
      if (!isRetryableSpawnError(error)) {
        return false;
      }
    }
  }

  return false;
}

function normalizeBrowserHost(host: string): string {
  if (
    host === "0.0.0.0" ||
    host === "::" ||
    host === "[::]" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return "localhost";
  }

  return host;
}

function isWslEnvironment(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

function isRetryableSpawnError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "ENOENT" ||
      (error as { code?: unknown }).code === "UNKNOWN")
  );
}
