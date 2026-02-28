/**
 * TimelineView - Main timeline tab showing a chronological event stream.
 *
 * Displays agent activity events (status changes, progress reports,
 * announcements, messages, bead updates) in a scrollable vertical list
 * with date separators, filters, and load-more pagination.
 */

import { useMemo, useRef, useEffect, type CSSProperties } from 'react';

import { useTimeline } from '../../hooks/useTimeline';
import { TimelineFilters } from './TimelineFilters';
import { TimelineEventCard } from './TimelineEventCard';
import type { TimelineEvent } from '../../services/api';

export interface TimelineViewProps {
  isActive?: boolean;
}

/** Group events by date for date separators. */
function groupByDate(events: TimelineEvent[]): { date: string; events: TimelineEvent[] }[] {
  const groups: Map<string, TimelineEvent[]> = new Map();

  for (const event of events) {
    const date = formatDate(event.createdAt);
    const existing = groups.get(date);
    if (existing) {
      existing.push(event);
    } else {
      groups.set(date, [event]);
    }
  }

  return Array.from(groups.entries()).map(([date, evts]) => ({ date, events: evts }));
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'TODAY';
    if (date.toDateString() === yesterday.toDateString()) return 'YESTERDAY';

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).toUpperCase();
  } catch {
    return 'UNKNOWN';
  }
}

export function TimelineView({ isActive = true }: TimelineViewProps) {
  const {
    events,
    loading,
    hasMore,
    error,
    filters,
    setFilters,
    loadMore,
  } = useTimeline();

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Track new events for animation (events prepended at top)
  const newEventIds = useMemo(() => {
    if (events.length > prevCountRef.current) {
      const newCount = events.length - prevCountRef.current;
      return new Set(events.slice(0, newCount).map((e) => e.id));
    }
    return new Set<string>();
  }, [events]);

  useEffect(() => {
    prevCountRef.current = events.length;
  }, [events.length]);

  const dateGroups = useMemo(() => groupByDate(events), [events]);

  if (!isActive) return null;

  if (loading && events.length === 0) {
    return (
      <div style={styles.container}>
        <header style={styles.header}>
          <h2 style={styles.title} className="crt-glow">TIMELINE</h2>
        </header>
        <div style={styles.loadingState}>
          <div style={styles.loadingPulse} />
          LOADING EVENT STREAM...
        </div>
      </div>
    );
  }

  if (error && events.length === 0) {
    return (
      <div style={styles.container}>
        <header style={styles.header}>
          <h2 style={styles.title} className="crt-glow">TIMELINE</h2>
        </header>
        <div style={styles.errorState}>
          STREAM ERROR: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h2 style={styles.title} className="crt-glow">TIMELINE</h2>
        <TimelineFilters
          filters={filters}
          onFiltersChange={setFilters}
          events={events}
        />
      </header>

      <div style={styles.eventList} ref={scrollRef}>
        {events.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>&gt;_</div>
            <div>NO EVENTS RECORDED YET</div>
            <div style={styles.emptyHint}>AGENT ACTIVITY WILL APPEAR HERE</div>
          </div>
        ) : (
          <>
            {dateGroups.map((group) => (
              <div key={group.date}>
                <div style={styles.dateSeparator}>
                  <span style={styles.dateLine} />
                  <span style={styles.dateLabel}>{group.date}</span>
                  <span style={styles.dateLine} />
                </div>
                {group.events.map((event) => (
                  <TimelineEventCard
                    key={event.id}
                    event={event}
                    isNew={newEventIds.has(event.id)}
                  />
                ))}
              </div>
            ))}

            {hasMore && (
              <button
                style={styles.loadMoreButton}
                onClick={() => { void loadMore(); }}
                disabled={loading}
              >
                {loading ? 'LOADING...' : '[ LOAD MORE ]'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Inline keyframes for new event glow animation */}
      <style>{`
        @keyframes timeline-glow {
          0% { background-color: rgba(0, 255, 0, 0.15); }
          100% { background-color: transparent; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    backgroundColor: '#0A0A0A',
    border: '1px solid var(--crt-phosphor-dim)',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--crt-phosphor-dim)',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flexWrap: 'wrap',
  },
  title: {
    margin: 0,
    fontSize: '1.2rem',
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.2em',
    fontFamily: '"Share Tech Mono", monospace',
    flexShrink: 0,
  },
  eventList: {
    flex: 1,
    overflow: 'auto',
    minHeight: 0,
  },
  dateSeparator: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 16px 4px',
  },
  dateLine: {
    flex: 1,
    height: '1px',
    backgroundColor: 'var(--crt-phosphor-dim)',
    opacity: 0.3,
  },
  dateLabel: {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.15em',
    flexShrink: 0,
  },
  loadMoreButton: {
    display: 'block',
    width: '100%',
    padding: '12px',
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor-dim)',
    border: 'none',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    cursor: 'pointer',
    letterSpacing: '0.1em',
    transition: 'color 0.15s ease',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '64px 24px',
    color: 'var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
    gap: '12px',
  },
  emptyIcon: {
    fontSize: '2rem',
    opacity: 0.5,
  },
  emptyHint: {
    fontSize: '0.7rem',
    opacity: 0.5,
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
    fontFamily: '"Share Tech Mono", monospace',
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
    color: '#FF4444',
    textAlign: 'center',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
  },
} satisfies Record<string, CSSProperties>;
