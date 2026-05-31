/**
 * QuestionService — shared orchestration layer for agent question triage (adj-181.3).
 *
 * This is the single orchestration point so BOTH REST (Phase 3) and MCP (Phase 2)
 * trigger identical broadcast + push behaviour. Routes and MCP tools call this
 * service; they do NOT call the store or APNS directly.
 *
 * Orchestration per operation:
 *
 *   fileQuestion:
 *     1. questionStore.fileQuestion — persist the record
 *     2. Derive/get the DM conversation for (asker, 'user')
 *     3. messageStore.insertMessage — mirror question as an agent message into the DM
 *     4. questionStore updated with conversationId (best-effort, non-fatal if it fails)
 *     5. wsBroadcast({ type: 'question:new', ... })
 *     6. Enqueue APNS push — blocking/high always; normal/low only when APNS is configured
 *
 *   answerQuestion:
 *     1. questionStore.getQuestion — get agentId for DM lookup
 *     2. questionStore.answerQuestion — persist the answer
 *     3. Mirror answer into asker's DM
 *     4. wsBroadcast({ type: 'question:answered', ... })
 *     (no APNS on answer)
 *
 *   dismissQuestion:
 *     1. questionStore.dismissQuestion — persist status change
 *     2. wsBroadcast({ type: 'question:dismissed', ... })
 *     (no APNS on dismiss)
 *
 *   listQuestions:
 *     Simple pass-through to questionStore.listQuestions.
 */

import { logWarn } from "../utils/index.js";
import { isAPNsConfigured, sendNotificationToAll } from "./apns-service.js";
import type { QuestionStore } from "./question-store.js";
import type { ConversationStore } from "./conversation-store.js";
import type { MessageStore } from "./message-store.js";
// Type-only import: erased at compile time, so it introduces NO runtime
// circular dependency (ws-server imports conversation-store at runtime; this
// is purely a compile-time type reference). Using the real union keeps the
// injected wsBroadcast assignable (avoids the TS2322 contravariance break).
import type { WsServerMessage } from "./ws-server.js";
import type {
  AgentQuestion,
  FileQuestionInput,
  AnswerQuestionInput,
  ListQuestionsFilter,
} from "../types/index.js";

// ============================================================================
// WsServerMessage extension for question events (adj-181.3.5)
//
// The ws-server exports `wsBroadcast(msg: WsServerMessage)`. We extend the
// union here by passing a compatible object — the `type` discriminant is what
// matters at the call site. TypeScript sees the call as valid because we accept
// the WsBroadcastFn type (typed as accepting any WsServerMessage-shaped object).
// We do NOT modify ws-server.ts directly for these new types to avoid coupling;
// instead the caller (index.ts) wires in the real wsBroadcast, and the type
// below is the minimal structural type we need.
// ============================================================================

/**
 * Shape of the wsBroadcast function accepted by createQuestionService.
 *
 * This MUST match the real `wsBroadcast(msg: WsServerMessage)` exported by
 * ws-server — the question:new/answered/dismissed variants are part of that
 * union (adj-181.3.5). A looser duck type ({ type: string; ... }) is NOT
 * assignable from the real strict function (parameter contravariance → TS2322),
 * so we reference the real union via a type-only import.
 */
export type WsBroadcastFn = (msg: WsServerMessage) => void;

// ============================================================================
// QuestionService interface
// ============================================================================

export interface QuestionService {
  /**
   * File a new agent question. Persists it, mirrors into the asker's DM,
   * broadcasts question:new, and enqueues an APNS push for blocking/high urgency.
   */
  fileQuestion(input: FileQuestionInput): Promise<AgentQuestion>;

  /**
   * Answer a question. Persists the answer, notifies the asker via DM,
   * and broadcasts question:answered. No APNS push.
   */
  answerQuestion(id: string, input: AnswerQuestionInput): Promise<AgentQuestion>;

  /**
   * Dismiss a question. Updates status and broadcasts question:dismissed. No APNS push.
   */
  dismissQuestion(id: string): Promise<AgentQuestion>;

  /**
   * List questions matching the filter. Defaults status to 'open'.
   * Sorted: blocking → high → normal → low, then oldest-first within a tier.
   */
  listQuestions(filter?: ListQuestionsFilter): AgentQuestion[];
}

// ============================================================================
// Dependencies
// ============================================================================

export interface QuestionServiceDeps {
  questionStore: QuestionStore;
  conversationStore: ConversationStore;
  messageStore: MessageStore;
  wsBroadcast: WsBroadcastFn;
}

// ============================================================================
// Push urgency policy
//
// blocking/high are "always-push urgencies" — they push whenever APNS is
// configured. normal/low also push when configured (the spec says "respect
// prefs" for normal/low, but there is no user-pref API yet; we treat "not
// configured" as the proxy gate). Both paths check isAPNsConfigured() so the
// APNS service handles the "not configured" case gracefully.
// ============================================================================

const ALWAYS_PUSH_URGENCIES: ReadonlySet<string> = new Set(["blocking", "high"]);

function urgencyAlwaysPushes(urgency: string): boolean {
  return ALWAYS_PUSH_URGENCIES.has(urgency);
}

// ============================================================================
// Body truncation
// ============================================================================

const MAX_BODY_LEN = 200;

