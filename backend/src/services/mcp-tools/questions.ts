/**
 * MCP Question Tools for Adjutant (adj-181.2).
 *
 * Registers file_question, answer_question, and list_questions.
 *
 * DESIGN INTENT — file_question is the SINGLE FRONT DOOR for anything an agent
 * needs from the General: both (a) questions that require a decision or answer,
 * and (b) user-blocking tasks/actions that only the General can complete (e.g.
 * providing a secret, granting access, approving a deployment, performing a
 * manual step). Use category='action_required' for the latter.
 *
 * Agents MUST NOT bury questions or blocking requests in send_message.
 * Agents MUST NOT use AskUserQuestion or block on stdin.
 * file_question is the required channel — send_message is for general comms and
 * for replying to the General.
 *
 * Identity is resolved SERVER-SIDE via getAgentBySession — the calling agent's
 * id is NEVER trusted from client-supplied params (Constitution Rule 4 / adj-146).
 *
 * projectId is the ONLY scoping key (UUID). Never projectName.
 * Cross-project override is supported via the adj-146 pattern:
 *   resolveToolProjectContext(explicitProjectId, sessionId)
 *
 * All orchestration (DM mirror, WS broadcast, APNS push) is delegated to
 * QuestionService — this module never touches the store, ws-server, or
 * apns-service directly.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgentBySession, resolveToolProjectContext } from "../mcp-server.js";
import { logInfo } from "../../utils/index.js";
import type { QuestionService } from "../question-service.js";
import {
  AgentQuestionUrgencySchema,
  AgentQuestionStatusSchema,
  AnswerQuestionSchema,
} from "../../types/index.js";

// ============================================================================
// Helper: wrap a JSON payload in the MCP text-content envelope
// ============================================================================

function jsonContent(
  payload: unknown,
): { content: { type: "text"; text: string }[] } {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register the question MCP tools on the given server.
 *
 * @param server - MCP server instance (one per agent session)
 * @param questionService - shared orchestration layer (adj-181.3)
 */
