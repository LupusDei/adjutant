import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardConvoys } from '../../../src/hooks/useDashboardConvoys';
import { api } from '../../../src/services/api';
import type { Convoy } from '../../../src/types';

// Mock the API service
vi.mock('../../../src/services/api', () => ({
  api: {
    convoys: {
      list: vi.fn(),
    },
  },
}));

const mockConvoys: Convoy[] = [
  {
    id: 'convoy1',
    name: 'Supply Run Alpha',
    status: 'completed',
    origin: 'Gastown',
    destination: 'Outpost 7',
    cargo: ['Water', 'Rations'],
    createdAt: '2023-01-01T12:00:00Z',
  },
  {
    id: 'convoy2',
    name: 'Trade Route Beta',
    status: 'in-progress',
    origin: 'Gastown',
    destination: 'Sector 3',
    cargo: ['Fuel'],
    createdAt: '2023-01-03T12:00:00Z',
  },
  {
    id: 'convoy3',
    name: 'Scavenger Hunt Gamma',
    status: 'pending',
    origin: 'Outpost 2',
    destination: 'Old City',
    cargo: ['Scrap Metal'],
    createdAt: '2023-01-02T12:00:00Z',
  },
  {
    id: 'convoy4',
    name: 'Reinforcement Delta',
    status: 'in-progress',
    origin: 'Gastown',
    destination: 'Frontline',
    cargo: ['Personnel'],
    createdAt: '2023-01-04T12:00:00Z',
  },
];

describe('useDashboardConvoys', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  it('should fetch and sort recent convoys successfully', async () => {
    (api.convoys.list as vi.Mock).mockResolvedValue(mockConvoys);

    const { result } = renderHook(() => useDashboardConvoys());

    // Initial state
    expect(result.current.loading).toBe(true);
    expect(result.current.recentConvoys).toEqual([]);
    expect(result.current.error).toBeNull();

    // Wait for the hook to finish fetching
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Assert fetched and sorted data (most recent 3)
    const expectedConvoysSorted = [
      mockConvoys[3], // convoy4 (2023-01-04)
      mockConvoys[1], // convoy2 (2023-01-03)
      mockConvoys[2], // convoy3 (2023-01-02)
    ];
    expect(result.current.recentConvoys).toEqual(expectedConvoysSorted);
    expect(result.current.error).toBeNull();
    expect(api.convoys.list).toHaveBeenCalledTimes(1);
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Failed to fetch convoys';
    (api.convoys.list as vi.Mock).mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useDashboardConvoys());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(errorMessage);
    expect(result.current.recentConvoys).toEqual([]);
  });

  it('should return an empty array if no convoys are found', async () => {
    (api.convoys.list as vi.Mock).mockResolvedValue([]);

    const { result } = renderHook(() => useDashboardConvoys());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recentConvoys).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should return fewer than 3 convoys if fewer are available', async () => {
    const fewConvoys = [mockConvoys[0], mockConvoys[1]];
    (api.convoys.list as vi.Mock).mockResolvedValue(fewConvoys);

    const { result } = renderHook(() => useDashboardConvoys());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recentConvoys).toEqual([
      fewConvoys[1], // convoy2
      fewConvoys[0], // convoy1
    ]);
    expect(result.current.recentConvoys.length).toBe(2);
    expect(result.current.error).toBeNull();
  });
});
