/**
 * Regression test for adj-pvp0x: OverviewDashboard timeline polling must
 * guard against setState-after-unmount.
 *
 * Before the fix, the 15s timeline polling effect called
 * setTimelineEvents() in a .then() handler without checking if the
 * component was still mounted. If unmount happened mid-fetch, React
 * would log "Can't perform a state update on an unmounted component"
 * once the response landed.
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

// We control resolution of getTimelineEvents in each test.
let pendingResolvers: Array<(value: { events: unknown[]; hasMore: boolean }) => void> = [];
vi.mock('../../src/services/api', () => ({
  api: {
    projects: {
      getAutoDevelopStatus: vi.fn().mockResolvedValue({ enabled: false, paused: false }),
    },
  },
  getTimelineEvents: vi.fn(() => {
    return new Promise<{ events: unknown[]; hasMore: boolean }>((resolve) => {
      pendingResolvers.push(resolve);
    });
  }),
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

describe('OverviewDashboard timeline polling (adj-pvp0x)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pendingResolvers = [];
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('should not emit React setState-after-unmount warning when unmounted mid-fetch', async () => {
    const { unmount } = render(<DashboardView />);

    // The initial timeline fetch is now pending — its promise was captured
    // in pendingResolvers.
    expect(pendingResolvers.length).toBeGreaterThanOrEqual(1);

    // Unmount BEFORE the fetch resolves.
    unmount();

    // Now resolve the in-flight fetch. Without the mountedRef guard, this
    // would call setTimelineEvents on an unmounted component and React
    // would log an error to the console.
    for (const resolve of pendingResolvers) {
      resolve({ events: [{ id: 'e1', eventType: 'message_sent', agentId: 'a', action: 'x', createdAt: new Date().toISOString() }], hasMore: false });
    }

    // Let the microtask queue drain so the .then handler runs.
    await Promise.resolve();
    await Promise.resolve();

    // No console.error for state-update-on-unmounted-component should have
    // fired. (We don't assert zero calls — other libraries may log — only
    // that none of the messages mention setState-on-unmounted-component.)
    const offendingCalls = consoleErrorSpy.mock.calls.filter((args) => {
      const msg = args[0];
      return typeof msg === 'string' && /unmounted component/i.test(msg);
    });
    expect(offendingCalls).toEqual([]);
  });
});
