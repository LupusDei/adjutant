import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardView } from '../../../../src/components/dashboard/OverviewDashboard';
import { useProjectOverview } from '../../../../src/hooks/useProjectOverview';

// Mock the project overview hook
vi.mock('../../../../src/hooks/useProjectOverview', () => ({
  useProjectOverview: vi.fn(),
}));

// Mock priorityLabel used by OverviewDashboard
vi.mock('../../../../src/hooks/useDashboardBeads', () => ({
  priorityLabel: vi.fn(() => 'MED'),
}));

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useProjectOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        project: { id: 'test', name: 'test', path: '/test', active: true },
        beads: { open: [], inProgress: [], recentlyClosed: [] },
        epics: { inProgress: [], recentlyCompleted: [] },
        agents: [],
        unreadMessages: [],
      },
      loading: false,
      noProject: false,
    });
  });

  it('renders dashboard widgets', () => {
    render(<DashboardView />);
    expect(screen.getByText('AGENTS')).toBeInTheDocument();
    expect(screen.getByText('UNREAD MESSAGES')).toBeInTheDocument();
    expect(screen.getByText('TASKS')).toBeInTheDocument();
    expect(screen.getByText('EPICS')).toBeInTheDocument();
  });

  it('shows no-project state when no project is selected', () => {
    (useProjectOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      loading: false,
      noProject: true,
    });
    render(<DashboardView />);
    expect(screen.getByText('No active project selected.')).toBeInTheDocument();
  });
});
