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
    (db.prepare("SELECT name FROM migrations").all() as { name: string }[]).map((r) => r.name),
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
 * Import data from legacy JSON files into SQLite tables if the tables are empty.
 * Called once after migrations to seed the database from ~/.adjutant/*.json.
 */
export function importJsonIfNeeded(db: Database.Database): void {
  // --- Projects ---
  const projectsTableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
    .get();

  if (projectsTableExists) {
    const projectCount = (db.prepare("SELECT COUNT(*) as cnt FROM projects").get() as { cnt: number }).cnt;
    if (projectCount === 0) {
      const projectsFile = join(homedir(), ".adjutant", "projects.json");
      if (existsSync(projectsFile)) {
        try {
          const raw = readFileSync(projectsFile, "utf8");
          const store = JSON.parse(raw) as { projects?: Record<string, unknown>[] };
          const projects = store.projects;
          if (Array.isArray(projects) && projects.length > 0) {
            const insert = db.prepare(`
              INSERT OR IGNORE INTO projects (id, name, path, git_remote, mode, created_at, active)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            const importBatch = db.transaction(() => {
              for (const p of projects) {
                // Normalize legacy "standalone" mode to "swarm"
                const rawMode = p["mode"] as string;
                const mode = rawMode === "standalone" ? "swarm" : rawMode || "swarm";
                const active = p["active"] ? 1 : 0;
                insert.run(
                  p["id"] as string,
                  p["name"] as string,
                  p["path"] as string,
                  (p["gitRemote"] as string) || null,
                  mode,
                  (p["createdAt"] as string) || new Date().toISOString(),
                  active,
                );
              }
            });

            importBatch();
            logInfo(`Imported ${projects.length} projects from projects.json into SQLite`);
          }
        } catch (err) {
          logWarn(`Failed to import projects.json: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  // --- Sessions ---
  const sessionsTableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='managed_sessions'")
    .get();

  if (sessionsTableExists) {
    const sessionCount = (db.prepare("SELECT COUNT(*) as cnt FROM managed_sessions").get() as { cnt: number }).cnt;
    if (sessionCount === 0) {
      const sessionsFile = join(homedir(), ".adjutant", "sessions.json");
      if (existsSync(sessionsFile)) {
        try {
          const raw = readFileSync(sessionsFile, "utf8");
          const sessions = JSON.parse(raw) as Record<string, unknown>[];
          if (Array.isArray(sessions) && sessions.length > 0) {
            const insert = db.prepare(`
              INSERT OR IGNORE INTO managed_sessions (id, name, tmux_session, tmux_pane, project_path, mode, status, workspace_type, pipe_active, created_at, last_activity)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const importBatch = db.transaction(() => {
              for (const s of sessions) {
                // Normalize legacy "standalone" mode to "swarm"
                const rawMode = s["mode"] as string;
                const mode = rawMode === "standalone" ? "swarm" : rawMode || "swarm";
                insert.run(
                  s["id"] as string,
                  s["name"] as string,
                  (s["tmuxSession"] as string) || "",
                  (s["tmuxPane"] as string) || "",
                  (s["projectPath"] as string) || "",
                  mode,
                  (s["status"] as string) || "idle",
                  (s["workspaceType"] as string) || "primary",
                  s["pipeActive"] ? 1 : 0,
                  (s["createdAt"] as string) || new Date().toISOString(),
                  (s["lastActivity"] as string) || new Date().toISOString(),
                );
              }
            });

            importBatch();
            logInfo(`Imported ${sessions.length} sessions from sessions.json into SQLite`);
          }
        } catch (err) {
          logWarn(`Failed to import sessions.json: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
}

/**
 * Get the singleton database instance. Creates it if it doesn't exist.
 */
export function getDatabase(): Database.Database {
  if (singleton === null) {
    singleton = createDatabase(DEFAULT_DB_PATH);
    runMigrations(singleton);
    importJsonIfNeeded(singleton);
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
