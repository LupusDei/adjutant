/**
 * useOpenQuestions hook (adj-181.4)
 *
 * Manages the list of open agent questions for the triage view:
 *   - Initial load from GET /api/questions?status=open
 *   - Live updates via CommunicationContext WS subscription
 *   - answer() and dismiss() mutations with optimistic list removal
 *   - Filter state: category / agentId / urgency — each triggers a re-fetch
 *
 * WS events consumed:
 *   question:new      → add to open list ONLY if it passes current filters (adj-181.9)
 *   question:answered → remove from open list
 *   question:dismissed → remove from open list
 *
 * adj-181.9: WS question:new events are gated against active filters so a filtered
 *   view never receives a row that wouldn't appear if the user refreshed.
 * adj-181.11: answer() and dismiss() rethrow errors so callers (rows) can surface
 *   per-row error state rather than relying only on the global error banner.
 * adj-181.13: openCount is derived from questions.length so the QUESTIONS tab
 *   badge can render without a separate fetch.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

import { api } from '../services/api';
import { useCommunicationActions } from '../contexts/CommunicationContext';
import type {
  AgentQuestion,
  AnswerQuestionParams,
  QuestionCategory,
  QuestionUrgency,
} from '../types/questions';

// ── Types ────────────────────────────────────────────────────────────────────

type CategoryFilter = QuestionCategory | 'all';
type UrgencyFilter = QuestionUrgency | 'all';

export interface UseOpenQuestionsResult {
  questions: AgentQuestion[];
  /** Number of open questions — drives the QUESTIONS tab badge (adj-181.13). */
  openCount: number;
  loading: boolean;
  error: string | null;
  /** Current category filter value. 'all' means no filter. */
  categoryFilter: CategoryFilter;
  /** Current agent filter value. 'all' means no filter. */
  agentFilter: string;
  /** Current urgency filter value. 'all' means no filter. */
  urgencyFilter: UrgencyFilter;
  setCategoryFilter: (value: CategoryFilter) => void;
  setAgentFilter: (value: string) => void;
  setUrgencyFilter: (value: UrgencyFilter) => void;
  /** Answer a question — at least one of answerBody/chosenOption must be provided.
   *  Rethrows on failure so the calling row can display a per-row error (adj-181.11). */
  answer: (id: string, params: AnswerQuestionParams) => Promise<void>;
  /** Dismiss a question without answering it.
   *  Rethrows on failure so the calling row can display a per-row error (adj-181.11). */
  dismiss: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// ── Shape of incoming WS events ──────────────────────────────────────────────

interface WsQuestionNew {
  type: 'question:new';
  questionId: string;
  urgency: AgentQuestion['urgency'];
  status: AgentQuestion['status'];
  body: string;
  category: AgentQuestion['category'];
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

interface WsQuestionStatus {
  type: 'question:answered' | 'question:dismissed';
  questionId: string;
  status: AgentQuestion['status'];
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useOpenQuestions(): UseOpenQuestionsResult {
  const [questions, setQuestions] = useState<AgentQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilterState] = useState<CategoryFilter>('all');
  const [agentFilter, setAgentFilterState] = useState<string>('all');
  const [urgencyFilter, setUrgencyFilterState] = useState<UrgencyFilter>('all');

  // Refs to expose current filter values to the WS callback without stale closure
  // (adj-181.9: the WS handler must see the latest filter state)
  const categoryFilterRef = useRef<CategoryFilter>('all');
  const agentFilterRef = useRef<string>('all');
  const urgencyFilterRef = useRef<UrgencyFilter>('all');

