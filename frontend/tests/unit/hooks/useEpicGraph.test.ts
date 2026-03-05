import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import type { BeadsGraphResponse } from '../../../src/types/beads-graph';

// Mock the API module
vi.mock('../../../src/services/api', () => ({
  api: {
    beads: {
      graphForEpic: vi.fn(),
    },
  },
}));

// Import after mocking
import { api } from '../../../src/services/api';
import { useEpicGraph } from '../../../src/hooks/useEpicGraph';

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockEpicGraphResponse(
  overrides: Partial<BeadsGraphResponse> = {}
): BeadsGraphResponse {
  return {
    nodes: [
      {
        id: 'adj-010',
        title: 'Parent Epic',
        status: 'in_progress',
        type: 'epic',
        priority: 1,
        assignee: null,
        source: 'adjutant',
      },
      {
        id: 'adj-010.1',
        title: 'Sub-task: API layer',
        status: 'open',
        type: 'task',
        priority: 2,
        assignee: 'agent-1',
        source: 'adjutant',
      },
      {
        id: 'adj-010.2',
        title: 'Sub-task: UI component',
        status: 'closed',
        type: 'task',
        priority: 2,
        assignee: 'agent-2',
        source: 'adjutant',
      },
    ],
    edges: [
      {
        issueId: 'adj-010',
        dependsOnId: 'adj-010.1',
        type: 'depends_on',
      },
      {
        issueId: 'adj-010',
        dependsOnId: 'adj-010.2',
        type: 'depends_on',
      },
    ],
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('useEpicGraph', () => {
  const mockGraphForEpic = api.beads.graphForEpic as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // Data Fetching
  // ===========================================================================

  describe('data fetching', () => {
    it('should fetch scoped graph data for a specific epic', async () => {
      const mockData = createMockEpicGraphResponse();
      mockGraphForEpic.mockResolvedValue(mockData);

      const { result } = renderHook(() => useEpicGraph('adj-010'));

      expect(result.current.loading).toBe(true);
      expect(mockGraphForEpic).toHaveBeenCalledWith('adj-010');

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should transform API nodes into React Flow nodes with positions', async () => {
      const mockData = createMockEpicGraphResponse();
      mockGraphForEpic.mockResolvedValue(mockData);

      const { result } = renderHook(() => useEpicGraph('adj-010'));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.nodes).toHaveLength(3);

      for (const node of result.current.nodes) {
        expect(node.position).toBeDefined();
        expect(typeof node.position.x).toBe('number');
        expect(typeof node.position.y).toBe('number');
      }

      const nodeIds = result.current.nodes.map((n) => n.id);
      expect(nodeIds).toContain('adj-010');
      expect(nodeIds).toContain('adj-010.1');
      expect(nodeIds).toContain('adj-010.2');

      for (const node of result.current.nodes) {
        expect(node.type).toBe('beadNode');
      }
    });

    it('should transform API edges into React Flow edges', async () => {
      const mockData = createMockEpicGraphResponse();
      mockGraphForEpic.mockResolvedValue(mockData);

      const { result } = renderHook(() => useEpicGraph('adj-010'));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.edges).toHaveLength(2);

      const edge1 = result.current.edges.find(
        (e) => e.source === 'adj-010.1' && e.target === 'adj-010'
      );
      expect(edge1).toBeDefined();

      const edge2 = result.current.edges.find(
        (e) => e.source === 'adj-010.2' && e.target === 'adj-010'
      );
      expect(edge2).toBeDefined();
    });
  });

  // ===========================================================================
  // Null epicId
  // ===========================================================================

  describe('null epicId', () => {
    it('should not fetch when epicId is null', () => {
      renderHook(() => useEpicGraph(null));

      expect(mockGraphForEpic).not.toHaveBeenCalled();
    });

    it('should return empty state when epicId is null', () => {
      const { result } = renderHook(() => useEpicGraph(null));

      expect(result.current.nodes).toEqual([]);
      expect(result.current.edges).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  // ===========================================================================
  // Error State
  // ===========================================================================

  describe('error state', () => {
    it('should handle fetch errors', async () => {
      const error = new Error('Network error');
      mockGraphForEpic.mockRejectedValue(error);

      const { result } = renderHook(() => useEpicGraph('adj-010'));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toEqual(error);
      expect(result.current.nodes).toEqual([]);
      expect(result.current.edges).toEqual([]);
    });
  });

  // ===========================================================================
  // Re-fetch on epicId change
  // ===========================================================================

  describe('epicId change', () => {
    it('should re-fetch when epicId changes', async () => {
      const mockData1 = createMockEpicGraphResponse();
      const mockData2 = createMockEpicGraphResponse({
        nodes: [
          {
            id: 'adj-020',
            title: 'Different epic',
            status: 'open',
            type: 'epic',
            priority: 1,
            assignee: null,
          },
        ],
        edges: [],
      });
      mockGraphForEpic
        .mockResolvedValueOnce(mockData1)
        .mockResolvedValueOnce(mockData2);

      const { result, rerender } = renderHook(
        ({ epicId }: { epicId: string }) => useEpicGraph(epicId),
        { initialProps: { epicId: 'adj-010' } }
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.nodes).toHaveLength(3);

      rerender({ epicId: 'adj-020' });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockGraphForEpic).toHaveBeenCalledWith('adj-020');
      expect(result.current.nodes).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Critical Path
  // ===========================================================================

  describe('critical path', () => {
    it('should provide critical path toggle', async () => {
      const mockData = createMockEpicGraphResponse();
      mockGraphForEpic.mockResolvedValue(mockData);

      const { result } = renderHook(() => useEpicGraph('adj-010'));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.showCriticalPath).toBe(false);

      act(() => {
        result.current.toggleCriticalPath();
      });

      expect(result.current.showCriticalPath).toBe(true);
    });
  });

  // ===========================================================================
  // Refresh
  // ===========================================================================

  describe('refresh', () => {
    it('should allow manual refresh', async () => {
      mockGraphForEpic.mockResolvedValue(createMockEpicGraphResponse());

      const { result } = renderHook(() => useEpicGraph('adj-010'));

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGraphForEpic).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockGraphForEpic).toHaveBeenCalledTimes(2);
    });
  });
});
