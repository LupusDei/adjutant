import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { MemoryStore } from "../../../../src/services/adjutant/memory-store.js";
import type { AdjutantState } from "../../../../src/services/adjutant/state-store.js";
import type { CommunicationManager } from "../../../../src/services/adjutant/communication.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";

let testDir: string;
let db: Database.Database;
let memoryStore: MemoryStore;
let state: AdjutantState;
let comm: CommunicationManager;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-memcollect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

function createMockComm(): CommunicationManager {
  return {
    queueRoutine: vi.fn(),
    sendImportant: vi.fn().mockResolvedValue(undefined),
    escalate: vi.fn().mockResolvedValue(undefined),
    messageAgent: vi.fn().mockResolvedValue(undefined),
    flushRoutineQueue: vi.fn().mockReturnValue([]),
    getRoutineQueueLength: vi.fn().mockReturnValue(0),
  };
}

describe("MemoryCollector Behavior", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    const { createMemoryStore } = await import("../../../../src/services/adjutant/memory-store.js");
    const { createAdjutantState } = await import("../../../../src/services/adjutant/state-store.js");
    memoryStore = createMemoryStore(db);
    state = createAdjutantState(db);
    comm = createMockComm();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("structure", () => {
    it("should have correct name and triggers", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      expect(behavior.name).toBe("memory-collector");
      expect(behavior.triggers).toContain("bead:closed");
      expect(behavior.triggers).toContain("agent:status_changed");
    });
  });

  describe("shouldAct", () => {
    it("should return true for bead:closed events", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event: BehaviorEvent = {
        name: "bead:closed",
        data: { id: "adj-001", title: "test bead", closedAt: new Date().toISOString() },
        seq: 1,
      };
      expect(behavior.shouldAct(event, state)).toBe(true);
    });
  });
});
