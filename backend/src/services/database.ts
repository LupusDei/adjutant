import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { logInfo, logWarn } from "../utils/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");
const DEFAULT_DB_DIR = join(homedir(), ".adjutant");
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, "adjutant.db");

let singleton: Database.Database | null = null;

/**
 * Create a new database connection with WAL mode and standard PRAGMAs.
 * Used directly in tests with a custom path; production code uses getDatabase().
 */
export function createDatabase(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return db;
}

/**
 * Run all unapplied migrations from the migrations directory.
 * Tracks applied migrations in a `migrations` table.
 */
export function runMigrations(db: Database.Database): void {
  // Create the migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Get already-applied migration names
  const applied = new Set(
    (db.prepare("SELECT name FROM migrations").all() as Array<{ name: string }>).map((r) => r.name),
  );

  // Read migration files in sorted order
  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    logWarn("No migrations directory found, skipping migrations");
    return;
  }

  const insertMigration = db.prepare("INSERT INTO migrations (name) VALUES (?)");

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    logInfo(`Running migration: ${file}`);

    db.transaction(() => {
      db.exec(sql);
      insertMigration.run(file);
    })();
  }
}

/**
 * Get the singleton database instance. Creates it if it doesn't exist.
 */
export function getDatabase(): Database.Database {
  if (singleton === null) {
    singleton = createDatabase(DEFAULT_DB_PATH);
    runMigrations(singleton);
  }
  return singleton;
}

/**
 * Initialize the database (alias for getDatabase that makes intent clear).
 */
export function initDatabase(): Database.Database {
  return getDatabase();
}

/**
 * Close the singleton database connection.
 */
export function closeDatabase(): void {
  if (singleton !== null) {
    singleton.close();
    singleton = null;
  }
}
