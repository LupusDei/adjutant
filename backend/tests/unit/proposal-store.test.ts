import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-proposal-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("proposal-store", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("insertProposal", () => {
    it("should store and return a proposal with generated UUID", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "test-agent",
        title: "Improve error handling",
        description: "Add structured error responses across all API routes.",
        type: "engineering",
        project: "adjutant",
      });

      expect(proposal.id).toBeTruthy();
      expect(proposal.author).toBe("test-agent");
      expect(proposal.title).toBe("Improve error handling");
      expect(proposal.description).toBe("Add structured error responses across all API routes.");
      expect(proposal.type).toBe("engineering");
      expect(proposal.project).toBe("adjutant");
      expect(proposal.status).toBe("pending");
      expect(proposal.createdAt).toBeTruthy();
      expect(proposal.updatedAt).toBeTruthy();
    });

    it("should create proposals with unique IDs", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const p1 = store.insertProposal({ author: "a", title: "T1", description: "D1", type: "product", project: "adjutant" });
      const p2 = store.insertProposal({ author: "b", title: "T2", description: "D2", type: "engineering", project: "other-project" });

      expect(p1.id).not.toBe(p2.id);
    });
  });

  describe("getProposal", () => {
    it("should return a proposal by ID", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const created = store.insertProposal({ author: "agent-1", title: "Test", description: "Desc", type: "product", project: "adjutant" });
      const fetched = store.getProposal(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.title).toBe("Test");
    });

    it("should return null for non-existent ID", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      expect(store.getProposal("non-existent")).toBeNull();
    });
  });

  describe("getProposals", () => {
    it("should return all proposals when no filters", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      store.insertProposal({ author: "a", title: "P1", description: "D1", type: "product", project: "adjutant" });
      store.insertProposal({ author: "b", title: "P2", description: "D2", type: "engineering", project: "other-project" });

      const all = store.getProposals();
      expect(all).toHaveLength(2);
    });

    it("should filter by status", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const p1 = store.insertProposal({ author: "a", title: "P1", description: "D1", type: "product", project: "adjutant" });
      store.insertProposal({ author: "b", title: "P2", description: "D2", type: "engineering", project: "adjutant" });
      store.updateProposalStatus(p1.id, "accepted");

      const pending = store.getProposals({ status: "pending" });
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe("P2");

      const accepted = store.getProposals({ status: "accepted" });
      expect(accepted).toHaveLength(1);
      expect(accepted[0].title).toBe("P1");
    });

    it("should filter by type", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      store.insertProposal({ author: "a", title: "P1", description: "D1", type: "product", project: "adjutant" });
      store.insertProposal({ author: "b", title: "P2", description: "D2", type: "engineering", project: "adjutant" });

      const products = store.getProposals({ type: "product" });
      expect(products).toHaveLength(1);
      expect(products[0].type).toBe("product");
    });

    it("should filter by project", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      store.insertProposal({ author: "a", title: "P1", description: "D1", type: "product", project: "adjutant" });
      store.insertProposal({ author: "b", title: "P2", description: "D2", type: "engineering", project: "other-project" });
      store.insertProposal({ author: "c", title: "P3", description: "D3", type: "product", project: "adjutant" });

      const adjutantProposals = store.getProposals({ project: "adjutant" });
      expect(adjutantProposals).toHaveLength(2);
      expect(adjutantProposals.every((p) => p.project === "adjutant")).toBe(true);

      const otherProposals = store.getProposals({ project: "other-project" });
      expect(otherProposals).toHaveLength(1);
      expect(otherProposals[0].project).toBe("other-project");
    });

    it("should store and return the project field correctly", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "agent-x",
        title: "Add caching",
        description: "Cache layer for API",
        type: "engineering",
        project: "other-project",
      });

      expect(proposal.project).toBe("other-project");

      const fetched = store.getProposal(proposal.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.project).toBe("other-project");
    });

    it("should return newest first", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      store.insertProposal({ author: "a", title: "First", description: "D1", type: "product", project: "adjutant" });
      store.insertProposal({ author: "b", title: "Second", description: "D2", type: "product", project: "adjutant" });

      const all = store.getProposals();
      expect(all[0].title).toBe("Second");
      expect(all[1].title).toBe("First");
    });
  });

  describe("updateProposalStatus", () => {
    it("should update status to accepted", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const p = store.insertProposal({ author: "a", title: "T", description: "D", type: "product", project: "adjutant" });
      const updated = store.updateProposalStatus(p.id, "accepted");

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("accepted");
    });

    it("should update status to dismissed", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const p = store.insertProposal({ author: "a", title: "T", description: "D", type: "engineering", project: "other-project" });
      const updated = store.updateProposalStatus(p.id, "dismissed");

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("dismissed");
    });

    it("should return null for non-existent ID", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      expect(store.updateProposalStatus("non-existent", "accepted")).toBeNull();
    });
  });
});
