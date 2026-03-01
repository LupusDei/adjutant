import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardCrew } from '../../../src/hooks/useDashboardCrew';
import { api } from '../../../src/services/api';
import type { AgentType, CrewMemberStatus } from '../../../src/types';

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
  { name: 'Jax', type: 'agent', status: 'working', rig: 'rig1', currentTask: 'Processing data' },
  { name: 'Kael', type: 'agent', status: 'idle', rig: 'rig2' },
  { name: 'Zoe', type: 'agent', status: 'blocked', rig: null, currentTask: 'Waiting on dependency' },
];

describe('useDashboardCrew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch crew data successfully', async () => {
    vi.mocked(api.agents.list).mockResolvedValue(mockAgents);

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
    expect(result.current.totalCrew).toBe(3); // 3 agents
    expect(result.current.activeCrew).toBe(2); // Jax (working) + Kael (idle)
    expect(result.current.recentCrew).toHaveLength(3);
    // Sorted by status priority: working first, then blocked, then idle
    expect(result.current.recentCrew[0].name).toBe('Jax'); // working
    expect(result.current.error).toBeNull();
    expect(api.agents.list).toHaveBeenCalledTimes(1);
  });

  it('should generate alerts for blocked and stuck agents', async () => {
    const agentsWithIssues: MockAgent[] = [
      { name: 'Alice', type: 'agent', status: 'stuck', rig: 'rig1' },
      { name: 'Bob', type: 'agent', status: 'blocked', rig: 'rig2' },
      { name: 'Charlie', type: 'agent', status: 'working', rig: 'rig3' },
    ];
    vi.mocked(api.agents.list).mockResolvedValue(agentsWithIssues);

    const { result } = renderHook(() => useDashboardCrew());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.crewAlerts).toContain('Alice is STUCK');
    expect(result.current.crewAlerts).toContain('Bob is blocked');
    expect(result.current.crewAlerts).toHaveLength(2);
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Failed to fetch crew list';
    vi.mocked(api.agents.list).mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useDashboardCrew());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.error).toBe(errorMessage);
    expect(result.current.totalCrew).toBe(0);
    expect(result.current.activeCrew).toBe(0);
    expect(result.current.crewAlerts).toEqual([]);
  });

  it('should count agents correctly including offline', async () => {
    const agentsWithOffline: MockAgent[] = [
      { name: 'Active', type: 'agent', status: 'working', rig: 'rig1' },
      { name: 'Offline1', type: 'agent', status: 'offline', rig: null },
      { name: 'Offline2', type: 'user', status: 'offline', rig: null },
    ];
    vi.mocked(api.agents.list).mockResolvedValue(agentsWithOffline);

    const { result } = renderHook(() => useDashboardCrew());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.totalCrew).toBe(3);
    expect(result.current.activeCrew).toBe(1); // Only 'Active' agent
  });
});
