/**
 * REST routes for proposal management.
 *
 * GET    /api/proposals      - List proposals (filter by status, type)
 * POST   /api/proposals      - Create a proposal
 * GET    /api/proposals/:id  - Get single proposal
 * PATCH  /api/proposals/:id  - Update proposal status (accept/dismiss)
 */

import { Router } from "express";
import { CreateProposalSchema, UpdateProposalStatusSchema, ProposalFilterSchema } from "../types/proposals.js";
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
    });

    res.status(201).json(success(proposal));
  });

  // GET /api/proposals/:id
  router.get("/:id", (req, res) => {
    const proposal = store.getProposal(req.params["id"]!);
    if (!proposal) {
      res.status(404).json(notFound("Proposal", req.params["id"]));
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

    const proposal = store.updateProposalStatus(req.params["id"]!, bodyResult.data.status);
    if (!proposal) {
      res.status(404).json(notFound("Proposal", req.params["id"]));
      return;
    }

    res.json(success(proposal));
  });

  return router;
}
