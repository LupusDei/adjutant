/**
 * Tests for BeadsList virtualization.
 *
 * adj-139.4.5 — With 500 beads per group, the original implementation
 * mounted 500 <tr> rows at once. TableVirtuoso renders only the visible
 * window plus a small overscan.
 *
 * Note: jsdom does not implement real layout, so Virtuoso renders 0-1
 * items in the test environment. The assertion is therefore upper-bound:
 * the number of rows must be FAR less than the input length.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

import { BeadsList } from '../../src/components/beads/BeadsList';
import type { BeadInfo } from '../../src/types';

// Mock usePolling to inject a controlled bead list
let mockBeads: BeadInfo[] = [];

vi.mock('../../src/hooks/usePolling', () => ({
  usePolling: () => ({
    data: mockBeads,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

// Mock api so no real fetches happen
vi.mock('../../src/services/api', () => ({
  api: {
    beads: { list: vi.fn().mockResolvedValue([]) },
    messages: { send: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('../../src/services/api-costs', () => ({
  costApi: {
    fetchBeadCost: vi.fn().mockResolvedValue({ totalCost: 0 }),
  },
}));

beforeEach(() => {
  mockBeads = [];
});

afterEach(() => {
  cleanup();
});

function makeBead(idx: number): BeadInfo {
  return {
    id: `adj-${idx}`,
    title: `Bead ${idx}`,
    status: 'open',
    priority: 2,
    type: 'task',
    assignee: null,
    project: 'adjutant',
    source: 'adjutant',
    labels: [],
    createdAt: '2026-05-17T00:00:00Z',
    updatedAt: '2026-05-17T00:00:00Z',
  };
}

describe('BeadsList virtualization (adj-139.4.5)', () => {
  it('should render the group header for 500 beads', async () => {
    mockBeads = Array.from({ length: 500 }, (_, i) => makeBead(i));
    const { container } = render(<BeadsList statusFilter="all" />);

    await waitFor(() => {
      // Group header shows count [500]
      expect(container.textContent).toContain('[500]');
    });
  });

  it('should NOT render all 500 bead rows in the DOM', async () => {
    mockBeads = Array.from({ length: 500 }, (_, i) => makeBead(i));
    const { container } = render(<BeadsList statusFilter="all" />);

    await waitFor(() => {
      expect(container.textContent).toContain('[500]');
    });

    // Look for unique bead titles. Without virtualization all 500 are present.
    const titles = Array.from(container.querySelectorAll('td')).filter((el) =>
      /^Bead \d+$/.test(el.textContent ?? ''),
    );

    expect(titles.length).toBeLessThan(200);
  });
});
