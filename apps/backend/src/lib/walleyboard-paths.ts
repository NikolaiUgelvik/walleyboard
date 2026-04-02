import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveWalleyBoardHome(): string {
  const override = process.env.WALLEYBOARD_HOME?.trim();
  if (override && override.length > 0) {
    return override;
  }

  return join(homedir(), ".walleyboard");
}

export function resolveWalleyBoardPath(...segments: string[]): string {
  return join(resolveWalleyBoardHome(), ...segments);
}

export function ensureWalleyBoardDir(...segments: string[]): string {
  const path = resolveWalleyBoardPath(...segments);
  mkdirSync(path, { recursive: true });
  return path;
}
