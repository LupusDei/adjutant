import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BeadsList } from '../../../src/components/beads/BeadsList';
import { api } from '../../../src/services/api';

vi.mock('../../../src/services/api', () => ({
  api: {
    beads: {
      list: vi.fn(),
    },
    mail: {
      send: vi.fn(),
    },
  },
}));

const mockBeads = [
  {
    id: 'hq-001',
    title: 'Test bead 1',
    type: 'task',
    priority: 2,
    status: 'open',
    assignee: null,
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T12:00:00Z',
  },
  {
    id: 'hq-002',
    title: 'Test bead 2',
    type: 'task',
    priority: 1,
    status: 'closed',
    assignee: 'gastown_boy/dag',
    createdAt: '2026-01-14T10:00:00Z',
    updatedAt: '2026-01-14T14:00:00Z',
  },
];

describe('BeadsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.beads.list).mockResolvedValue(mockBeads);
    vi.mocked(api.mail.send).mockResolvedValue(undefined);
  });

  describe('reactive updates on filter change', () => {
    it('should fetch data immediately when component mounts', async () => {
      render(<BeadsList statusFilter="open" isActive={true} />);

      await waitFor(() => {
        expect(api.beads.list).toHaveBeenCalledWith({
          status: 'open',
          type: 'task',
          limit: 50,
        });
      });
    });

    it('should refetch when statusFilter prop changes', async () => {
      const { rerender } = render(<BeadsList statusFilter="open" isActive={true} />);

      await waitFor(() => {
        expect(api.beads.list).toHaveBeenCalledWith({
          status: 'open',
          type: 'task',
          limit: 50,
        });
      });

      vi.clearAllMocks();

      // Change filter to closed
      rerender(<BeadsList statusFilter="closed" isActive={true} />);

      await waitFor(() => {
        expect(api.beads.list).toHaveBeenCalledWith({
          status: 'closed',
          type: 'task',
          limit: 50,
        });
      });
    });

    it('should refetch with correct filter after multiple rapid changes', async () => {
      const { rerender } = render(<BeadsList statusFilter="open" isActive={true} />);

      await waitFor(() => {
        expect(api.beads.list).toHaveBeenCalled();
      });

      vi.clearAllMocks();

      // Rapid filter changes
      rerender(<BeadsList statusFilter="closed" isActive={true} />);
      rerender(<BeadsList statusFilter="all" isActive={true} />);

      await waitFor(() => {
        // Should eventually fetch with the final filter value
        expect(api.beads.list).toHaveBeenLastCalledWith({
          status: 'all',
          type: 'task',
          limit: 50,
        });
      });
    });
  });

  describe('reactive updates on sling action', () => {
    it('should refresh list after successful sling', async () => {
      const user = userEvent.setup();

      render(<BeadsList statusFilter="open" isActive={true} />);

      // Wait for initial render
      await waitFor(() => {
        expect(screen.getByText('hq-001')).toBeInTheDocument();
      });

      vi.clearAllMocks();

      // Find and click the SLING button for hq-001 (unassigned bead)
      const slingButton = screen.getByRole('button', { name: /sling/i });
      await user.click(slingButton);

      // Should send mail to mayor
      await waitFor(() => {
        expect(api.mail.send).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'mayor/',
            subject: expect.stringContaining('hq-001'),
          })
        );
      });

      // Should refresh the beads list
      await waitFor(() => {
        expect(api.beads.list).toHaveBeenCalled();
      });
    });
  });

  describe('display', () => {
    it('should display beads with correct information', async () => {
      render(<BeadsList statusFilter="all" isActive={true} />);

      await waitFor(() => {
        expect(screen.getByText('hq-001')).toBeInTheDocument();
        expect(screen.getByText('Test bead 1')).toBeInTheDocument();
        expect(screen.getByText('hq-002')).toBeInTheDocument();
        expect(screen.getByText('Test bead 2')).toBeInTheDocument();
      });
    });

    it('should show loading state initially', () => {
      vi.mocked(api.beads.list).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<BeadsList statusFilter="open" isActive={true} />);

      expect(screen.getByText(/scanning beads database/i)).toBeInTheDocument();
    });

    it('should show error state on fetch failure', async () => {
      vi.mocked(api.beads.list).mockRejectedValue(new Error('Network error'));

      render(<BeadsList statusFilter="open" isActive={true} />);

      await waitFor(() => {
        expect(screen.getByText(/scan failed/i)).toBeInTheDocument();
      });
    });

    it('should show empty state when no beads', async () => {
      vi.mocked(api.beads.list).mockResolvedValue([]);

      render(<BeadsList statusFilter="open" isActive={true} />);

      await waitFor(() => {
        expect(screen.getByText(/no beads found/i)).toBeInTheDocument();
      });
    });
  });
});
