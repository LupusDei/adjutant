/**
 * Regression test for adj-139.5.3 — TimelineView must not render an inline
 * <style> block. The @keyframes timeline-glow animation lives in
 * src/components/timeline/timeline.css to avoid CSS re-parse on every parent
 * state change.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import { TimelineView } from '../../src/components/timeline/TimelineView';

// Stub the useTimeline hook so the component renders without backend coupling.
vi.mock('../../src/hooks/useTimeline', () => ({
  useTimeline: () => ({
    events: [],
    loading: false,
    hasMore: false,
    error: null,
    filters: { agents: [], types: [], range: '24h' },
    setFilters: vi.fn(),
    loadMore: vi.fn(async () => undefined),
  }),
}));

// TimelineFilters is unrelated to this test — render a minimal stub.
vi.mock('../../src/components/timeline/TimelineFilters', () => ({
  TimelineFilters: () => null,
}));

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
});
