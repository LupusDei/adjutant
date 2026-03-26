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

  describe("checkProposalCompletion", () => {
    it("should emit proposal:completed and update status when epic linked via proposal_epics is closed", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const { checkProposalCompletion } = await import("../../src/services/mcp-tools/beads.js");
      const { getEventBus } = await import("../../src/services/event-bus.js");

      const store = createProposalStore(db);
      const proposal = store.insertProposal({
        author: "test-agent",
        title: "Test Proposal",
        description: "Test proposal for lifecycle.",
        type: "engineering",
        project: "test-project-id",
      });

      insertProposalEpicLink(db, proposal.id, "adj-100", "test-project-id");

      const events: { proposalId: string; projectId: string; epicId?: string }[] = [];
      getEventBus().on("proposal:completed", (data) => {
        events.push(data);
      });

      checkProposalCompletion("adj-100", db, store);

      expect(events).toHaveLength(1);
      expect(events[0].proposalId).toBe(proposal.id);
      expect(events[0].projectId).toBe("test-project-id");
      expect(events[0].epicId).toBe("adj-100");

      // Verify proposal status was updated
      const updated = store.getProposal(proposal.id);
      expect(updated?.status).toBe("completed");
    });

    it("should NOT emit if the bead is not linked to any proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const { checkProposalCompletion } = await import("../../src/services/mcp-tools/beads.js");
      const { getEventBus } = await import("../../src/services/event-bus.js");

      const store = createProposalStore(db);

      const events: unknown[] = [];
      getEventBus().on("proposal:completed", (data) => {
        events.push(data);
      });

      checkProposalCompletion("adj-999", db, store);

      expect(events).toHaveLength(0);
    });

    it("should NOT emit if proposal is already completed", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const { checkProposalCompletion } = await import("../../src/services/mcp-tools/beads.js");
      const { getEventBus } = await import("../../src/services/event-bus.js");

      const store = createProposalStore(db);
      const proposal = store.insertProposal({
        author: "test-agent",
        title: "Already Done",
        description: "Already completed proposal.",
        type: "engineering",
        project: "test-project-id",
      });

      // Mark as completed first
      store.updateProposalStatus(proposal.id, "completed");

      insertProposalEpicLink(db, proposal.id, "adj-200", "test-project-id");

      const events: unknown[] = [];
      getEventBus().on("proposal:completed", (data) => {
        events.push(data);
      });

      checkProposalCompletion("adj-200", db, store);

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

  describe("checkAndCompleteProposal", () => {
    it("should NOT complete proposal when some linked beads are still open", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const { checkAndCompleteProposal } = await import("../../src/services/proposal-lifecycle.js");

      // Mock isBeadClosed via bd-client mock
      const bdClient = await import("../../src/services/bd-client.js");
      const execBdSpy = vi.spyOn(bdClient, "execBd");
      // First epic is closed, second is still open
      execBdSpy.mockResolvedValueOnce({
        success: true,
        data: { id: "adj-300", status: "closed" },
        raw: "",
      });
      execBdSpy.mockResolvedValueOnce({
        success: true,
        data: { id: "adj-301", status: "open" },
        raw: "",
      });

      const store = createProposalStore(db);
      const proposal = store.insertProposal({
        author: "test-agent",
        title: "Partially Done",
        description: "Some beads still open.",
        type: "engineering",
        project: "project-1",
      });

      insertProposalEpicLink(db, proposal.id, "adj-300", "project-1");
      insertProposalEpicLink(db, proposal.id, "adj-301", "project-1");

      const result = await checkAndCompleteProposal(db, store, proposal.id, "project-1");
      expect(result).toBe(false);

      const unchanged = store.getProposal(proposal.id);
      expect(unchanged?.status).toBe("pending");

      execBdSpy.mockRestore();
    });

    it("should complete proposal when ALL linked beads are closed", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const { checkAndCompleteProposal } = await import("../../src/services/proposal-lifecycle.js");
      const { getEventBus } = await import("../../src/services/event-bus.js");

      // Mock all epics as closed
      const bdClient = await import("../../src/services/bd-client.js");
      const execBdSpy = vi.spyOn(bdClient, "execBd");
      execBdSpy.mockResolvedValueOnce({
        success: true,
        data: { id: "adj-400", status: "closed" },
        raw: "",
      });
      execBdSpy.mockResolvedValueOnce({
        success: true,
        data: { id: "adj-401", status: "closed" },
        raw: "",
      });

      const store = createProposalStore(db);
      const proposal = store.insertProposal({
        author: "test-agent",
        title: "All Done",
        description: "All beads closed.",
        type: "engineering",
        project: "project-1",
      });

      insertProposalEpicLink(db, proposal.id, "adj-400", "project-1");
      insertProposalEpicLink(db, proposal.id, "adj-401", "project-1");

      const events: unknown[] = [];
      getEventBus().on("proposal:completed", (data) => {
        events.push(data);
      });

      const result = await checkAndCompleteProposal(db, store, proposal.id, "project-1");
      expect(result).toBe(true);

      const updated = store.getProposal(proposal.id);
      expect(updated?.status).toBe("completed");

      expect(events).toHaveLength(1);

      execBdSpy.mockRestore();
    });

    it("should update proposal status to completed", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const { checkAndCompleteProposal } = await import("../../src/services/proposal-lifecycle.js");

      // Mock single epic as closed
      const bdClient = await import("../../src/services/bd-client.js");
      const execBdSpy = vi.spyOn(bdClient, "execBd");
      execBdSpy.mockResolvedValueOnce({
        success: true,
        data: { id: "adj-500", status: "closed" },
        raw: "",
      });

      const store = createProposalStore(db);
      const proposal = store.insertProposal({
        author: "test-agent",
        title: "Single Epic Proposal",
        description: "One epic linked.",
        type: "engineering",
        project: "project-1",
      });

      insertProposalEpicLink(db, proposal.id, "adj-500", "project-1");

      await checkAndCompleteProposal(db, store, proposal.id, "project-1");

      const updated = store.getProposal(proposal.id);
      expect(updated?.status).toBe("completed");
      expect(updated?.updatedAt).toBeTruthy();

      execBdSpy.mockRestore();
    });
  });

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
