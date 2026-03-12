/**
 * Proposals API contract tests.
 *
 * Validates proposal endpoint responses match declared Zod schemas.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// Mocks
// ============================================================================

const mockProposalStore = {
  createProposal: vi.fn(),
  getProposal: vi.fn(),
  getProposals: vi.fn(),
  updateProposalStatus: vi.fn(),
  addComment: vi.fn(),
  getComments: vi.fn(),
  addRevision: vi.fn(),
  getRevisions: vi.fn(),
};

vi.mock("../../src/services/proposal-store.js", () => ({
  createProposalStore: vi.fn().mockReturnValue(mockProposalStore),
}));

import { createProposalsRouter } from "../../src/routes/proposals.js";
import {
  ProposalListResponseSchema,
  SingleProposalResponseSchema,
  ProposalCommentListResponseSchema,
  SingleProposalCommentResponseSchema,
  ApiErrorSchema,
} from "../../src/types/api-contracts.js";

// ============================================================================
// Fixtures
// ============================================================================

const MOCK_PROPOSAL = {
  id: "951ee0d6-14e1-4cef-a526-b84f3aab10de",
  title: "Unify service result types",
  description: "Replace 25+ identical result wrapper types...",
  type: "engineering" as const,
  project: "adjutant",
  author: "raynor",
  status: "accepted" as const,
  createdAt: "2026-02-26T03:30:54.000Z",
  updatedAt: "2026-03-11T13:15:38.000Z",
};

const MOCK_COMMENT = {
  id: "comment-001",
  proposalId: MOCK_PROPOSAL.id,
  author: "kerrigan",
  body: "LGTM — the type aliases are a clean migration path.",
  createdAt: "2026-03-11T14:00:00.000Z",
};

// ============================================================================
// Tests
// ============================================================================

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/proposals", createProposalsRouter(null as any));
  return app;
}

describe("Proposals API contracts", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/proposals", () => {
    it("response matches ProposalListResponseSchema", async () => {
      mockProposalStore.getProposals.mockReturnValue([MOCK_PROPOSAL]);

      const res = await request(app).get("/api/proposals");

      expect(res.status).toBe(200);
      const parsed = ProposalListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });
  });

  describe("GET /api/proposals/:id", () => {
    it("response matches SingleProposalResponseSchema", async () => {
      mockProposalStore.getProposal.mockReturnValue(MOCK_PROPOSAL);

      const res = await request(app).get(`/api/proposals/${MOCK_PROPOSAL.id}`);

      expect(res.status).toBe(200);
      const parsed = SingleProposalResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns 404 when proposal not found", async () => {
      mockProposalStore.getProposal.mockReturnValue(null);

      const res = await request(app).get("/api/proposals/nonexistent");

      expect(res.status).toBe(404);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  describe("POST /api/proposals", () => {
    it("response matches SingleProposalResponseSchema", async () => {
      mockProposalStore.createProposal.mockReturnValue(MOCK_PROPOSAL);

      const res = await request(app)
        .post("/api/proposals")
        .send({
          title: "New proposal",
          description: "Description here",
          type: "engineering",
          author: "raynor",
        });

      expect(res.status).toBe(201);
      const parsed = SingleProposalResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  describe("GET /api/proposals/:id/comments", () => {
    it("response matches ProposalCommentListResponseSchema", async () => {
      mockProposalStore.getProposal.mockReturnValue(MOCK_PROPOSAL);
      mockProposalStore.getComments.mockReturnValue([MOCK_COMMENT]);

      const res = await request(app).get(`/api/proposals/${MOCK_PROPOSAL.id}/comments`);

      expect(res.status).toBe(200);
      const parsed = ProposalCommentListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });
  });

  describe("POST /api/proposals/:id/comments", () => {
    it("response matches SingleProposalCommentResponseSchema", async () => {
      mockProposalStore.getProposal.mockReturnValue(MOCK_PROPOSAL);
      mockProposalStore.addComment.mockReturnValue(MOCK_COMMENT);

      const res = await request(app)
        .post(`/api/proposals/${MOCK_PROPOSAL.id}/comments`)
        .send({ author: "kerrigan", body: "Looks good." });

      expect(res.status).toBe(201);
      const parsed = SingleProposalCommentResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });
});
