import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type CliOptions = {
  host?: string;
  port?: string;
  showHelp: boolean;
  showVersion: boolean;
};

function readPackageVersion(packageRoot: string): string {
  const packageJsonPath = join(packageRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: string;
  };

  return packageJson.version ?? "0.0.0";
}

function printHelp(): void {
  process.stdout.write(`Usage: walleyboard [--host <host>] [--port <port>]

Starts the WalleyBoard backend and serves the packaged frontend from the same
process.

Options:
  --host <host>     Bind host for the backend server.
  --port <port>     Bind port for the backend server.
  --help            Show this help text.
  --version         Show the package version.
`);
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    showHelp: false,
    showVersion: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) {
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      options.showHelp = true;
      continue;
    }

    if (argument === "--version" || argument === "-v") {
      options.showVersion = true;
      continue;
    }

    if (argument === "--host") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--host requires a value");
      }

      options.host = value;
      index += 1;
      continue;
    }

    if (argument === "--port") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--port requires a value");
      }

      options.port = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

async function main(): Promise<void> {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const options = parseCliOptions(process.argv.slice(2));

  if (options.showHelp) {
    printHelp();
    return;
  }

  if (options.showVersion) {
    process.stdout.write(`${readPackageVersion(packageRoot)}\n`);
    return;
  }

  const backendEntryPath = join(packageRoot, "dist", "backend", "index.js");
  const staticAssetDir = join(packageRoot, "dist", "web");

  if (!existsSync(backendEntryPath) || !existsSync(staticAssetDir)) {
    throw new Error(
      "WalleyBoard is missing its packaged runtime assets. Rebuild the package before running it.",
    );
  }

  if (options.host) {
    process.env.HOST = options.host;
  }

  if (options.port) {
    process.env.PORT = options.port;
  }

  process.env.WALLEYBOARD_STATIC_DIR ??= staticAssetDir;

  await import(pathToFileURL(backendEntryPath).href);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
