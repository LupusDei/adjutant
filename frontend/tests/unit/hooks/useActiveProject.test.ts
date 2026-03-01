import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock the api module
const mockProjectsList = vi.fn();
vi.mock('../../../src/services/api', () => ({
  api: {
    projects: {
      list: () => mockProjectsList(),
    },
  },
}));

import { useActiveProject } from '../../../src/hooks/useActiveProject';

describe('useActiveProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null initially while loading', () => {
    mockProjectsList.mockReturnValue(new Promise(() => {
      // Never resolves - simulates loading
    }));

    const { result } = renderHook(() => useActiveProject());

    expect(result.current.activeProject).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('should return the active project name when one exists', async () => {
    mockProjectsList.mockResolvedValue([
      { id: 'proj-1', name: 'adjutant', path: '/code/adjutant', active: false },
      { id: 'proj-2', name: 'gastown', path: '/code/gastown', active: true },
      { id: 'proj-3', name: 'ios-app', path: '/code/ios', active: false },
    ]);

    const { result } = renderHook(() => useActiveProject());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activeProject).toBe('gastown');
  });

  it('should return null when no project is active', async () => {
    mockProjectsList.mockResolvedValue([
      { id: 'proj-1', name: 'adjutant', path: '/code/adjutant', active: false },
      { id: 'proj-2', name: 'gastown', path: '/code/gastown', active: false },
    ]);

    const { result } = renderHook(() => useActiveProject());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activeProject).toBeNull();
  });

  it('should return null when projects list is empty', async () => {
    mockProjectsList.mockResolvedValue([]);

    const { result } = renderHook(() => useActiveProject());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activeProject).toBeNull();
  });

  it('should return null when API call fails', async () => {
    mockProjectsList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useActiveProject());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activeProject).toBeNull();
  });

  it('should not refetch on re-render (fetches only once)', async () => {
    mockProjectsList.mockResolvedValue([
      { id: 'proj-1', name: 'gastown', path: '/code/gastown', active: true },
    ]);

    const { result, rerender } = renderHook(() => useActiveProject());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    rerender();
    rerender();

    // Should only call once (on mount)
    expect(mockProjectsList).toHaveBeenCalledTimes(1);
  });
});
