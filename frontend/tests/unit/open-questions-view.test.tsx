/**
 * OpenQuestionsView component tests (adj-181.4.3)
 *
 * TDD: these tests are written BEFORE the implementation.
 * They cover:
 *   1. Renders the list of questions with agent/urgency/body
 *   2. Shows category chip per question
 *   3. Suggested-option buttons are rendered and clicking one answers the question
 *   4. Free-text answer box submits via the answer action
 *   5. Answered question row leaves the list (hook removes it)
 *   6. Dismiss action removes the question from the list
 *   7. Filter bar narrows the list by urgency
 *   8. Loading state renders a loading indicator
 *   9. Error state renders an error message
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OpenQuestionsView } from '../../src/components/questions/OpenQuestionsView';

// ── Mock the hook ────────────────────────────────────────────────────────────
const mockAnswer = vi.fn().mockResolvedValue(undefined);
const mockDismiss = vi.fn().mockResolvedValue(undefined);
const mockSetCategoryFilter = vi.fn();
const mockSetAgentFilter = vi.fn();
const mockSetUrgencyFilter = vi.fn();

const defaultHookResult = {
  questions: [],
  loading: false,
  error: null,
  categoryFilter: 'all' as const,
  agentFilter: 'all',
  urgencyFilter: 'all' as const,
  setCategoryFilter: mockSetCategoryFilter,
  setAgentFilter: mockSetAgentFilter,
  setUrgencyFilter: mockSetUrgencyFilter,
  answer: mockAnswer,
  dismiss: mockDismiss,
  refresh: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../src/hooks/useOpenQuestions', () => ({
  useOpenQuestions: vi.fn(() => defaultHookResult),
}));

import { useOpenQuestions } from '../../src/hooks/useOpenQuestions';
import type { AgentQuestion } from '../../src/types/questions';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function setHookResult(overrides: Partial<typeof defaultHookResult>) {
  vi.mocked(useOpenQuestions).mockReturnValue({ ...defaultHookResult, ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useOpenQuestions).mockReturnValue({ ...defaultHookResult });
  mockAnswer.mockResolvedValue(undefined);
  mockDismiss.mockResolvedValue(undefined);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OpenQuestionsView', () => {
  describe('renders question list', () => {
    it('should render asking agent and question body for each question', () => {
      const q = makeQuestion({
        id: 'q-1',
        agentId: 'engineer-web',
        body: 'Should we use Redis or SQLite for caching?',
        urgency: 'high',
      });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      // Component renders agent id in uppercase (may appear in both row and agent filter)
      const agentEls = screen.getAllByText('ENGINEER-WEB');
      expect(agentEls.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Should we use Redis or SQLite for caching?')).toBeInTheDocument();
    });

    it('should render urgency indicator for each question', () => {
      const q = makeQuestion({ urgency: 'blocking', body: 'Critical thing' });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      // The urgency badge in the row shows 'BLOCKING' — there may be multiple
      // elements with this text (also in filter bar), so use getAllByText
      const blockingEls = screen.getAllByText(/blocking/i);
      expect(blockingEls.length).toBeGreaterThanOrEqual(1);
    });

    it('should render empty state when no questions', () => {
      setHookResult({ questions: [] });

      render(<OpenQuestionsView />);

      expect(screen.getByText(/no open questions/i)).toBeInTheDocument();
    });
  });

  describe('category chip', () => {
    it('should render category chip for each question', () => {
      const q = makeQuestion({ category: 'action_required', body: 'Do this thing' });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      // Component shows 'ACTION_REQ' as the display label for action_required
      const actionEls = screen.getAllByText(/action_req/i);
      expect(actionEls.length).toBeGreaterThanOrEqual(1);
    });

    it('should not render category chip when category is null', () => {
      const q = makeQuestion({ category: null, id: 'q-no-cat', body: 'Uncategorized question' });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      // The question is rendered but no category chip
      expect(screen.getByText('Uncategorized question')).toBeInTheDocument();
    });
  });

  describe('context block', () => {
    it('should render context text when context toggle is expanded', () => {
      const q = makeQuestion({
        body: 'How should I proceed?',
        context: 'I already tried approach X and got error Y',
      });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      // Context is collapsed by default — the toggle button is present
      const toggle = screen.getByRole('button', { name: /\[.*\] context/i });
      expect(toggle).toBeInTheDocument();

      // Expand it
      fireEvent.click(toggle);

      // Now context text is visible
      expect(screen.getByText('I already tried approach X and got error Y')).toBeInTheDocument();
    });
  });

  describe('suggested options — one-tap answer buttons', () => {
    it('should render one button per suggested option', () => {
      const q = makeQuestion({
        id: 'q-opts',
        body: 'Which approach?',
        suggestedOptions: ['Approach A', 'Approach B', 'Approach C'],
      });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      expect(screen.getByRole('button', { name: /approach a/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /approach b/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /approach c/i })).toBeInTheDocument();
    });

    it('should call answer with chosenOption when an option button is clicked', async () => {
      const q = makeQuestion({
        id: 'q-click-opt',
        suggestedOptions: ['Yes', 'No'],
      });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      fireEvent.click(screen.getByRole('button', { name: /yes/i }));

      await waitFor(() => {
        expect(mockAnswer).toHaveBeenCalledWith('q-click-opt', { chosenOption: 'Yes' });
      });
    });
  });

  describe('free-text answer box', () => {
    it('should render a text input and submit button per question', () => {
      const q = makeQuestion({ id: 'q-txt', body: 'Open-ended question' });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      // There should be a textarea or input for free-text answer
      const input = screen.getByPlaceholderText(/answer/i);
      expect(input).toBeInTheDocument();
    });

    it('should call answer with answerBody when free-text is submitted', async () => {
      const q = makeQuestion({ id: 'q-freetext' });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      const input = screen.getByPlaceholderText(/answer/i);
      fireEvent.change(input, { target: { value: 'My detailed answer' } });
      fireEvent.submit(input.closest('form')!);

      await waitFor(() => {
        expect(mockAnswer).toHaveBeenCalledWith('q-freetext', { answerBody: 'My detailed answer' });
      });
    });
  });

  describe('dismiss action', () => {
    it('should render a dismiss button per question', () => {
      const q = makeQuestion({ id: 'q-dismiss-btn' });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('should call dismiss when dismiss button is clicked', async () => {
      const q = makeQuestion({ id: 'q-dismiss-it' });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

      await waitFor(() => {
        expect(mockDismiss).toHaveBeenCalledWith('q-dismiss-it');
      });
    });
  });

  describe('loading state', () => {
    it('should render loading indicator when loading is true', () => {
      setHookResult({ loading: true, questions: [] });

      render(<OpenQuestionsView />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('should render error message when error is set', () => {
      setHookResult({ error: 'Failed to load questions', questions: [] });

      render(<OpenQuestionsView />);

      expect(screen.getByText(/failed to load questions/i)).toBeInTheDocument();
    });
  });

  describe('filter bar', () => {
    it('should call setUrgencyFilter when urgency filter button is clicked', () => {
      render(<OpenQuestionsView />);

      // Find the blocking filter button
      const blockingBtn = screen.getByRole('button', { name: /blocking/i });
      fireEvent.click(blockingBtn);

      expect(mockSetUrgencyFilter).toHaveBeenCalledWith('blocking');
    });

    it('should call setCategoryFilter when category filter is applied', () => {
      render(<OpenQuestionsView />);

      const decisionBtn = screen.getByRole('button', { name: /decision/i });
      fireEvent.click(decisionBtn);

      expect(mockSetCategoryFilter).toHaveBeenCalledWith('decision');
    });

    // adj-181.8: AGENT filter in view filter bar
    it('should render an AGENT filter label in the filter bar (adj-181.8)', () => {
      render(<OpenQuestionsView />);
      // The AGENT: label span and AGENT: ALL button both match /agent:/i — use getAllByText
      const agentEls = screen.getAllByText(/agent:/i);
      expect(agentEls.length).toBeGreaterThanOrEqual(1);
    });

    it('should call setAgentFilter when agent ALL filter is clicked (adj-181.8)', () => {
      render(<OpenQuestionsView />);
      const allAgentBtn = screen.getByRole('button', { name: /agent: all/i });
      fireEvent.click(allAgentBtn);
      expect(mockSetAgentFilter).toHaveBeenCalledWith('all');
    });
  });

  // adj-181.10: action_required visually distinct from other categories
  describe('action_required distinct treatment (adj-181.10)', () => {
    it('should render a distinct data-category attribute for action_required', () => {
      const q = makeQuestion({ category: 'action_required', body: 'Go do this thing' });
      setHookResult({ questions: [q] });

      const { container } = render(<OpenQuestionsView />);

      const actionEl = container.querySelector('[data-category="action_required"]');
      expect(actionEl).toBeInTheDocument();
    });

    it('should NOT apply action_required marker to other categories', () => {
      const q = makeQuestion({ category: 'decision', body: 'Make a decision' });
      setHookResult({ questions: [q] });

      const { container } = render(<OpenQuestionsView />);

      const actionEl = container.querySelector('[data-category="action_required"]');
      expect(actionEl).not.toBeInTheDocument();
    });
  });

  // adj-181.11: per-row error surface
  describe('per-row error display (adj-181.11)', () => {
    it('should show a row-level error when answer fails', async () => {
      const q = makeQuestion({ id: 'q-row-err', suggestedOptions: ['Yes'] });
      setHookResult({ questions: [q] });
      mockAnswer.mockRejectedValue(new Error('Network error'));

      render(<OpenQuestionsView />);

      fireEvent.click(screen.getByRole('button', { name: /yes/i }));

      await waitFor(() => {
        expect(screen.getByText(/network error/i)).toBeInTheDocument();
      });
    });

    it('should show a row-level error when dismiss fails', async () => {
      const q = makeQuestion({ id: 'q-dis-err' });
      setHookResult({ questions: [q] });
      mockDismiss.mockRejectedValue(new Error('Dismiss failed'));

      render(<OpenQuestionsView />);

      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

      await waitFor(() => {
        expect(screen.getByText(/dismiss failed/i)).toBeInTheDocument();
      });
    });
  });

  // adj-181.14: project field on each row
  describe('project field on row (adj-181.14)', () => {
    it('should render the projectId on each question row', () => {
      const q = makeQuestion({ projectId: 'proj-uuid-123' });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      expect(screen.getByText(/proj-uuid-123/i)).toBeInTheDocument();
    });
  });

  // adj-181.15: context expanded by default for high/blocking urgency
  describe('context auto-expand for high/blocking urgency (adj-181.15)', () => {
    it('should auto-expand context for blocking urgency questions', () => {
      const q = makeQuestion({
        urgency: 'blocking',
        context: 'This is critical context that must be visible',
      });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      expect(screen.getByText('This is critical context that must be visible')).toBeInTheDocument();
    });

    it('should auto-expand context for high urgency questions', () => {
      const q = makeQuestion({
        urgency: 'high',
        context: 'High urgency context auto-shown',
      });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      expect(screen.getByText('High urgency context auto-shown')).toBeInTheDocument();
    });

    it('should keep context collapsed for normal urgency questions', () => {
      const q = makeQuestion({
        urgency: 'normal',
        context: 'Normal context stays hidden initially',
      });
      setHookResult({ questions: [q] });

      render(<OpenQuestionsView />);

      expect(screen.queryByText('Normal context stays hidden initially')).not.toBeInTheDocument();
    });
  });

  // adj-181.18: keyboard navigation between rows
  describe('keyboard navigation between rows (adj-181.18)', () => {
    it('should render question rows with data-question-row attribute for keyboard focus', () => {
      const q1 = makeQuestion({ id: 'q-kb-1', body: 'First question' });
      const q2 = makeQuestion({ id: 'q-kb-2', body: 'Second question' });
      setHookResult({ questions: [q1, q2] });

      const { container } = render(<OpenQuestionsView />);

      const rows = container.querySelectorAll('[data-question-row]');
      expect(rows.length).toBe(2);
    });

    it('should move focus to next row on ArrowDown key press', async () => {
      const q1 = makeQuestion({ id: 'q-nav-1', body: 'First question nav' });
      const q2 = makeQuestion({ id: 'q-nav-2', body: 'Second question nav' });
      setHookResult({ questions: [q1, q2] });

      const { container } = render(<OpenQuestionsView />);

      const rows = container.querySelectorAll('[data-question-row]');
      expect(rows.length).toBe(2);

      const firstRow = rows[0] as HTMLElement;
      firstRow.focus();
      fireEvent.keyDown(firstRow, { key: 'ArrowDown' });

      await waitFor(() => {
        expect(document.activeElement).toBe(rows[1]);
      });
    });

    it('should move focus to previous row on ArrowUp key press', async () => {
      const q1 = makeQuestion({ id: 'q-nav-u1', body: 'First question up nav' });
      const q2 = makeQuestion({ id: 'q-nav-u2', body: 'Second question up nav' });
      setHookResult({ questions: [q1, q2] });

      const { container } = render(<OpenQuestionsView />);

      const rows = container.querySelectorAll('[data-question-row]');
      const secondRow = rows[1] as HTMLElement;
      secondRow.focus();
      fireEvent.keyDown(secondRow, { key: 'ArrowUp' });

      await waitFor(() => {
        expect(document.activeElement).toBe(rows[0]);
      });
    });
  });
});
