import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import type { BeadsGraphResponse } from "../../../src/types/beads-graph";

// Mock the API module
vi.mock("../../../src/services/api", () => ({
  api: {
    beads: {
      graph: vi.fn(),
    },
  },
}));

// Import after mocking
import { api } from "../../../src/services/api";
import { useBeadsGraph } from "../../../src/hooks/useBeadsGraph";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockGraphResponse(
  overrides: Partial<BeadsGraphResponse> = {}
): BeadsGraphResponse {
  return {
    nodes: [
      {
        id: "adj-001",
        title: "Epic: Build feature",
        status: "in_progress",
        type: "epic",
        priority: 1,
        assignee: null,
        source: "adjutant",
      },
      {
        id: "adj-002",
        title: "Task: Implement API",
        status: "open",
        type: "task",
        priority: 2,
        assignee: "agent-1",
        source: "adjutant",
      },
      {
        id: "adj-003",
        title: "Task: Write tests",
        status: "closed",
        type: "task",
        priority: 2,
        assignee: "agent-2",
        source: "adjutant",
      },
    ],
    edges: [
      {
        issueId: "adj-001",
        dependsOnId: "adj-002",
        type: "depends_on",
      },
      {
        issueId: "adj-001",
        dependsOnId: "adj-003",
        type: "depends_on",
      },
    ],
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("useBeadsGraph", () => {
  const mockGraph = api.beads.graph as ReturnType<typeof vi.fn>;

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

  describe("data fetching", () => {
    it("should fetch graph data on mount", async () => {
      const mockData = createMockGraphResponse();
      mockGraph.mockResolvedValue(mockData);

      const { result } = renderHook(() => useBeadsGraph());

      expect(result.current.loading).toBe(true);
      expect(mockGraph).toHaveBeenCalledTimes(1);

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should transform API nodes into React Flow nodes with positions", async () => {
      const mockData = createMockGraphResponse();
      mockGraph.mockResolvedValue(mockData);

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      // Should have 3 nodes
      expect(result.current.nodes).toHaveLength(3);

      // Each node should have position from dagre layout
      for (const node of result.current.nodes) {
        expect(node.position).toBeDefined();
        expect(typeof node.position.x).toBe("number");
        expect(typeof node.position.y).toBe("number");
      }

      // Nodes should have expected IDs
      const nodeIds = result.current.nodes.map((n) => n.id);
      expect(nodeIds).toContain("adj-001");
      expect(nodeIds).toContain("adj-002");
      expect(nodeIds).toContain("adj-003");

      // Nodes should have beadNode type for custom rendering
      for (const node of result.current.nodes) {
        expect(node.type).toBe("beadNode");
      }

      // Nodes should carry data from API
      const epicNode = result.current.nodes.find((n) => n.id === "adj-001");
      expect(epicNode?.data.title).toBe("Epic: Build feature");
      expect(epicNode?.data.status).toBe("in_progress");
      expect(epicNode?.data.beadType).toBe("epic");
      expect(epicNode?.data.priority).toBe(1);
    });

    it("should transform API edges into React Flow edges", async () => {
      const mockData = createMockGraphResponse();
      mockGraph.mockResolvedValue(mockData);

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      // Should have 2 edges
      expect(result.current.edges).toHaveLength(2);

      // Edges should have source and target from API
      const edge1 = result.current.edges.find(
        (e) => e.source === "adj-002" && e.target === "adj-001"
      );
      expect(edge1).toBeDefined();

      const edge2 = result.current.edges.find(
        (e) => e.source === "adj-003" && e.target === "adj-001"
      );
      expect(edge2).toBeDefined();
    });
  });

  // ===========================================================================
  // Loading State
  // ===========================================================================

  describe("loading state", () => {
    it("should start in loading state", () => {
      mockGraph.mockResolvedValue(createMockGraphResponse());

      const { result } = renderHook(() => useBeadsGraph());

      expect(result.current.loading).toBe(true);
      expect(result.current.nodes).toEqual([]);
      expect(result.current.edges).toEqual([]);
    });

    it("should clear loading when data arrives", async () => {
      mockGraph.mockResolvedValue(createMockGraphResponse());

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.loading).toBe(false);
    });
  });

  // ===========================================================================
  // Error State
  // ===========================================================================

  describe("error state", () => {
    it("should handle fetch errors", async () => {
      const error = new Error("Network error");
      mockGraph.mockRejectedValue(error);

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toEqual(error);
      expect(result.current.nodes).toEqual([]);
      expect(result.current.edges).toEqual([]);
    });

    it("should clear error on successful refetch", async () => {
      const error = new Error("Temporary error");
      mockGraph
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(createMockGraphResponse());

      const { result } = renderHook(() =>
        useBeadsGraph({ pollInterval: 5000 })
      );

      // Wait for first fetch (error)
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.error).toEqual(error);

      // Trigger next poll
      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.nodes).toHaveLength(3);
    });
  });

  // ===========================================================================
  // Empty Graph
  // ===========================================================================

  describe("empty graph", () => {
    it("should handle empty graph (no nodes, no edges)", async () => {
      mockGraph.mockResolvedValue({ nodes: [], edges: [] });

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.nodes).toEqual([]);
      expect(result.current.edges).toEqual([]);
    });

    it("should handle nodes without edges", async () => {
      mockGraph.mockResolvedValue({
        nodes: [
          {
            id: "adj-solo",
            title: "Solo task",
            status: "open",
            type: "task",
            priority: 2,
            assignee: null,
          },
        ],
        edges: [],
      });

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.nodes).toHaveLength(1);
      expect(result.current.edges).toEqual([]);
      expect(result.current.nodes[0]?.position).toBeDefined();
    });
  });

  // ===========================================================================
  // Polling
  // ===========================================================================

  describe("polling", () => {
    it("should poll at specified interval", async () => {
      mockGraph.mockResolvedValue(createMockGraphResponse());

      renderHook(() => useBeadsGraph({ pollInterval: 10000 }));

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGraph).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(10000);
        await Promise.resolve();
      });

      expect(mockGraph).toHaveBeenCalledTimes(2);
    });

    it("should not poll when enabled is false", () => {
      mockGraph.mockResolvedValue(createMockGraphResponse());

      renderHook(() => useBeadsGraph({ enabled: false }));

      expect(mockGraph).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Refresh
  // ===========================================================================

  describe("refresh", () => {
    it("should allow manual refresh", async () => {
      mockGraph.mockResolvedValue(createMockGraphResponse());

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGraph).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockGraph).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // Collapse / Expand
  // ===========================================================================

  describe("collapse/expand", () => {
    it("should toggle a node ID in/out of collapsed set", async () => {
      mockGraph.mockResolvedValue(createMockGraphResponse());

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      // Initially no nodes collapsed
      expect(result.current.collapsedNodes.size).toBe(0);

      // Toggle collapse on
      act(() => {
        result.current.toggleCollapse("adj-001");
      });
      expect(result.current.collapsedNodes.has("adj-001")).toBe(true);

      // Toggle collapse off
      act(() => {
        result.current.toggleCollapse("adj-001");
      });
      expect(result.current.collapsedNodes.has("adj-001")).toBe(false);
    });

    it("should mark collapsed node data with collapsed flag", async () => {
      mockGraph.mockResolvedValue(createMockGraphResponse());

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        result.current.toggleCollapse("adj-001");
      });

      const epicNode = result.current.nodes.find((n) => n.id === "adj-001");
      expect(epicNode?.data.collapsed).toBe(true);
    });

    it("should collapseAll only epic nodes that have children, not tasks", async () => {
      // Graph: epic-1 has children (task-a depends on epic-1)
      //        task-b also has a child edge (task-c depends on task-b)
      //        Only epic-1 should be collapsed (not task-b, despite having children)
      mockGraph.mockResolvedValue({
        nodes: [
          { id: "epic-1", title: "Epic 1", status: "open", type: "epic", priority: 1, assignee: null },
          { id: "task-a", title: "Task A", status: "open", type: "task", priority: 2, assignee: null },
          { id: "task-b", title: "Task B", status: "open", type: "task", priority: 2, assignee: null },
          { id: "task-c", title: "Task C", status: "open", type: "task", priority: 2, assignee: null },
        ],
        edges: [
          { issueId: "task-a", dependsOnId: "epic-1", type: "depends_on" },
          { issueId: "task-c", dependsOnId: "task-b", type: "depends_on" },
        ],
      });

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        result.current.collapseAll();
      });

      // epic-1 is an epic AND has children -> should be collapsed
      expect(result.current.collapsedNodes.has("epic-1")).toBe(true);
      // task-b has children but is NOT an epic -> should NOT be collapsed
      expect(result.current.collapsedNodes.has("task-b")).toBe(false);
    });

    it("should expandAll by clearing the collapsed set", async () => {
      mockGraph.mockResolvedValue(createMockGraphResponse());

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      // Manually collapse a node first
      act(() => {
        result.current.toggleCollapse("adj-001");
      });
      expect(result.current.collapsedNodes.size).toBe(1);

      act(() => {
        result.current.expandAll();
      });
      expect(result.current.collapsedNodes.size).toBe(0);
    });
  });

  // ===========================================================================
  // Epic IDs extraction
  // ===========================================================================

  describe("epicIds", () => {
    it("should extract and sort epic IDs from graph data", async () => {
      mockGraph.mockResolvedValue({
        nodes: [
          { id: "epic-z", title: "Z Epic", status: "open", type: "epic", priority: 1, assignee: null },
          { id: "task-1", title: "Task", status: "open", type: "task", priority: 2, assignee: null },
          { id: "epic-a", title: "A Epic", status: "open", type: "epic", priority: 1, assignee: null },
        ],
        edges: [],
      });

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.epicIds).toEqual(["epic-a", "epic-z"]);
    });

    it("should return empty epicIds when no data", () => {
      mockGraph.mockResolvedValue({ nodes: [], edges: [] });

      const { result } = renderHook(() => useBeadsGraph());
      // Before data loads, epicIds should be empty
      expect(result.current.epicIds).toEqual([]);
    });
  });

  // ===========================================================================
  // Critical Path
  // ===========================================================================

  describe("critical path", () => {
    it("should compute critical path from graph data", async () => {
      mockGraph.mockResolvedValue({
        nodes: [
          { id: "A", title: "A", status: "open", type: "task", priority: 2, assignee: null },
          { id: "B", title: "B", status: "open", type: "task", priority: 2, assignee: null },
          { id: "C", title: "C", status: "open", type: "task", priority: 2, assignee: null },
        ],
        edges: [
          { issueId: "A", dependsOnId: "B", type: "depends_on" },
          { issueId: "B", dependsOnId: "C", type: "depends_on" },
        ],
      });

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.criticalPathLength).toBe(3);
      expect(result.current.criticalPath.nodeIds.has("A")).toBe(true);
      expect(result.current.criticalPath.nodeIds.has("B")).toBe(true);
      expect(result.current.criticalPath.nodeIds.has("C")).toBe(true);
    });

    it("should toggle critical path display", async () => {
      mockGraph.mockResolvedValue(createMockGraphResponse());

      const { result } = renderHook(() => useBeadsGraph());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.showCriticalPath).toBe(false);

      act(() => {
        result.current.toggleCriticalPath();
      });

      expect(result.current.showCriticalPath).toBe(true);

      act(() => {
        result.current.toggleCriticalPath();
      });

      expect(result.current.showCriticalPath).toBe(false);
    });
  });
});
