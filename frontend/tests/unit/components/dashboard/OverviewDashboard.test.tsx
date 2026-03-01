import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardView } from '../../../../src/components/dashboard/OverviewDashboard';
import { useDashboard } from '../../../../src/hooks/useDashboard';

// Mock the unified dashboard hook
vi.mock('../../../../src/hooks/useDashboard', () => ({
  useDashboard: vi.fn(),
}));

// Mock priorityLabel used by OverviewDashboard
vi.mock('../../../../src/hooks/useDashboardBeads', () => ({
  priorityLabel: vi.fn(() => 'MED'),
}));

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        epics: { data: null, loading: false, error: null },
        beads: { data: null, loading: false, error: null },
        unreadMessages: { data: [], loading: false, error: null },
      },
      loading: false,
    });
  });

  it('renders dashboard widgets', () => {
    render(<DashboardView />);
    // The dashboard should render without crashing
    expect(screen.getByText('EPICS')).toBeInTheDocument();
  });
});
