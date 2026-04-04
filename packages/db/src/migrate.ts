import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type Database from "better-sqlite3";

import {
  createWalleyboardDatabase,
  createWalleyboardDb,
  openWalleyboardSqlite,
  type WalleyboardDatabaseHandle,
} from "./client.js";

const migrationsTableName = "__walleyboard_migrations";
const cleanInstallMigrationName = "0000_clean_install";
const liveUpgradeMigrationName = "0001_upgrade_live_20260404";
const migrationsDirPath = fileURLToPath(
  new URL("../drizzle/", import.meta.url),
);

function readMigrationSql(fileName: string): string {
  return readFileSync(`${migrationsDirPath}${fileName}`, "utf8");
}

function ensureMigrationsTable(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${migrationsTableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `);
}

function hasRecordedMigration(
  sqlite: Database.Database,
  name: string,
): boolean {
  const row = sqlite
    .prepare(
      `SELECT 1 AS has_migration FROM ${migrationsTableName} WHERE name = ? LIMIT 1`,
    )
    .get(name) as { has_migration: number } | undefined;

  return row?.has_migration === 1;
}

function recordMigration(sqlite: Database.Database, name: string): void {
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO ${migrationsTableName} (name, created_at) VALUES (?, ?)`,
    )
    .run(name, new Date().toISOString());
}

function listUserTables(sqlite: Database.Database): string[] {
  const rows = sqlite
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name != ?
        ORDER BY name
      `,
    )
    .all(migrationsTableName) as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

function runMigration(
  sqlite: Database.Database,
  name: string,
  fileName: string,
): void {
  sqlite.exec(readMigrationSql(fileName));
  recordMigration(sqlite, name);
}

export function migrateWalleyboardSqlite(
  sqlite: Database.Database,
): Database.Database {
  ensureMigrationsTable(sqlite);

  if (
    hasRecordedMigration(sqlite, cleanInstallMigrationName) ||
    hasRecordedMigration(sqlite, liveUpgradeMigrationName)
  ) {
    return sqlite;
  }

  const userTables = listUserTables(sqlite);
  if (userTables.length === 0) {
    runMigration(sqlite, cleanInstallMigrationName, "0000_clean_install.sql");
    return sqlite;
  }

  runMigration(
    sqlite,
    liveUpgradeMigrationName,
    "0001_upgrade_live_20260404.sql",
  );
  return sqlite;
}

export function migrateWalleyboardDb(
  databasePath: string,
): WalleyboardDatabaseHandle {
  const sqlite = openWalleyboardSqlite(databasePath);
  migrateWalleyboardSqlite(sqlite);
  return {
    sqlite,
    db: createWalleyboardDb(sqlite),
  };
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
