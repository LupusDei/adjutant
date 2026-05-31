/**
 * Agent Question Triage types (adj-181)
 *
 * Mirrors the backend AgentQuestion shape from the question-store.
 * These types are the frontend side of the backend contract defined in:
 *   backend/src/types/index.ts (AgentQuestion, QuestionUrgency, QuestionStatus, QuestionCategory)
 */

/** Urgency levels for agent questions (blocking → high → normal → low). */
export type QuestionUrgency = 'low' | 'normal' | 'high' | 'blocking';

/** Lifecycle status of a question. */
export type QuestionStatus = 'open' | 'answered' | 'dismissed';

/** Category bucket for filtering and triage. */
export type QuestionCategory =
  | 'decision'
  | 'clarification'
  | 'approval'
  | 'action_required'
  | 'other';

/** A first-class agent question as returned by GET /api/questions. */
export interface AgentQuestion {
  id: string;
  projectId: string;
  /** ID of the asking agent (server-resolved, never client-supplied). */
  agentId: string;
  /** The question itself — one-line ask. */
  body: string;
  /** Rich agent-authored framing context (what they tried, the tradeoff, etc.). */
  context: string | null;
  /** Filterable bucket. */
  category: QuestionCategory | null;
  /** Agent-proposed answer choices the General can one-tap. */
  suggestedOptions: string[] | null;
  urgency: QuestionUrgency;
  status: QuestionStatus;
  /** Free-text answer body. */
  answerBody: string | null;
  /** The suggested option the General picked. */
  chosenOption: string | null;
  /** Who answered the question. */
  answeredBy: string | null;
  /** Optional linked bead ID. */
  beadId: string | null;
  /** DM conversation the question was mirrored into. */
  conversationId: string | null;
  createdAt: string;
  answeredAt: string | null;
  updatedAt: string;
}

/** Parameters for the answer endpoint (at least one of answerBody/chosenOption required). */
export interface AnswerQuestionParams {
  answerBody?: string;
  chosenOption?: string;
}

/** Parameters for listing questions. */
export interface ListQuestionsParams {
  status?: QuestionStatus;
  projectId?: string;
  category?: QuestionCategory | string;
  agentId?: string;
  urgency?: QuestionUrgency | string;
}

/** WebSocket event payload for question:new */
export interface QuestionNewEvent {
  type: 'question:new';
  questionId: string;
  urgency: QuestionUrgency;
  status: QuestionStatus;
  body: string;
  category: QuestionCategory | null;
  agentId: string;
  conversationId: string | null;
  createdAt: string;
  projectId: string;
  context: string | null;
  suggestedOptions: string[] | null;
  answerBody: string | null;
  chosenOption: string | null;
  answeredBy: string | null;
  beadId: string | null;
  answeredAt: string | null;
  updatedAt: string;
}

/** WebSocket event payload for question:answered or question:dismissed */
export interface QuestionStatusEvent {
  type: 'question:answered' | 'question:dismissed';
  questionId: string;
  status: QuestionStatus;
}

export type QuestionWsEvent = QuestionNewEvent | QuestionStatusEvent;