  const { subscribe } = useCommunicationActions();

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const fetchQuestions = useCallback(async (opts?: {
    category?: CategoryFilter;
    agent?: string;
    urgency?: UrgencyFilter;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const params: Parameters<typeof api.questions.list>[0] = { status: 'open' };
      const cat = opts?.category ?? categoryFilter;
      const agent = opts?.agent ?? agentFilter;
      const urg = opts?.urgency ?? urgencyFilter;
      if (cat !== 'all') params.category = cat;
      if (agent !== 'all') params.agentId = agent;
      if (urg !== 'all') params.urgency = urg;
      const data = await api.questions.list(params);
      setQuestions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, agentFilter, urgencyFilter]);

  // Initial load
  useEffect(() => {
    void fetchQuestions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Filter setters (each triggers re-fetch) ─────────────────────────────────

  const setCategoryFilter = useCallback((value: CategoryFilter) => {
    setCategoryFilterState(value);
    categoryFilterRef.current = value;
    setLoading(true);
    setError(null);
    const params: Parameters<typeof api.questions.list>[0] = { status: 'open' };
    if (value !== 'all') params.category = value;
    if (agentFilterRef.current !== 'all') params.agentId = agentFilterRef.current;
    if (urgencyFilterRef.current !== 'all') params.urgency = urgencyFilterRef.current;
    void api.questions.list(params)
      .then((data) => { setQuestions(data); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { setLoading(false); });
  }, []);

  const setAgentFilter = useCallback((value: string) => {
    setAgentFilterState(value);
    agentFilterRef.current = value;
    setLoading(true);
    setError(null);
    const params: Parameters<typeof api.questions.list>[0] = { status: 'open' };
    if (categoryFilterRef.current !== 'all') params.category = categoryFilterRef.current;
    if (value !== 'all') params.agentId = value;
    if (urgencyFilterRef.current !== 'all') params.urgency = urgencyFilterRef.current;
    void api.questions.list(params)
      .then((data) => { setQuestions(data); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { setLoading(false); });
  }, []);

  const setUrgencyFilter = useCallback((value: UrgencyFilter) => {
    setUrgencyFilterState(value);
    urgencyFilterRef.current = value;
    setLoading(true);
    setError(null);
    const params: Parameters<typeof api.questions.list>[0] = { status: 'open' };
    if (categoryFilterRef.current !== 'all') params.category = categoryFilterRef.current;
    if (agentFilterRef.current !== 'all') params.agentId = agentFilterRef.current;
    if (value !== 'all') params.urgency = value;
    void api.questions.list(params)
      .then((data) => { setQuestions(data); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { setLoading(false); });
  }, []);

  // ── WS subscription ─────────────────────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = subscribe((msg) => {
      // Use unknown cast and type-narrow safely — don't cast to `any`.
      const wsMsg = msg as unknown as Record<string, unknown>;
      const type = wsMsg['type'];

      if (type === 'question:new') {
        const ev = wsMsg as unknown as WsQuestionNew;

        // adj-181.9: Gate incoming WS events against active filters.
        // A question:new event that doesn't match the current filters must NOT be
        // inserted — it would pollute the filtered view and vanish on refresh.
        const catFilter = categoryFilterRef.current;
        const agFilter = agentFilterRef.current;
        const urgFilter = urgencyFilterRef.current;

        if (catFilter !== 'all' && ev.category !== catFilter) return;
        if (agFilter !== 'all' && ev.agentId !== agFilter) return;
        if (urgFilter !== 'all' && ev.urgency !== urgFilter) return;

        const newQ: AgentQuestion = {
          id: ev.questionId,
          projectId: ev.projectId,
          agentId: ev.agentId,
          body: ev.body,
          context: ev.context,
          category: ev.category,
          suggestedOptions: ev.suggestedOptions,
          urgency: ev.urgency,
          status: 'open',
          answerBody: ev.answerBody,
          chosenOption: ev.chosenOption,
          answeredBy: ev.answeredBy,
          beadId: ev.beadId,
          conversationId: ev.conversationId,
          createdAt: ev.createdAt,
          answeredAt: ev.answeredAt,
          updatedAt: ev.updatedAt,
        };
        setQuestions((prev) => [...prev, newQ]);
      } else if (type === 'question:answered' || type === 'question:dismissed') {
        const ev = wsMsg as unknown as WsQuestionStatus;
        setQuestions((prev) => prev.filter((q) => q.id !== ev.questionId));
      }
    });

    return unsubscribe;
  }, [subscribe]);

  // ── Mutations ───────────────────────────────────────────────────────────────

  // adj-181.11: Both answer and dismiss rethrow so each row can display its own
  // error state. The global error banner is set as well for visibility, but the
  // throw gives the row a chance to show inline feedback.

  const answer = useCallback(async (id: string, params: AnswerQuestionParams) => {
    try {
      await api.questions.answer(id, params);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  const dismiss = useCallback(async (id: string) => {
    try {
      await api.questions.dismiss(id);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  return {
    questions,
    // adj-181.13: derived from questions list — no separate fetch needed
    openCount: questions.length,
    loading,
    error,
    categoryFilter,
    agentFilter,
    urgencyFilter,
    setCategoryFilter,
    setAgentFilter,
    setUrgencyFilter,
    answer,
    dismiss,
    refresh: fetchQuestions,
  };
}
