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

  // ===========================================================================
  // Migration: proposal_comments table (adj-068.1.1)
  // ===========================================================================
  describe("proposal_comments table (migration)", () => {
    it("should create proposal_comments table", () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='proposal_comments'")
        .all() as { name: string }[];
      expect(tables).toHaveLength(1);
    });

    it("should have correct columns on proposal_comments", () => {
      const columns = db.prepare("PRAGMA table_info(proposal_comments)").all() as { name: string }[];
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain("id");
      expect(colNames).toContain("proposal_id");
      expect(colNames).toContain("author");
      expect(colNames).toContain("body");
      expect(colNames).toContain("created_at");
    });

    it("should have index on proposal_comments(proposal_id, created_at)", () => {
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='proposal_comments'")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_proposal_comments_proposal");
    });
  });

  // ===========================================================================
  // Migration: proposal_revisions table (adj-068.1.1)
  // ===========================================================================
  describe("proposal_revisions table (migration)", () => {
    it("should create proposal_revisions table", () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='proposal_revisions'")
        .all() as { name: string }[];
      expect(tables).toHaveLength(1);
    });

    it("should have correct columns on proposal_revisions", () => {
      const columns = db.prepare("PRAGMA table_info(proposal_revisions)").all() as { name: string }[];
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain("id");
      expect(colNames).toContain("proposal_id");
      expect(colNames).toContain("revision_number");
      expect(colNames).toContain("author");
      expect(colNames).toContain("title");
      expect(colNames).toContain("description");
      expect(colNames).toContain("type");
      expect(colNames).toContain("changelog");
      expect(colNames).toContain("created_at");
    });

    it("should have index on proposal_revisions(proposal_id, revision_number)", () => {
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='proposal_revisions'")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_proposal_revisions_proposal");
    });
  });

  // ===========================================================================
  // Comment CRUD (adj-068.2.1)
  // ===========================================================================
  describe("insertComment", () => {
    it("should insert a comment and return it", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "raynor",
        title: "Test Proposal",
        description: "A test proposal",
        type: "engineering",
        project: "adjutant",
      });

      const comment = store.insertComment({
        proposalId: proposal.id,
        author: "kerrigan",
        body: "Looks good!",
      });

      expect(comment.id).toBeDefined();
      expect(comment.proposalId).toBe(proposal.id);
      expect(comment.author).toBe("kerrigan");
      expect(comment.body).toBe("Looks good!");
      expect(comment.createdAt).toBeDefined();
    });

    it("should throw when proposal_id references a non-existent proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      expect(() =>
        store.insertComment({
          proposalId: "non-existent-id",
          author: "kerrigan",
          body: "Comment on nothing",
        }),
      ).toThrow();
    });
  });

  describe("getComments", () => {
    it("should return comments for a proposal ordered by created_at ascending", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "raynor",
        title: "Test",
        description: "Desc",
        type: "engineering",
        project: "adjutant",
      });

      store.insertComment({ proposalId: proposal.id, author: "kerrigan", body: "First" });
      store.insertComment({ proposalId: proposal.id, author: "raynor", body: "Second" });

      const comments = store.getComments(proposal.id);
      expect(comments).toHaveLength(2);
      expect(comments[0]!.body).toBe("First");
      expect(comments[1]!.body).toBe("Second");
    });

    it("should return empty array for proposal with no comments", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "raynor",
        title: "Test",
        description: "Desc",
        type: "engineering",
        project: "adjutant",
      });

      const comments = store.getComments(proposal.id);
      expect(comments).toEqual([]);
    });

    it("should not return comments from other proposals", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const p1 = store.insertProposal({ author: "raynor", title: "P1", description: "D1", type: "engineering", project: "adjutant" });
      const p2 = store.insertProposal({ author: "raynor", title: "P2", description: "D2", type: "engineering", project: "adjutant" });

      store.insertComment({ proposalId: p1.id, author: "kerrigan", body: "On P1" });
      store.insertComment({ proposalId: p2.id, author: "kerrigan", body: "On P2" });

      const comments = store.getComments(p1.id);
      expect(comments).toHaveLength(1);
      expect(comments[0]!.body).toBe("On P1");
    });
  });

  // ===========================================================================
  // Revision CRUD (adj-068.2.2)
  // ===========================================================================
  describe("reviseProposal", () => {
    it("should snapshot the old proposal and update with new content", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "raynor",
        title: "Original Title",
        description: "Original Desc",
        type: "engineering",
        project: "adjutant",
      });

      const revised = store.reviseProposal(proposal.id, {
        author: "kerrigan",
        title: "Revised Title",
        changelog: "Changed the title",
      });

      expect(revised).not.toBeNull();
      expect(revised!.title).toBe("Revised Title");
      expect(revised!.description).toBe("Original Desc"); // unchanged field preserved

      // Verify revision was stored
      const revisions = store.getRevisions(proposal.id);
      expect(revisions).toHaveLength(1);
      expect(revisions[0]!.revisionNumber).toBe(1);
      expect(revisions[0]!.title).toBe("Original Title"); // old title
      expect(revisions[0]!.description).toBe("Original Desc"); // old desc
      expect(revisions[0]!.author).toBe("kerrigan");
      expect(revisions[0]!.changelog).toBe("Changed the title");
    });

    // adj-ovbhc — prove the single-statement UPDATE persists a LARGE description.
    // The observed "description silently dropped" could NOT originate here: this
    // confirms the store layer is innocent, localizing the drop to the transport/
    // client boundary (the in-process path round-trips a large description fine).
    it("should persist a large description in a single revise (store is innocent)", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "raynor",
        title: "T",
        description: "small",
        type: "engineering",
        project: "adjutant",
      });

      const bigDescription = "D".repeat(5000);
      const revised = store.reviseProposal(proposal.id, {
        author: "raynor",
        title: "T2",
        description: bigDescription,
        changelog: "large description revise",
      });

      expect(revised).not.toBeNull();
      expect(revised!.title).toBe("T2");
      expect(revised!.description).toBe(bigDescription); // fully persisted, not dropped
      // Re-read from disk to be certain it round-trips through SQLite.
      expect(store.getProposal(proposal.id)!.description).toBe(bigDescription);
    });

    it("should increment revision_number for successive revisions", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "raynor",
        title: "V1",
        description: "D1",
        type: "engineering",
        project: "adjutant",
      });

      store.reviseProposal(proposal.id, { author: "kerrigan", description: "D2", changelog: "Rev 1" });
      store.reviseProposal(proposal.id, { author: "kerrigan", title: "V3", changelog: "Rev 2" });

      const revisions = store.getRevisions(proposal.id);
      expect(revisions).toHaveLength(2);
      expect(revisions[0]!.revisionNumber).toBe(1);
      expect(revisions[1]!.revisionNumber).toBe(2);
    });

    it("should only update provided fields, keeping others unchanged", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "raynor",
        title: "Title",
        description: "Desc",
        type: "engineering",
        project: "adjutant",
      });

      const revised = store.reviseProposal(proposal.id, {
        author: "kerrigan",
        type: "product",
        changelog: "Changed type only",
      });

      expect(revised!.title).toBe("Title"); // unchanged
      expect(revised!.description).toBe("Desc"); // unchanged
      expect(revised!.type).toBe("product"); // changed
    });

    it("should return null for non-existent proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const result = store.reviseProposal("non-existent", {
        author: "kerrigan",
        title: "New",
        changelog: "Nope",
      });
      expect(result).toBeNull();
    });
  });

  describe("getRevisions", () => {
    it("should return revisions ordered by revision_number ascending", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "raynor",
        title: "V1",
        description: "D1",
        type: "engineering",
        project: "adjutant",
      });

      store.reviseProposal(proposal.id, { author: "kerrigan", title: "V2", changelog: "First rev" });
      store.reviseProposal(proposal.id, { author: "raynor", title: "V3", changelog: "Second rev" });

      const revisions = store.getRevisions(proposal.id);
      expect(revisions).toHaveLength(2);
      expect(revisions[0]!.revisionNumber).toBe(1);
      expect(revisions[0]!.title).toBe("V1");
      expect(revisions[1]!.revisionNumber).toBe(2);
      expect(revisions[1]!.title).toBe("V2"); // snapshot of what was current before the third revision
    });

    it("should return empty array for proposal with no revisions", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "raynor",
        title: "Test",
        description: "Desc",
        type: "engineering",
        project: "adjutant",
      });

      const revisions = store.getRevisions(proposal.id);
      expect(revisions).toEqual([]);
    });
  });

  // ===========================================================================
  // UNIQUE constraint on (proposal_id, revision_number) (adj-068.1.1.1)
  // ===========================================================================
  describe("proposal_revisions UNIQUE constraint", () => {
    it("should have unique index on (proposal_id, revision_number)", () => {
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='proposal_revisions'")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_proposal_revisions_unique");
    });

    it("should reject duplicate (proposal_id, revision_number) pairs", () => {
      // Insert a proposal directly
      db.prepare(
        "INSERT INTO proposals (id, author, title, description, type, project, status, created_at, updated_at) VALUES ('p1', 'a', 't', 'd', 'engineering', 'adj', 'pending', datetime('now'), datetime('now'))",
      ).run();
      // Insert first revision
      db.prepare(
        "INSERT INTO proposal_revisions (id, proposal_id, revision_number, author, title, description, type, changelog) VALUES ('r1', 'p1', 1, 'a', 't', 'd', 'engineering', 'c')",
      ).run();
      // Duplicate should fail
      expect(() =>
        db.prepare(
          "INSERT INTO proposal_revisions (id, proposal_id, revision_number, author, title, description, type, changelog) VALUES ('r2', 'p1', 1, 'a', 't', 'd', 'engineering', 'c')",
        ).run(),
      ).toThrow();
    });
  });

  // ===========================================================================
  // Zod schema max-length validation (adj-068.1.2.1)
  // ===========================================================================
  describe("Zod schema max-length validation", () => {
    it("should reject comment body exceeding 10,000 characters", async () => {
      const { CreateCommentSchema } = await import("../../src/types/proposals.js");
      const longBody = "x".repeat(10001);
      const result = CreateCommentSchema.safeParse({ body: longBody, author: "test" });
      expect(result.success).toBe(false);
    });

    it("should accept comment body at exactly 10,000 characters", async () => {
      const { CreateCommentSchema } = await import("../../src/types/proposals.js");
      const body = "x".repeat(10000);
      const result = CreateCommentSchema.safeParse({ body, author: "test" });
      expect(result.success).toBe(true);
    });

    it("should reject revision changelog exceeding 10,000 characters", async () => {
      const { ReviseProposalSchema } = await import("../../src/types/proposals.js");
      const longChangelog = "x".repeat(10001);
      const result = ReviseProposalSchema.safeParse({ title: "t", changelog: longChangelog, author: "test" });
      expect(result.success).toBe(false);
    });

    it("should reject revision description exceeding 10,000 characters", async () => {
      const { ReviseProposalSchema } = await import("../../src/types/proposals.js");
      const longDesc = "x".repeat(10001);
      const result = ReviseProposalSchema.safeParse({ description: longDesc, changelog: "c", author: "test" });
      expect(result.success).toBe(false);
    });
  });

  // ===========================================================================
  // Mutation tests — killing surviving mutations
  // ===========================================================================

  describe("getProposals unscoped inclusion (mutation coverage)", () => {
    it("should include proposals with empty project when filtering by project", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      // Insert a proposal with a specific project
      store.insertProposal({ author: "a", title: "Scoped", description: "D1", type: "product", project: "my-project" });

      // Insert a proposal with empty project (unscoped) directly via SQL
      db.prepare(
        "INSERT INTO proposals (id, author, title, description, type, project, status, created_at, updated_at) VALUES ('unscoped-1', 'b', 'Unscoped', 'D2', 'engineering', '', 'pending', datetime('now'), datetime('now'))",
      ).run();

      // Filtering by project should include both scoped AND unscoped (empty project) proposals
      const results = store.getProposals({ project: "my-project" });
      expect(results.length).toBe(2);
      expect(results.some((p) => p.title === "Unscoped")).toBe(true);
      expect(results.some((p) => p.title === "Scoped")).toBe(true);
    });

    it("should not include proposals from other projects", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      store.insertProposal({ author: "a", title: "Mine", description: "D1", type: "product", project: "my-project" });
      store.insertProposal({ author: "b", title: "Theirs", description: "D2", type: "product", project: "other-project" });

      // Insert unscoped proposal
      db.prepare(
        "INSERT INTO proposals (id, author, title, description, type, project, status, created_at, updated_at) VALUES ('unscoped-1', 'c', 'Unscoped', 'D3', 'engineering', '', 'pending', datetime('now'), datetime('now'))",
      ).run();

      const results = store.getProposals({ project: "my-project" });
      // Should include 'Mine' + 'Unscoped' but NOT 'Theirs'
      expect(results.some((p) => p.title === "Theirs")).toBe(false);
      expect(results.some((p) => p.title === "Mine")).toBe(true);
      expect(results.some((p) => p.title === "Unscoped")).toBe(true);
    });
  });

  describe("rowToProposal autoGenerated mapping (mutation coverage)", () => {
    it("should return autoGenerated as false for non-auto-generated proposals", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "human",
        title: "Manual proposal",
        description: "Created by a person",
        type: "product",
        project: "adjutant",
      });

      // Default auto_generated is 0/null, so autoGenerated should be false
      expect(proposal.autoGenerated).toBe(false);
    });

    it("should return autoGenerated as true when auto_generated flag is set", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "agent",
        title: "Auto proposal",
        description: "Generated automatically",
        type: "engineering",
        project: "adjutant",
      });

      // Set auto_generated flag directly
      db.prepare("UPDATE proposals SET auto_generated = 1 WHERE id = ?").run(proposal.id);

      const fetched = store.getProposal(proposal.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.autoGenerated).toBe(true);
    });
  });

  describe("isProjectId validation (mutation coverage)", () => {
    it("should accept valid UUID strings", async () => {
      const { isProjectId } = await import("../../src/services/proposal-store.js");

      expect(isProjectId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
      expect(isProjectId("abcdef01")).toBe(true); // 8-char hex
    });

    it("should reject non-UUID/non-hex strings", async () => {
      const { isProjectId } = await import("../../src/services/proposal-store.js");

      expect(isProjectId("adjutant")).toBe(false);
      expect(isProjectId("my-project")).toBe(false);
      expect(isProjectId("not-a-uuid-at-all")).toBe(false);
      expect(isProjectId("")).toBe(false);
      expect(isProjectId("zzzzzzzz")).toBe(false); // 8 chars but not hex
      expect(isProjectId("abcdef0")).toBe(false); // 7 hex chars (too short)
      expect(isProjectId("abcdef012")).toBe(false); // 9 hex chars (too long without full UUID)
    });
  });

  describe("setConfidenceScore (mutation coverage)", () => {
    it("should set confidence score and signals on a proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "reviewer",
        title: "Score me",
        description: "Needs scoring",
        type: "engineering",
        project: "adjutant",
      });

      const signals = { feasibility: 0.9, impact: 0.7, alignment: 0.8 };
      const scored = store.setConfidenceScore(proposal.id, 0.8, signals);

      expect(scored).not.toBeNull();
      expect(scored!.confidenceScore).toBe(0.8);
      expect(scored!.confidenceSignals).toEqual(signals);
    });

    it("should return null when setting confidence score for non-existent proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const result = store.setConfidenceScore("non-existent", 0.5, { test: 0.5 });
      expect(result).toBeNull();
    });
  });

  describe("incrementReviewRound (mutation coverage)", () => {
    it("should increment the review round counter", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "reviewer",
        title: "Review me",
        description: "Needs review",
        type: "engineering",
        project: "adjutant",
      });

      expect(proposal.reviewRound).toBe(0);

      const after1 = store.incrementReviewRound(proposal.id);
      expect(after1).not.toBeNull();
      expect(after1!.reviewRound).toBe(1);

      const after2 = store.incrementReviewRound(proposal.id);
      expect(after2).not.toBeNull();
      expect(after2!.reviewRound).toBe(2);
    });

    it("should return null for non-existent proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const result = store.incrementReviewRound("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("getProposals createdAfter filter (mutation coverage)", () => {
    it("should filter proposals by createdAfter timestamp", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      store.insertProposal({ author: "a", title: "Old", description: "D1", type: "product", project: "adjutant" });
      store.insertProposal({ author: "b", title: "New", description: "D2", type: "product", project: "adjutant" });

      // Use a future timestamp -- no proposals should match
      const futureTimestamp = "2099-01-01T00:00:00";
      const results = store.getProposals({ createdAfter: futureTimestamp });
      expect(results).toHaveLength(0);
    });

    it("should return all proposals when createdAfter is in the past", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      store.insertProposal({ author: "a", title: "P1", description: "D1", type: "product", project: "adjutant" });
      store.insertProposal({ author: "b", title: "P2", description: "D2", type: "product", project: "adjutant" });

      const pastTimestamp = "2000-01-01T00:00:00";
      const results = store.getProposals({ createdAfter: pastTimestamp });
      expect(results).toHaveLength(2);
    });
  });

  describe("confidenceSignals parsing (mutation coverage)", () => {
    it("should parse confidence_signals JSON back into an object", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "agent",
        title: "Signals test",
        description: "Check signals round-trip",
        type: "engineering",
        project: "adjutant",
      });

      const signals = { feasibility: 0.85, novelty: 0.6 };
      store.setConfidenceScore(proposal.id, 0.72, signals);

      const fetched = store.getProposal(proposal.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.confidenceSignals).toEqual(signals);
    });

    it("should return undefined confidenceSignals when not set", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "agent",
        title: "No signals",
        description: "No confidence yet",
        type: "engineering",
        project: "adjutant",
      });

      const fetched = store.getProposal(proposal.id);
      expect(fetched!.confidenceSignals).toBeUndefined();
    });
  });

  // adj-200.2.1 — migration 035 (html, is_public, share_token, published_at) + Proposal mapping
  describe("public-html schema (migration 035)", () => {
    it("should add html, is_public, share_token, published_at columns to proposals table", () => {
      const columns = (db.prepare("PRAGMA table_info(proposals)").all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(columns).toContain("html");
      expect(columns).toContain("is_public");
      expect(columns).toContain("share_token");
      expect(columns).toContain("published_at");
    });

    it("should enforce a UNIQUE index on share_token", () => {
      const indexes = db.prepare("PRAGMA index_list(proposals)").all() as {
        name: string;
        unique: number;
      }[];
      const shareTokenIndex = indexes.find((idx) => {
        const cols = (db.prepare(`PRAGMA index_info(${idx.name})`).all() as { name: string }[]).map(
          (c) => c.name,
        );
        return cols.includes("share_token");
      });
      expect(shareTokenIndex).toBeDefined();
      expect(shareTokenIndex!.unique).toBe(1);
    });

    it("should NOT create a standalone is_public index (low-value, dropped — adj-200.2.1.1)", () => {
      // The public read path (WHERE share_token = ? AND is_public = 1) is already served
      // by the share_token UNIQUE index; a standalone index on the 2-value boolean adds
      // write overhead for no read benefit, so migration 035 no longer creates it.
      const indexNames = (db.prepare("PRAGMA index_list(proposals)").all() as { name: string }[]).map(
        (idx) => idx.name,
      );
      expect(indexNames).not.toContain("idx_proposals_is_public");
    });

    it("should default a new proposal to no html, private, no token, no published_at", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "agent",
        title: "Defaults",
        description: "A fresh proposal has no public-html fields set.",
        type: "engineering",
        project: "adjutant",
      });

      expect(proposal.html).toBeUndefined();
      expect(proposal.isPublic).toBe(false);
      expect(proposal.shareToken).toBeUndefined();
      expect(proposal.publishedAt).toBeUndefined();
    });

    it("should map populated html/is_public/share_token/published_at columns onto the Proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);

      const proposal = store.insertProposal({
        author: "agent",
        title: "Mapped",
        description: "This row is mutated directly to exercise rowToProposal mapping.",
        type: "product",
        project: "adjutant",
      });

      db.prepare(
        "UPDATE proposals SET html = ?, is_public = 1, share_token = ?, published_at = ? WHERE id = ?",
      ).run("<h1>Hello</h1>", "tokenABC1234567890", "2026-06-18T00:00:00Z", proposal.id);

      const fetched = store.getProposal(proposal.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.html).toBe("<h1>Hello</h1>");
      expect(fetched!.isPublic).toBe(true);
      expect(fetched!.shareToken).toBe("tokenABC1234567890");
      expect(fetched!.publishedAt).toBe("2026-06-18T00:00:00Z");
    });
  });

  // adj-200.2.2 — sharing methods + collision-safe token generation
  describe("generateShareToken", () => {
    it("should return an unguessable base62 string of at least 16 chars", async () => {
      const { generateShareToken } = await import("../../src/services/proposal-store.js");
      const token = generateShareToken();
      expect(token).toMatch(/^[0-9A-Za-z]+$/);
      expect(token.length).toBeGreaterThanOrEqual(16);
    });

    it("should produce distinct tokens across many calls", async () => {
      const { generateShareToken } = await import("../../src/services/proposal-store.js");
      const tokens = new Set<string>();
      for (let i = 0; i < 500; i++) {
        tokens.add(generateShareToken());
      }
      expect(tokens.size).toBe(500);
    });
  });

  describe("setHtml", () => {
    it("should store the html body and return the updated proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);
      const p = store.insertProposal({
        author: "agent",
        title: "Has html",
        description: "markdown still required",
        type: "engineering",
        project: "adjutant",
      });

      const updated = store.setHtml(p.id, "<section><h1>Rich</h1></section>");
      expect(updated).not.toBeNull();
      expect(updated!.html).toBe("<section><h1>Rich</h1></section>");
      expect(store.getProposal(p.id)!.html).toBe("<section><h1>Rich</h1></section>");
    });

    it("should return null for a non-existent proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);
      expect(store.setHtml("does-not-exist", "<p>x</p>")).toBeNull();
    });
  });

  describe("publishProposal", () => {
    it("should generate a token, set is_public and published_at", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);
      const p = store.insertProposal({
        author: "agent",
        title: "Publish me",
        description: "desc",
        type: "product",
        project: "adjutant",
      });

      const published = store.publishProposal(p.id);
      expect(published).not.toBeNull();
      expect(published!.isPublic).toBe(true);
      expect(published!.shareToken).toMatch(/^[0-9A-Za-z]{16,}$/);
      expect(published!.publishedAt).toBeTruthy();
    });

    it("should reuse the same token when re-publishing after unpublish (idempotent link)", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);
      const p = store.insertProposal({
        author: "agent",
        title: "Toggle",
        description: "desc",
        type: "product",
        project: "adjutant",
      });

      const first = store.publishProposal(p.id);
      const token = first!.shareToken;
      store.unpublishProposal(p.id);
      const second = store.publishProposal(p.id);

      expect(second!.shareToken).toBe(token);
      expect(second!.isPublic).toBe(true);
    });

    it("should regenerate the token on a UNIQUE collision", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");

      // Pre-occupy a token via a store whose generator emits a fixed value.
      const occupier = createProposalStore(db, { generateToken: () => "COLLIDINGTOKEN0000001" });
      const a = occupier.insertProposal({
        author: "agent",
        title: "A",
        description: "desc",
        type: "product",
        project: "adjutant",
      });
      occupier.publishProposal(a.id);

      // Second store: emit the colliding token first, then a unique one.
      let calls = 0;
      const store = createProposalStore(db, {
        generateToken: () => (calls++ === 0 ? "COLLIDINGTOKEN0000001" : "UNIQUETOKEN000000002"),
      });
      const b = store.insertProposal({
        author: "agent",
        title: "B",
        description: "desc",
        type: "product",
        project: "adjutant",
      });
      const published = store.publishProposal(b.id);

      expect(published!.shareToken).toBe("UNIQUETOKEN000000002");
      expect(calls).toBe(2); // regenerated after the first collision
    });

    it("should throw after MAX_ATTEMPTS when every generated token collides (adj-200.2.2.1)", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");

      // Pre-occupy a fixed token.
      const occupier = createProposalStore(db, { generateToken: () => "ALWAYSCOLLIDES000001" });
      const a = occupier.insertProposal({
        author: "agent",
        title: "A",
        description: "desc",
        type: "product",
        project: "adjutant",
      });
      occupier.publishProposal(a.id);

      // Second store ALWAYS emits the same already-occupied token, so every one of the
      // MAX_ATTEMPTS inserts hits SQLITE_CONSTRAINT_UNIQUE. publishProposal must THROW —
      // not silently return an unpublished proposal.
      let calls = 0;
      const store = createProposalStore(db, {
        generateToken: () => {
          calls++;
          return "ALWAYSCOLLIDES000001";
        },
      });
      const b = store.insertProposal({
        author: "agent",
        title: "B",
        description: "desc",
        type: "product",
        project: "adjutant",
      });

      expect(() => store.publishProposal(b.id)).toThrow(/unique share token/i);
      expect(calls).toBe(5); // exactly MAX_ATTEMPTS regeneration attempts, all colliding

      // And the collision left the proposal genuinely unpublished (no token leaked).
      const after = store.getProposal(b.id);
      expect(after!.isPublic).toBe(false);
      expect(after!.shareToken).toBeUndefined();
    });

    it("should return null for a non-existent proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);
      expect(store.publishProposal("nope")).toBeNull();
    });
  });

  describe("unpublishProposal", () => {
    it("should set is_public to false but keep the token so the link can be revived", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);
      const p = store.insertProposal({
        author: "agent",
        title: "Unpub",
        description: "desc",
        type: "product",
        project: "adjutant",
      });
      const published = store.publishProposal(p.id);
      const token = published!.shareToken;

      const unpublished = store.unpublishProposal(p.id);
      expect(unpublished).not.toBeNull();
      expect(unpublished!.isPublic).toBe(false);
      expect(unpublished!.shareToken).toBe(token); // token retained
    });

    it("should return null for a non-existent proposal", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);
      expect(store.unpublishProposal("nope")).toBeNull();
    });
  });

  describe("getProposalByToken", () => {
    it("should return the proposal only when it is public", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);
      const p = store.insertProposal({
        author: "agent",
        title: "Public lookup",
        description: "desc",
        type: "product",
        project: "adjutant",
      });
      const published = store.publishProposal(p.id);
      const token = published!.shareToken!;

      const found = store.getProposalByToken(token);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(p.id);
    });

    it("should return null for a token whose proposal has been unpublished", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);
      const p = store.insertProposal({
        author: "agent",
        title: "Revoked",
        description: "desc",
        type: "product",
        project: "adjutant",
      });
      const token = store.publishProposal(p.id)!.shareToken!;
      store.unpublishProposal(p.id);

      expect(store.getProposalByToken(token)).toBeNull();
    });

    it("should return null for an unknown token", async () => {
      const { createProposalStore } = await import("../../src/services/proposal-store.js");
      const store = createProposalStore(db);
      expect(store.getProposalByToken("totally-unknown-token-xyz")).toBeNull();
    });
  });
});
