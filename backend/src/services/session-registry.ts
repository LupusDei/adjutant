/**
 * SessionRegistry — in-memory session tracking with SQLite persistence.
 *
 * Maintains state for every managed tmux session. Persists to the
 * managed_sessions table in SQLite so sessions survive backend restarts.
 */

import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { getDatabase } from "./database.js";
import { logInfo, logWarn } from "../utils/index.js";

// ============================================================================
// Types
// ============================================================================

export type SessionMode = "swarm";
export type SessionStatus = "idle" | "working" | "waiting_permission" | "offline";
export type WorkspaceType = "primary" | "worktree" | "copy";

export interface ManagedSession {
  id: string;
  name: string;
  tmuxSession: string;
  tmuxPane: string;
  projectPath: string;
  mode: SessionMode;
  status: SessionStatus;
  workspaceType: WorkspaceType;
  connectedClients: Set<string>;
  outputBuffer: string[];
  pipeActive: boolean;
  createdAt: Date;
  lastActivity: Date;
}

/** Row shape returned by SQLite queries on managed_sessions. */
interface SessionRow {
  id: string;
  name: string;
  tmux_session: string;
  tmux_pane: string;
  project_path: string;
  mode: string;
  status: string;
  workspace_type: string;
  pipe_active: number;
  created_at: string;
  last_activity: string;
}

export interface CreateSessionOptions {
  name: string;
  tmuxSession: string;
  tmuxPane?: string;
  projectPath: string;
  mode?: SessionMode;
  workspaceType?: WorkspaceType;
}

// ============================================================================
// Constants
// ============================================================================

const OUTPUT_BUFFER_MAX = 1000;

// ============================================================================
// SessionRegistry
// ============================================================================

