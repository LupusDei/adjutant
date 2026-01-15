import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverviewDashboard } from '../../../src/components/dashboard/OverviewDashboard';
// import { useDashboardMail } from '../../../src/hooks/useDashboardMail';
// import { useDashboardConvoys } from '../../../src/hooks/useDashboardConvoys';
// import { useDashboardCrew } from '../../../src/hooks/useDashboardCrew';

// Mock the custom hooks explicitly
// vi.mock('../../../src/hooks/useDashboardMail', () => ({
//   useDashboardMail: vi.fn(),
// }));
// vi.mock('../../../src/hooks/useDashboardConvoys', () => ({
//   useDashboardConvoys: vi.fn(),
// }));
// vi.mock('../../../src/hooks/useDashboardCrew', () => ({
//   useDashboardCrew: vi.fn(),
// }));

describe('OverviewDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations for the hooks
    (useDashboardMail as vi.Mock).mockReturnValue({
      unreadMessages: [],
      recentMessages: [],
      loading: false,
      error: null,
    });
    (useDashboardConvoys as vi.Mock).mockReturnValue({
      recentConvoys: [],
      loading: false,
      error: null,
    });
    (useDashboardCrew as vi.Mock).mockReturnValue({
      totalCrew: 0,
      activeCrew: 0,
      crewAlerts: [],
      loading: false,
      error: null,
    });
  });

  it('renders main title and grid', () => {
    render(<OverviewDashboard />);
    expect(screen.getByText('SYSTEM OVERVIEW')).toBeInTheDocument();
    expect(screen.getByText('MAIL')).toBeInTheDocument();
    expect(screen.getByText('CONVOY MANIFESTS')).toBeInTheDocument();
    expect(screen.getByText('CREW ROSTER & ALERTS')).toBeInTheDocument();
    expect(screen.getByText('SYSTEM CONFIG')).toBeInTheDocument();