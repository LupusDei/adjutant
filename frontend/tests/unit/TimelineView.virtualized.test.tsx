/**
 * Tests for TimelineView virtualization.
 *
 * adj-139.4.4 — With 1000 events the timeline used to mount 1000 cards
 * simultaneously, costing >100ms per render. With Virtuoso, only the
 * visible window is mounted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

import { TimelineView } from '../../src/components/timeline/TimelineView';
import type { TimelineEvent } from '../../src/services/api';

// Mock useTimeline to inject controlled data
let mockEvents: TimelineEvent[] = [];

vi.mock('../../src/hooks/useTimeline', async () => {
  return {
    useTimeline: () => ({
      events: mockEvents,
      loading: false,
      hasMore: false,
      error: null,
      filters: {},
      setFilters: vi.fn(),
      loadMore: vi.fn().mockResolvedValue(undefined),
    }),
    MAX_TIMELINE_EVENTS: 1000,
  };
});

beforeEach(() => {
  mockEvents = [];
});

afterEach(() => {
  cleanup();
});

function makeEvent(idx: number): TimelineEvent {
  return {
    id: `evt-${idx}`,
    eventType: 'status_change',
    agentId: 'agent-x',
    action: `action ${idx}`,
    detail: null,
    beadId: null,
    messageId: null,
    createdAt: new Date(Date.now() - idx * 1000).toISOString(),
  };
}

describe('TimelineView virtualization (adj-139.4.4)', () => {
  it('should render without crashing on empty events array', () => {
    mockEvents = [];
    const { getByText } = render(<TimelineView isActive={true} />);
    expect(getByText('NO EVENTS RECORDED YET')).toBeTruthy();
  });

  it('should NOT render all 1000 events as DOM cards', () => {
    mockEvents = Array.from({ length: 1000 }, (_, i) => makeEvent(i));
    const { container } = render(<TimelineView isActive={true} />);

    // Look for cards by their characteristic structure (action text)
    // Without virtualization, all 1000 action texts are present.
    const actionTexts = Array.from(container.querySelectorAll('span')).filter((el) =>
      el.textContent?.startsWith('action ')
    );

    expect(actionTexts.length).toBeLessThan(200);
  });

  it('should render the title regardless of event count', () => {
    mockEvents = Array.from({ length: 500 }, (_, i) => makeEvent(i));
    const { getByText } = render(<TimelineView isActive={true} />);
    expect(getByText('TIMELINE')).toBeTruthy();
  });
});
