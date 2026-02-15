/**
 * SessionRegistry — in-memory session tracking with file persistence.
 *
 * Maintains the set of all known managed sessions. Persists to
 * ~/.adjutant/sessions.json so sessions survive backend restarts.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import type {
  ManagedSession,
  SessionFile,
  SessionMode,
  WorkspaceType,
} from "../../types/session.js";
import { logInfo, logWarn } from "../../utils/index.js";

// ============================================================================
// Constants
// ============================================================================

const ADJUTANT_DIR = join(homedir(), ".adjutant");
const SESSIONS_FILE = join(ADJUTANT_DIR, "sessions.json");
const SAVE_DEBOUNCE_MS = 2000;

// ============================================================================
// State
// ============================================================================

const sessions = new Map<string, ManagedSession>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Ring Buffer
// ============================================================================

export class RingBuffer {
  private lines: string[] = [];
  private maxLines: number;

  constructor(maxLines = 1000) {
    this.maxLines = maxLines;
  }

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines);
    }
  }

  getAll(): string[] {
    return [...this.lines];
  }

  clear(): void {
    this.lines = [];
  }

  get size(): number {
    return this.lines.length;
  }
}

// Per-session output buffers (not persisted)
const outputBuffers = new Map<string, RingBuffer>();

// ============================================================================
// Registry Operations
// ============================================================================

export interface CreateSessionOptions {
  name: string;
  tmuxSession: string;
  tmuxPane?: string;
  projectPath: string;
  mode: SessionMode;
  workspaceType?: WorkspaceType | undefined;
}

export function createSession(opts: CreateSessionOptions): ManagedSession {
  const id = randomUUID();
  const now = new Date().toISOString();
  const session: ManagedSession = {
    id,
    name: opts.name,
    tmuxSession: opts.tmuxSession,
    tmuxPane: opts.tmuxPane ?? `${opts.tmuxSession}:0.0`,
    projectPath: opts.projectPath,
    mode: opts.mode,
    status: "idle",
    workspaceType: opts.workspaceType ?? "primary",
    connectedClients: [],
    pipeActive: false,
    createdAt: now,
    lastActivity: now,
  };
  sessions.set(id, session);
  outputBuffers.set(id, new RingBuffer());
  scheduleSave();
  logInfo("session created", { id, name: session.name, tmux: session.tmuxSession });
  return session;
}

export function getSession(id: string): ManagedSession | undefined {
  return sessions.get(id);
}

export function getSessionByTmux(tmuxSession: string): ManagedSession | undefined {
  for (const session of sessions.values()) {
    if (session.tmuxSession === tmuxSession) return session;
  }
  return undefined;
}

export function getAllSessions(): ManagedSession[] {
  return [...sessions.values()];
}

export function updateSession(id: string, updates: Partial<ManagedSession>): ManagedSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  Object.assign(session, updates, { lastActivity: new Date().toISOString() });
  scheduleSave();
  return session;
}

export function removeSession(id: string): boolean {
  const removed = sessions.delete(id);
  if (removed) {
    outputBuffers.delete(id);
    scheduleSave();
    logInfo("session removed", { id });
  }
  return removed;
}

export function addClient(sessionId: string, clientId: string): void {
  const session = sessions.get(sessionId);
  if (session && !session.connectedClients.includes(clientId)) {
    session.connectedClients.push(clientId);
    scheduleSave();
  }
}

export function removeClient(sessionId: string, clientId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.connectedClients = session.connectedClients.filter((c) => c !== clientId);
    scheduleSave();
  }
}

export function removeClientFromAll(clientId: string): string[] {
  const affected: string[] = [];
  for (const session of sessions.values()) {
    const idx = session.connectedClients.indexOf(clientId);
    if (idx !== -1) {
      session.connectedClients.splice(idx, 1);
      affected.push(session.id);
    }
  }
  if (affected.length > 0) scheduleSave();
  return affected;
}

// ============================================================================
// Output Buffer Access
// ============================================================================

export function getOutputBuffer(sessionId: string): RingBuffer | undefined {
  return outputBuffers.get(sessionId);
}

export function pushOutput(sessionId: string, data: string): void {
  let buf = outputBuffers.get(sessionId);
  if (!buf) {
    buf = new RingBuffer();
    outputBuffers.set(sessionId, buf);
  }
  buf.push(data);
}

// ============================================================================
// Persistence
// ============================================================================

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveToDisk().catch((err) => {
      logWarn("failed to save sessions", { error: String(err) });
    });
  }, SAVE_DEBOUNCE_MS);
}

async function saveToDisk(): Promise<void> {
  const file: SessionFile = {
    sessions: getAllSessions(),
    savedAt: new Date().toISOString(),
  };
  await mkdir(ADJUTANT_DIR, { recursive: true });
  await writeFile(SESSIONS_FILE, JSON.stringify(file, null, 2));
}

export async function loadFromDisk(): Promise<void> {
  try {
    const raw = await readFile(SESSIONS_FILE, "utf-8");
    const file: SessionFile = JSON.parse(raw);
    sessions.clear();
    for (const s of file.sessions) {
      // Reset transient state on load
      s.connectedClients = [];
      s.pipeActive = false;
      s.status = "offline";
      sessions.set(s.id, s);
      outputBuffers.set(s.id, new RingBuffer());
    }
    logInfo("sessions loaded from disk", { count: sessions.size });
  } catch {
    logInfo("no sessions file found, starting fresh");
  }
}

export async function forceSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await saveToDisk();
}
