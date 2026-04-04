import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";

import { walleyboardSchema } from "./schema.js";

export type WalleyboardDatabase = BetterSQLite3Database<
  typeof walleyboardSchema
>;

export type WalleyboardDatabaseHandle = {
  db: WalleyboardDatabase;
  close(): void;
  transaction<T>(operation: () => T): T;
};

function openWalleyboardSqlite(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  return sqlite;
}

export function createWalleyboardDb(
  sqlite: Database.Database,
): WalleyboardDatabase {
  return drizzle(sqlite, { schema: walleyboardSchema });
}

export function createWalleyboardDatabase(
  databasePath: string,
): WalleyboardDatabaseHandle {
  const sqlite = openWalleyboardSqlite(databasePath);
  const db = createWalleyboardDb(sqlite);
  return {
    db,
    close() {
      sqlite.close();
    },
    transaction<T>(operation: () => T): T {
      return sqlite.transaction(operation)();
    },
  };
}
