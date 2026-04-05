import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const repoRoot = resolve(packageDir, "..", "..");
const outputDir = resolve(packageDir, "dist");
const backendEntry = resolve(repoRoot, "apps/backend/src/index.ts");
const backendOutput = resolve(outputDir, "backend/index.js");
const cliEntry = resolve(packageDir, "src/cli.ts");
const cliOutput = resolve(outputDir, "cli.js");
const frontendRoot = resolve(repoRoot, "apps/web");
const frontendDist = resolve(frontendRoot, "dist");
const bundledFrontendDist = resolve(outputDir, "web");
const drizzleDir = resolve(repoRoot, "packages/db/drizzle");
const bundledDrizzleDir = resolve(outputDir, "drizzle");
const shouldForceFrontendBuild =
  process.env.WALLEYBOARD_FORCE_WEB_BUILD === "1";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function ensureFrontendBuild() {
  if (!shouldForceFrontendBuild && existsSync(frontendDist)) {
    return;
  }

  execFileSync(npmCommand, ["--workspace", "@walleyboard/web", "run", "build"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
}

await ensureFrontendBuild();

rmSync(outputDir, { recursive: true, force: true });

await build({
  bundle: true,
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  entryPoints: [backendEntry],
  external: ["better-sqlite3", "node-pty"],
  format: "esm",
  legalComments: "none",
  outfile: backendOutput,
  platform: "node",
  sourcemap: true,
  target: "node22",
});

await build({
  banner: {
    js: "#!/usr/bin/env node",
  },
  bundle: true,
  entryPoints: [cliEntry],
  format: "esm",
  legalComments: "none",
  outfile: cliOutput,
  platform: "node",
  sourcemap: true,
  target: "node22",
});

cpSync(frontendDist, bundledFrontendDist, { recursive: true });
cpSync(drizzleDir, bundledDrizzleDir, { recursive: true });
chmodSync(cliOutput, 0o755);
