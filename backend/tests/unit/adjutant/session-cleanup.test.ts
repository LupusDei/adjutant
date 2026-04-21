// Suppress logging
vi.mock("../../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock child_process
const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { StimulusEngine } from "../../../src/services/adjutant/stimulus-engine.js";
import { LifecycleManager } from "../../../src/services/lifecycle-manager.js";
import { SessionRegistry } from "../../../src/services/session-registry.js";
import type { EventName } from "../../../src/services/event-bus.js";

// ============================================================================
// Test helpers
// ============================================================================

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS managed_sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      tmux_session TEXT NOT NULL,
      tmux_pane TEXT NOT NULL,
      project_path TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'swarm',
      status TEXT NOT NULL DEFAULT 'idle',
      workspace_type TEXT NOT NULL DEFAULT 'primary',
      pipe_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_activity TEXT NOT NULL
    )
  `);
  return db;
}

/**
 * Register a session directly in the registry (bypassing tmux).
 * Returns the session ID.
 */
function registerTestSession(registry: SessionRegistry, name: string): string {
  const session = registry.create({
    name,
    tmuxSession: `adj-swarm-${name}`,
    tmuxPane: `adj-swarm-${name}:1.1`,
    projectPath: "/tmp/test",
    mode: "swarm",
  });
  registry.updateStatus(session.id, "working");
  return session.id;
}

// ============================================================================
// cancelWatchesByAgent tests
// ============================================================================

describe("StimulusEngine.cancelWatchesByAgent", () => {
  let engine: StimulusEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new StimulusEngine();
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
  });

  it("should cancel all watches registered by the specified agent", () => {
    // Register watches with callerAgent
    const id1 = engine.registerWatch("agent:status_changed" as EventName, undefined, undefined, "watch 1", "duke");
    const id2 = engine.registerWatch("bead:updated" as EventName, undefined, undefined, "watch 2", "duke");

    const cancelled = engine.cancelWatchesByAgent("duke");

    expect(cancelled).toBe(2);
    // Verify watches are gone by checking pending schedule
    const pending = engine.getPendingSchedule();
    expect(pending.watches).toHaveLength(0);
  });

  it("should NOT cancel watches registered by other agents", () => {
    // Register watches for different agents
    engine.registerWatch("agent:status_changed" as EventName, undefined, undefined, "duke watch", "duke");
    engine.registerWatch("bead:updated" as EventName, undefined, undefined, "nova watch", "nova");
    engine.registerWatch("build:failed" as EventName, undefined, undefined, "duke watch 2", "duke");

    const cancelled = engine.cancelWatchesByAgent("duke");

    expect(cancelled).toBe(2);
    const pending = engine.getPendingSchedule();
    expect(pending.watches).toHaveLength(1);
    expect(pending.watches[0]!.reason).toBe("nova watch");
  });

  it("should return 0 when the agent has no watches", () => {
    // Register watches for a different agent
    engine.registerWatch("agent:status_changed" as EventName, undefined, undefined, "nova watch", "nova");

    const cancelled = engine.cancelWatchesByAgent("duke");

    expect(cancelled).toBe(0);
    // nova's watch should still be there
    const pending = engine.getPendingSchedule();
    expect(pending.watches).toHaveLength(1);
  });

  it("should clear timeout timers for cancelled watches", () => {
    // Register a watch with a timeout
    engine.registerWatch("agent:status_changed" as EventName, undefined, 60_000, "timed watch", "duke");

    const cancelled = engine.cancelWatchesByAgent("duke");
    expect(cancelled).toBe(1);

    // Advance past the timeout — should NOT fire a wake
    const wakeSpy = vi.fn();
    engine.onWake(wakeSpy);
    vi.advanceTimersByTime(120_000);
    expect(wakeSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// killSession cleanup integration tests
// ============================================================================

describe("LifecycleManager.killSession — schedule/watch cleanup", () => {
  let testDb: Database.Database;
  let registry: SessionRegistry;
  let lifecycle: LifecycleManager;
  let mockCronStore: { disableByAgent: ReturnType<typeof vi.fn> };
  let mockStimulusEngine: { cancelWatchesByAgent: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestDb();
    registry = new SessionRegistry(testDb);

    // Default: all tmux commands succeed
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args[0] === "list-panes") {
          const tIdx = args.indexOf("-t");
          const sessionName = tIdx >= 0 ? args[tIdx + 1] : "test";
          cb(null, `${sessionName}:1.1\n`, "");
        } else {
          cb(null, "", "");
        }
      },
    );

    mockCronStore = { disableByAgent: vi.fn().mockReturnValue(3) };
    mockStimulusEngine = { cancelWatchesByAgent: vi.fn().mockReturnValue(2) };

    lifecycle = new LifecycleManager(registry, 5);
    lifecycle.setCronScheduleStore(mockCronStore as never);
    lifecycle.setStimulusEngine(mockStimulusEngine as never);
  });

  afterEach(() => {
    if (testDb) testDb.close();
  });

  it("should call disableByAgent with the session agent name on kill", () => {
    const sessionId = registerTestSession(registry, "duke");

    // killSession is async — await it
    return lifecycle.killSession(sessionId).then((result) => {
      expect(result).toBe(true);
      expect(mockCronStore.disableByAgent).toHaveBeenCalledWith("duke");
    });
  });

  it("should call cancelWatchesByAgent with the session agent name on kill", () => {
    const sessionId = registerTestSession(registry, "duke");

    return lifecycle.killSession(sessionId).then((result) => {
      expect(result).toBe(true);
      expect(mockStimulusEngine.cancelWatchesByAgent).toHaveBeenCalledWith("duke");
    });
  });

  it("should work correctly when cronScheduleStore and stimulusEngine are not wired", () => {
    // Create a lifecycle without the optional dependencies
    const bareLifecycle = new LifecycleManager(registry, 5);
    const sessionId = registerTestSession(registry, "nova");

    return bareLifecycle.killSession(sessionId).then((result) => {
      expect(result).toBe(true);
      // Should not throw — graceful when dependencies are absent
    });
  });
});
