/**
 * SessionBridge — main orchestrator for the Session Bridge system.
 *
 * Singleton that wires together SessionRegistry, SessionConnector,
 * InputRouter, and LifecycleManager. Provides the public API for
 * session management operations.
 */

import { basename } from "path";
import { logInfo, logWarn } from "../utils/index.js";
import { getEventBus } from "./event-bus.js";
import { getDeploymentMode } from "./workspace/index.js";
import {
  SessionRegistry,
  getSessionRegistry,
  resetSessionRegistry,
  type SessionStatus,
} from "./session-registry.js";
import { SessionConnector } from "./session-connector.js";
import { InputRouter } from "./input-router.js";
import { LifecycleManager, type CreateSessionRequest } from "./lifecycle-manager.js";

// ============================================================================
// Types
// ============================================================================

export interface SessionBridgeConfig {
  maxSessions?: number;
  pipeDir?: string;
  persistencePath?: string;
}

export interface SessionInfo {
  id: string;
  name: string;
  tmuxSession: string;
  tmuxPane: string;
  projectPath: string;
  mode: string;
  status: string;
  workspaceType: string;
  connectedClients: string[];
  pipeActive: boolean;
  createdAt: string;
  lastActivity: string;
}

// ============================================================================
// SessionBridge
// ============================================================================

export class SessionBridge {
  readonly registry: SessionRegistry;
  readonly connector: SessionConnector;
  readonly inputRouter: InputRouter;
  readonly lifecycle: LifecycleManager;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(config?: SessionBridgeConfig) {
    this.registry = config?.persistencePath
      ? new SessionRegistry(config.persistencePath)
      : getSessionRegistry();
    this.connector = new SessionConnector(this.registry, config?.pipeDir);
    this.inputRouter = new InputRouter(this.registry);
    this.lifecycle = new LifecycleManager(this.registry, config?.maxSessions);
  }

  /**
   * Initialize the bridge: load persisted sessions, verify tmux state.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<void> {

    const loaded = await this.registry.load();
    logInfo("SessionBridge initializing", { loadedSessions: loaded });

    // Verify which loaded sessions are still alive in tmux
    for (const session of this.registry.getAll()) {
      const alive = await this.lifecycle.isAlive(session.id);
      if (alive) {
        this.registry.updateStatus(session.id, "idle");
      }
      // sessions that aren't alive stay "offline" (set during load)
    }

    // Prune dead (offline) sessions so stale entries don't linger
    const deadIds = this.registry
      .getAll()
      .filter((s) => s.status === "offline")
      .map((s) => s.id);
    for (const id of deadIds) {
      this.registry.remove(id);
    }
    if (deadIds.length > 0) {
      logInfo("Pruned dead sessions", { count: deadIds.length, ids: deadIds });
    }
    // Always save after verification — persists auto-healed pane references
    await this.registry.save();

    // Auto-create a session if none are alive for the project root
    const projectRoot = process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd();
    const aliveSessions = this.registry.getAll().filter((s) => s.status !== "offline");
    const hasProjectSession = aliveSessions.some(
      (s) => s.projectPath === projectRoot
    );

    if (!hasProjectSession) {
      const sessionName = basename(projectRoot);
      logInfo("Auto-creating session for project root", { projectRoot, sessionName });
      const mode = getDeploymentMode();
      const result = await this.lifecycle.createSession({
        name: sessionName,
        projectPath: projectRoot,
        mode,
        workspaceType: "primary",
      });
      if (result.success) {
        await this.registry.save();
        logInfo("Auto-session created", { sessionId: result.sessionId });
      } else {
        logWarn("Auto-session creation failed", { error: result.error });
      }
    }

    // Set up output handler to broadcast via event bus
    this.connector.onOutput((sessionId, _line, events) => {
      getEventBus().emit("stream:status", {
        streamId: sessionId,
        agent: this.registry.get(sessionId)?.name ?? "unknown",
        state: "token",
      });
      // Emit parsed events for WS broadcast
      if (events.length > 0) {
        getEventBus().emit("stream:output", {
          streamId: sessionId,
          events,
        });
      }
    });

    this.initialized = true;
    logInfo("SessionBridge initialized");
  }

  /**
   * Create a new session.
   */
  async createSession(req: CreateSessionRequest) {
    const result = await this.lifecycle.createSession(req);
    if (result.success && result.sessionId) {
      await this.registry.save();
    }
    return result;
  }

