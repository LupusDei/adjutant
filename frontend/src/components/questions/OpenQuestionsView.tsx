/**
 * OpenQuestionsView — Agent Question Triage (adj-181.4)
 *
 * Military-grade operations terminal for answering agent questions.
 * Each question is a filed intelligence report awaiting command authorization.
 *
 * Design: Pip-Boy retro terminal. Urgency levels treated as threat levels.
 * Interaction model: decisive — one-tap option buttons or free-text submission.
 *
 * adj-181.8  — AGENT filter exposed in the filter bar
 * adj-181.9  — WS filter gate enforced in hook (not in this component)
 * adj-181.10 — action_required chip is visually distinct (solid fill + [!] prefix)
 * adj-181.11 — per-row error display; errors surface in the row, not only globally
 * adj-181.12 — blocking rows have persistent left border anchor (not hover-only)
 * adj-181.14 — project field shown on each row
 * adj-181.15 — context auto-expands for high/blocking urgency
 * adj-181.16 — timeAgo/dismiss contrast fixed (#888 minimum)
 * adj-181.17 — category chip on-palette green (no cyan)
 * adj-181.18 — keyboard navigation: ArrowDown/j = next row, ArrowUp/k = prev row
 */
import {
  type CSSProperties,
  useState,
  useCallback,
  useRef,
  type SyntheticEvent,
  type KeyboardEvent,
} from 'react';

import { useOpenQuestions } from '../../hooks/useOpenQuestions';
import type { AgentQuestion, QuestionCategory, QuestionUrgency } from '../../types/questions';

// ── Urgency config ────────────────────────────────────────────────────────────

const URGENCY_COLORS: Record<QuestionUrgency, string> = {
  blocking: '#ff2222',
  high: '#ff8800',
  normal: '#00ff00',
  low: '#00aa00',
};

const URGENCY_LABELS: Record<QuestionUrgency, string> = {
  blocking: 'BLOCKING',
  high: 'HIGH',
  normal: 'NORMAL',
  low: 'LOW',
};

const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  decision: 'DECISION',
  clarification: 'CLARIFY',
  approval: 'APPROVAL',
  // adj-181.10: action_required is a "DO THIS" task, distinguished by [!] prefix
  action_required: 'ACTION_REQ',
  other: 'OTHER',
};

// Categories that are "do-action" tasks vs "answer questions" (adj-181.10)
const ACTION_CATEGORY = new Set<QuestionCategory>(['action_required']);

// ── Utilities ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${String(diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${String(diffHr)}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${String(diffDay)}d ago`;
}

// ── QuestionRow ───────────────────────────────────────────────────────────────

interface QuestionRowProps {
  question: AgentQuestion;
  onAnswer: (id: string, params: { answerBody?: string; chosenOption?: string }) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  /** Called when ArrowDown/j is pressed on this row (adj-181.18) */
  onFocusNext: () => void;
  /** Called when ArrowUp/k is pressed on this row (adj-181.18) */
  onFocusPrev: () => void;
}

