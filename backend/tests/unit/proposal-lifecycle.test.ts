import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-proposal-lifecycle-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

/**
 * Insert a proposal_epics link directly into the DB (simulating what auto-develop does).
 */
function insertProposalEpicLink(database: Database.Database, proposalId: string, epicId: string, projectId: string): void {
  database.prepare(
    "INSERT INTO proposal_epics (proposal_id, epic_id, project_id) VALUES (?, ?, ?)",
  ).run(proposalId, epicId, projectId);
}

describe("ProposalLifecycle", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    // Reset event bus between tests
    const { resetEventBus } = await import("../../src/services/event-bus.js");
    resetEventBus();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("completeProposal (coordinator-driven)", () => {
    it("should emit proposal:completed and update status", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const { completeProposal } = await import("../../src/services/proposal-lifecycle.js");
      const { getEventBus } = await import("../../src/services/event-bus.js");

      const store = createProposalStore(db);
      const proposal = store.insertProposal({
        author: "test-agent",
        title: "Test Proposal",
        description: "Test proposal for lifecycle.",
        type: "engineering",
        project: "test-project-id",
      });

      const events: { proposalId: string; projectId: string; epicId?: string }[] = [];
      getEventBus().on("proposal:completed", (data) => {
        events.push(data);
      });

      const result = completeProposal(store, proposal.id, "test-project-id", "adj-100");

      expect(result).toBe(true);
      expect(events).toHaveLength(1);
      expect(events[0].proposalId).toBe(proposal.id);
      expect(events[0].projectId).toBe("test-project-id");

      const updated = store.getProposal(proposal.id);
      expect(updated?.status).toBe("completed");
    });

    it("should return false for nonexistent proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const { completeProposal } = await import("../../src/services/proposal-lifecycle.js");

      const store = createProposalStore(db);
      const result = completeProposal(store, "nonexistent", "test-project-id");
      expect(result).toBe(false);
    });

    it("should return false if proposal is already completed", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const { completeProposal } = await import("../../src/services/proposal-lifecycle.js");
      const { getEventBus } = await import("../../src/services/event-bus.js");

      const store = createProposalStore(db);
      const proposal = store.insertProposal({
        author: "test-agent",
        title: "Already Done",
        description: "Already completed.",
        type: "engineering",
        project: "test-project-id",
      });

      store.updateProposalStatus(proposal.id, "completed");

      const events: unknown[] = [];
      getEventBus().on("proposal:completed", (data) => {
        events.push(data);
      });

      const result = completeProposal(store, proposal.id, "test-project-id");
      expect(result).toBe(false);
      expect(events).toHaveLength(0);
    });
  });

  describe("getProposalLinksForEpic", () => {
    it("should return proposal links for a given epic", async () => {
      const { getProposalLinksForEpic } = await import("../../src/services/proposal-lifecycle.js");

      insertProposalEpicLink(db, "proposal-1", "adj-100", "project-1");
      insertProposalEpicLink(db, "proposal-2", "adj-100", "project-1");

      const links = getProposalLinksForEpic(db, "adj-100");
      expect(links).toHaveLength(2);
      expect(links[0].proposalId).toBe("proposal-1");
      expect(links[1].proposalId).toBe("proposal-2");
    });

    it("should return empty array when no links exist", async () => {
      const { getProposalLinksForEpic } = await import("../../src/services/proposal-lifecycle.js");

      const links = getProposalLinksForEpic(db, "adj-nonexistent");
      expect(links).toHaveLength(0);
    });
  });

  describe("getEpicsForProposal", () => {
    it("should return all epic IDs linked to a proposal", async () => {
      const { getEpicsForProposal } = await import("../../src/services/proposal-lifecycle.js");

      insertProposalEpicLink(db, "proposal-1", "adj-100", "project-1");
      insertProposalEpicLink(db, "proposal-1", "adj-101", "project-1");

      const epicIds = getEpicsForProposal(db, "proposal-1");
      expect(epicIds).toHaveLength(2);
      expect(epicIds).toContain("adj-100");
      expect(epicIds).toContain("adj-101");
    });
  });

  // checkAndCompleteProposal was removed in adj-153 — proposal completion is now coordinator-driven

  describe("idle-proposal-nudge skips completed proposals", () => {
    it("should only query pending proposals (completed are excluded)", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");

      const store = createProposalStore(db);

      // Create one pending, one completed proposal
      const pending = store.insertProposal({
        author: "agent-1",
        title: "Pending Work",
        description: "Still to do.",
        type: "engineering",
        project: "project-1",
      });

      const completed = store.insertProposal({
        author: "agent-2",
        title: "Done Work",
        description: "Already finished.",
        type: "engineering",
        project: "project-1",
      });
      store.updateProposalStatus(completed.id, "completed");

      // The idle-proposal-nudge queries with status: "pending"
      const pendingProposals = store.getProposals({ status: "pending", project: "project-1" });
      expect(pendingProposals).toHaveLength(1);
      expect(pendingProposals[0].id).toBe(pending.id);

      // Verify completed proposal is not in the result
      const completedProposals = store.getProposals({ status: "completed", project: "project-1" });
      expect(completedProposals).toHaveLength(1);
      expect(completedProposals[0].id).toBe(completed.id);
    });
  });
});
