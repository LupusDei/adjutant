import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardCrew } from '../../../src/hooks/useDashboardCrew';
import { api } from '../../../src/services/api';
import type { CrewMember } from '../../../src/types';

// Mock the API service
vi.mock('../../../src/services/api', () => ({
  api: {
    agents: {
      list: vi.fn(),
      check: vi.fn(),
    },
  },
}));

const mockCrewMembers: CrewMember[] = [
  { id: 'crew1', name: 'Jax' },
  { id: 'crew2', name: 'Kael' },
  { id: 'crew3', name: 'Zoe' },
];

describe('useDashboardCrew', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  it('should fetch crew data and health checks successfully', async () => {
    (api.agents.list as vi.Mock).mockResolvedValue(mockCrewMembers);
    (api.agents.check as vi.Mock).mockResolvedValue({ healthy: true, issues: [] });

    const { result } = renderHook(() => useDashboardCrew());

    // Initial state
    expect(result.current.loading).toBe(true);
    expect(result.current.totalCrew).toBe(0);
    expect(result.current.activeCrew).toBe(0);
    expect(result.current.crewAlerts).toEqual([]);
    expect(result.current.error).toBeNull();

    // Wait for the hook to finish fetching
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Assert fetched data
    expect(result.current.totalCrew).toBe(mockCrewMembers.length);
    expect(result.current.activeCrew).toBe(mockCrewMembers.length); // As per current implementation
    expect(result.current.crewAlerts).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(api.agents.list).toHaveBeenCalledTimes(1);
    expect(api.agents.check).toHaveBeenCalledTimes(1);
  });

  it('should reflect crew alerts from the health check', async () => {
    (api.agents.list as vi.Mock).mockResolvedValue(mockCrewMembers);
    const mockIssues = ['Engine anomaly detected', 'Life support fluctuating'];
    (api.agents.check as vi.Mock).mockResolvedValue({ healthy: false, issues: mockIssues });

    const { result } = renderHook(() => useDashboardCrew());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.totalCrew).toBe(mockCrewMembers.length);
    expect(result.current.activeCrew).toBe(mockCrewMembers.length);
    expect(result.current.crewAlerts).toEqual(mockIssues);
    expect(result.current.error).toBeNull();
  });

  it('should handle API errors from agent list gracefully', async () => {
    const errorMessage = 'Failed to fetch crew list';
    (api.agents.list as vi.Mock).mockRejectedValue(new Error(errorMessage));
    (api.agents.check as vi.Mock).mockResolvedValue({ healthy: true, issues: [] }); // Ensure check doesn't fail cascade

    const { result } = renderHook(() => useDashboardCrew());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(errorMessage);
    expect(result.current.totalCrew).toBe(0);
    expect(result.current.activeCrew).toBe(0);
    expect(result.current.crewAlerts).toEqual([]);
  });

  it('should handle API errors from agent check gracefully', async () => {
    const errorMessage = 'Failed to fetch agent health';
    (api.agents.list as vi.Mock).mockResolvedValue(mockCrewMembers);
    (api.agents.check as vi.Mock).mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useDashboardCrew());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(errorMessage);
    expect(result.current.totalCrew).toBe(mockCrewMembers.length);
    expect(result.current.activeCrew).toBe(mockCrewMembers.length);
    expect(result.current.crewAlerts).toEqual([]); // Alerts should be empty on error
  });
});
