import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

// Mock the useEpicDetail hook
vi.mock('../../src/hooks', () => ({
  useEpicDetail: vi.fn(() => ({
    epic: {
      id: 'adj-010',
      title: 'Build Feature X',
      status: 'in_progress',
      priority: 1,
      assignee: null,
      project: 'adjutant',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-02T00:00:00Z',
      labels: [],
    },
    openSubtasks: [],
    closedSubtasks: [],
    subtasks: [],
    progress: 0.5,
    progressText: '1/2',
    isComplete: false,
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the API module
vi.mock('../../src/services/api', () => ({
  api: {
    beads: {
      graphForEpic: vi.fn().mockReturnValue(new Promise(() => {})),
      update: vi.fn(),
    },
    agents: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock React Flow to avoid canvas/DOM issues in jsdom
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) =>
    createElement('div', { 'data-testid': 'react-flow' }, children),
  ReactFlowProvider: ({ children }: { children?: React.ReactNode }) =>
    createElement('div', null, children),
  Background: () => createElement('div', { 'data-testid': 'rf-background' }),
  Controls: () => createElement('div', { 'data-testid': 'rf-controls' }),
  MiniMap: () => createElement('div', { 'data-testid': 'rf-minimap' }),
  BackgroundVariant: { Dots: 'dots' },
  useReactFlow: () => ({ fitView: vi.fn() }),
}));

// Import after mocking
import { EpicDetailView } from '../../src/components/epics/EpicDetailView';

// =============================================================================
// Tests
// =============================================================================

describe('EpicDetailView - View Graph button', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render a View Graph button in the header', async () => {
    render(
      createElement(EpicDetailView, {
        epicId: 'adj-010',
        onClose: mockOnClose,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    const graphButton = screen.getByLabelText('View dependency graph');
    expect(graphButton).toBeTruthy();
  });

  it('should show the EpicGraphView overlay when View Graph is clicked', async () => {
    render(
      createElement(EpicDetailView, {
        epicId: 'adj-010',
        onClose: mockOnClose,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    const graphButton = screen.getByLabelText('View dependency graph');
    fireEvent.click(graphButton);

    // The overlay should now be visible (it calls graphForEpic)
    // We check for the epic ID in the overlay header
    const epicIdElements = screen.getAllByText('ADJ-010');
    // Should have at least 2 - one in the detail panel, one in the graph overlay
    expect(epicIdElements.length).toBeGreaterThanOrEqual(2);
  });

  it('should close the graph overlay when its close button is clicked', async () => {
    render(
      createElement(EpicDetailView, {
        epicId: 'adj-010',
        onClose: mockOnClose,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Open the graph
    const graphButton = screen.getByLabelText('View dependency graph');
    fireEvent.click(graphButton);

    // Close it
    const closeButton = screen.getByLabelText('Close graph');
    fireEvent.click(closeButton);

    // The overlay should be gone - check that there's only one ADJ-010 now
    const epicIdElements = screen.getAllByText('ADJ-010');
    expect(epicIdElements).toHaveLength(1);
  });

  it('should not render View Graph when no epicId', () => {
    render(
      createElement(EpicDetailView, {
        epicId: null,
        onClose: mockOnClose,
      })
    );

    expect(screen.queryByLabelText('View dependency graph')).toBeNull();
  });

  // ===========================================================================
  // QA Edge Case: Escape key isolation (adj-036.4)
  // ===========================================================================

  it('should NOT close the detail panel when Escape is pressed while graph overlay is open', async () => {
    render(
      createElement(EpicDetailView, {
        epicId: 'adj-010',
        onClose: mockOnClose,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Open the graph overlay
    const graphButton = screen.getByLabelText('View dependency graph');
    fireEvent.click(graphButton);

    // Press Escape -- should close the graph overlay but NOT call mockOnClose
    mockOnClose.mockClear();
    fireEvent.keyDown(window, { key: 'Escape' });

    // The graph overlay should close (close button should be gone)
    expect(screen.queryByLabelText('Close graph')).toBeNull();
    // The detail panel's onClose should NOT have been called
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
