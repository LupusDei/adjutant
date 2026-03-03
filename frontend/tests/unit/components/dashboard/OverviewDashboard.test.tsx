import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardView } from '../../../../src/components/dashboard/OverviewDashboard';
import { useOverview } from '../../../../src/hooks/useProjectOverview';

// Mock the overview hook
vi.mock('../../../../src/hooks/useProjectOverview', () => ({
  useOverview: vi.fn(),
}));

// Mock priorityLabel used by OverviewDashboard
vi.mock('../../../../src/hooks/useDashboardBeads', () => ({
  priorityLabel: vi.fn(() => 'MED'),
}));

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        projects: [{ id: 'test', name: 'test', path: '/test', active: true }],
        beads: { open: [], inProgress: [], recentlyClosed: [] },
        epics: { inProgress: [], recentlyCompleted: [] },
        agents: [],
        unreadMessages: [],
      },
      loading: false,
    });
  });

  it('renders dashboard widgets', () => {
    render(<DashboardView />);
    expect(screen.getByText('AGENTS')).toBeInTheDocument();
    expect(screen.getByText('UNREAD MESSAGES')).toBeInTheDocument();
    expect(screen.getByText('TASKS')).toBeInTheDocument();
    expect(screen.getByText('EPICS')).toBeInTheDocument();
  });

  it('renders empty states when no data is available', () => {
    (useOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      loading: false,
    });
    render(<DashboardView />);
    // With null data, widgets should still render with empty states
    expect(screen.getByText('AGENTS')).toBeInTheDocument();
  });
});
