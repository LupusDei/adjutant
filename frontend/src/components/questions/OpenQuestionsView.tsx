/**
 * OpenQuestionsView — Agent Question Triage (adj-181.4)
 *
 * Military-grade operations terminal for answering agent questions.
 * Each question is a filed intelligence report awaiting command authorization.
 *
 * Design: Pip-Boy retro terminal. Urgency levels treated as threat levels.
 * Interaction model: decisive — one-tap option buttons or free-text submission.
 */
import { type CSSProperties, useState, useCallback, useRef, type SyntheticEvent } from 'react';

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
  action_required: 'ACTION_REQ',
  other: 'OTHER',
};

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
}

function QuestionRow({ question, onAnswer, onDismiss }: QuestionRowProps) {
  const [contextExpanded, setContextExpanded] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const urgencyColor = URGENCY_COLORS[question.urgency];
  const isBlocking = question.urgency === 'blocking';

  const handleOptionClick = useCallback(async (option: string) => {
    setSubmitting(true);
    try {
      await onAnswer(question.id, { chosenOption: option });
    } catch {
      // error handled in hook
    } finally {
      setSubmitting(false);
    }
  }, [question.id, onAnswer]);

  const handleFreeTextSubmit = useCallback(async (e: SyntheticEvent) => {
    e.preventDefault();
    const text = freeText.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      await onAnswer(question.id, { answerBody: text });
      setFreeText('');
    } catch {
      // error handled in hook
    } finally {
      setSubmitting(false);
    }
  }, [question.id, freeText, onAnswer]);

  const handleDismiss = useCallback(async () => {
    setSubmitting(true);
    try {
      await onDismiss(question.id);
    } catch {
      // error handled in hook
    } finally {
      setSubmitting(false);
    }
  }, [question.id, onDismiss]);

  return (
    <div style={{
      ...styles.row,
      borderLeftColor: urgencyColor,
      ...(isBlocking ? styles.rowBlocking : {}),
    }}>
      {/* Header: agent + urgency + age + category */}
      <div style={styles.rowHeader}>
        <div style={styles.rowMeta}>
          <span style={styles.agentId}>{question.agentId.toUpperCase()}</span>
          <span style={{ ...styles.urgencyBadge, color: urgencyColor, borderColor: urgencyColor }}>
            {URGENCY_LABELS[question.urgency]}
          </span>
          {question.category && (
            <span style={styles.categoryChip}>
              {CATEGORY_LABELS[question.category]}
            </span>
          )}
          <span style={styles.timeAgo}>{timeAgo(question.createdAt)}</span>
        </div>
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

      {/* Context block — collapsible */}
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
    setUrgencyFilter,
    setCategoryFilter,
    answer,
    dismiss,
  } = useOpenQuestions();

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.viewHeader}>
        <span style={styles.viewTitle}>OPEN QUESTIONS</span>
        <span style={styles.viewCount}>{questions.length} PENDING</span>
      </div>

      {/* Filter bar */}
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

      <div style={styles.list}>
        {questions.map((q) => (
          <QuestionRow
            key={q.id}
            question={q}
            onAnswer={answer}
            onDismiss={dismiss}
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
    transition: 'box-shadow 0.15s ease',
  },
  rowBlocking: {
    boxShadow: '0 0 8px rgba(255, 34, 34, 0.2)',
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
  urgencyBadge: {
    fontSize: '10px',
    padding: '1px 5px',
    border: '1px solid',
    fontWeight: 'bold',
    letterSpacing: '0.5px',
    fontFamily: MONO,
  },
  categoryChip: {
    color: '#00ccff',
    border: '1px solid #00ccff',
    fontSize: '9px',
    padding: '1px 4px',
    letterSpacing: '0.5px',
    fontFamily: MONO,
  },
  timeAgo: {
    color: '#555',
    fontSize: '10px',
    fontFamily: MONO,
  },
  dismissBtn: {
    background: 'transparent',
    border: '1px solid #555',
    color: '#555',
    padding: '2px 8px',
    fontSize: '10px',
    fontFamily: MONO,
    cursor: 'pointer',
    letterSpacing: '0.5px',
    textTransform: 'uppercase' as const,
    flexShrink: 0,
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