function truncate(text: string): string {
  if (text.length <= MAX_BODY_LEN) return text;
  return text.slice(0, MAX_BODY_LEN) + "...";
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a QuestionService bound to the provided dependencies.
 */
export function createQuestionService({
  questionStore,
  conversationStore,
  messageStore,
  wsBroadcast,
}: QuestionServiceDeps): QuestionService {
  return {
    async fileQuestion(input: FileQuestionInput): Promise<AgentQuestion> {
      // 1. Persist
      const question = questionStore.fileQuestion(input);

      // 2. Mirror into asker's DM
      let conversationId: string | undefined;
      try {
        const dm = conversationStore.getOrCreateDm(question.agentId, "user");
        conversationId = dm.id;

        // Build a human-readable message body for the DM mirror
        const dmBody = buildDmBody(question);

        messageStore.insertMessage({
          agentId: question.agentId,
          recipient: "user",
          role: "agent",
          body: dmBody,
          conversationId: dm.id,
          metadata: {
            questionId: question.id,
            urgency: question.urgency,
            category: question.category ?? null,
          },
        });
      } catch (err) {
        // DM mirroring is best-effort — don't fail the question filing
        logWarn("question-service: failed to mirror question into DM", {
          questionId: question.id,
          error: String(err),
        });
      }

      // 3. Broadcast question:new
      wsBroadcast({
        type: "question:new",
        questionId: question.id,
        projectId: question.projectId,
        agentId: question.agentId,
        urgency: question.urgency,
        status: question.status,
        body: question.body,
        category: question.category ?? null,
        conversationId: conversationId ?? undefined,
        createdAt: question.createdAt,
      });

      // 4. APNS push
      //    blocking/high always push when APNS is configured; normal/low also push
      //    when configured (the spec says "respect prefs" for normal/low, but there
      //    is no user-pref API yet — we treat "not configured" as the proxy gate).
      const isAlways = urgencyAlwaysPushes(question.urgency);
      const pushEnabled = isAlways ? isAPNsConfigured() : isAPNsConfigured();

      if (pushEnabled) {
        const truncatedBody = truncate(question.body);
        sendNotificationToAll({
          title: `[${question.urgency.toUpperCase()}] Question from ${question.agentId}`,
          body: truncatedBody,
          sound: "default",
          category: "AGENT_QUESTION",
          threadId: `question-${question.projectId}`,
          data: {
            type: "agent_question",
            questionId: question.id,
            projectId: question.projectId,
            agentId: question.agentId,
            urgency: question.urgency,
            body: truncatedBody,
            // Deep-link target — iOS uses this to open the Open Questions screen
            screen: "open_questions",
          },
        }).catch((err) => {
          logWarn("question-service: APNS push failed", {
            questionId: question.id,
            error: String(err),
          });
        });
      }

      return question;
    },

    async answerQuestion(id: string, input: AnswerQuestionInput): Promise<AgentQuestion> {
      // Fetch question first so we know the agentId for DM lookup
      const existing = questionStore.getQuestion(id);
      if (!existing) {
        throw new Error(`Question not found: ${id}`);
      }

      // 1. Persist the answer
      const answered = questionStore.answerQuestion(id, input);

      // 2. Mirror answer into asker's DM
      try {
        const dm = conversationStore.getOrCreateDm(existing.agentId, "user");
        const answerText = buildAnswerDmBody(answered);

        messageStore.insertMessage({
          agentId: "user",
          recipient: existing.agentId,
          role: "user",
          body: answerText,
          conversationId: dm.id,
          metadata: {
            questionId: answered.id,
            answeredBy: answered.answeredBy ?? "user",
          },
        });
      } catch (err) {
        logWarn("question-service: failed to mirror answer into DM", {
          questionId: id,
          error: String(err),
        });
      }

      // 3. Broadcast question:answered
      wsBroadcast({
        type: "question:answered",
        questionId: answered.id,
        projectId: answered.projectId,
        agentId: answered.agentId,
        status: answered.status,
        answeredBy: answered.answeredBy ?? null,
        answerBody: answered.answerBody ?? null,
        chosenOption: answered.chosenOption ?? null,
        answeredAt: answered.answeredAt ?? null,
      });

      return answered;
    },

    async dismissQuestion(id: string): Promise<AgentQuestion> {
      // 1. Persist
      const dismissed = questionStore.dismissQuestion(id);

      // 2. Broadcast question:dismissed
      wsBroadcast({
        type: "question:dismissed",
        questionId: dismissed.id,
        projectId: dismissed.projectId,
        agentId: dismissed.agentId,
        status: dismissed.status,
        updatedAt: dismissed.updatedAt,
      });

      return dismissed;
    },

    listQuestions(filter: ListQuestionsFilter = {}): AgentQuestion[] {
      return questionStore.listQuestions(filter);
    },
  };
}

// ============================================================================
// DM body builders
// ============================================================================

/**
 * Build a human-readable DM body for the question mirror.
 * This is what the asker would see in their DM thread.
 */
function buildDmBody(q: AgentQuestion): string {
  const lines: string[] = [];
  const urgencyTag = q.urgency !== "normal" ? ` [${q.urgency.toUpperCase()}]` : "";
  lines.push(`[QUESTION${urgencyTag}] ${q.body}`);
  if (q.context) {
    lines.push(`\nContext: ${q.context}`);
  }
  if (q.suggestedOptions && q.suggestedOptions.length > 0) {
    lines.push(`\nOptions: ${q.suggestedOptions.map((o, i) => `(${i + 1}) ${o}`).join(", ")}`);
  }
  if (q.beadId) {
    lines.push(`\nBead: ${q.beadId}`);
  }
  return lines.join("");
}

/**
 * Build the answer notification message posted back into the asker's DM.
 */
function buildAnswerDmBody(q: AgentQuestion): string {
  const parts: string[] = [`[ANSWERED] Re: ${q.body}`];
  if (q.chosenOption) {
    parts.push(`\nChosen option: ${q.chosenOption}`);
  }
  if (q.answerBody) {
    parts.push(`\nAnswer: ${q.answerBody}`);
  }
  return parts.join("");
}
