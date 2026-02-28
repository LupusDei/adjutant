/**
 * TimelineFilters - Filter bar for the timeline view.
 *
 * Provides agent dropdown, event type chips, bead ID input,
 * and a clear-all button in a compact horizontal layout.
 */

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react';

import type { TimelineFilters as FilterState, TimeRange } from '../../hooks/useTimeline';
import type { TimelineEvent } from '../../services/api';

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '1h', label: 'LAST 1H' },
  { value: '6h', label: 'LAST 6H' },
  { value: '24h', label: 'LAST 24H' },
  { value: '7d', label: 'LAST 7D' },
  { value: 'all', label: 'ALL TIME' },
];

const EVENT_TYPES = [
  { value: 'status_change', label: 'STATUS', icon: '\u{1F504}' },
  { value: 'progress_report', label: 'PROGRESS', icon: '\u{1F4CA}' },
  { value: 'announcement', label: 'ANNOUNCE', icon: '\u{1F4E2}' },
  { value: 'message_sent', label: 'MESSAGE', icon: '\u{1F4AC}' },
  { value: 'bead_updated', label: 'BEAD UPD', icon: '\u{1F4DD}' },
  { value: 'bead_closed', label: 'BEAD CLOSE', icon: '\u2705' },
] as const;

export interface TimelineFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  events: TimelineEvent[];
}

export function TimelineFilters({ filters, onFiltersChange, events }: TimelineFiltersProps) {
  const [beadInput, setBeadInput] = useState(filters.beadId ?? '');

  // Extract unique agent IDs from events
  const agentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const event of events) {
      if (event.agentId && event.agentId !== 'system') {
        ids.add(event.agentId);
      }
    }
    return Array.from(ids).sort();
  }, [events]);

  // Debounce bead ID input
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = beadInput.trim();
      if (trimmed !== (filters.beadId ?? '')) {
        onFiltersChange({ ...filters, beadId: trimmed || undefined });
      }
    }, 400);
    return () => { clearTimeout(timer); };
  }, [beadInput, filters, onFiltersChange]);

  const handleAgentChange = useCallback((agentId: string) => {
    onFiltersChange({ ...filters, agentId: agentId || undefined });
  }, [filters, onFiltersChange]);

  const handleEventTypeToggle = useCallback((eventType: string) => {
    const current = filters.eventType;
    onFiltersChange({
      ...filters,
      eventType: current === eventType ? undefined : eventType,
    });
  }, [filters, onFiltersChange]);

  const handleTimeRangeChange = useCallback((value: string) => {
    const range = value as TimeRange;
    onFiltersChange({ ...filters, timeRange: range === 'all' ? undefined : range });
  }, [filters, onFiltersChange]);

  const handleClearAll = useCallback(() => {
    setBeadInput('');
    onFiltersChange({});
  }, [onFiltersChange]);

  const hasActiveFilters = filters.agentId || filters.eventType || filters.beadId || filters.timeRange;

  return (
    <div style={styles.container}>
      {/* Agent dropdown */}
      <select
        value={filters.agentId ?? ''}
        onChange={(e) => { handleAgentChange(e.target.value); }}
        style={styles.select}
        aria-label="Filter by agent"
      >
        <option value="">ALL AGENTS</option>
        <option value="system">SYSTEM</option>
        {agentIds.map((id) => (
          <option key={id} value={id}>{id.toUpperCase()}</option>
        ))}
      </select>

      {/* Time range dropdown */}
      <select
        value={filters.timeRange ?? 'all'}
        onChange={(e) => { handleTimeRangeChange(e.target.value); }}
        style={styles.select}
        aria-label="Filter by time range"
      >
        {TIME_RANGES.map((tr) => (
          <option key={tr.value} value={tr.value}>{tr.label}</option>
        ))}
      </select>

      {/* Event type chips */}
      <div style={styles.chips}>
        {EVENT_TYPES.map((et) => (
          <button
            key={et.value}
            style={{
              ...styles.chip,
              ...(filters.eventType === et.value ? styles.chipActive : {}),
            }}
            onClick={() => { handleEventTypeToggle(et.value); }}
            title={et.value}
          >
            {et.icon} {et.label}
          </button>
        ))}
      </div>

      {/* Bead ID input */}
      <div style={styles.beadInputContainer}>
        <input
          type="text"
          value={beadInput}
          onChange={(e) => { setBeadInput(e.target.value); }}
          placeholder="BEAD ID..."
          style={styles.beadInput}
          aria-label="Filter by bead ID"
        />
      </div>

      {/* Clear all */}
      {hasActiveFilters && (
        <button
          style={styles.clearButton}
          onClick={handleClearAll}
          title="Clear all filters"
        >
          CLEAR
        </button>
      )}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  select: {
    backgroundColor: '#050505',
    color: 'var(--crt-phosphor)',
    border: '1px solid var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    padding: '3px 8px',
    outline: 'none',
    cursor: 'pointer',
  },
  chips: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
  },
  chip: {
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor-dim)',
    border: '1px solid var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.65rem',
    padding: '2px 6px',
    cursor: 'pointer',
    letterSpacing: '0.05em',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
  },
  chipActive: {
    backgroundColor: 'var(--crt-phosphor)',
    color: '#0a0a0a',
    fontWeight: 'bold',
    textShadow: 'none',
  },
  beadInputContainer: {
    position: 'relative',
  },
  beadInput: {
    backgroundColor: '#050505',
    color: 'var(--crt-phosphor)',
    border: '1px solid var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    padding: '3px 8px',
    outline: 'none',
    width: '100px',
    letterSpacing: '0.05em',
  },
  clearButton: {
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor-dim)',
    border: '1px solid var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.65rem',
    padding: '2px 8px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
    transition: 'color 0.15s ease',
  },
} satisfies Record<string, CSSProperties>;
