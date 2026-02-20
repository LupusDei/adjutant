/**
 * SessionRegistry — in-memory session tracking with file persistence.
 *
 * Maintains state for every managed tmux session. Persists to
 * ~/.adjutant/sessions.json so sessions survive backend restarts.
 */

import { randomUUID } from "crypto";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { logInfo, logWarn } from "../utils/index.js";

// ============================================================================
// Types
// ============================================================================

export type SessionMode = "swarm" | "swarm" | "gastown";
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

/** Serializable form for file persistence. */
interface SerializedSession {
  id: string;
  name: string;
  tmuxSession: string;
  tmuxPane: string;
  projectPath: string;
  mode: SessionMode;
  status: SessionStatus;
  workspaceType: WorkspaceType;
  pipeActive: boolean;
  createdAt: string;
  lastActivity: string;
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
const PERSISTENCE_DIR = join(homedir(), ".adjutant");
const PERSISTENCE_FILE = join(PERSISTENCE_DIR, "sessions.json");

// ============================================================================
// SessionRegistry
// ============================================================================

export class SessionRegistry {
  private sessions = new Map<string, ManagedSession>();
  private persistencePath: string;

  constructor(persistencePath?: string) {
    this.persistencePath = persistencePath ?? PERSISTENCE_FILE;
  }

  /**
   * Create and register a new session.
   */
  create(opts: CreateSessionOptions): ManagedSession {
    const id = randomUUID();
    const session: ManagedSession = {
      id,
      name: opts.name,
      tmuxSession: opts.tmuxSession,
      tmuxPane: opts.tmuxPane ?? `${opts.tmuxSession}:0.0`,
      projectPath: opts.projectPath,
      mode: opts.mode ?? "swarm",
      status: "idle",
      workspaceType: opts.workspaceType ?? "primary",
      connectedClients: new Set(),
      outputBuffer: [],
      pipeActive: false,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

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
   * Persist sessions to disk.
   */
  async save(): Promise<void> {
    const serialized: SerializedSession[] = this.getAll().map((s) => ({
      id: s.id,
      name: s.name,
      tmuxSession: s.tmuxSession,
      tmuxPane: s.tmuxPane,
      projectPath: s.projectPath,
      mode: s.mode,
      status: s.status,
      workspaceType: s.workspaceType,
      pipeActive: s.pipeActive,
      createdAt: s.createdAt.toISOString(),
      lastActivity: s.lastActivity.toISOString(),
    }));

    const dir = join(this.persistencePath, "..");
    await mkdir(dir, { recursive: true });
    await writeFile(this.persistencePath, JSON.stringify(serialized, null, 2));
    logInfo("Sessions persisted", { count: serialized.length });
  }

  /**
   * Load sessions from disk.
   */
  async load(): Promise<number> {
    try {
      const raw = await readFile(this.persistencePath, "utf-8");
      const data = JSON.parse(raw) as SerializedSession[];

      for (const entry of data) {
        const session: ManagedSession = {
          id: entry.id,
          name: entry.name,
          tmuxSession: entry.tmuxSession,
          tmuxPane: entry.tmuxPane,
          projectPath: entry.projectPath,
          mode: entry.mode,
          status: "offline", // start as offline until we verify tmux
          workspaceType: entry.workspaceType,
          connectedClients: new Set(),
          outputBuffer: [],
          pipeActive: false,
          createdAt: new Date(entry.createdAt),
          lastActivity: new Date(entry.lastActivity),
        };
        this.sessions.set(session.id, session);
      }

      logInfo("Sessions loaded from disk", { count: data.length });
      return data.length;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        logInfo("No sessions file found, starting fresh");
        return 0;
      }
      logWarn("Failed to load sessions", { error: String(err) });
      return 0;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SessionRegistry | null = null;

export function getSessionRegistry(): SessionRegistry {
  if (!instance) {
    instance = new SessionRegistry();
  }
  return instance;
}

export function resetSessionRegistry(): void {
  instance = null;
}