  /**
   * Connect a WebSocket client to a session (start streaming output).
   */
  async connectClient(
    sessionId: string,
    clientId: string,
    replay = false
  ): Promise<{ success: boolean; buffer?: string[]; error?: string }> {
    // Wait for init to finish (handles race where WS connects before init completes)
    if (this.initPromise) {
      await this.initPromise;
    }

    const session = this.registry.get(sessionId);
    if (!session) {
      return { success: false, error: "Session not found" };
    }

    if (session.status === "offline") {
      return { success: false, error: "Session is offline" };
    }

    this.registry.addClient(sessionId, clientId);

    // Start pipe if not already attached
    if (!this.connector.isAttached(sessionId)) {
      let attached = await this.connector.attach(sessionId);
      if (!attached) {
        // Pipe failed — check if the tmux session is alive (isAlive auto-heals stale pane refs)
        const alive = await this.lifecycle.isAlive(sessionId);
        if (!alive) {
          this.registry.updateStatus(sessionId, "offline");
          this.registry.removeClient(sessionId, clientId);
          await this.registry.save();
          return { success: false, error: "Session is no longer available (tmux pane gone)" };
        }
        // isAlive auto-healed the pane reference — retry attach with corrected pane
        await this.registry.save();
        attached = await this.connector.attach(sessionId);
        if (!attached) {
          this.registry.removeClient(sessionId, clientId);
          return { success: false, error: "Failed to attach output pipe" };
        }
      }
    }

    let buffer: string[] | undefined;
    if (replay) {
      buffer = this.registry.getOutputBuffer(sessionId);
    } else {
      this.registry.clearOutputBuffer(sessionId);
    }

    return { success: true, ...(buffer ? { buffer } : {}) };
  }

  /**
   * Disconnect a WebSocket client from a session.
   */
  async disconnectClient(sessionId: string, clientId: string): Promise<void> {
    this.registry.removeClient(sessionId, clientId);

    const session = this.registry.get(sessionId);
    if (session && session.connectedClients.size === 0) {
      // No more clients — detach pipe to save resources
      await this.connector.detach(sessionId);
    }
  }

  /**
   * Send input to a session.
   */
  async sendInput(sessionId: string, text: string): Promise<boolean> {
    return this.inputRouter.sendInput(sessionId, text);
  }

  /**
   * Send interrupt (Ctrl-C) to a session.
   */
  async sendInterrupt(sessionId: string): Promise<boolean> {
    return this.inputRouter.sendInterrupt(sessionId);
  }

  /**
   * Send permission response to a session.
   */
  async sendPermissionResponse(
    sessionId: string,
    approved: boolean
  ): Promise<boolean> {
    return this.inputRouter.sendPermissionResponse(sessionId, approved);
  }

  /**
   * Kill a session and clean up.
   */
  async killSession(sessionId: string): Promise<boolean> {
    await this.connector.detach(sessionId);
    this.inputRouter.clearQueue(sessionId);
    const killed = await this.lifecycle.killSession(sessionId);
    if (killed) {
      await this.registry.save();
    }
    return killed;
  }

  /**
   * List all sessions as serializable info objects.
   */
  listSessions(): SessionInfo[] {
    return this.registry.getAll().map((s) => ({
      id: s.id,
      name: s.name,
      tmuxSession: s.tmuxSession,
      tmuxPane: s.tmuxPane,
      projectPath: s.projectPath,
      mode: s.mode,
      status: s.status,
      workspaceType: s.workspaceType,
      connectedClients: Array.from(s.connectedClients),
      pipeActive: s.pipeActive,
      createdAt: s.createdAt.toISOString(),
      lastActivity: s.lastActivity.toISOString(),
    }));
  }

  /**
   * Get a single session's info.
   */
  getSession(sessionId: string): SessionInfo | undefined {
    const s = this.registry.get(sessionId);
    if (!s) return undefined;
    return {
      id: s.id,
      name: s.name,
      tmuxSession: s.tmuxSession,
      tmuxPane: s.tmuxPane,
      projectPath: s.projectPath,
      mode: s.mode,
      status: s.status,
      workspaceType: s.workspaceType,
      connectedClients: Array.from(s.connectedClients),
      pipeActive: s.pipeActive,
      createdAt: s.createdAt.toISOString(),
      lastActivity: s.lastActivity.toISOString(),
    };
  }

  /**
   * Update a session's status.
   */
  updateSessionStatus(sessionId: string, status: SessionStatus): boolean {
    const updated = this.registry.updateStatus(sessionId, status);
    if (updated && status === "idle") {
      // Flush queued input when session becomes idle
      this.inputRouter.flushQueue(sessionId).catch(() => {});
    }
    return updated;
  }

  /**
   * Shut down the bridge: detach all pipes, persist sessions.
   */
  async shutdown(): Promise<void> {
    await this.connector.detachAll();
    this.inputRouter.clearAllQueues();
    await this.registry.save();
    this.initialized = false;
    logInfo("SessionBridge shut down");
  }

  /**
   * Whether the bridge has been initialized.
   */
  get isInitialized(): boolean {
    return this.initialized;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SessionBridge | null = null;

export function getSessionBridge(config?: SessionBridgeConfig): SessionBridge {
  if (!instance) {
    instance = new SessionBridge(config);
  }
  return instance;
}

export function resetSessionBridge(): void {
  instance = null;
  resetSessionRegistry();
}
