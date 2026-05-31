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
 *   question:new      → add to open list (if it passes current filters in view)
 *   question:answered → remove from open list
 *   question:dismissed → remove from open list
 */
import { useState, useEffect, useCallback } from 'react';

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
  /** Answer a question — at least one of answerBody/chosenOption must be provided. */
  answer: (id: string, params: AnswerQuestionParams) => Promise<void>;
  /** Dismiss a question without answering it. */
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
    setLoading(true);
    setError(null);
    const params: Parameters<typeof api.questions.list>[0] = { status: 'open' };
    if (value !== 'all') params.category = value;
    if (agentFilter !== 'all') params.agentId = agentFilter;
    if (urgencyFilter !== 'all') params.urgency = urgencyFilter;
    void api.questions.list(params)
      .then((data) => { setQuestions(data); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { setLoading(false); });
  }, [agentFilter, urgencyFilter]);

  const setAgentFilter = useCallback((value: string) => {
    setAgentFilterState(value);
    setLoading(true);
    setError(null);
    const params: Parameters<typeof api.questions.list>[0] = { status: 'open' };
    if (categoryFilter !== 'all') params.category = categoryFilter;
    if (value !== 'all') params.agentId = value;
    if (urgencyFilter !== 'all') params.urgency = urgencyFilter;
    void api.questions.list(params)
      .then((data) => { setQuestions(data); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { setLoading(false); });
  }, [categoryFilter, urgencyFilter]);

  const setUrgencyFilter = useCallback((value: UrgencyFilter) => {
    setUrgencyFilterState(value);
    setLoading(true);
    setError(null);
    const params: Parameters<typeof api.questions.list>[0] = { status: 'open' };
    if (categoryFilter !== 'all') params.category = categoryFilter;
    if (agentFilter !== 'all') params.agentId = agentFilter;
    if (value !== 'all') params.urgency = value;
    void api.questions.list(params)
      .then((data) => { setQuestions(data); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { setLoading(false); });
  }, [categoryFilter, agentFilter]);

  // ── WS subscription ─────────────────────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = subscribe((msg) => {
      // Use unknown cast and type-narrow safely — don't cast to `any`.
      const wsMsg = msg as unknown as Record<string, unknown>;
      const type = wsMsg['type'];

      if (type === 'question:new') {
        const ev = wsMsg as unknown as WsQuestionNew;
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
