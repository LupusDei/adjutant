/**
 * EpicDetailView - Slide-out panel showing epic details and subtasks.
 * Pip-Boy terminal aesthetic matching the rest of the UI.
 */

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useEpicDetail } from '../../hooks';
import type { BeadInfo } from '../../types';

export interface EpicDetailViewProps {
  epicId: string | null;
  onClose: () => void;
  onBeadClick?: (beadId: string) => void;
}

/**
 * Gets priority display info.
 */
function getPriorityInfo(priority: number): { label: string; color: string } {
  switch (priority) {
    case 0:
      return { label: 'P0', color: '#FF4444' };
    case 1:
      return { label: 'P1', color: '#FFB000' };
    case 2:
      return { label: 'P2', color: 'var(--crt-phosphor)' };
    case 3:
      return { label: 'P3', color: 'var(--crt-phosphor-dim)' };
    case 4:
      return { label: 'P4', color: '#666666' };
    default:
      return { label: `P${priority}`, color: 'var(--crt-phosphor-dim)' };
  }
}


/**
 * Formats a timestamp for display.
 */
function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

/**
 * Copies text to clipboard.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets color for progress bar based on completion percentage.
 */
function getProgressColor(progress: number, isComplete: boolean): string {
  if (isComplete) {
    return '#00FF00'; // Success green
  } else if (progress > 0.5) {
    return 'var(--crt-phosphor)';
  } else if (progress > 0) {
    return '#FFB000'; // Warning amber
  } else {
    return 'var(--crt-phosphor-dim)';
  }
}

/**
 * Subtask row component.
 */
function SubtaskRow({
  subtask,
  onClick,
}: {
  subtask: BeadInfo;
  onClick: () => void;
}) {
  const priorityInfo = getPriorityInfo(subtask.priority);
  const isClosed = subtask.status === 'closed';

  return (
    <button style={styles.subtaskRow} onClick={onClick}>
      {/* Status indicator */}
      <span
        style={{
          ...styles.statusIndicator,
          color: isClosed ? '#00FF00' : 'var(--crt-phosphor-dim)',
        }}
      >
        {isClosed ? '\u2713' : '\u25CB'}
      </span>

      {/* Title and metadata */}
      <div style={styles.subtaskContent}>
        <span style={styles.subtaskTitle}>{subtask.title}</span>
        <div style={styles.subtaskMeta}>
          <span style={styles.subtaskId}>{subtask.id.toUpperCase()}</span>
          {subtask.assignee && (
            <span style={styles.subtaskAssignee}>{subtask.assignee}</span>
          )}
        </div>
      </div>

      {/* Priority badge */}
      <span
        style={{
          ...styles.priorityBadge,
          backgroundColor: priorityInfo.color + '20',
          borderColor: priorityInfo.color,
          color: priorityInfo.color,
        }}
      >
        {priorityInfo.label}
      </span>

      {/* Chevron */}
      <span style={styles.chevron}>&gt;</span>
    </button>
  );
}

/**
 * Section header for subtask groups.
 */
function SubtaskSection({
  title,
  count,
  subtasks,
  onSubtaskClick,
}: {
  title: string;
  count: number;
  subtasks: BeadInfo[];
  onSubtaskClick: (id: string) => void;
}) {
  if (subtasks.length === 0) return null;

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <h4 style={styles.sectionTitle}>{title}</h4>
        <span style={styles.sectionCount}>{count}</span>
      </div>
      {subtasks.map((subtask) => (
        <SubtaskRow
          key={subtask.id}
          subtask={subtask}
          onClick={() => { onSubtaskClick(subtask.id); }}
        />
      ))}
    </div>
  );
}

