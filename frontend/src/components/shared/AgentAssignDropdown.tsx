/**
 * AgentAssignDropdown - Inline agent assignment widget.
 * Shows current assignee with a clickable dropdown to reassign.
 * Fetches agents on open, filters to idle/working, shows loading/empty states.
 * Pip-Boy terminal aesthetic.
 */

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { api } from '../../services/api';
import type { CrewMember } from '../../types';

export interface AgentAssignDropdownProps {
  /** Current bead ID (for display context) */
  beadId: string;
  /** Current assignee name or null */
  currentAssignee: string | null;
  /** Called when an agent is selected */
  onAssign: (agentName: string) => void;
  /** Whether assignment is disabled (e.g., bead is closed) */
  disabled?: boolean;
  /** Compact mode for tight spaces like table cells */
  compact?: boolean;
}

/**
 * Extracts short name from a full agent path (e.g., "project/raynor" -> "raynor").
 */
function shortName(name: string | null): string {
  if (!name) return '';
  const parts = name.split('/');
  return parts[parts.length - 1] ?? name;
}

export function AgentAssignDropdown({
  beadId,
  currentAssignee,
  onAssign,
  disabled = false,
  compact = false,
}: AgentAssignDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [agents, setAgents] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  // Fetch agents when dropdown opens
  const handleOpen = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
    setLoading(true);
    setError(null);

    void api.agents.list().then((result) => {
      const available = result.filter((a) => a.status === 'idle' || a.status === 'working');
      setAgents(available);
      setLoading(false);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
      setLoading(false);
    });
  }, [disabled]);

  const handleSelect = useCallback((agentName: string) => {
    setIsOpen(false);
    onAssign(agentName);
  }, [onAssign]);

  const displayName = currentAssignee ? shortName(currentAssignee) : null;

  return (
    <div
      ref={dropdownRef}
      style={styles.container}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Trigger button */}
      <button
        style={{
          ...styles.trigger,
          ...(compact ? styles.triggerCompact : {}),
          ...(disabled ? styles.triggerDisabled : {}),
          ...(displayName ? styles.triggerAssigned : {}),
        }}
        onClick={isOpen ? () => setIsOpen(false) : handleOpen}
        disabled={disabled}
        title={currentAssignee ? `Assigned to ${currentAssignee} — click to reassign` : `Assign ${beadId}`}
      >
        {displayName ?? (compact ? '—' : 'ASSIGN')}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div style={styles.dropdown}>
          {loading && (
            <div style={styles.statusRow}>SCANNING...</div>
          )}

          {error && (
            <div style={{ ...styles.statusRow, color: '#FF4444' }}>ERR: {error}</div>
          )}

          {!loading && !error && agents.length === 0 && (
            <div style={styles.statusRow}>NO AGENTS AVAILABLE</div>
          )}

          {!loading && !error && agents.map((agent) => {
            const isCurrentAssignee = agent.name === currentAssignee;
            return (
              <button
                key={agent.id}
                style={{
                  ...styles.agentOption,
                  ...(isCurrentAssignee ? styles.agentOptionCurrent : {}),
                }}
                onClick={() => handleSelect(agent.name)}
              >
                <span style={styles.agentName}>{shortName(agent.name)}</span>
                <span style={{
                  ...styles.agentStatus,
                  color: agent.status === 'idle' ? '#00FF00' : '#00FF88',
                }}>
                  {agent.status === 'idle' ? 'IDLE' : 'BUSY'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    position: 'relative',
    display: 'inline-block',
  },
  trigger: {
    background: 'none',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.65rem',
    padding: '2px 6px',
    cursor: 'pointer',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
  },
  triggerCompact: {
    fontSize: '0.6rem',
    padding: '1px 4px',
  },
  triggerDisabled: {
    opacity: 0.4,
    cursor: 'default',
  },
  triggerAssigned: {
    color: 'var(--crt-phosphor)',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: '2px',
    minWidth: '140px',
    maxHeight: '200px',
    overflowY: 'auto',
    backgroundColor: '#0A0A0A',
    border: '1px solid var(--crt-phosphor)',
    boxShadow: '0 0 12px rgba(0, 255, 0, 0.15)',
    zIndex: 500,
    fontFamily: '"Share Tech Mono", monospace',
  },
  statusRow: {
    padding: '8px 10px',
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.05em',
  },
  agentOption: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '6px 10px',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '1px solid rgba(0, 255, 0, 0.05)',
    color: 'var(--crt-phosphor)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.7rem',
    cursor: 'pointer',
    textAlign: 'left',
  },
  agentOptionCurrent: {
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    borderLeft: '2px solid var(--crt-phosphor)',
  },
  agentName: {
    letterSpacing: '0.03em',
  },
  agentStatus: {
    fontSize: '0.6rem',
    letterSpacing: '0.08em',
  },
} satisfies Record<string, CSSProperties>;
