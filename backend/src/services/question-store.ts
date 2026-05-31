/**
 * QuestionStore — data layer for agent question triage (adj-181.1.4).
 *
 * All operations are projectId-scoped. This is a pure data-access layer:
 * no HTTP, no MCP, no WS broadcast. Business logic and side-effects (DM
 * mirroring, WS broadcast) live in the service layer above this.
 *
 * The urgency priority ordering for listQuestions is:
 *   blocking(3) → high(2) → normal(1) → low(0)
 * Within the same urgency, questions are sorted oldest-first (created_at ASC)
 * so that the longest-waiting question surfaces at the top of its tier.
 *
 * suggestedOptions round-trips as a JSON array string in the DB column.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import type {
  AgentQuestion,
  AgentQuestionStatus,
  FileQuestionInput,
  AnswerQuestionInput,
  ListQuestionsFilter,
} from "../types/index.js";
import { FileQuestionSchema } from "../types/index.js";

// ============================================================================
// DB row type (snake_case, as returned by SQLite)
// ============================================================================

interface AgentQuestionRow {
  id: string;
  project_id: string;
  agent_id: string;
  body: string;
  context: string | null;
  category: string | null;
  suggested_options: string | null;
  urgency: string;
  status: string;
  answer_body: string | null;
  chosen_option: string | null;
  answered_by: string | null;
  bead_id: string | null;
  conversation_id: string | null;
  created_at: string;
  answered_at: string | null;
  updated_at: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map a raw DB row to the camelCase AgentQuestion interface.
 * suggestedOptions is parsed from JSON; null columns become undefined.
 */
