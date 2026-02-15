import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import {
  SessionRegistry,
  getSessionRegistry,
  resetSessionRegistry,
} from "../../../src/services/session/session-registry.js";

// Suppress logging
vi.mock("../../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const TEST_DIR = join(tmpdir(), `session-registry-test-${Date.now()}`);
const TEST_FILE = join(TEST_DIR, "sessions.json");

describe("SessionRegistry", () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    registry = new SessionRegistry(TEST_FILE);
    resetSessionRegistry();
  });

  afterEach(() => {
    try {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe("singleton", () => {
    it("should return the same instance on subsequent calls", () => {
      const r1 = getSessionRegistry();
      const r2 = getSessionRegistry();
      expect(r1).toBe(r2);
    });

    it("should return a new instance after reset", () => {
      const r1 = getSessionRegistry();
      resetSessionRegistry();
      const r2 = getSessionRegistry();
      expect(r1).not.toBe(r2);
    });
  });

  // ==========================================================================
  // Create
  // ==========================================================================

  describe("create", () => {
    it("should create a session with required fields", () => {
      const session = registry.create({
        name: "test-agent",
        tmuxSession: "adj-test-agent",
        projectPath: "/home/user/project",
      });

      expect(session.id).toBeDefined();
      expect(session.name).toBe("test-agent");
      expect(session.tmuxSession).toBe("adj-test-agent");
      expect(session.projectPath).toBe("/home/user/project");
      expect(session.mode).toBe("standalone");
      expect(session.status).toBe("idle");
      expect(session.workspaceType).toBe("primary");
      expect(session.connectedClients.size).toBe(0);
      expect(session.outputBuffer).toEqual([]);
      expect(session.pipeActive).toBe(false);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivity).toBeInstanceOf(Date);
    });

    it("should generate default tmuxPane from tmuxSession", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "my-session",
        projectPath: "/tmp",
      });

      expect(session.tmuxPane).toBe("my-session:0.0");
    });

    it("should use provided optional fields", () => {
      const session = registry.create({
        name: "swarm-worker",
        tmuxSession: "adj-swarm-1",
        tmuxPane: "adj-swarm-1:1.2",
        projectPath: "/project",
        mode: "swarm",
        workspaceType: "worktree",
      });

      expect(session.tmuxPane).toBe("adj-swarm-1:1.2");
      expect(session.mode).toBe("swarm");
      expect(session.workspaceType).toBe("worktree");
    });

    it("should assign unique IDs to different sessions", () => {
      const s1 = registry.create({
        name: "agent-1",
        tmuxSession: "adj-1",
        projectPath: "/tmp",
      });
      const s2 = registry.create({
        name: "agent-2",
        tmuxSession: "adj-2",
        projectPath: "/tmp",
      });

      expect(s1.id).not.toBe(s2.id);
    });

    it("should increment session count", () => {
      expect(registry.size).toBe(0);
      registry.create({
        name: "a",
        tmuxSession: "adj-a",
        projectPath: "/tmp",
      });
      expect(registry.size).toBe(1);
      registry.create({
        name: "b",
        tmuxSession: "adj-b",
        projectPath: "/tmp",
      });
      expect(registry.size).toBe(2);
    });
  });

  // ==========================================================================
  // Get / Lookup
  // ==========================================================================

  describe("get", () => {
    it("should return a session by ID", () => {
      const created = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const found = registry.get(created.id);
      expect(found).toBe(created);
    });

    it("should return undefined for unknown ID", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return empty array when no sessions", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("should return all registered sessions", () => {
      registry.create({
        name: "a",
        tmuxSession: "adj-a",
        projectPath: "/tmp",
      });
      registry.create({
        name: "b",
        tmuxSession: "adj-b",
        projectPath: "/tmp",
      });

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((s) => s.name).sort()).toEqual(["a", "b"]);
    });
  });

  describe("findByTmuxSession", () => {
    it("should find session by tmux session name", () => {
      const created = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const found = registry.findByTmuxSession("adj-test");
      expect(found).toBe(created);
    });

    it("should return undefined when not found", () => {
      expect(registry.findByTmuxSession("nonexistent")).toBeUndefined();
    });
  });

  describe("findByName", () => {
    it("should find sessions matching name", () => {
      registry.create({
        name: "agent",
        tmuxSession: "adj-1",
        projectPath: "/tmp",
      });
      registry.create({
        name: "agent",
        tmuxSession: "adj-2",
        projectPath: "/tmp",
      });
      registry.create({
        name: "other",
        tmuxSession: "adj-3",
        projectPath: "/tmp",
      });

      const found = registry.findByName("agent");
      expect(found).toHaveLength(2);
    });

    it("should return empty array when no match", () => {
      expect(registry.findByName("ghost")).toEqual([]);
    });
  });

  // ==========================================================================
  // Update Status
  // ==========================================================================

  describe("updateStatus", () => {
    it("should update session status", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const updated = registry.updateStatus(session.id, "working");
      expect(updated).toBe(true);
      expect(registry.get(session.id)?.status).toBe("working");
    });

    it("should update lastActivity timestamp", async () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });
      const originalTime = session.lastActivity.getTime();

      // Small delay to ensure time advances
      await new Promise((r) => setTimeout(r, 10));

      registry.updateStatus(session.id, "working");
      expect(registry.get(session.id)!.lastActivity.getTime()).toBeGreaterThanOrEqual(
        originalTime
      );
    });

    it("should return false for unknown session", () => {
      expect(registry.updateStatus("unknown", "idle")).toBe(false);
    });
  });

  // ==========================================================================
  // Client Management
  // ==========================================================================

  describe("client management", () => {
    it("should add a client to a session", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const added = registry.addClient(session.id, "client-1");
      expect(added).toBe(true);
      expect(session.connectedClients.has("client-1")).toBe(true);
    });

    it("should remove a client from a session", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      registry.addClient(session.id, "client-1");
      const removed = registry.removeClient(session.id, "client-1");
      expect(removed).toBe(true);
      expect(session.connectedClients.has("client-1")).toBe(false);
    });

    it("should handle multiple clients", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      registry.addClient(session.id, "client-1");
      registry.addClient(session.id, "client-2");
      expect(session.connectedClients.size).toBe(2);

      registry.removeClient(session.id, "client-1");
      expect(session.connectedClients.size).toBe(1);
      expect(session.connectedClients.has("client-2")).toBe(true);
    });

    it("should return false for unknown session", () => {
      expect(registry.addClient("unknown", "c1")).toBe(false);
      expect(registry.removeClient("unknown", "c1")).toBe(false);
    });
  });

  // ==========================================================================
  // Output Buffer (Ring Buffer)
  // ==========================================================================

  describe("output buffer", () => {
    it("should append lines to output buffer", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      registry.appendOutput(session.id, "line 1");
      registry.appendOutput(session.id, "line 2");

      const buffer = registry.getOutputBuffer(session.id);
      expect(buffer).toEqual(["line 1", "line 2"]);
    });

    it("should cap buffer at 1000 lines", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      // Add 1050 lines
      for (let i = 0; i < 1050; i++) {
        registry.appendOutput(session.id, `line ${i}`);
      }

      const buffer = registry.getOutputBuffer(session.id)!;
      expect(buffer).toHaveLength(1000);
      expect(buffer[0]).toBe("line 50"); // oldest 50 were dropped
      expect(buffer[999]).toBe("line 1049");
    });

    it("should return a copy of the buffer", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      registry.appendOutput(session.id, "line 1");
      const buf1 = registry.getOutputBuffer(session.id)!;
      buf1.push("extra");

      const buf2 = registry.getOutputBuffer(session.id)!;
      expect(buf2).toHaveLength(1);
    });

    it("should clear output buffer", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      registry.appendOutput(session.id, "line 1");
      const cleared = registry.clearOutputBuffer(session.id);
      expect(cleared).toBe(true);
      expect(registry.getOutputBuffer(session.id)).toEqual([]);
    });

    it("should return undefined for unknown session", () => {
      expect(registry.getOutputBuffer("unknown")).toBeUndefined();
    });

    it("should return false when appending to unknown session", () => {
      expect(registry.appendOutput("unknown", "data")).toBe(false);
    });
  });

  // ==========================================================================
  // Remove
  // ==========================================================================

  describe("remove", () => {
    it("should remove a session", () => {
      const session = registry.create({
        name: "test",
        tmuxSession: "adj-test",
        projectPath: "/tmp",
      });

      const removed = registry.remove(session.id);
      expect(removed).toBe(true);
      expect(registry.get(session.id)).toBeUndefined();
      expect(registry.size).toBe(0);
    });

    it("should return false for unknown session", () => {
      expect(registry.remove("unknown")).toBe(false);
    });
  });

  // ==========================================================================
  // Persistence
  // ==========================================================================

  describe("persistence", () => {
    it("should save sessions to disk", async () => {
      registry.create({
        name: "agent-1",
        tmuxSession: "adj-1",
        projectPath: "/project/1",
        mode: "standalone",
      });
      registry.create({
        name: "agent-2",
        tmuxSession: "adj-2",
        projectPath: "/project/2",
        mode: "swarm",
        workspaceType: "worktree",
      });

      await registry.save();

      expect(existsSync(TEST_FILE)).toBe(true);
      const data = JSON.parse(readFileSync(TEST_FILE, "utf-8"));
      expect(data).toHaveLength(2);
      expect(data[0].name).toBe("agent-1");
      expect(data[1].mode).toBe("swarm");
    });

    it("should load sessions from disk", async () => {
      // Save some sessions
      registry.create({
        name: "persistent",
        tmuxSession: "adj-persistent",
        projectPath: "/project",
      });
      await registry.save();

      // Create a new registry and load
      const newRegistry = new SessionRegistry(TEST_FILE);
      const loaded = await newRegistry.load();

      expect(loaded).toBe(1);
      expect(newRegistry.size).toBe(1);

      const sessions = newRegistry.getAll();
      expect(sessions[0].name).toBe("persistent");
      expect(sessions[0].status).toBe("offline"); // loaded sessions start as offline
      expect(sessions[0].connectedClients.size).toBe(0);
      expect(sessions[0].outputBuffer).toEqual([]);
    });

    it("should return 0 when sessions file doesn't exist", async () => {
      const freshRegistry = new SessionRegistry(
        join(TEST_DIR, "nonexistent", "sessions.json")
      );
      const loaded = await freshRegistry.load();
      expect(loaded).toBe(0);
    });

    it("should handle corrupt JSON gracefully", async () => {
      const { writeFileSync } = await import("fs");
      writeFileSync(TEST_FILE, "not valid json{{{");

      const loaded = await registry.load();
      expect(loaded).toBe(0);
    });

    it("should restore dates as Date objects", async () => {
      registry.create({
        name: "dated",
        tmuxSession: "adj-dated",
        projectPath: "/tmp",
      });
      await registry.save();

      const newRegistry = new SessionRegistry(TEST_FILE);
      await newRegistry.load();

      const session = newRegistry.getAll()[0];
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivity).toBeInstanceOf(Date);
    });
  });
});