function QuestionRow({ question, onAnswer, onDismiss, onFocusNext, onFocusPrev }: QuestionRowProps) {
  // adj-181.15: auto-expand context for high/blocking urgency rows
  const autoExpand = question.urgency === 'blocking' || question.urgency === 'high';
  const [contextExpanded, setContextExpanded] = useState(autoExpand);
  const [freeText, setFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // adj-181.11: per-row error state (not global banner only)
  const [rowError, setRowError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const urgencyColor = URGENCY_COLORS[question.urgency];
  const isBlocking = question.urgency === 'blocking';
  const isActionRequired = question.category !== null && question.category !== undefined && ACTION_CATEGORY.has(question.category);

  const handleOptionClick = useCallback(async (option: string) => {
    setSubmitting(true);
    setRowError(null);
    try {
      await onAnswer(question.id, { chosenOption: option });
    } catch (err) {
      // adj-181.11: surface error in this row, not just in global banner
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [question.id, onAnswer]);

  const handleFreeTextSubmit = useCallback(async (e: SyntheticEvent) => {
    e.preventDefault();
    const text = freeText.trim();
    if (!text) return;
    setSubmitting(true);
    setRowError(null);
    try {
      await onAnswer(question.id, { answerBody: text });
      setFreeText('');
    } catch (err) {
      // adj-181.11: surface error in this row
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [question.id, freeText, onAnswer]);

  const handleDismiss = useCallback(async () => {
    setSubmitting(true);
    setRowError(null);
    try {
      await onDismiss(question.id);
    } catch (err) {
      // adj-181.11: surface error in this row
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [question.id, onDismiss]);

  // adj-181.18: keyboard nav handler for the row container
  const handleRowKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      onFocusNext();
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      onFocusPrev();
    }
  }, [onFocusNext, onFocusPrev]);

  return (
    <div
      style={{
        ...styles.row,
        borderLeftColor: urgencyColor,
        // adj-181.12: persistent visual anchor for blocking rows
        ...(isBlocking ? styles.rowBlocking : {}),
      }}
      // adj-181.18: keyboard navigation — tabIndex makes the row focusable
      tabIndex={0}
      data-question-row
      data-question-id={question.id}
      onKeyDown={handleRowKeyDown}
      role="article"
      aria-label={`Question from ${question.agentId}: ${question.body}`}
    >
      {/* Header: agent + project + urgency + age + category */}
      <div style={styles.rowHeader}>
        <div style={styles.rowMeta}>
          <span style={styles.agentId}>{question.agentId.toUpperCase()}</span>

          {/* adj-181.14: project field */}
          <span style={styles.projectId} title={question.projectId}>
            {question.projectId}
          </span>

          <span style={{ ...styles.urgencyBadge, color: urgencyColor, borderColor: urgencyColor }}>
            {URGENCY_LABELS[question.urgency]}
          </span>

          {/* adj-181.10: action_required uses filled chip + [!] prefix; others use hollow border */}
          {question.category && (
            <span
              style={isActionRequired ? styles.categoryChipAction : styles.categoryChip}
              data-category={question.category}
              title={isActionRequired ? 'Action required — you must DO this' : 'Question category'}
            >
              {isActionRequired ? `[!] ${CATEGORY_LABELS[question.category]}` : CATEGORY_LABELS[question.category]}
            </span>
          )}

          {/* adj-181.16: timeAgo color raised to #888 from #555 */}
          <span style={styles.timeAgo}>{timeAgo(question.createdAt)}</span>
        </div>
        {/* adj-181.16: dismiss button color raised to #888 */}
        <button
          style={{ ...styles.dismissBtn, opacity: submitting ? 0.5 : 1 }}
          onClick={() => { void handleDismiss(); }}
          disabled={submitting}
          aria-label="Dismiss"
        >
          DISMISS
        </button>
      </div>

      {/* Question body */}
      <div style={styles.body}>{question.body}</div>

      {/* adj-181.11: per-row inline error */}
      {rowError !== null && (
        <div style={styles.rowError} role="alert">{rowError}</div>
      )}

      {/* Context block — adj-181.15: auto-expanded for high/blocking */}
      {question.context && (
        <div style={styles.contextSection}>
          <button
            style={styles.contextToggle}
            onClick={() => { setContextExpanded((v) => !v); }}
            aria-expanded={contextExpanded}
          >
            {contextExpanded ? '[-] CONTEXT' : '[+] CONTEXT'}
          </button>
          {contextExpanded && (
            <div style={styles.contextBlock}>{question.context}</div>
          )}
        </div>
      )}

      {/* Answer section */}
      <div style={styles.answerSection}>
        {/* Suggested option buttons */}
        {question.suggestedOptions && question.suggestedOptions.length > 0 && (
          <div style={styles.optionRow}>
            {question.suggestedOptions.map((opt) => (
              <button
                key={opt}
                style={{ ...styles.optionBtn, opacity: submitting ? 0.5 : 1 }}
                onClick={() => { void handleOptionClick(opt); }}
                disabled={submitting}
                aria-label={opt}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {/* Free-text answer */}
        <form onSubmit={(e) => { void handleFreeTextSubmit(e); }} style={styles.answerForm}>
          <textarea
            ref={textareaRef}
            style={styles.answerInput}
            value={freeText}
            onChange={(e) => { setFreeText(e.target.value); }}
            placeholder="Answer..."
            rows={2}
            disabled={submitting}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                void handleFreeTextSubmit(e);
              }
            }}
          />
          <button
            type="submit"
            style={{ ...styles.submitBtn, opacity: submitting || !freeText.trim() ? 0.5 : 1 }}
            disabled={submitting || !freeText.trim()}
          >
            SEND
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export interface OpenQuestionsViewProps {
  isActive?: boolean;
}

const URGENCY_FILTERS: { value: QuestionUrgency | 'all'; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'blocking', label: 'BLOCKING' },
  { value: 'high', label: 'HIGH' },
  { value: 'normal', label: 'NORMAL' },
  { value: 'low', label: 'LOW' },
];

const CATEGORY_FILTERS: { value: QuestionCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'decision', label: 'DECISION' },
  { value: 'clarification', label: 'CLARIFY' },
  { value: 'approval', label: 'APPROVAL' },
  { value: 'action_required', label: 'ACTION_REQ' },
  { value: 'other', label: 'OTHER' },
];

export function OpenQuestionsView({ isActive: _isActive }: OpenQuestionsViewProps) {
  const {
    questions,
    loading,
    error,
    urgencyFilter,
    categoryFilter,
    agentFilter,
    setUrgencyFilter,
    setCategoryFilter,
    setAgentFilter,
    answer,
    dismiss,
  } = useOpenQuestions();

  // adj-181.18: ref to the list container so we can query row elements for focus
  const listRef = useRef<HTMLDivElement>(null);

  const focusRow = useCallback((index: number) => {
    if (!listRef.current) return;
    const rows = listRef.current.querySelectorAll<HTMLElement>('[data-question-row]');
    const el = rows[index];
    if (el) el.focus();
  }, []);

  // adj-181.8: derive unique agent IDs from the current question list for the agent filter
  const uniqueAgents = Array.from(new Set(questions.map((q) => q.agentId))).sort();

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.viewHeader}>
        <span style={styles.viewTitle}>OPEN QUESTIONS</span>
        <span style={styles.viewCount}>{questions.length} PENDING</span>
      </div>

      {/* Filter bar — urgency, category, and agent (adj-181.8) */}
      <div style={styles.filterBar}>
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>URGENCY:</span>
          {URGENCY_FILTERS.map((f) => (
            <button
              key={f.value}
              style={{
                ...styles.filterBtn,
                ...(urgencyFilter === f.value ? styles.filterBtnActive : {}),
              }}
              onClick={() => { setUrgencyFilter(f.value); }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>CATEGORY:</span>
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.value}
              style={{
                ...styles.filterBtn,
                ...(categoryFilter === f.value ? styles.filterBtnActive : {}),
              }}
              onClick={() => { setCategoryFilter(f.value); }}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* adj-181.8: agent filter row */}
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>AGENT:</span>
          <button
            style={{
              ...styles.filterBtn,
              ...(agentFilter === 'all' ? styles.filterBtnActive : {}),
            }}
            onClick={() => { setAgentFilter('all'); }}
          >
            AGENT: ALL
          </button>
          {uniqueAgents.map((agentId) => (
            <button
              key={agentId}
              style={{
                ...styles.filterBtn,
                ...(agentFilter === agentId ? styles.filterBtnActive : {}),
              }}
              onClick={() => { setAgentFilter(agentId); }}
            >
              {agentId.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* States */}
      {error && (
        <div style={styles.errorBar}>{error}</div>
      )}

      {loading && (
        <div style={styles.loadingBar}>LOADING...</div>
      )}

      {/* Question list */}
      {!loading && !error && questions.length === 0 && (
        <div style={styles.emptyState}>NO OPEN QUESTIONS</div>
      )}

      <div style={styles.list} ref={listRef}>
        {questions.map((q, idx) => (
          <QuestionRow
            key={q.id}
            question={q}
            onAnswer={answer}
            onDismiss={dismiss}
            onFocusNext={() => { focusRow(idx + 1); }}
            onFocusPrev={() => { focusRow(idx - 1); }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const MONO = 'var(--font-mono, monospace)';
const GREEN = 'var(--pipboy-green, #00ff00)';
const GREEN_DIM = 'var(--pipboy-green-dim, #00aa00)';
const BG_PANEL = 'var(--pipboy-bg-panel, #111111)';

const styles: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    fontFamily: MONO,
    overflowY: 'auto',
  },
  viewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: `1px solid ${GREEN_DIM}`,
    marginBottom: '8px',
  },
  viewTitle: {
    color: GREEN,
    fontSize: '14px',
    fontWeight: 'bold',
    letterSpacing: '2px',
  },
  viewCount: {
    color: GREEN_DIM,
    fontSize: '11px',
    letterSpacing: '1px',
  },
  filterBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '6px 0',
    borderBottom: `1px solid ${GREEN_DIM}`,
    marginBottom: '10px',
  },
  filterGroup: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
    alignItems: 'center',
  },
  filterLabel: {
    color: GREEN_DIM,
    fontSize: '10px',
    letterSpacing: '1px',
    marginRight: '4px',
    width: '70px',
    flexShrink: 0,
  },
  filterBtn: {
    background: 'transparent',
    border: '1px solid transparent',
    color: GREEN_DIM,
    padding: '2px 7px',
    fontSize: '10px',
    fontFamily: MONO,
    cursor: 'pointer',
    letterSpacing: '0.5px',
    textTransform: 'uppercase' as const,
  },
  filterBtnActive: {
    border: `1px solid ${GREEN}`,
    color: GREEN,
    textShadow: `0 0 4px var(--pipboy-green-glow, #00ff0066)`,
  },
  errorBar: {
    color: '#ff4444',
    border: '1px solid #ff4444',
    padding: '6px 10px',
    fontSize: '12px',
    marginBottom: '8px',
  },
  loadingBar: {
    color: GREEN_DIM,
    fontSize: '12px',
    padding: '8px 0',
    letterSpacing: '2px',
  },
  emptyState: {
    color: GREEN_DIM,
    fontSize: '13px',
    textAlign: 'center' as const,
    padding: '40px 20px',
    letterSpacing: '2px',
  },
  list: {
    flex: 1,
  },

  // Row styles
  row: {
    borderLeft: '3px solid',
    borderBottom: `1px solid ${GREEN_DIM}`,
    padding: '10px 14px',
    marginBottom: '6px',
    background: BG_PANEL,
    // adj-181.18: visible focus ring for keyboard nav (60fps safe — outline, not layout)
    outline: 'none',
  },
  rowBlocking: {
    // adj-181.12: PERSISTENT visual anchor for blocking rows — always-on, not hover-dependent.
    // Background tint + strong inset left shadow create an unmissable anchoring effect.
    // Uses opacity-based approach (no layout thrash) for 60fps compliance.
    background: 'rgba(255, 34, 34, 0.04)',
    boxShadow: 'inset 4px 0 0 rgba(255, 34, 34, 0.7)',
  },
  rowHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  rowMeta: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    gap: '8px',
  },
  agentId: {
    color: GREEN,
    fontSize: '11px',
    fontWeight: 'bold',
    letterSpacing: '1px',
  },
  // adj-181.14: project field — dimmer than agent, readable contrast
  projectId: {
    // adj-181.16: #888 provides readable contrast on #0a0a0a / #111111 dark bg
    color: '#888',
    fontSize: '9px',
    fontFamily: MONO,
    letterSpacing: '0.5px',
    maxWidth: '140px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  urgencyBadge: {
    fontSize: '10px',
    padding: '1px 5px',
    border: '1px solid',
    fontWeight: 'bold',
    letterSpacing: '0.5px',
    fontFamily: MONO,
  },
  // adj-181.17: on-palette green (replaced off-palette #00ccff cyan)
  categoryChip: {
    color: GREEN_DIM,
    border: `1px solid ${GREEN_DIM}`,
    fontSize: '9px',
    padding: '1px 4px',
    letterSpacing: '0.5px',
    fontFamily: MONO,
  },
  // adj-181.10: action_required gets solid filled chip to visually signal "DO THIS, not answer"
  // Amber/orange fill makes it unmissable vs the hollow green question chips
  categoryChipAction: {
    color: '#0a0a0a',
    background: '#cc8800',
    border: '1px solid #cc8800',
    fontSize: '9px',
    padding: '1px 4px',
    letterSpacing: '0.5px',
    fontFamily: MONO,
    fontWeight: 'bold',
  },
  // adj-181.16: raised from #555 (near-invisible) to #888 (readable on dark bg)
  timeAgo: {
    color: '#888',
    fontSize: '10px',
    fontFamily: MONO,
  },
  // adj-181.16: raised from #555 to #888 for dismiss button
  dismissBtn: {
    background: 'transparent',
    border: '1px solid #888',
    color: '#888',
    padding: '2px 8px',
    fontSize: '10px',
    fontFamily: MONO,
    cursor: 'pointer',
    letterSpacing: '0.5px',
    textTransform: 'uppercase' as const,
    flexShrink: 0,
  },
  // adj-181.11: per-row inline error display
  rowError: {
    color: '#ff4444',
    fontSize: '10px',
    fontFamily: MONO,
    marginBottom: '6px',
    letterSpacing: '0.5px',
  },
  body: {
    color: GREEN,
    fontSize: '13px',
    lineHeight: '1.5',
    marginBottom: '8px',
  },
  contextSection: {
    marginBottom: '8px',
  },
  contextToggle: {
    background: 'transparent',
    border: 'none',
    color: GREEN_DIM,
    fontSize: '10px',
    fontFamily: MONO,
    cursor: 'pointer',
    padding: '0',
    letterSpacing: '0.5px',
    textTransform: 'uppercase' as const,
  },
  contextBlock: {
    marginTop: '6px',
    padding: '8px 10px',
    borderLeft: `2px solid ${GREEN_DIM}`,
    color: GREEN_DIM,
    fontSize: '11px',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap' as const,
    background: 'rgba(0, 170, 0, 0.05)',
  },
  answerSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  optionRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '6px',
  },
  optionBtn: {
    background: 'transparent',
    border: `1px solid ${GREEN}`,
    color: GREEN,
    padding: '3px 10px',
    fontSize: '11px',
    fontFamily: MONO,
    cursor: 'pointer',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    transition: 'box-shadow 0.1s ease',
  },
  answerForm: {
    display: 'flex',
    gap: '6px',
    alignItems: 'flex-start',
  },
  answerInput: {
    flex: 1,
    background: 'rgba(0, 170, 0, 0.07)',
    border: `1px solid ${GREEN_DIM}`,
    color: GREEN,
    padding: '4px 8px',
    fontSize: '11px',
    fontFamily: MONO,
    outline: 'none',
    resize: 'vertical' as const,
    caretColor: GREEN,
  },
  submitBtn: {
    background: 'transparent',
    border: `1px solid ${GREEN}`,
    color: GREEN,
    padding: '4px 12px',
    fontSize: '11px',
    fontFamily: MONO,
    cursor: 'pointer',
    fontWeight: 'bold',
    letterSpacing: '0.5px',
    flexShrink: 0,
    alignSelf: 'flex-end',
  },
};
