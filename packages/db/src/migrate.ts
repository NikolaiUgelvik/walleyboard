import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  createWalleyboardDatabase,
  type WalleyboardDatabaseHandle,
} from "./client.js";

const migrationsDirPath = fileURLToPath(
  new URL("../drizzle/", import.meta.url),
);

export function migrateWalleyboardDb(
  databasePath: string,
): WalleyboardDatabaseHandle {
  const handle = createWalleyboardDatabase(databasePath);
  migrate(handle.db, { migrationsFolder: migrationsDirPath });
  return handle;
}

export function createMigratedWalleyboardDatabase(
  databasePath: string,
): WalleyboardDatabaseHandle {
  return migrateWalleyboardDb(databasePath);
}

export function createUnmigratedWalleyboardDatabase(
  databasePath: string,
): WalleyboardDatabaseHandle {
  return createWalleyboardDatabase(databasePath);
}
