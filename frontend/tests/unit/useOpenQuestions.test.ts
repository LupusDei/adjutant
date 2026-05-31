/**
 * useOpenQuestions hook tests (adj-181.4.1)
 *
 * TDD: these tests are written BEFORE the implementation.
 * They cover:
 *   1. Initial load — fetches open questions from API
 *   2. Live WS update — question:new adds to list; question:answered + question:dismissed remove from open list
 *   3. Answer via chosenOption — calls API with chosenOption, removes from list
 *   4. Answer via free text — calls API with answerBody, removes from list
 *   5. Dismiss — calls API, removes from list
 *   6. Filter state — category/agent/urgency filters re-fetch API with params
 *   7. Error state — API failure surfaces error string
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOpenQuestions } from '../../src/hooks/useOpenQuestions';

// ── Mock api module ─────────────────────────────────────────────────────────
vi.mock('../../src/services/api', () => {
  const apiObj = {
    questions: {
      list: vi.fn(),
      answer: vi.fn(),
      dismiss: vi.fn(),
    },
  };
  return { api: apiObj, default: apiObj };
});

// ── Mock CommunicationContext ───────────────────────────────────────────────
const mockSubscribe = vi.fn(() => vi.fn());
vi.mock('../../src/contexts/CommunicationContext', () => ({
  useCommunicationActions: () => ({
    subscribe: mockSubscribe,
    subscribeTimeline: vi.fn(() => () => {}),
    sendMessage: vi.fn(),
  }),
}));

import { api } from '../../src/services/api';
import type { AgentQuestion } from '../../src/types/questions';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeQuestion(overrides: Partial<AgentQuestion> = {}): AgentQuestion {
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    projectId: 'proj-uuid-123',
    agentId: 'agent-1',
    body: 'What should I do about X?',
    context: 'I tried Y and Z but neither worked.',
    category: 'decision',
    suggestedOptions: ['Option A', 'Option B'],
    urgency: 'normal',
    status: 'open',
    answerBody: null,
    chosenOption: null,
    answeredBy: null,
    beadId: null,
    conversationId: 'conv-1',
    createdAt: '2026-05-31T10:00:00Z',
    answeredAt: null,
    updatedAt: '2026-05-31T10:00:00Z',
    ...overrides,
  };
}

const listFn = () => vi.mocked(api.questions.list);
const answerFn = () => vi.mocked(api.questions.answer);
const dismissFn = () => vi.mocked(api.questions.dismiss);

beforeEach(() => {
  vi.clearAllMocks();
  listFn().mockResolvedValue([]);
  answerFn().mockResolvedValue(undefined);
  dismissFn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useOpenQuestions', () => {
  describe('initial load', () => {
    it('should fetch open questions on mount and populate the list', async () => {
      const q1 = makeQuestion({ urgency: 'blocking', body: 'Critical blocker' });
      const q2 = makeQuestion({ urgency: 'normal', body: 'Normal question' });
      listFn().mockResolvedValue([q1, q2]);

      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(listFn()).toHaveBeenCalledWith({ status: 'open' });
      expect(result.current.questions).toHaveLength(2);
      expect(result.current.questions[0]!.id).toBe(q1.id);
    });

    it('should start in loading state', () => {
      const { result } = renderHook(() => useOpenQuestions());
      expect(result.current.loading).toBe(true);
    });

    it('should surface error string when API fetch fails', async () => {
      listFn().mockRejectedValue(new Error('API down'));

      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('API down');
      expect(result.current.questions).toHaveLength(0);
    });
  });

  describe('live WS updates', () => {
    it('should add a new question when question:new WS event arrives', async () => {
      listFn().mockResolvedValue([]);
      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const newQ = makeQuestion({ id: 'q-new', body: 'New live question' });

      act(() => {
        subscriberCallback?.({
          type: 'question:new',
          questionId: newQ.id,
          urgency: newQ.urgency,
          status: newQ.status,
          body: newQ.body,
          category: newQ.category,
          agentId: newQ.agentId,
          conversationId: newQ.conversationId,
          createdAt: newQ.createdAt,
          projectId: newQ.projectId,
          context: newQ.context,
          suggestedOptions: newQ.suggestedOptions,
          answerBody: null,
          chosenOption: null,
          answeredBy: null,
          beadId: null,
          answeredAt: null,
          updatedAt: newQ.updatedAt,
        });
      });

      expect(result.current.questions).toHaveLength(1);
      expect(result.current.questions[0]!.id).toBe('q-new');
    });

    it('should remove a question when question:answered WS event arrives', async () => {
      const q = makeQuestion({ id: 'q-open' });
      listFn().mockResolvedValue([q]);
      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.questions).toHaveLength(1);
      });

      act(() => {
        subscriberCallback?.({
          type: 'question:answered',
          questionId: 'q-open',
          status: 'answered',
        });
      });

      expect(result.current.questions).toHaveLength(0);
    });

    it('should remove a question when question:dismissed WS event arrives', async () => {
      const q = makeQuestion({ id: 'q-open-2' });
      listFn().mockResolvedValue([q]);
      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.questions).toHaveLength(1);
      });

      act(() => {
        subscriberCallback?.({
          type: 'question:dismissed',
          questionId: 'q-open-2',
          status: 'dismissed',
        });
      });

      expect(result.current.questions).toHaveLength(0);
    });

    it('should ignore WS messages with unrelated types', async () => {
      const q = makeQuestion({ id: 'q-stay' });
      listFn().mockResolvedValue([q]);
      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.questions).toHaveLength(1);
      });

      act(() => {
        subscriberCallback?.({ type: 'chat_message', body: 'irrelevant' });
      });

      expect(result.current.questions).toHaveLength(1);
    });
  });

  describe('answer — chosenOption', () => {
    it('should call answer API with chosenOption and remove question from open list', async () => {
      const q = makeQuestion({ id: 'q-opt', suggestedOptions: ['Yes', 'No'] });
      listFn().mockResolvedValue([q]);

      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.questions).toHaveLength(1);
      });

      await act(async () => {
        await result.current.answer('q-opt', { chosenOption: 'Yes' });
      });

      expect(answerFn()).toHaveBeenCalledWith('q-opt', { chosenOption: 'Yes' });
      expect(result.current.questions).toHaveLength(0);
    });
  });

  describe('answer — free text', () => {
    it('should call answer API with answerBody and remove question from open list', async () => {
      const q = makeQuestion({ id: 'q-text' });
      listFn().mockResolvedValue([q]);

      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.questions).toHaveLength(1);
      });

      await act(async () => {
        await result.current.answer('q-text', { answerBody: 'My free-text answer' });
      });

      expect(answerFn()).toHaveBeenCalledWith('q-text', { answerBody: 'My free-text answer' });
      expect(result.current.questions).toHaveLength(0);
    });

    it('should set error state when answer API fails', async () => {
      const q = makeQuestion({ id: 'q-err' });
      listFn().mockResolvedValue([q]);
      answerFn().mockRejectedValue(new Error('Answer failed'));

      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.questions).toHaveLength(1);
      });

      await act(async () => {
        try {
          await result.current.answer('q-err', { answerBody: 'text' });
        } catch {
          // Expected — hook rethrows for caller awareness
        }
      });

      expect(result.current.error).toBe('Answer failed');
      // Question stays in list on error
      expect(result.current.questions).toHaveLength(1);
    });
  });

  describe('dismiss', () => {
    it('should call dismiss API and remove question from open list', async () => {
      const q = makeQuestion({ id: 'q-dis' });
      listFn().mockResolvedValue([q]);

      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.questions).toHaveLength(1);
      });

      await act(async () => {
        await result.current.dismiss('q-dis');
      });

      expect(dismissFn()).toHaveBeenCalledWith('q-dis');
      expect(result.current.questions).toHaveLength(0);
    });

    it('should set error state when dismiss API fails', async () => {
      const q = makeQuestion({ id: 'q-dis-err' });
      listFn().mockResolvedValue([q]);
      dismissFn().mockRejectedValue(new Error('Dismiss failed'));

      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.questions).toHaveLength(1);
      });

      await act(async () => {
        try {
          await result.current.dismiss('q-dis-err');
        } catch {
          // Expected — hook rethrows for caller awareness
        }
      });

      expect(result.current.error).toBe('Dismiss failed');
      // Question stays in list on error
      expect(result.current.questions).toHaveLength(1);
    });
  });

  describe('filter state', () => {
    it('should re-fetch with category filter when setCategoryFilter is called', async () => {
      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setCategoryFilter('decision');
      });

      await waitFor(() => {
        expect(listFn()).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'open', category: 'decision' })
        );
      });
    });

    it('should re-fetch with agentId filter when setAgentFilter is called', async () => {
      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setAgentFilter('agent-alpha');
      });

      await waitFor(() => {
        expect(listFn()).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'open', agentId: 'agent-alpha' })
        );
      });
    });

    it('should re-fetch with urgency filter when setUrgencyFilter is called', async () => {
      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setUrgencyFilter('blocking');
      });

      await waitFor(() => {
        expect(listFn()).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'open', urgency: 'blocking' })
        );
      });
    });

    it('should expose current filter values', async () => {
      const { result } = renderHook(() => useOpenQuestions());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.categoryFilter).toBe('all');
      expect(result.current.agentFilter).toBe('all');
      expect(result.current.urgencyFilter).toBe('all');

      act(() => {
        result.current.setCategoryFilter('approval');
      });

      expect(result.current.categoryFilter).toBe('approval');
    });
  });
});
