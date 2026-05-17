/**
 * Regression test for adj-139.5.3 — TimelineView must not render an inline
 * <style> block. The @keyframes timeline-glow animation lives in
 * src/components/timeline/timeline.css to avoid CSS re-parse on every parent
 * state change.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import { TimelineView } from '../../src/components/timeline/TimelineView';
import { useTimeline } from '../../src/hooks/useTimeline';
import type { TimelineEvent } from '../../src/services/api';

// Stub the useTimeline hook so the component renders without backend coupling.
// We expose the mock so individual tests can override the return value.
vi.mock('../../src/hooks/useTimeline', () => ({
  useTimeline: vi.fn(() => ({
    events: [],
    loading: false,
    hasMore: false,
    error: null,
    filters: { agents: [], types: [], range: '24h' },
    setFilters: vi.fn(),
    loadMore: vi.fn(async () => undefined),
  })),
}));

// TimelineFilters is unrelated to this test — render a minimal stub.
vi.mock('../../src/components/timeline/TimelineFilters', () => ({
  TimelineFilters: () => null,
}));

const useTimelineMock = useTimeline as unknown as ReturnType<typeof vi.fn>;

describe('TimelineView (adj-139.5.3)', () => {
  it('should not render an inline <style> element (keyframes must live in external CSS)', () => {
    const { container } = render(<TimelineView />);
    const inlineStyleElements = container.querySelectorAll('style');
    expect(inlineStyleElements.length).toBe(0);
  });

  it('should not embed timeline-glow keyframes inline', () => {
    const { container } = render(<TimelineView />);
    expect(container.innerHTML).not.toContain('@keyframes timeline-glow');
  });

  // adj-q7xrl: the empty-state assertion above can't catch a regression
  // where inline <style> is reintroduced in the events-list rendering path.
  // Mount with non-empty events spanning two dates so the date-separator
  // and event-card render paths are exercised, then assert again.
  it('should not render an inline <style> element when events are present (multi-date)', () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    const events: TimelineEvent[] = [
      {
        id: 'evt-1',
        eventType: 'status_change',
        agentId: 'engineer-a',
        action: 'started working',
        detail: null,
        beadId: null,
        messageId: null,
        createdAt: today.toISOString(),
      },
      {
        id: 'evt-2',
        eventType: 'progress_report',
        agentId: 'engineer-a',
        action: 'progress 50%',
        detail: null,
        beadId: 'adj-123',
        messageId: null,
        createdAt: today.toISOString(),
      },
      {
        id: 'evt-3',
        eventType: 'message_sent',
        agentId: 'engineer-b',
        action: 'sent message',
        detail: null,
        beadId: null,
        messageId: 'msg-1',
        createdAt: today.toISOString(),
      },
      {
        id: 'evt-4',
        eventType: 'bead_closed',
        agentId: 'engineer-b',
        action: 'closed adj-456',
        detail: null,
        beadId: 'adj-456',
        messageId: null,
        createdAt: yesterday.toISOString(),
      },
      {
        id: 'evt-5',
        eventType: 'announcement',
        agentId: 'mayor/',
        action: 'announce',
        detail: null,
        beadId: null,
        messageId: null,
        createdAt: yesterday.toISOString(),
      },
    ];

    useTimelineMock.mockReturnValueOnce({
      events,
      loading: false,
      hasMore: false,
      error: null,
      filters: { agents: [], types: [], range: '24h' },
      setFilters: vi.fn(),
      loadMore: vi.fn(async () => undefined),
    });

    const { container } = render(<TimelineView />);

    // Confirm we're really rendering the events-list path (not the empty state).
    // The component renders date separators; with two dates we expect content.
    expect(container.innerHTML.length).toBeGreaterThan(100);

    // The actual regression guard: no inline <style> and no embedded keyframes.
    expect(container.querySelectorAll('style').length).toBe(0);
    expect(container.innerHTML).not.toContain('@keyframes timeline-glow');
  });
});
