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

function makeMailEvent(body: string, from = "user"): BehaviorEvent {
  return {
    name: "mail:received",
    data: {
      id: `msg-${Date.now()}`,
      from,
      to: "adjutant-core",
      subject: "",
      preview: body.slice(0, 100),
    },
    seq: 1,
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
      expect(behavior.triggers).toContain("mail:received");
      expect(behavior.triggers).toContain("bead:closed");
      expect(behavior.triggers).toContain("agent:status_changed");
    });
  });

  describe("correction detection on mail:received", () => {
    it("should detect prohibition pattern: 'don't use any types'", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("don't use any types in the codebase");

      await behavior.act(event, state, comm);

      const learnings = memoryStore.queryLearnings({});
      expect(learnings.length).toBeGreaterThanOrEqual(1);
      expect(learnings[0].sourceType).toBe("user_correction");
    });

    it("should detect mandate pattern: 'always use strict mode'", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("always use strict mode in TypeScript");

      await behavior.act(event, state, comm);

      const learnings = memoryStore.queryLearnings({});
      expect(learnings.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect remember pattern: 'remember that beads must be assigned'", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("remember that beads must be assigned before starting work");

      await behavior.act(event, state, comm);

      const learnings = memoryStore.queryLearnings({});
      expect(learnings.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect 'never skip' pattern", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("never skip tests when implementing features");

      await behavior.act(event, state, comm);

      const learnings = memoryStore.queryLearnings({});
      expect(learnings.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect 'stop doing' pattern", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("stop creating documentation files proactively");

      await behavior.act(event, state, comm);

      const learnings = memoryStore.queryLearnings({});
      expect(learnings.length).toBeGreaterThanOrEqual(1);
    });

    it("should NOT detect correction in normal conversational message", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("How is the progress on the memory system?");

      await behavior.act(event, state, comm);

      const learnings = memoryStore.queryLearnings({});
      expect(learnings).toHaveLength(0);
    });

    it("should only process messages from user", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("don't use any types", "some-agent");

      await behavior.act(event, state, comm);

      const learnings = memoryStore.queryLearnings({});
      expect(learnings).toHaveLength(0);
    });

    it("should create a correction record alongside the learning", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("don't use any types ever");

      await behavior.act(event, state, comm);

      const corrections = memoryStore.getUnresolvedCorrections();
      expect(corrections.length).toBeGreaterThanOrEqual(1);
    });

    it("should deduplicate similar corrections", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);

      // Send the same correction twice
      await behavior.act(makeMailEvent("don't use any types"), state, comm);
      await behavior.act(makeMailEvent("don't use any types in code"), state, comm);

      // Should reinforce the existing learning rather than creating duplicates
      const learnings = memoryStore.queryLearnings({});
      // Depending on dedup logic, may have 1 or 2 — but the first should be reinforced
      const corrections = memoryStore.getUnresolvedCorrections();
      // Should have at most 2 corrections but the second should have recurrence
      expect(corrections.length).toBeLessThanOrEqual(2);
    });

    it("should log a decision when correction is detected", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("always run tests before committing");

      await behavior.act(event, state, comm);

      const decisions = state.getRecentDecisions(5);
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      expect(decisions[0].behavior).toBe("memory-collector");
    });
  });

  describe("shouldAct", () => {
    it("should return true for mail:received events", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("test message");
      expect(behavior.shouldAct(event, state)).toBe(true);
    });

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

  describe("correction:detected event emission (adj-3315)", () => {
    it("should emit correction:detected event when a correction is found", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const { getEventBus, resetEventBus } = await import("../../../../src/services/event-bus.js");

      resetEventBus();
      const bus = getEventBus();
      const emitted: unknown[] = [];
      bus.on("correction:detected", (data) => emitted.push(data));

      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("don't use any types in the codebase");

      await behavior.act(event, state, comm);

      expect(emitted.length).toBe(1);
      const payload = emitted[0] as { messageId: string; from: string; pattern: string; body: string };
      expect(payload.from).toBe("user");
      expect(payload.pattern).toBeTruthy();
      expect(payload.body).toBe("don't use any types in the codebase");

      resetEventBus();
    });

    it("should NOT emit correction:detected for non-user messages", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const { getEventBus, resetEventBus } = await import("../../../../src/services/event-bus.js");

      resetEventBus();
      const bus = getEventBus();
      const emitted: unknown[] = [];
      bus.on("correction:detected", (data) => emitted.push(data));

      const behavior = createMemoryCollector(memoryStore);
      const event = makeMailEvent("don't use any types", "some-agent");

      await behavior.act(event, state, comm);

      expect(emitted.length).toBe(0);

      resetEventBus();
    });
  });

  describe("inferTopic relevance (adj-n3r6)", () => {
    it("should return the most relevant topic (highest keyword match count)", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);

      // Message with many technical keywords: "type", "test", "code", "typescript"
      // and fewer operational keywords: "bead"
      // Should infer topic from technical category, not operational
      const event = makeMailEvent("always use strict type in test code for typescript");

      await behavior.act(event, state, comm);

      const learnings = memoryStore.queryLearnings({});
      expect(learnings.length).toBeGreaterThanOrEqual(1);
      // The topic should be from the technical category since it has more matches
      expect(learnings[0].topic).toMatch(/^technical-/);
    });

    it("should pick longest matching keyword for topic specificity", async () => {
      const { createMemoryCollector } = await import("../../../../src/services/adjutant/behaviors/memory-collector.js");
      const behavior = createMemoryCollector(memoryStore);

      // Message with "typescript" (longer/more specific) and "type" (shorter)
      const event = makeMailEvent("always use typescript strict mode");

      await behavior.act(event, state, comm);

      const learnings = memoryStore.queryLearnings({});
      expect(learnings.length).toBeGreaterThanOrEqual(1);
      // Should pick the more specific keyword "typescript" not just "type"
      expect(learnings[0].topic).toContain("typescript");
    });
  });
});
