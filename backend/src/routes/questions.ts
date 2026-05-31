/**
 * Questions REST routes (adj-181.3.2).
 *
 * Thin HTTP adapters over QuestionService. No DB access; no business logic.
 * Input validation via Zod at the boundary. All orchestration (DM mirror,
 * WS broadcast, APNS push) happens inside the service.
 *
 *   GET  /api/questions                — list questions with optional filters
 *   POST /api/questions/:id/answer     — answer a question
 *   POST /api/questions/:id/dismiss    — dismiss a question
 *
 * Architecture: route → service → store (per .claude/rules/04-architecture.md).
 */

import { Router } from "express";
import { z } from "zod";

import type { QuestionService } from "../services/question-service.js";
import {
  AgentQuestionStatusSchema,
  AgentQuestionUrgencySchema,
  AnswerQuestionSchema,
} from "../types/index.js";
import { success, badRequest, notFound, validationError } from "../utils/responses.js";

// ============================================================================
// Query filter schema
// ============================================================================

const ListQuestionsQuerySchema = z.object({
  status: AgentQuestionStatusSchema.optional(),
  projectId: z.string().optional(),
  category: z.string().optional(),
  agentId: z.string().optional(),
  urgency: AgentQuestionUrgencySchema.optional(),
});

// ============================================================================
// Router factory
// ============================================================================

/**
 * Create a questions router bound to the given QuestionService.
 * The factory pattern lets tests inject a test-scoped mock service.
 */
export function createQuestionsRouter(service: QuestionService): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // GET /api/questions
  // -------------------------------------------------------------------------
  router.get("/", (req, res) => {
    const parsed = ListQuestionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(
        validationError("Invalid query parameters", parsed.error.message),
      );
    }

    // Default status to 'open' so the triage view works without explicit params
    const filter = {
      status: parsed.data.status ?? "open" as const,
      ...parsed.data,
    };

    const questions = service.listQuestions(filter);
    return res.json(success({ questions, total: questions.length }));
  });

  // -------------------------------------------------------------------------
  // POST /api/questions/:id/answer
  // -------------------------------------------------------------------------
  router.post("/:id/answer", async (req, res) => {
    const { id } = req.params;

    // Validate the answer body via Zod (enforces "at least one of" rule)
    const parsed = AnswerQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(
        validationError("Invalid answer input", parsed.error.message),
      );
    }

    const input = {
      ...parsed.data,
      // The REST endpoint assumes the dashboard operator ('user') is answering.
      // MCP tools (Phase 2) resolve the answering agent server-side and pass
      // it explicitly.
      answeredBy: parsed.data.answeredBy ?? "user",
    };

    try {
      const question = await service.answerQuestion(id, input);
      return res.json(success({ question }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return res.status(404).json(notFound("Question", id));
      }
      return res.status(400).json(badRequest(message));
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/questions/:id/dismiss
  // -------------------------------------------------------------------------
  router.post("/:id/dismiss", async (req, res) => {
    const { id } = req.params;

    try {
      const question = await service.dismissQuestion(id);
      return res.json(success({ question }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return res.status(404).json(notFound("Question", id));
      }
      return res.status(400).json(badRequest(message));
    }
  });

  return router;
}
