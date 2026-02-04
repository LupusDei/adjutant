import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardView } from '../../../../src/components/dashboard/OverviewDashboard';
import { useDashboardMail } from '../../../../src/hooks/useDashboardMail';
import { useDashboardEpics } from '../../../../src/hooks/useDashboardEpics';
import { useDashboardCrew } from '../../../../src/hooks/useDashboardCrew';

// Mock the custom hooks
vi.mock('../../../../src/hooks/useDashboardMail', () => ({
  useDashboardMail: vi.fn(),
}));
vi.mock('../../../../src/hooks/useDashboardEpics', () => ({
  useDashboardEpics: vi.fn(),
}));
vi.mock('../../../../src/hooks/useDashboardCrew', () => ({
  useDashboardCrew: vi.fn(),
}));

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations for the hooks
    (useDashboardMail as ReturnType<typeof vi.fn>).mockReturnValue({
      recentMessages: [],
      totalCount: 0,
      unreadCount: 0,
      loading: false,
      error: null,
    });
    (useDashboardEpics as ReturnType<typeof vi.fn>).mockReturnValue({
      recentEpics: [],
      totalCount: 0,
      activeCount: 0,
      completedCount: 0,
      loading: false,
      error: null,
    });
    (useDashboardCrew as ReturnType<typeof vi.fn>).mockReturnValue({
      totalCrew: 0,
      activeCrew: 0,
      recentCrew: [],
      crewAlerts: [],
      loading: false,
      error: null,
    });
  });

  it('renders widget headers', () => {
    render(<DashboardView />);
    expect(screen.getByText('MAIL')).toBeInTheDocument();
    expect(screen.getByText('CREW & POLECATS')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE EPICS')).toBeInTheDocument();
  });
});