export class SessionRegistry {
  private sessions = new Map<string, ManagedSession>();
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  /**
   * Create and register a new session.
   */
  create(opts: CreateSessionOptions): ManagedSession {
    const id = randomUUID();
    const now = new Date();
    const session: ManagedSession = {
      id,
      name: opts.name,
      tmuxSession: opts.tmuxSession,
      tmuxPane: opts.tmuxPane ?? opts.tmuxSession,
      projectPath: opts.projectPath,
      mode: opts.mode ?? "swarm",
      status: "idle",
      workspaceType: opts.workspaceType ?? "primary",
      connectedClients: new Set(),
      outputBuffer: [],
      pipeActive: false,
      createdAt: now,
      lastActivity: now,
    };

    this.db.prepare(`
      INSERT INTO managed_sessions (id, name, tmux_session, tmux_pane, project_path, mode, status, workspace_type, pipe_active, created_at, last_activity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.name,
      session.tmuxSession,
      session.tmuxPane,
      session.projectPath,
      session.mode,
      session.status,
      session.workspaceType,
      session.pipeActive ? 1 : 0,
      session.createdAt.toISOString(),
      session.lastActivity.toISOString(),
    );

    this.sessions.set(id, session);
    logInfo("Session created", { id, name: session.name });
    return session;
  }

  /**
   * Get a session by ID.
   */
  get(id: string): ManagedSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Get all sessions.
   */
  getAll(): ManagedSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Find a session by tmux session name.
   */
  findByTmuxSession(tmuxSession: string): ManagedSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.tmuxSession === tmuxSession) return session;
    }
    return undefined;
  }

  /**
   * Find sessions by name.
   */
  findByName(name: string): ManagedSession[] {
    return this.getAll().filter((s) => s.name === name);
  }

  /**
   * Update session status.
   */
  updateStatus(id: string, status: SessionStatus): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.status = status;
    session.lastActivity = new Date();

    this.db.prepare(
      "UPDATE managed_sessions SET status = ?, last_activity = ? WHERE id = ?",
    ).run(status, session.lastActivity.toISOString(), id);

    return true;
  }

  /**
   * Add a connected client to a session.
   */
  addClient(sessionId: string, clientId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.connectedClients.add(clientId);
    session.lastActivity = new Date();
    return true;
  }

  /**
   * Remove a connected client from a session.
   */
  removeClient(sessionId: string, clientId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.connectedClients.delete(clientId);
    return true;
  }

  /**
   * Append a line to the session's output buffer (ring buffer).
   */
  appendOutput(sessionId: string, line: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.outputBuffer.push(line);
    while (session.outputBuffer.length > OUTPUT_BUFFER_MAX) {
      session.outputBuffer.shift();
    }
    session.lastActivity = new Date();
    return true;
  }

  /**
   * Get output buffer contents.
   */
  getOutputBuffer(sessionId: string): string[] | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return [...session.outputBuffer];
  }

  /**
   * Clear a session's output buffer.
   */
  clearOutputBuffer(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.outputBuffer = [];
    return true;
  }

  /**
   * Remove a session from the registry.
   */
  remove(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.sessions.delete(id);
    this.db.prepare("DELETE FROM managed_sessions WHERE id = ?").run(id);
    logInfo("Session removed", { id, name: session.name });
    return true;
  }

  /**
   * Get session count.
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Persist current in-memory session state to SQLite.
   * Uses INSERT OR REPLACE so callers that still call save() after
   * bulk in-memory mutations get the expected behaviour.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async save(): Promise<void> {
    const upsert = this.db.prepare(`
      INSERT OR REPLACE INTO managed_sessions
        (id, name, tmux_session, tmux_pane, project_path, mode, status, workspace_type, pipe_active, created_at, last_activity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const sessions = this.getAll();

    const runBatch = this.db.transaction(() => {
      // Remove rows that are no longer in memory
      const inMemoryIds = sessions.map((s) => s.id);
      if (inMemoryIds.length === 0) {
        this.db.prepare("DELETE FROM managed_sessions").run();
      } else {
        const existing = this.db
          .prepare("SELECT id FROM managed_sessions")
          .all() as { id: string }[];
        for (const row of existing) {
          if (!inMemoryIds.includes(row.id)) {
            this.db.prepare("DELETE FROM managed_sessions WHERE id = ?").run(row.id);
          }
        }
      }

      // Upsert all in-memory sessions
      for (const s of sessions) {
        upsert.run(
          s.id,
          s.name,
          s.tmuxSession,
          s.tmuxPane,
          s.projectPath,
          s.mode,
          s.status,
          s.workspaceType,
          s.pipeActive ? 1 : 0,
          s.createdAt.toISOString(),
          s.lastActivity.toISOString(),
        );
      }
    });

    runBatch();
    logInfo("Sessions persisted", { count: sessions.length });
  }

  /**
   * Load sessions from SQLite into the in-memory Map.
   * All loaded sessions start as "offline" until tmux is verified.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async load(): Promise<number> {
    try {
      const rows = this.db
        .prepare("SELECT * FROM managed_sessions")
        .all() as SessionRow[];

      for (const row of rows) {
        const session: ManagedSession = {
          id: row.id,
          name: row.name,
          tmuxSession: row.tmux_session,
          tmuxPane: row.tmux_pane,
          projectPath: row.project_path,
          mode: row.mode as SessionMode,
          status: "offline", // start as offline until we verify tmux
          workspaceType: row.workspace_type as WorkspaceType,
          connectedClients: new Set(),
          outputBuffer: [],
          pipeActive: false, // reset on load, re-established when pipes reconnect
          createdAt: new Date(row.created_at),
          lastActivity: new Date(row.last_activity),
        };
        this.sessions.set(session.id, session);
      }

      logInfo("Sessions loaded from database", { count: rows.length });
      return rows.length;
    } catch (err) {
      logWarn("Failed to load sessions from database", { error: String(err) });
      return 0;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SessionRegistry | null = null;

export function getSessionRegistry(): SessionRegistry {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  if (!instance) {
    instance = new SessionRegistry();
  }
  return instance;
}

export function resetSessionRegistry(): void {
  instance = null;
}