export function registerQuestionTools(
  server: McpServer,
  questionService: QuestionService,
): void {
  // =========================================================================
  // file_question
  //
  // THE single front door for anything an agent needs from the General:
  //   - Questions requiring a decision or answer (category: decision | clarification | approval | other)
  //   - Blocking tasks/actions the General must COMPLETE (category: action_required)
  //     e.g. "Add STRIPE_SECRET_KEY to .env", "Grant repo access to CI bot",
  //          "Approve the production deploy", "Sign the API keys contract"
  //
  // Do NOT bury questions or blocking requests in send_message.
  // Do NOT use AskUserQuestion. Do NOT block on stdin.
  //
  // Example — question:
  //   file_question({ body: "Should we use Redis or SQLite for sessions?",
  //                   context: "Redis has lower latency; SQLite avoids ops overhead.",
  //                   category: "decision", urgency: "high",
  //                   suggestedOptions: ["Redis", "SQLite"] })
  //
  // Example — blocking action:
  //   file_question({ body: "Please add STRIPE_SECRET_KEY to production .env",
  //                   context: "Payment integration is blocked until the key is set.",
  //                   category: "action_required", urgency: "blocking" })
  // =========================================================================
  server.tool(
    "file_question",
    {
      body: z
        .string()
        .min(1)
        .describe(
          "The question or blocking request — one clear, direct ask. " +
            "For questions, state what you need to know. " +
            "For action_required items, state exactly what the General must do.",
        ),
      context: z
        .string()
        .optional()
        .describe(
          "Rich framing so the General can act fast and accurately: what you are doing, " +
            "what you already tried, the tradeoff, and/or exactly what is needed. " +
            "More context → faster, better answer.",
        ),
      category: z
        .enum([
          "decision",
          "clarification",
          "approval",
          "action_required",
          "other",
        ])
        .optional()
        .describe(
          "Filterable bucket. Use 'action_required' when you need the General to DO something " +
            "(provide a key, grant access, approve, make a call) rather than just answer.",
        ),
      urgency: AgentQuestionUrgencySchema.default("normal").describe(
        "Triage priority. blocking = work is completely halted; high = significant impact; " +
          "normal = standard; low = whenever you have time.",
      ),
      suggestedOptions: z
        .array(z.string().min(1))
        .optional()
        .describe(
          "Agent-proposed answer choices the General can one-tap. " +
            "Include when you have a clear option set (e.g. ['Redis', 'SQLite']). " +
            "For action_required items, a single-entry list like ['Completed'] gives the General a quick confirm.",
        ),
      beadId: z
        .string()
        .optional()
        .describe("Bead linked to this question (optional, for context)."),
      projectId: z
        .string()
        .optional()
        .describe(
          "Explicit project UUID for cross-project questions (adj-146). " +
            "Omit to use the session's own project.",
        ),
    },
    async (
      { body, context, category, urgency, suggestedOptions, beadId, projectId: explicitProjectId },
      extra,
    ) => {
      // ---- 1. Resolve asker identity server-side (NEVER client-supplied) ----
      const agentId = extra.sessionId
        ? getAgentBySession(extra.sessionId)
        : undefined;
      if (!agentId) {
        return jsonContent({ error: "Unknown session — cannot resolve agent identity" });
      }

      // ---- 2. Resolve project context (adj-146 override pattern) ----
      const projectCtx = resolveToolProjectContext(explicitProjectId, extra.sessionId);
      if (!projectCtx) {
        return jsonContent({
          error:
            "No project context for this session. " +
            "Connect with a valid project or pass an explicit projectId.",
        });
      }

      // ---- 3. Delegate to QuestionService (handles store + DM + WS + push) ----
      try {
        const question = await questionService.fileQuestion({
          projectId: projectCtx.projectId,
          agentId,
          body,
          context,
          category,
          urgency: urgency ?? "normal",
          suggestedOptions,
          beadId,
        });

        logInfo("MCP file_question", {
          agentId,
          questionId: question.id,
          projectId: question.projectId,
          urgency: question.urgency,
          category: question.category ?? "none",
        });

        return jsonContent({ id: question.id, status: question.status });
      } catch (err) {
        return jsonContent({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // =========================================================================
  // answer_question
  //
  // Answer an open question. At least one of answerBody or chosenOption is
  // required. For action_required items the answer confirms completion
  // (e.g. answerBody: "Done — key added to .env" or chosenOption: "Completed").
  // =========================================================================
  server.tool(
    "answer_question",
    {
      id: z.string().min(1).describe("The question ID to answer."),
      answerBody: z
        .string()
        .min(1)
        .optional()
        .describe("Free-text answer or completion confirmation."),
      chosenOption: z
        .string()
        .min(1)
        .optional()
        .describe(
          "One of the question's suggestedOptions chosen by the General. " +
            "Must match one of the filed options exactly.",
        ),
      projectId: z
        .string()
        .optional()
        .describe("Explicit project UUID for cross-project answers (adj-146)."),
    },
    async (
      { id, answerBody, chosenOption, projectId: explicitProjectId },
      extra,
    ) => {
      // ---- 1. Validate one-of rule (at least one of answerBody / chosenOption) ----
      const parsed = AnswerQuestionSchema.safeParse({ answerBody, chosenOption });
      if (!parsed.success) {
        // ZodError.issues is the canonical field (Zod v3); .errors is an alias
        // that may not be present in all build contexts.
        const issues = parsed.error.issues ?? [];
        return jsonContent({
          error:
            issues.length > 0
              ? issues.map((e) => e.message).join("; ")
              : "At least one of answerBody or chosenOption is required",
        });
      }

      // ---- 2. Resolve project context (adj-146 override pattern) ----
      // NOTE: answer_question does not require a specific projectId — the question
      // already carries its own projectId. We still honour the override for
      // cross-project coordinators who need explicit scoping.
      resolveToolProjectContext(explicitProjectId, extra.sessionId);

      // ---- 3. Resolve answering agent server-side (adj-baauf fix) ----
      // Identity is NEVER trusted from client-supplied params (Constitution Rule 4).
      // Fall back to "user" when no session agent is found, mirroring REST route intent.
      const answeredByAgent = extra.sessionId
        ? getAgentBySession(extra.sessionId)
        : undefined;
      const answeredBy = answeredByAgent ?? "user";

      // ---- 4. Delegate to QuestionService ----
      try {
        const answered = await questionService.answerQuestion(id, {
          ...parsed.data,
          answeredBy,
        });

        logInfo("MCP answer_question", {
          questionId: id,
          answeredBy: answered.answeredBy ?? "unknown",
        });

        return jsonContent({
          id: answered.id,
          status: answered.status,
          answeredAt: answered.answeredAt ?? null,
        });
      } catch (err) {
        return jsonContent({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // =========================================================================
  // list_questions
  //
  // List filed questions. Defaults to status=open. All filters are optional
  // and composable. Sorted: blocking → high → normal → low, then oldest-first.
  // =========================================================================
  server.tool(
    "list_questions",
    {
      status: AgentQuestionStatusSchema.optional().describe(
        "Filter by lifecycle status. Defaults to 'open'.",
      ),
      projectId: z
        .string()
        .optional()
        .describe(
          "Filter by project UUID. Omit to use the session's own project " +
            "or pass explicitly for cross-project listing (adj-146).",
        ),
      category: z
        .enum([
          "decision",
          "clarification",
          "approval",
          "action_required",
          "other",
        ])
        .optional()
        .describe("Filter by question category."),
      agentId: z.string().optional().describe("Filter by asking agent ID."),
      urgency: AgentQuestionUrgencySchema.optional().describe(
        "Filter by urgency tier.",
      ),
    },
    async (
      { status, projectId: explicitProjectId, category, agentId, urgency },
      extra,
    ) => {
      // Resolve project context for the projectId filter:
      // - If caller supplied an explicit projectId, use that (cross-project / adj-146)
      // - Otherwise fall back to the session's own project (may be undefined for
      //   unscoped sessions, which is fine — listQuestions will return all)
      const projectCtx = resolveToolProjectContext(explicitProjectId, extra.sessionId);
      const resolvedProjectId = explicitProjectId ?? projectCtx?.projectId;

      const questions = questionService.listQuestions({
        status,
        projectId: resolvedProjectId,
        category,
        agentId,
        urgency,
      });

      logInfo("MCP list_questions", {
        count: questions.length,
        status: status ?? "open",
        projectId: resolvedProjectId ?? "all",
      });

      return jsonContent({ questions });
    },
  );
}
