/**
 * REST routes for proposal management.
 *
 * GET    /api/proposals                - List proposals (filter by status, type)
 * POST   /api/proposals                - Create a proposal
 * GET    /api/proposals/:id            - Get single proposal
 * PATCH  /api/proposals/:id            - Update proposal status (accept/dismiss/complete)
 * POST   /api/proposals/:id/comments   - Add a comment to a proposal
 * GET    /api/proposals/:id/comments   - Get comments for a proposal
 * POST   /api/proposals/:id/revisions  - Create a new revision of a proposal
 * GET    /api/proposals/:id/revisions  - Get revision history for a proposal
 */

import { Router } from "express";
import {
  CreateProposalSchema,
  UpdateProposalStatusSchema,
  ProposalFilterSchema,
  CreateCommentSchema,
  ReviseProposalSchema,
} from "../types/proposals.js";
import type { ProposalStore } from "../services/proposal-store.js";
import { success, badRequest, notFound, validationError } from "../utils/responses.js";

export function createProposalsRouter(store: ProposalStore): Router {
  const router = Router();

  // GET /api/proposals
  router.get("/", (req, res) => {
    const filterResult = ProposalFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      res.status(400).json(validationError("Invalid filter", filterResult.error.message));
      return;
    }

    const proposals = store.getProposals(filterResult.data);
    res.json(success(proposals));
  });

  // POST /api/proposals
  router.post("/", (req, res) => {
    const bodyResult = CreateProposalSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json(validationError("Invalid proposal", bodyResult.error.message));
      return;
    }

    const author = (req.body as Record<string, unknown>)["author"] as string | undefined;
    if (!author) {
      res.status(400).json(badRequest("Author is required"));
      return;
    }

    const proposal = store.insertProposal({
      author,
      title: bodyResult.data.title,
      description: bodyResult.data.description,
      type: bodyResult.data.type,
      project: bodyResult.data.project,
    });

    res.status(201).json(success(proposal));
  });

  // GET /api/proposals/:id
  router.get("/:id", (req, res) => {
    const proposal = store.getProposal(req.params.id);
    if (!proposal) {
      res.status(404).json(notFound("Proposal", req.params.id));
      return;
    }
    res.json(success(proposal));
  });

  // PATCH /api/proposals/:id
  router.patch("/:id", (req, res) => {
    const bodyResult = UpdateProposalStatusSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json(validationError("Invalid status update", bodyResult.error.message));
      return;
    }

    const proposal = store.updateProposalStatus(req.params.id, bodyResult.data.status);
    if (!proposal) {
      res.status(404).json(notFound("Proposal", req.params.id));
      return;
    }

    res.json(success(proposal));
  });

  // POST /api/proposals/:id/comments
  router.post("/:id/comments", (req, res) => {
    const proposal = store.getProposal(req.params.id);
    if (!proposal) {
      res.status(404).json(notFound("Proposal", req.params.id));
      return;
    }

    const bodyResult = CreateCommentSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json(validationError("Invalid comment", bodyResult.error.message));
      return;
    }

    const comment = store.insertComment({
      proposalId: req.params.id,
      author: bodyResult.data.author,
      body: bodyResult.data.body,
    });

    res.status(201).json(success(comment));
  });

  // GET /api/proposals/:id/comments
  router.get("/:id/comments", (req, res) => {
    const proposal = store.getProposal(req.params.id);
    if (!proposal) {
      res.status(404).json(notFound("Proposal", req.params.id));
      return;
    }

    const comments = store.getComments(req.params.id);
    res.json(success(comments));
  });

  // POST /api/proposals/:id/revisions
  router.post("/:id/revisions", (req, res) => {
    const proposal = store.getProposal(req.params.id);
    if (!proposal) {
      res.status(404).json(notFound("Proposal", req.params.id));
      return;
    }

    const bodyResult = ReviseProposalSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json(validationError("Invalid revision", bodyResult.error.message));
      return;
    }

    const revised = store.reviseProposal(req.params.id, {
      author: bodyResult.data.author,
      title: bodyResult.data.title,
      description: bodyResult.data.description,
      type: bodyResult.data.type,
      changelog: bodyResult.data.changelog,
    });

    if (!revised) {
      res.status(404).json(notFound("Proposal", req.params.id));
      return;
    }

    res.status(201).json(success(revised));
  });

  // GET /api/proposals/:id/revisions
  router.get("/:id/revisions", (req, res) => {
    const proposal = store.getProposal(req.params.id);
    if (!proposal) {
      res.status(404).json(notFound("Proposal", req.params.id));
      return;
    }

    const revisions = store.getRevisions(req.params.id);
    res.json(success(revisions));
  });

  return router;
}
