import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SessionBridge,
  getSessionBridge,
  resetSessionBridge,
} from "../../src/services/session-bridge.js";
import { resetSessionRegistry } from "../../src/services/session-registry.js";

// Suppress logging
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock event bus
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() }),
}));

// Mock child_process (used by connector, input-router, lifecycle)
const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Mock fs (used by connector and registry)
vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue({ code: "ENOENT" }),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe("SessionBridge", () => {
  let bridge: SessionBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionBridge();
    resetSessionRegistry();

    bridge = new SessionBridge({
      persistencePath: "/tmp/test-sessions.json",
      pipeDir: "/tmp/adjutant-test",
      maxSessions: 5,
    });

    // Default: tmux commands succeed
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        cb(null, "", "");
      }
    );
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe("singleton", () => {
    it("should return the same instance", () => {
      resetSessionBridge();
      const b1 = getSessionBridge();
      const b2 = getSessionBridge();
      expect(b1).toBe(b2);
    });

    it("should return new instance after reset", () => {
      resetSessionBridge();
      const b1 = getSessionBridge();
      resetSessionBridge();
      const b2 = getSessionBridge();
      expect(b1).not.toBe(b2);
    });
  });

  // ==========================================================================
  // Init
  // ==========================================================================

  describe("init", () => {
    it("should initialize the bridge", async () => {
      expect(bridge.isInitialized).toBe(false);
      await bridge.init();
      expect(bridge.isInitialized).toBe(true);
    });

    it("should be idempotent", async () => {
      await bridge.init();
      await bridge.init(); // Should not throw
      expect(bridge.isInitialized).toBe(true);
    });
  });

  // ==========================================================================
  // List sessions
  // ==========================================================================

  describe("listSessions", () => {
    it("should return empty array when no sessions", () => {
      const sessions = bridge.listSessions();
      expect(sessions).toEqual([]);
    });

    it("should return serializable session info", () => {
      bridge.registry.create({
        name: "test-agent",
        tmuxSession: "adj-test",
        projectPath: "/project",
        mode: "swarm",
      });

      const sessions = bridge.listSessions();
      expect(sessions).toHaveLength(1);

      const info = sessions[0];
      expect(info.name).toBe("test-agent");
      expect(info.tmuxSession).toBe("adj-test");
      expect(info.projectPath).toBe("/project");
      expect(info.mode).toBe("swarm");
      expect(info.status).toBe("idle");
      expect(info.connectedClients).toEqual([]);
      expect(info.pipeActive).toBe(false);
      expect(typeof info.createdAt).toBe("string");
      expect(typeof info.lastActivity).toBe("string");
    });
  });

  // ==========================================================================
  // Get session
  // ==========================================================================

  describe("getSession", () => {
    it("should return session info by ID", () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const info = bridge.getSession(session.id);
      expect(info).toBeDefined();
      expect(info!.id).toBe(session.id);
      expect(info!.name).toBe("test");
    });

    it("should return undefined for unknown session", () => {
      expect(bridge.getSession("nonexistent")).toBeUndefined();
    });
  });

  // ==========================================================================
  // Connect client
  // ==========================================================================

  describe("connectClient", () => {
    it("should connect a client to a session", async () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const result = await bridge.connectClient(session.id, "client-1");
      expect(result.success).toBe(true);
      expect(session.connectedClients.has("client-1")).toBe(true);
    });

    it("should return buffer when replay is requested", async () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      bridge.registry.appendOutput(session.id, "previous output");

      const result = await bridge.connectClient(session.id, "client-1", true);
      expect(result.success).toBe(true);
      expect(result.buffer).toEqual(["previous output"]);
    });

    it("should clear buffer when replay is not requested", async () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      bridge.registry.appendOutput(session.id, "old output");

      const result = await bridge.connectClient(session.id, "client-1", false);
      expect(result.success).toBe(true);
      expect(result.buffer).toBeUndefined();
      expect(bridge.registry.getOutputBuffer(session.id)).toEqual([]);
    });

    it("should fail for unknown session", async () => {
      const result = await bridge.connectClient("unknown", "client-1");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Session not found");
    });

    it("should fail for offline session", async () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      bridge.registry.updateStatus(session.id, "offline");

      const result = await bridge.connectClient(session.id, "client-1");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Session is offline");
    });
  });

  // ==========================================================================
  // Disconnect client
  // ==========================================================================

  describe("disconnectClient", () => {
    it("should remove client from session", async () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      bridge.registry.addClient(session.id, "client-1");

      await bridge.disconnectClient(session.id, "client-1");
      expect(session.connectedClients.has("client-1")).toBe(false);
    });

    it("should handle disconnect from nonexistent session gracefully", async () => {
      // Should not throw
      await bridge.disconnectClient("unknown", "client-1");
    });
  });

  // ==========================================================================
  // Send input
  // ==========================================================================

  describe("sendInput", () => {
    it("should send input to session", async () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      bridge.registry.updateStatus(session.id, "idle");

      const sent = await bridge.sendInput(session.id, "fix the bug");
      expect(sent).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        ["send-keys", "-t", session.tmuxPane, "fix the bug", "Enter"],
        expect.anything(),
        expect.any(Function)
      );
    });

    it("should return false for unknown session", async () => {
      const sent = await bridge.sendInput("unknown", "hello");
      expect(sent).toBe(false);
    });
  });

  // ==========================================================================
  // Send interrupt
  // ==========================================================================

  describe("sendInterrupt", () => {
    it("should send Ctrl-C to session", async () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const sent = await bridge.sendInterrupt(session.id);
      expect(sent).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "tmux",
        ["send-keys", "-t", session.tmuxPane, "C-c"],
        expect.anything(),
        expect.any(Function)
      );
    });
  });

  // ==========================================================================
  // Permission response
  // ==========================================================================

  describe("sendPermissionResponse", () => {
    it("should send approved response", async () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const sent = await bridge.sendPermissionResponse(session.id, true);
      expect(sent).toBe(true);
    });

    it("should send denied response", async () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const sent = await bridge.sendPermissionResponse(session.id, false);
      expect(sent).toBe(true);
    });
  });

  // ==========================================================================
  // Update status
  // ==========================================================================

  describe("updateSessionStatus", () => {
    it("should update session status", () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const updated = bridge.updateSessionStatus(session.id, "working");
      expect(updated).toBe(true);
      expect(session.status).toBe("working");
    });

    it("should return false for unknown session", () => {
      expect(bridge.updateSessionStatus("unknown", "idle")).toBe(false);
    });
  });

  // ==========================================================================
  // Kill session
  // ==========================================================================

  describe("killSession", () => {
    it("should kill session and clean up", async () => {
      const session = bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const killed = await bridge.killSession(session.id);
      expect(killed).toBe(true);
      expect(bridge.registry.get(session.id)).toBeUndefined();
    });

    it("should return false for unknown session", async () => {
      const killed = await bridge.killSession("nonexistent");
      expect(killed).toBe(false);
    });
  });

  // ==========================================================================
  // Shutdown
  // ==========================================================================

  describe("shutdown", () => {
    it("should shut down cleanly", async () => {
      await bridge.init();

      bridge.registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      await bridge.shutdown();
      expect(bridge.isInitialized).toBe(false);
    });
  });
});
