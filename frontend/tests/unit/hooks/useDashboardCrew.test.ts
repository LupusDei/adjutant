import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardCrew } from '../../../src/hooks/useDashboardCrew';
import { api } from '../../../src/services/api';
import type { CrewMember, AgentType, CrewMemberStatus } from '../../../src/types';

// Mock the API service
vi.mock('../../../src/services/api', () => ({
  api: {
    agents: {
      list: vi.fn(),
    },
  },
}));

interface MockAgent {
  name: string;
  type: AgentType;
  status: CrewMemberStatus;
  rig: string | null;
  currentTask?: string;
}

const mockAgents: MockAgent[] = [
  { name: 'Jax', type: 'crew', status: 'working', rig: 'rig1', currentTask: 'Processing data' },
  { name: 'Kael', type: 'polecat', status: 'idle', rig: 'rig2' },
  { name: 'Zoe', type: 'crew', status: 'blocked', rig: null, currentTask: 'Waiting on dependency' },
];

describe('useDashboardCrew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch crew data successfully', async () => {
    (api.agents.list as vi.Mock).mockResolvedValue(mockAgents);

    const { result } = renderHook(() => useDashboardCrew());

    // Initial state
    expect(result.current.loading).toBe(true);
    expect(result.current.totalCrew).toBe(0);
    expect(result.current.activeCrew).toBe(0);
    expect(result.current.crewAlerts).toEqual([]);
    expect(result.current.error).toBeNull();

    // Wait for the hook to finish fetching
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    // Assert fetched data
    expect(result.current.totalCrew).toBe(3); // 3 crew/polecat agents
    expect(result.current.activeCrew).toBe(2); // Jax (working) + Kael (idle)
    expect(result.current.recentCrew).toHaveLength(3);
    // Sorted by status priority: working first, then blocked, then idle
    expect(result.current.recentCrew[0].name).toBe('Jax'); // working
    expect(result.current.error).toBeNull();
    expect(api.agents.list).toHaveBeenCalledTimes(1);
  });

  it('should generate alerts for blocked and stuck agents', async () => {
    const agentsWithIssues: MockAgent[] = [
      { name: 'Alice', type: 'crew', status: 'stuck', rig: 'rig1' },
      { name: 'Bob', type: 'polecat', status: 'blocked', rig: 'rig2' },
      { name: 'Charlie', type: 'crew', status: 'working', rig: 'rig3' },
    ];
    (api.agents.list as vi.Mock).mockResolvedValue(agentsWithIssues);

    const { result } = renderHook(() => useDashboardCrew());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.crewAlerts).toContain('Alice is STUCK');
    expect(result.current.crewAlerts).toContain('Bob is blocked');
    expect(result.current.crewAlerts).toHaveLength(2);
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Failed to fetch crew list';
    (api.agents.list as vi.Mock).mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useDashboardCrew());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.error).toBe(errorMessage);
    expect(result.current.totalCrew).toBe(0);
    expect(result.current.activeCrew).toBe(0);
    expect(result.current.crewAlerts).toEqual([]);
  });

  it('should exclude offline polecats from counts', async () => {
    const agentsWithOffline: MockAgent[] = [
      { name: 'Active', type: 'polecat', status: 'working', rig: 'rig1' },
      { name: 'Offline', type: 'polecat', status: 'offline', rig: null },
      { name: 'Crew', type: 'crew', status: 'offline', rig: null }, // Offline crew still counted
    ];
    (api.agents.list as vi.Mock).mockResolvedValue(agentsWithOffline);

    const { result } = renderHook(() => useDashboardCrew());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    // Offline polecat excluded, offline crew included
    expect(result.current.totalCrew).toBe(2);
    expect(result.current.activeCrew).toBe(1); // Only 'Active' polecat
  });
});
