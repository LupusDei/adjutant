/**
 * Tests for epic dependency graph feature:
 * - EpicGraphPage renders the full-page graph
 * - BeadDetailView shows "VIEW DEPENDENCY GRAPH" button for epics
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

// Mock usePolling to return controlled data
const mockRefresh = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/hooks/usePolling', () => ({
  usePolling: vi.fn(() => ({
    data: {
      nodes: [
        { id: 'adj-010', title: 'Root Epic', status: 'in_progress', type: 'epic', priority: 1, assignee: null, source: 'adjutant' },
        { id: 'adj-010.1', title: 'Sub-epic 1', status: 'open', type: 'epic', priority: 2, assignee: null, source: 'adjutant' },
        { id: 'adj-010.1.1', title: 'Task A', status: 'closed', type: 'task', priority: 2, assignee: 'agent-1', source: 'adjutant' },
      ],
      edges: [
        { dependsOnId: 'adj-010', issueId: 'adj-010.1', type: 'blocks' },
        { dependsOnId: 'adj-010.1', issueId: 'adj-010.1.1', type: 'blocks' },
      ],
    },
    loading: false,
    error: null,
    refresh: mockRefresh,
  })),
}));

// Mock React Flow
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges }: { nodes?: unknown[]; edges?: unknown[] }) =>
    createElement('div', { 'data-testid': 'react-flow', 'data-node-count': nodes?.length ?? 0, 'data-edge-count': edges?.length ?? 0 }),
  ReactFlowProvider: ({ children }: { children?: React.ReactNode }) =>
    createElement('div', null, children),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  BackgroundVariant: { Dots: 'dots' },
}));

// Mock dagre
vi.mock('@dagrejs/dagre', () => {
  const mockGraph = {
    setDefaultEdgeLabel: vi.fn().mockReturnThis(),
    setGraph: vi.fn(),
    setNode: vi.fn(),
    setEdge: vi.fn(),
    node: vi.fn((id: string) => ({ x: 100, y: id.split('.').length * 100, width: 200, height: 60 })),
  };
  return {
    default: {
      graphlib: {
        Graph: vi.fn(() => mockGraph),
      },
      layout: vi.fn(),
    },
  };
});

// Mock critical-path and cycle-detection
vi.mock('../../src/utils/critical-path', () => ({
  computeCriticalPath: vi.fn(() => ({ nodeIds: new Set(), edgeIds: new Set() })),
}));
vi.mock('../../src/utils/cycle-detection', () => ({
  detectCycles: vi.fn(() => ({ hasCycles: false, cycles: [], nodesInCycles: new Set(), edgesInCycles: new Set() })),
}));

// Mock API
vi.mock('../../src/services/api', () => ({
  api: {
    beads: {
      get: vi.fn().mockResolvedValue({
        id: 'adj-010',
        title: 'Root Epic',
        status: 'in_progress',
        priority: 1,
        type: 'epic',
        assignee: null,
        project: 'adjutant',
        source: 'adjutant',
        labels: [],
        description: 'An epic description',
        dependencies: [],
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-02T00:00:00Z',
        closedAt: null,
        agentState: null,
        isWisp: false,
        isPinned: false,
      }),
      graphForEpic: vi.fn().mockResolvedValue({
        nodes: [
          { id: 'adj-010', title: 'Root Epic', status: 'in_progress', type: 'epic', priority: 1, assignee: null },
          { id: 'adj-010.1', title: 'Sub-epic 1', status: 'open', type: 'epic', priority: 2, assignee: null },
        ],
        edges: [{ dependsOnId: 'adj-010', issueId: 'adj-010.1', type: 'blocks' }],
      }),
      update: vi.fn(),
    },
    agents: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { EpicGraphPage } from '../../src/components/beads/EpicGraphPage';
import { BeadDetailView } from '../../src/components/beads/BeadDetailView';

describe('EpicGraphPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the React Flow graph with nodes', async () => {
    render(createElement(EpicGraphPage, { epicId: 'adj-010' }));

    await act(async () => {
      await new Promise((r) => { setTimeout(r, 10); });
    });

    const reactFlow = screen.getByTestId('react-flow');
    expect(reactFlow).toBeTruthy();
    expect(reactFlow.getAttribute('data-node-count')).toBe('3');
    expect(reactFlow.getAttribute('data-edge-count')).toBe('2');
  });

  it('should show epic ID in the header', async () => {
    render(createElement(EpicGraphPage, { epicId: 'adj-010' }));

    await act(async () => {
      await new Promise((r) => { setTimeout(r, 10); });
    });

    expect(screen.getByText('adj-010')).toBeTruthy();
  });

  it('should show stats in the header', async () => {
    render(createElement(EpicGraphPage, { epicId: 'adj-010' }));

    await act(async () => {
      await new Promise((r) => { setTimeout(r, 10); });
    });

    expect(screen.getByText('OPEN')).toBeTruthy();
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.getByText('CLOSED')).toBeTruthy();
  });
});

describe('BeadDetailView - Epic Graph Button', () => {
  const mockOnClose = vi.fn();
  let windowOpenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('should show VIEW DEPENDENCY GRAPH button for epic beads', async () => {
    render(createElement(BeadDetailView, {
      beadId: 'adj-010',
      onClose: mockOnClose,
    }));

    await act(async () => {
      await new Promise((r) => { setTimeout(r, 10); });
    });

    expect(screen.getByText('VIEW DEPENDENCY GRAPH')).toBeTruthy();
  });

  it('should open a new window when the graph button is clicked', async () => {
    render(createElement(BeadDetailView, {
      beadId: 'adj-010',
      onClose: mockOnClose,
    }));

    await act(async () => {
      await new Promise((r) => { setTimeout(r, 10); });
    });

    fireEvent.click(screen.getByText('VIEW DEPENDENCY GRAPH'));
    expect(windowOpenSpy).toHaveBeenCalledWith(
      expect.stringContaining('#graph/adj-010'),
      '_blank',
      'noopener',
    );
  });

  it('should NOT show graph button for task beads', async () => {
    const { api } = await import('../../src/services/api');
    vi.mocked(api.beads.get).mockResolvedValueOnce({
      id: 'adj-010.1.1',
      title: 'Task A',
      status: 'open',
      priority: 2,
      type: 'task',
      assignee: null,
      project: 'adjutant',
      source: 'adjutant',
      labels: [],
      description: '',
      dependencies: [],
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: null,
      closedAt: null,
      agentState: null,
      isWisp: false,
      isPinned: false,
    });

    render(createElement(BeadDetailView, {
      beadId: 'adj-010.1.1',
      onClose: mockOnClose,
    }));

    await act(async () => {
      await new Promise((r) => { setTimeout(r, 10); });
    });

    expect(screen.queryByText('VIEW DEPENDENCY GRAPH')).toBeNull();
  });
});