export function EpicDetailView({ epicId, onClose, onBeadClick }: EpicDetailViewProps) {
  const {
    epic,
    openSubtasks,
    closedSubtasks,
    subtasks,
    progress,
    progressText,
    isComplete,
    loading,
    error,
    refresh,
  } = useEpicDetail(epicId);

  const [copied, setCopied] = useState(false);

  const handleCopyId = useCallback(() => {
    if (!epic) return;
    void copyToClipboard(epic.id).then((didCopy) => {
      if (didCopy) {
        setCopied(true);
        setTimeout(() => { setCopied(false); }, 2000);
      }
    });
  }, [epic]);

  const handleSubtaskClick = useCallback(
    (id: string) => {
      if (onBeadClick) {
        onBeadClick(id);
      }
    },
    [onBeadClick]
  );

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, [onClose]);

  // Don't render if no epic selected
  if (!epicId) return null;

  const progressColor = getProgressColor(progress, isComplete);

  return (
    <>
      {/* Backdrop */}
      <div style={styles.backdrop} onClick={onClose} />

      {/* Panel */}
      <div style={styles.panel}>
        {/* Header */}
        <div style={styles.header}>
          <button style={styles.backButton} onClick={onClose} aria-label="Back">
            &lt; BACK
          </button>
          <h2 style={styles.headerTitle}>EPIC DETAIL</h2>
          <button
            style={styles.refreshButton}
            onClick={handleRefresh}
            aria-label="Refresh"
            disabled={loading}
          >
            {loading ? '...' : '\u21BB'}
          </button>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {loading && !epic && (
            <div style={styles.loadingState}>
              <div style={styles.loadingPulse} />
              LOADING...
            </div>
          )}

          {error && (
            <div style={styles.errorState}>
              <div style={styles.errorText}>ERROR: {error}</div>
              <button style={styles.retryButton} onClick={handleRefresh}>
                RETRY
              </button>
            </div>
          )}

          {epic && (
            <>
              {/* Epic Header Card */}
              <div style={styles.epicHeader}>
                {/* Title */}
                <h3 style={styles.epicTitle}>{epic.title}</h3>

                {/* ID and copy button */}
                <div style={styles.idRow}>
                  <span style={styles.epicId}>{epic.id.toUpperCase()}</span>
                  <button
                    style={styles.copyButton}
                    onClick={handleCopyId}
                    title="Copy ID"
                  >
                    {copied ? '\u2713' : '\u2398'}
                  </button>
                  {epic.rig && <span style={styles.rigBadge}>{epic.rig.toUpperCase()}</span>}
                  <span
                    style={{
                      ...styles.priorityBadge,
                      backgroundColor: getPriorityInfo(epic.priority).color + '20',
                      borderColor: getPriorityInfo(epic.priority).color,
                      color: getPriorityInfo(epic.priority).color,
                    }}
                  >
                    {getPriorityInfo(epic.priority).label}
                  </span>
                </div>

                {/* Timestamps */}
                {formatTimestamp(epic.createdAt) && (
                  <div style={styles.timestampRow}>
                    <span style={styles.timestampLabel}>CREATED:</span>
                    <span style={styles.timestampValue}>
                      {formatTimestamp(epic.createdAt)}
                    </span>
                  </div>
                )}
                {formatTimestamp(epic.updatedAt) && (
                  <div style={styles.timestampRow}>
                    <span style={styles.timestampLabel}>UPDATED:</span>
                    <span style={styles.timestampValue}>
                      {formatTimestamp(epic.updatedAt)}
                    </span>
                  </div>
                )}
              </div>

              {/* Progress Section */}
              <div style={styles.progressSection}>
                <div style={styles.progressHeader}>
                  <span style={styles.progressLabel}>PROGRESS</span>
                  <span style={styles.progressText}>{progressText}</span>
                </div>

                {/* Progress bar */}
                <div style={styles.progressBarContainer}>
                  <div style={styles.progressBarBackground}>
                    <div
                      style={{
                        ...styles.progressBarFill,
                        width: `${progress * 100}%`,
                        backgroundColor: progressColor,
                        boxShadow: `0 0 8px ${progressColor}`,
                      }}
                    />
                  </div>
                </div>

                {/* Status text */}
                <div style={styles.progressStatus}>
                  <span
                    style={{
                      ...styles.progressStatusText,
                      color: isComplete ? '#00FF00' : 'var(--crt-phosphor)',
                    }}
                  >
                    {isComplete ? 'COMPLETE' : 'IN PROGRESS'}
                  </span>
                </div>
              </div>

              {/* Subtasks Sections */}
              <SubtaskSection
                title="OPEN TASKS"
                count={openSubtasks.length}
                subtasks={openSubtasks}
                onSubtaskClick={handleSubtaskClick}
              />

              <SubtaskSection
                title="COMPLETED"
                count={closedSubtasks.length}
                subtasks={closedSubtasks}
                onSubtaskClick={handleSubtaskClick}
              />

              {/* Empty state */}
              {subtasks.length === 0 && !loading && (
                <div style={styles.emptyState}>
                  <span style={styles.emptyIcon}>{'\u2713'}</span>
                  <span style={styles.emptyTitle}>NO SUBTASKS</span>
                  <span style={styles.emptySubtitle}>
                    This epic has no linked tasks.
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

const styles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 999,
  },
  panel: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: '450px',
    maxWidth: '90vw',
    backgroundColor: '#0A0A0A',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRight: 'none',
    boxShadow: '-4px 0 20px rgba(0, 255, 0, 0.1)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Share Tech Mono", monospace',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '2px solid var(--crt-phosphor-dim)',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  backButton: {
    background: 'none',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
    fontSize: '0.75rem',
    padding: '6px 12px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
  },
  headerTitle: {
    margin: 0,
    flex: 1,
    fontSize: '1rem',
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.15em',
    textAlign: 'center',
  },
  refreshButton: {
    background: 'none',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
    fontSize: '1rem',
    width: '32px',
    height: '32px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    padding: '16px',
    overflowY: 'auto',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    gap: '16px',
  },
  loadingPulse: {
    width: '40px',
    height: '40px',
    border: '2px solid var(--crt-phosphor-dim)',
    borderTopColor: 'var(--crt-phosphor)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorState: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
  },
  errorText: {
    color: '#FF4444',
    textAlign: 'center',
    letterSpacing: '0.1em',
  },
  retryButton: {
    background: 'none',
    border: '1px solid #FF4444',
    color: '#FF4444',
    padding: '8px 16px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
  },
  epicHeader: {
    padding: '16px',
    marginBottom: '16px',
    backgroundColor: 'rgba(0, 255, 0, 0.02)',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRadius: '4px',
  },
  epicTitle: {
    margin: '0 0 12px 0',
    fontSize: '1.1rem',
    color: 'var(--crt-phosphor)',
    fontWeight: 'normal',
    lineHeight: 1.4,
    textShadow: '0 0 10px var(--crt-phosphor)',
  },
  idRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  epicId: {
    fontSize: '0.8rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
  },
  copyButton: {
    background: 'none',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
    fontSize: '0.8rem',
    padding: '2px 6px',
    cursor: 'pointer',
  },
  rigBadge: {
    fontSize: '0.7rem',
    padding: '2px 6px',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.05em',
  },
  priorityBadge: {
    fontSize: '0.7rem',
    padding: '2px 8px',
    border: '1px solid',
    fontWeight: 'bold',
    letterSpacing: '0.05em',
  },
  timestampRow: {
    display: 'flex',
    gap: '8px',
    fontSize: '0.75rem',
    marginTop: '4px',
  },
  timestampLabel: {
    color: 'var(--crt-phosphor-dim)',
  },
  timestampValue: {
    color: 'var(--crt-phosphor)',
  },
  progressSection: {
    padding: '16px',
    marginBottom: '16px',
    backgroundColor: 'rgba(0, 255, 0, 0.02)',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRadius: '4px',
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  progressLabel: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.15em',
  },
  progressText: {
    fontSize: '0.9rem',
    color: 'var(--crt-phosphor)',
    fontWeight: 'bold',
    textShadow: '0 0 8px var(--crt-phosphor)',
  },
  progressBarContainer: {
    marginBottom: '8px',
  },
  progressBarBackground: {
    height: '12px',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  progressStatus: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  progressStatusText: {
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
  },
  section: {
    marginBottom: '16px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
    paddingBottom: '4px',
    borderBottom: '1px solid rgba(0, 255, 0, 0.2)',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.15em',
    fontWeight: 'normal',
  },
  sectionCount: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    opacity: 0.6,
  },
  subtaskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px',
    marginBottom: '6px',
    backgroundColor: 'rgba(0, 255, 0, 0.02)',
    border: '1px solid rgba(0, 255, 0, 0.15)',
    borderRadius: '4px',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    fontFamily: '"Share Tech Mono", monospace',
  },
  statusIndicator: {
    fontSize: '1rem',
    width: '20px',
    textAlign: 'center',
  },
  subtaskContent: {
    flex: 1,
    minWidth: 0,
  },
  subtaskTitle: {
    display: 'block',
    fontSize: '0.85rem',
    color: 'var(--crt-phosphor)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  subtaskMeta: {
    display: 'flex',
    gap: '8px',
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    marginTop: '2px',
  },
  subtaskId: {
    letterSpacing: '0.05em',
  },
  subtaskAssignee: {
    opacity: 0.7,
  },
  chevron: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.8rem',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 24px',
    textAlign: 'center',
  },
  emptyIcon: {
    fontSize: '2rem',
    color: 'var(--crt-phosphor-dim)',
    marginBottom: '12px',
  },
  emptyTitle: {
    fontSize: '0.9rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    marginBottom: '4px',
  },
  emptySubtitle: {
    fontSize: '0.75rem',
    color: 'var(--crt-phosphor-dim)',
    opacity: 0.6,
  },
} satisfies Record<string, CSSProperties>;
