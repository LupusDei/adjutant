import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

import type { BeadsGraphResponse } from '../../src/types/beads-graph';

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

// Mock the API module
vi.mock('../../src/services/api', () => ({
  api: {
    beads: {
      graphForEpic: vi.fn(),
    },
  },
}));

// Import after mocking
import { api } from '../../src/services/api';
import { EpicGraphView } from '../../src/components/epics/EpicGraphView';

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockGraphResponse(): BeadsGraphResponse {
  return {
    nodes: [
      {
        id: 'adj-010',
        title: 'Build Feature X',
        status: 'in_progress',
        type: 'epic',
        priority: 1,
        assignee: null,
      },
      {
        id: 'adj-010.1',
        title: 'API layer',
        status: 'open',
        type: 'task',
        priority: 2,
        assignee: 'agent-1',
      },
    ],
    edges: [
      {
        issueId: 'adj-010',
        dependsOnId: 'adj-010.1',
        type: 'depends_on',
      },
    ],
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('EpicGraphView', () => {
  const mockGraphForEpic = api.beads.graphForEpic as ReturnType<typeof vi.fn>;
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // Rendering
  // ===========================================================================

  describe('rendering', () => {
    it('should render the overlay with epic title and ID', async () => {
      mockGraphForEpic.mockResolvedValue(createMockGraphResponse());

      render(
        createElement(EpicGraphView, {
          epicId: 'adj-010',
          epicTitle: 'Build Feature X',
          onClose: mockOnClose,
        })
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByText('ADJ-010')).toBeTruthy();
      expect(screen.getByText('Build Feature X')).toBeTruthy();
    });

    it('should render loading state initially', () => {
      mockGraphForEpic.mockReturnValue(new Promise(() => {})); // Never resolves

      render(
        createElement(EpicGraphView, {
          epicId: 'adj-010',
          epicTitle: 'Build Feature X',
          onClose: mockOnClose,
        })
      );

      expect(screen.getByText(/COMPUTING.*GRAPH/i)).toBeTruthy();
    });

    it('should render error state on fetch failure', async () => {
      mockGraphForEpic.mockRejectedValue(new Error('Server error'));

      render(
        createElement(EpicGraphView, {
          epicId: 'adj-010',
          epicTitle: 'Build Feature X',
          onClose: mockOnClose,
        })
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText(/GRAPH.*FAILED/i)).toBeTruthy();
    });

    it('should render the React Flow graph when data loads', async () => {
      mockGraphForEpic.mockResolvedValue(createMockGraphResponse());

      render(
        createElement(EpicGraphView, {
          epicId: 'adj-010',
          epicTitle: 'Build Feature X',
          onClose: mockOnClose,
        })
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId('react-flow')).toBeTruthy();
    });
  });

  // ===========================================================================
  // Close Behavior
  // ===========================================================================

  describe('close behavior', () => {
    it('should call onClose when close button is clicked', async () => {
      mockGraphForEpic.mockResolvedValue(createMockGraphResponse());

      render(
        createElement(EpicGraphView, {
          epicId: 'adj-010',
          epicTitle: 'Build Feature X',
          onClose: mockOnClose,
        })
      );

      await act(async () => {
        await Promise.resolve();
      });

      const closeButton = screen.getByLabelText('Close graph');
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when Escape key is pressed', async () => {
      mockGraphForEpic.mockResolvedValue(createMockGraphResponse());

      render(
        createElement(EpicGraphView, {
          epicId: 'adj-010',
          epicTitle: 'Build Feature X',
          onClose: mockOnClose,
        })
      );

      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Critical Path Toggle
  // ===========================================================================

  describe('critical path toggle', () => {
    it('should render a critical path toggle button', async () => {
      mockGraphForEpic.mockResolvedValue(createMockGraphResponse());

      render(
        createElement(EpicGraphView, {
          epicId: 'adj-010',
          epicTitle: 'Build Feature X',
          onClose: mockOnClose,
        })
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByText('CRITICAL PATH')).toBeTruthy();
    });
  });

  // ===========================================================================
  // API call
  // ===========================================================================

  describe('API integration', () => {
    it('should call graphForEpic with the correct epicId', async () => {
      mockGraphForEpic.mockResolvedValue(createMockGraphResponse());

      render(
        createElement(EpicGraphView, {
          epicId: 'adj-010',
          epicTitle: 'Build Feature X',
          onClose: mockOnClose,
        })
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockGraphForEpic).toHaveBeenCalledWith('adj-010');
    });
  });
});
