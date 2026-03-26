/**
 * Acceptance Tests: Proposal Project Filtering (adj-149)
 *
 * End-to-end tests verifying that proposals are correctly filtered by project
 * across the REST API. Covers the scenarios that caused the adj-149 bug:
 *
 * 1. Filtering by project UUID returns matching proposals
 * 2. Unscoped (empty project) proposals appear in project-filtered results
 * 3. Filtering by project excludes other projects' proposals
 * 4. No filter returns all proposals regardless of project
 * 5. Combined filters (project + status, project + type) work correctly
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { TestHarness } from "../../src/acceptance/test-harness.js";

// Simulated project UUIDs matching real DB format (8-char short IDs)
const PROJECT_ADJUTANT = "0e578d15";
const PROJECT_AUTOTANK = "71f9d993";

interface ProposalResponse {
  success: boolean;
  data: {
    id: string;
    title: string;
    project: string;
    status: string;
    type: string;
  }[];
}

describe("Acceptance: Proposal Project Filtering (adj-149)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = new TestHarness();
    await harness.setup();
  });

  afterEach(async () => {
    await harness.destroy();
  });

  // ===========================================================================
  // Setup helper — seeds a standard set of proposals across projects
  // ===========================================================================

  async function seedStandardProposals() {
    const adjutant1 = await harness.seedProposal({
      author: "agent-1",
      title: "Adjutant Feature A",
      description: "Feature for adjutant project",
      type: "engineering",
      project: PROJECT_ADJUTANT,
    });
    const adjutant2 = await harness.seedProposal({
      author: "agent-2",
      title: "Adjutant Feature B",
      description: "Another adjutant feature",
      type: "product",
      project: PROJECT_ADJUTANT,
    });
    const autotank1 = await harness.seedProposal({
      author: "agent-3",
      title: "Auto-tank Weapon System",
      description: "Weapon system for auto-tank",
      type: "engineering",
      project: PROJECT_AUTOTANK,
    });
    return { adjutant1, adjutant2, autotank1 };
  }

  // ===========================================================================
  // Core project filtering
  // ===========================================================================

  describe("project UUID filtering", () => {
    it("should return only proposals matching the project UUID", async () => {
      await seedStandardProposals();

      const res = await harness.get<ProposalResponse>("/api/proposals", {
        project: PROJECT_ADJUTANT,
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((p) => p.project === PROJECT_ADJUTANT)).toBe(true);
    });

    it("should return proposals for a different project UUID", async () => {
      await seedStandardProposals();

      const res = await harness.get<ProposalResponse>("/api/proposals", {
        project: PROJECT_AUTOTANK,
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].project).toBe(PROJECT_AUTOTANK);
      expect(res.body.data[0].title).toBe("Auto-tank Weapon System");
    });

    it("should return empty array when no proposals match the project", async () => {
      await seedStandardProposals();

      const res = await harness.get<ProposalResponse>("/api/proposals", {
        project: "deadbeef",
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Unscoped (legacy) proposals — empty project field
  // ===========================================================================

  describe("unscoped proposals with empty project", () => {
    it("should include unscoped proposals when filtering by project", async () => {
      // Seed a proposal with empty project (legacy/unscoped)
      await harness.seedProposal({
        author: "adjutant-core",
        title: "Legacy Unscoped Proposal",
        description: "Created before project-scoping existed",
        type: "engineering",
        project: "",
      });
      // Seed a scoped proposal
      await harness.seedProposal({
        author: "agent-1",
        title: "Scoped Proposal",
        description: "Belongs to adjutant",
        type: "product",
        project: PROJECT_ADJUTANT,
      });

      const res = await harness.get<ProposalResponse>("/api/proposals", {
        project: PROJECT_ADJUTANT,
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      const titles = res.body.data.map((p) => p.title);
      expect(titles).toContain("Legacy Unscoped Proposal");
      expect(titles).toContain("Scoped Proposal");
    });

    it("should show unscoped proposals for ANY project filter", async () => {
      await harness.seedProposal({
        author: "adjutant-core",
        title: "Universal Proposal",
        description: "No project scope",
        type: "engineering",
        project: "",
      });

      // Should appear when filtering by adjutant
      const adjRes = await harness.get<ProposalResponse>("/api/proposals", {
        project: PROJECT_ADJUTANT,
      });
      expect(adjRes.body.data).toHaveLength(1);
      expect(adjRes.body.data[0].title).toBe("Universal Proposal");

      // Should also appear when filtering by auto-tank
      const tankRes = await harness.get<ProposalResponse>("/api/proposals", {
        project: PROJECT_AUTOTANK,
      });
      expect(tankRes.body.data).toHaveLength(1);
      expect(tankRes.body.data[0].title).toBe("Universal Proposal");
    });
  });

  // ===========================================================================
  // No filter — "ALL PROJECTS" view
  // ===========================================================================

  describe("no project filter (ALL PROJECTS)", () => {
    it("should return all proposals from all projects", async () => {
      await seedStandardProposals();
      await harness.seedProposal({
        author: "adjutant-core",
        title: "Unscoped Proposal",
        description: "No project",
        type: "engineering",
        project: "",
      });

      const res = await harness.get<ProposalResponse>("/api/proposals");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(4);
    });
  });

  // ===========================================================================
  // Combined filters — project + status, project + type
  // ===========================================================================

  describe("combined filters", () => {
    it("should filter by project AND status", async () => {
      // Create adjutant proposals with different statuses
      await harness.seedProposal({
        author: "agent-1",
        title: "Pending Adjutant",
        description: "Pending",
        type: "engineering",
        project: PROJECT_ADJUTANT,
      });
      const accepted = await harness.seedProposal({
        author: "agent-2",
        title: "Accepted Adjutant",
        description: "Accepted",
        type: "engineering",
        project: PROJECT_ADJUTANT,
      });
      // Accept the second one
      await harness.patch(`/api/proposals/${accepted.id}`, { status: "accepted" });

      // Create auto-tank pending proposal
      await harness.seedProposal({
        author: "agent-3",
        title: "Pending Auto-tank",
        description: "Pending",
        type: "engineering",
        project: PROJECT_AUTOTANK,
      });

      // Filter: adjutant + pending
      const res = await harness.get<ProposalResponse>("/api/proposals", {
        project: PROJECT_ADJUTANT,
        status: "pending",
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe("Pending Adjutant");
    });

    it("should filter by project AND type", async () => {
      await harness.seedProposal({
        author: "agent-1",
        title: "Eng Proposal",
        description: "Engineering",
        type: "engineering",
        project: PROJECT_ADJUTANT,
      });
      await harness.seedProposal({
        author: "agent-2",
        title: "Product Proposal",
        description: "Product",
        type: "product",
        project: PROJECT_ADJUTANT,
      });
      await harness.seedProposal({
        author: "agent-3",
        title: "Other Project Eng",
        description: "Engineering in other project",
        type: "engineering",
        project: PROJECT_AUTOTANK,
      });

      const res = await harness.get<ProposalResponse>("/api/proposals", {
        project: PROJECT_ADJUTANT,
        type: "engineering",
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe("Eng Proposal");
    });
  });

  // ===========================================================================
  // Project field persistence — proposals created via API store project correctly
  // ===========================================================================

  describe("project field persistence via REST API", () => {
    it("should store and return the project field on creation", async () => {
      const createRes = await harness.post("/api/proposals", {
        author: "test-agent",
        title: "New Proposal",
        description: "Testing project persistence",
        type: "engineering",
        project: PROJECT_ADJUTANT,
      });

      expect(createRes.status).toBe(201);
      expect((createRes.body as { data: { project: string } }).data.project).toBe(PROJECT_ADJUTANT);

      // Verify it appears in filtered list
      const listRes = await harness.get<ProposalResponse>("/api/proposals", {
        project: PROJECT_ADJUTANT,
      });
      expect(listRes.body.data).toHaveLength(1);
      expect(listRes.body.data[0].project).toBe(PROJECT_ADJUTANT);
    });

    it("should not return the proposal when filtering by a different project", async () => {
      await harness.post("/api/proposals", {
        author: "test-agent",
        title: "Adjutant Only",
        description: "Should not appear in auto-tank",
        type: "engineering",
        project: PROJECT_ADJUTANT,
      });

      const res = await harness.get<ProposalResponse>("/api/proposals", {
        project: PROJECT_AUTOTANK,
      });

      // Should be empty — no auto-tank proposals and no unscoped proposals
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Regression: get single proposal with project field
  // ===========================================================================

  describe("single proposal retrieval preserves project", () => {
    it("should return project field on GET /api/proposals/:id", async () => {
      const created = await harness.seedProposal({
        author: "agent-1",
        title: "Specific Proposal",
        description: "Has a project",
        type: "product",
        project: PROJECT_AUTOTANK,
      });

      const res = await harness.get<{ data: { id: string; project: string } }>(
        `/api/proposals/${created.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.project).toBe(PROJECT_AUTOTANK);
    });
  });
});
