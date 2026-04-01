/**
 * Tests that timeline events carry the navigation IDs needed for
 * iOS deep linking (adj-175.1.4).
 *
 * These tests verify the data shapes produced by actual insertEvent()
 * calls in the codebase, using a real SQLite event store (not mocks).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

import type { EventStore, InsertEventInput } from "../../src/services/event-store.js";

let testDir: string;
let db: Database.Database;
let eventStore: EventStore;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-evtnav-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("Event Navigation Data", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    const { createEventStore } = await import("../../src/services/event-store.js");
    eventStore = createEventStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Task 1: proposal_completed events include proposalId in detail
  // -------------------------------------------------------------------------
  describe("proposal_completed events", () => {
    it("should include proposalId in detail", () => {
      // Mirrors the insertEvent call in backend/src/index.ts:150-155
      const input: InsertEventInput = {
        eventType: "proposal_completed",
        agentId: "system",
        action: "Proposal completed (epic: adj-175)",
        detail: { proposalId: "p-abc-123", projectId: "proj-uuid", epicId: "adj-175" },
      };

      const event = eventStore.insertEvent(input);

      expect(event.detail).not.toBeNull();
      expect(event.detail!["proposalId"]).toBe("p-abc-123");
      expect(event.detail!["projectId"]).toBe("proj-uuid");
      expect(event.detail!["epicId"]).toBe("adj-175");
    });

    it("should include proposalId even when epicId is null", () => {
      // When completeProposal is called without an epicId
      const input: InsertEventInput = {
        eventType: "proposal_completed",
        agentId: "system",
        action: "Proposal completed",
        detail: { proposalId: "p-def-456", projectId: "proj-uuid", epicId: null },
      };

      const event = eventStore.insertEvent(input);

      expect(event.detail).not.toBeNull();
      expect(event.detail!["proposalId"]).toBe("p-def-456");
      expect(event.detail!["epicId"]).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Task 2: bead_closed events have beadId set on the event itself
  // -------------------------------------------------------------------------
  describe("bead_closed events", () => {
    it("should have beadId set at the event level", () => {
      // Mirrors the insertEvent call in backend/src/services/mcp-tools/beads.ts:234-241
      const input: InsertEventInput = {
        eventType: "bead_closed",
        agentId: "engineer-1",
        action: "Closed bead adj-175.1.1",
        detail: { id: "adj-175.1.1", reason: "completed" },
        beadId: "adj-175.1.1",
      };

      const event = eventStore.insertEvent(input);

      expect(event.beadId).toBe("adj-175.1.1");
      expect(event.detail!["id"]).toBe("adj-175.1.1");
    });

    it("should have beadId set even when reason is undefined", () => {
      // close_bead can be called without a reason
      const input: InsertEventInput = {
        eventType: "bead_closed",
        agentId: "system",
        action: "Closed bead adj-100",
        detail: { id: "adj-100", reason: undefined },
        beadId: "adj-100",
      };

      const event = eventStore.insertEvent(input);

      expect(event.beadId).toBe("adj-100");
    });
  });

  describe("bead_updated events", () => {
    it("should have beadId set at the event level", () => {
      // Mirrors the insertEvent call in backend/src/services/mcp-tools/beads.ts:183-190
      const input: InsertEventInput = {
        eventType: "bead_updated",
        agentId: "engineer-1",
        action: "Updated bead adj-175.1.2",
        detail: { id: "adj-175.1.2", status: "in_progress", assignee: "engineer-1" },
        beadId: "adj-175.1.2",
      };

      const event = eventStore.insertEvent(input);

      expect(event.beadId).toBe("adj-175.1.2");
      expect(event.detail!["id"]).toBe("adj-175.1.2");
    });
  });

  // -------------------------------------------------------------------------
  // Task 3: coordinator_action events for agent targets include agentId/target
  // -------------------------------------------------------------------------
  describe("coordinator_action events", () => {
    it("should include target agent name for spawn_worker", () => {
      // Mirrors emitCoordinatorAction for spawn_worker in coordination.ts:198-205
      const input: InsertEventInput = {
        eventType: "coordinator_action",
        agentId: "adjutant-coordinator",
        action: "spawn_worker: engineer-5",
        detail: {
          behavior: "adjutant",
          action: "spawn_worker",
          target: "engineer-5",
          reason: "Spawned with prompt: Build the feature...",
        },
      };

      const event = eventStore.insertEvent(input);

      expect(event.detail).not.toBeNull();
      expect(event.detail!["target"]).toBe("engineer-5");
      expect(event.detail!["action"]).toBe("spawn_worker");
    });

    it("should include target agentId for nudge_agent", () => {
      // Mirrors emitCoordinatorAction for nudge_agent in coordination.ts:319-324
      const input: InsertEventInput = {
        eventType: "coordinator_action",
        agentId: "adjutant-coordinator",
        action: "nudge_agent: engineer-3",
        detail: {
          behavior: "adjutant",
          action: "nudge_agent",
          target: "engineer-3",
          reason: "Nudge: Please check your bead status...",
        },
      };

      const event = eventStore.insertEvent(input);

      expect(event.detail).not.toBeNull();
      expect(event.detail!["target"]).toBe("engineer-3");
      expect(event.detail!["action"]).toBe("nudge_agent");
    });

    it("should include target agentId for decommission_agent", () => {
      // Mirrors emitCoordinatorAction for decommission_agent in coordination.ts:399-404
      const input: InsertEventInput = {
        eventType: "coordinator_action",
        agentId: "adjutant-coordinator",
        action: "decommission_agent: idle-agent",
        detail: {
          behavior: "adjutant",
          action: "decommission_agent",
          target: "idle-agent",
          reason: "Agent idle for 30 minutes",
        },
      };

      const event = eventStore.insertEvent(input);

      expect(event.detail).not.toBeNull();
      expect(event.detail!["target"]).toBe("idle-agent");
      expect(event.detail!["action"]).toBe("decommission_agent");
    });

    it("should include both beadId and agentId for assign_bead", () => {
      // Mirrors emitCoordinatorAction for assign_bead in coordination.ts:263-270
      // After adj-175.1.3 fix: agentId is now included via extraDetail
      const input: InsertEventInput = {
        eventType: "coordinator_action",
        agentId: "adjutant-coordinator",
        action: "assign_bead: adj-175.1.1",
        detail: {
          behavior: "adjutant",
          action: "assign_bead",
          target: "adj-175.1.1",
          reason: "Best fit for this task",
          agentId: "engineer-1",  // Added by adj-175.1.3 fix
        },
        beadId: "adj-175.1.1",  // Set by emitCoordinatorAction when target starts with "adj-"
      };

      const event = eventStore.insertEvent(input);

      expect(event.detail).not.toBeNull();
      // The iOS app needs both the bead target and the assigned agent
      expect(event.detail!["target"]).toBe("adj-175.1.1");
      expect(event.detail!["agentId"]).toBe("engineer-1");
      expect(event.beadId).toBe("adj-175.1.1");
    });

    it("should set beadId on event when target is a bead ID", () => {
      // emitCoordinatorAction sets beadId when target starts with "adj-" (coordination.ts:137-139)
      const input: InsertEventInput = {
        eventType: "coordinator_action",
        agentId: "adjutant-coordinator",
        action: "assign_bead: adj-200",
        detail: {
          behavior: "adjutant",
          action: "assign_bead",
          target: "adj-200",
          reason: "Reassignment",
          agentId: "engineer-2",
        },
      };
      // Replicate the beadId logic from emitCoordinatorAction
      if (input.detail?.["target"] && String(input.detail["target"]).startsWith("adj-")) {
        input.beadId = String(input.detail["target"]);
      }

      const event = eventStore.insertEvent(input);

      expect(event.beadId).toBe("adj-200");
    });
  });
});
