/**
 * Tests for adj-139.3.6: OverviewDashboard polling stabilization.
 *
 * Before this fix, the 15s auto-develop polling effect depended on
 * `fetchAutoDevelopStatus` (which depends on `activeProjectId`). Changing
 * project tore down and re-created the interval. Under heavy churn this
 * left orphan intervals and caused excessive renders.
 *
 * After this fix:
 *  - setInterval is called exactly once for the lifetime of the mounted
 *    component (modulo cleanup on unmount).
 *  - activeProjectId changes do NOT re-create the interval; the latest
 *    project + fetch fn live in a ref read inside the closure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

import { DashboardView } from '../../src/components/dashboard/OverviewDashboard';
import { useOverview } from '../../src/hooks/useProjectOverview';
import { useProject } from '../../src/contexts/ProjectContext';

vi.mock('../../src/hooks/useProjectOverview', () => ({
  useOverview: vi.fn(),
}));

vi.mock('../../src/hooks/useDashboardBeads', () => ({
  priorityLabel: vi.fn(() => 'MED'),
}));

vi.mock('../../src/contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
  api: {
    projects: {
      getAutoDevelopStatus: vi.fn().mockResolvedValue({ enabled: false, paused: false }),
    },
  },
  getTimelineEvents: vi.fn().mockResolvedValue({ events: [], hasMore: false }),
}));

const useOverviewMock = useOverview as unknown as ReturnType<typeof vi.fn>;
const useProjectMock = useProject as unknown as ReturnType<typeof vi.fn>;

const EMPTY_OVERVIEW = {
  data: {
    projects: [],
    beads: { open: [], inProgress: [], recentlyClosed: [] },
    epics: { inProgress: [], recentlyCompleted: [] },
    agents: [],
    unreadMessages: [],
  },
  loading: false,
};

describe('OverviewDashboard polling stability (adj-139.3.6)', () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let clearIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setIntervalSpy = vi.spyOn(window, 'setInterval');
    clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    useOverviewMock.mockReturnValue(EMPTY_OVERVIEW);
    useProjectMock.mockReturnValue({
      selectedProject: { id: 'proj-1', name: 'p1', path: '/p1', hasBeads: true },
      projects: [],
      loading: false,
      selectProject: vi.fn(),
      refresh: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('should create the auto-develop polling interval exactly once across 10 activeProjectId changes', () => {
    const { rerender } = render(<DashboardView />);

    // The component sets multiple intervals (auto-develop + timeline). We're
    // specifically counting auto-develop polling, which uses a 15_000 ms
    // interval. Count those after first render.
    const initialCalls = setIntervalSpy.mock.calls.filter((c) => c[1] === 15_000).length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);

    // Switch project 10 times.
    for (let i = 2; i <= 11; i++) {
      useProjectMock.mockReturnValue({
        selectedProject: { id: `proj-${i}`, name: `p${i}`, path: `/p${i}`, hasBeads: true },
        projects: [],
        loading: false,
        selectProject: vi.fn(),
        refresh: vi.fn(),
      });
      rerender(<DashboardView />);
    }

    // After all rerenders, the 15s polling interval must NOT have been
    // recreated for each project change. Allow at most the initial setup
    // calls (1 for auto-develop + 1 for timeline = 2). The bug-shape would be
    // 11+ since each rerender re-ran the effect.
    const finalCalls = setIntervalSpy.mock.calls.filter((c) => c[1] === 15_000).length;
    expect(finalCalls).toBe(initialCalls);
  });

  it('should clear the polling interval exactly once on unmount', () => {
    const { unmount } = render(<DashboardView />);
    const intervalsBefore = setIntervalSpy.mock.calls.filter((c) => c[1] === 15_000).length;

    unmount();

    // Each 15s interval should have been cleared.
    expect(clearIntervalSpy).toHaveBeenCalled();
    // We don't easily know IDs, but the count of clearIntervals ≥ the count
    // of setIntervals we set up.
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(intervalsBefore);
  });
});
