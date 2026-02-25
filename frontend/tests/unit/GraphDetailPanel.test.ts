import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { GraphDetailPanel } from '../../src/components/beads/GraphDetailPanel';
import type { BeadNodeData } from '../../src/hooks/useBeadsGraph';

const mockBead: BeadNodeData = {
  id: 'adj-001',
  title: 'Implement dependency graph',
  status: 'in_progress',
  beadType: 'task',
  priority: 1,
  assignee: 'agent-alpha',
};

const mockBeadNoAssignee: BeadNodeData = {
  id: 'adj-002',
  title: 'Write documentation',
  status: 'open',
  beadType: 'epic',
  priority: 2,
  assignee: null,
};

describe('GraphDetailPanel', () => {
  const onClose = vi.fn();
  const onAssign = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderPanel(bead: BeadNodeData | null = mockBead) {
    return render(
      createElement(GraphDetailPanel, {
        bead,
        onClose,
        onAssign,
      })
    );
  }

  it('renders nothing when bead is null', () => {
    const { container } = renderPanel(null);
    expect(container.innerHTML).toBe('');
  });

  it('renders bead info when bead is provided', () => {
    renderPanel(mockBead);

    expect(screen.getByText('adj-001')).toBeTruthy();
    expect(screen.getByText('Implement dependency graph')).toBeTruthy();
    expect(screen.getByText('IN_PROGRESS')).toBeTruthy();
    expect(screen.getByText('TASK')).toBeTruthy();
    expect(screen.getByText('agent-alpha')).toBeTruthy();
  });

  it('renders priority value', () => {
    renderPanel(mockBead);

    // Priority should be shown as P1
    expect(screen.getByText('P1')).toBeTruthy();
  });

  it('shows "No assignee" when assignee is null', () => {
    renderPanel(mockBeadNoAssignee);

    expect(screen.getByText('NO ASSIGNEE')).toBeTruthy();
  });

  it('calls onAssign with bead ID when Assign button is clicked', () => {
    renderPanel(mockBead);

    const assignButton = screen.getByText('ASSIGN');
    fireEvent.click(assignButton);

    expect(onAssign).toHaveBeenCalledWith('adj-001');
  });

  it('calls onClose when close button is clicked', () => {
    renderPanel(mockBead);

    const closeButton = screen.getByLabelText('Close detail panel');
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay backdrop is clicked', () => {
    renderPanel(mockBead);

    const overlay = screen.getByTestId('graph-detail-overlay');
    fireEvent.click(overlay);

    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape key', () => {
    renderPanel(mockBead);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('renders epic type correctly', () => {
    renderPanel(mockBeadNoAssignee);

    expect(screen.getByText('adj-002')).toBeTruthy();
    expect(screen.getByText('EPIC')).toBeTruthy();
    expect(screen.getByText('OPEN')).toBeTruthy();
  });

  it('renders priority P2 for priority 2', () => {
    renderPanel(mockBeadNoAssignee);

    expect(screen.getByText('P2')).toBeTruthy();
  });
});
