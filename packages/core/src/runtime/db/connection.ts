/**
 * Open (and initialise) a `runs.db` SQLite database. WAL plus a long busy
 * timeout because the transient advance tick and the dashboard read it
 * concurrently. Initialisation is idempotent.
 */

import { Database } from "bun:sqlite";

import { SCHEMA_SQL } from "./schema.ts";

export function openRunsDatabase(path: string): Database {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
  for (const statement of SCHEMA_SQL.split(";")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) db.run(trimmed);
  }
  return db;
}