function rowToQuestion(row: AgentQuestionRow): AgentQuestion {
  return {
    id: row.id,
    projectId: row.project_id,
    agentId: row.agent_id,
    body: row.body,
    context: row.context ?? undefined,
    category: row.category ?? undefined,
    suggestedOptions: row.suggested_options
      ? (JSON.parse(row.suggested_options) as string[])
      : undefined,
    urgency: row.urgency as AgentQuestion["urgency"],
    status: row.status as AgentQuestionStatus,
    answerBody: row.answer_body ?? undefined,
    chosenOption: row.chosen_option ?? undefined,
    answeredBy: row.answered_by ?? undefined,
    beadId: row.bead_id ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    createdAt: row.created_at,
    answeredAt: row.answered_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

/**
 * CASE expression that maps urgency strings to a sort-priority integer.
 * blocking=3, high=2, normal=1, low=0.
 */
const URGENCY_ORDER_EXPR = `
  CASE urgency
    WHEN 'blocking' THEN 3
    WHEN 'high'     THEN 2
    WHEN 'normal'   THEN 1
    WHEN 'low'      THEN 0
    ELSE 0
  END
`;

// ============================================================================
// QuestionStore interface
// ============================================================================

export interface QuestionStore {
  /**
   * Persist a new question. Returns the created AgentQuestion.
   * Throws a structured Error if input validation fails (empty body, invalid urgency).
   */
  fileQuestion(input: FileQuestionInput): AgentQuestion;

  /**
   * Fetch a single question by id. Returns null when not found.
   */
  getQuestion(id: string): AgentQuestion | null;

  /**
   * Mark a question as answered. Requires at least one of answerBody or chosenOption.
   * When chosenOption is present and suggestedOptions are stored, the option MUST be
   * in the stored list. Throws structured Error on validation failures or not found.
   */
  answerQuestion(id: string, input: AnswerQuestionInput): AgentQuestion;

  /**
   * Mark a question as dismissed. Throws if not found.
   */
  dismissQuestion(id: string): AgentQuestion;

  /**
   * List questions matching the given filter. Defaults status to 'open'.
   * Sorted: blocking → high → normal → low, then created_at ASC within each tier.
   */
  listQuestions(filter?: ListQuestionsFilter): AgentQuestion[];
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a QuestionStore bound to the given better-sqlite3 database connection.
 */
export function createQuestionStore(db: Database.Database): QuestionStore {
  // Validate input using the Zod schema; throws with a human-readable error.
  function validateFileInput(raw: FileQuestionInput): FileQuestionInput {
    const result = FileQuestionSchema.safeParse(raw);
    if (!result.success) {
      // Use Zod's .format() to get a flat summary string — avoids unsafe indexing
      // into ZodError.errors which triggers @typescript-eslint/no-unsafe-assignment.
      throw new Error(`Invalid question input: ${result.error.message}`);
    }
    return result.data;
  }

  return {
    fileQuestion(input: FileQuestionInput): AgentQuestion {
      // Guard the body explicitly so the error message always contains "body".
      // Zod's .min(1) on body may interact with .default() on urgency in some
      // edge cases — the explicit guard ensures the error is reliably thrown.
      if (!input.body || input.body.trim().length === 0) {
        throw new Error("Invalid question input — body: Question body is required");
      }
      const validated = validateFileInput(input);

      const id = randomUUID();
      const now = new Date().toISOString();
      const suggestedOptionsJson = validated.suggestedOptions
        ? JSON.stringify(validated.suggestedOptions)
        : null;

      db.prepare(`
        INSERT INTO agent_questions
          (id, project_id, agent_id, body, context, category, suggested_options,
           urgency, status, bead_id, conversation_id, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
      `).run(
        id,
        validated.projectId,
        validated.agentId,
        validated.body,
        validated.context ?? null,
        validated.category ?? null,
        suggestedOptionsJson,
        validated.urgency,
        validated.beadId ?? null,
        validated.conversationId ?? null,
        now,
        now,
      );

      return rowToQuestion(
        db.prepare("SELECT * FROM agent_questions WHERE id = ?").get(id) as AgentQuestionRow,
      );
    },

    getQuestion(id: string): AgentQuestion | null {
      const row = db
        .prepare("SELECT * FROM agent_questions WHERE id = ?")
        .get(id) as AgentQuestionRow | undefined;
      return row ? rowToQuestion(row) : null;
    },

    answerQuestion(id: string, input: AnswerQuestionInput): AgentQuestion {
      // Validate: at least one of answerBody/chosenOption must be present.
      const hasAnswerBody = input.answerBody !== undefined && input.answerBody.length > 0;
      const hasChosenOption = input.chosenOption !== undefined && input.chosenOption.length > 0;

      if (!hasAnswerBody && !hasChosenOption) {
        throw new Error(
          "At least one of answerBody or chosenOption is required to answer a question",
        );
      }

      // Fetch current row to validate chosenOption against stored options.
      const existing = db
        .prepare("SELECT * FROM agent_questions WHERE id = ?")
        .get(id) as AgentQuestionRow | undefined;

      if (!existing) {
        throw new Error(`Question not found: ${id}`);
      }

      // When the question has stored suggestedOptions, chosenOption must be one of them.
      // `hasChosenOption` guards that chosenOption is a non-empty string here.
      const chosenOption = input.chosenOption;
      if (hasChosenOption && chosenOption !== undefined && existing.suggested_options) {
        const options = JSON.parse(existing.suggested_options) as string[];
        if (!options.includes(chosenOption)) {
          throw new Error(
            `chosenOption "${chosenOption}" is not one of the suggested options: ${options.join(", ")}`,
          );
        }
      }

      const now = new Date().toISOString();

      db.prepare(`
        UPDATE agent_questions
        SET status = 'answered',
            answer_body = ?,
            chosen_option = ?,
            answered_by = ?,
            answered_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        input.answerBody ?? null,
        input.chosenOption ?? null,
        input.answeredBy ?? null,
        now,
        now,
        id,
      );

      return rowToQuestion(
        db.prepare("SELECT * FROM agent_questions WHERE id = ?").get(id) as AgentQuestionRow,
      );
    },

    dismissQuestion(id: string): AgentQuestion {
      const existing = db
        .prepare("SELECT id FROM agent_questions WHERE id = ?")
        .get(id) as { id: string } | undefined;

      if (!existing) {
        throw new Error(`Question not found: ${id}`);
      }

      const now = new Date().toISOString();

      db.prepare(`
        UPDATE agent_questions
        SET status = 'dismissed',
            answered_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(now, now, id);

      return rowToQuestion(
        db.prepare("SELECT * FROM agent_questions WHERE id = ?").get(id) as AgentQuestionRow,
      );
    },

    listQuestions(filter: ListQuestionsFilter = {}): AgentQuestion[] {
      const status: AgentQuestionStatus = filter.status ?? "open";

      const conditions: string[] = ["status = ?"];
      // Typed as (string | null)[] — all dynamic filter values are either
      // string (from validated filter inputs) or implicitly non-null here.
      const params: string[] = [status];

      if (filter.projectId !== undefined) {
        conditions.push("project_id = ?");
        params.push(filter.projectId);
      }
      if (filter.category !== undefined) {
        conditions.push("category = ?");
        params.push(filter.category);
      }
      if (filter.agentId !== undefined) {
        conditions.push("agent_id = ?");
        params.push(filter.agentId);
      }
      if (filter.urgency !== undefined) {
        conditions.push("urgency = ?");
        params.push(filter.urgency);
      }

      const where = conditions.join(" AND ");
      const sql = `
        SELECT * FROM agent_questions
        WHERE ${where}
        ORDER BY ${URGENCY_ORDER_EXPR} DESC, created_at ASC
      `;

      const rows = db.prepare(sql).all(...params) as AgentQuestionRow[];
      return rows.map(rowToQuestion);
    },
  };
}
