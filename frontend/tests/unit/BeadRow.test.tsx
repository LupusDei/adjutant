/**
 * Tests for BeadRow memoization + style stability.
 *
 * adj-139.4.7 — The hot path in BeadsList constructs new inline style
 * objects on every render. Extracting BeadRow (memoized) and lifting
 * styles outside the render path stops the GC churn during 30s polls.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { BeadRow } from '../../src/components/beads/BeadRow';
import type { BeadInfo } from '../../src/types';

afterEach(() => {
  cleanup();
});

function makeBead(overrides: Partial<BeadInfo> = {}): BeadInfo {
  return {
    id: 'adj-1',
    title: 'Sample bead',
    status: 'open',
    priority: 2,
    type: 'task',
    assignee: null,
    project: 'adjutant',
    source: 'adjutant',
    labels: [],
    createdAt: '2026-05-17T00:00:00Z',
    updatedAt: '2026-05-17T00:00:00Z',
    ...overrides,
  };
}

describe('BeadRow (adj-139.4.7)', () => {
  it('should render a row containing bead id and title', () => {
    const bead = makeBead({ id: 'adj-42', title: 'Test row' });
    const { container } = render(
      <table><tbody>
        <BeadRow bead={bead} cost={null} highlightQuery="" isMenuOpen={false} />
      </tbody></table>,
    );
    expect(container.textContent).toContain('adj-42');
    expect(container.textContent).toContain('Test row');
  });

  it('should be wrapped in React.memo', () => {
    interface MemoLike { $$typeof?: symbol; compare?: unknown }
    const row = BeadRow as unknown as MemoLike;
    expect(row.$$typeof).toBeDefined();
    expect(typeof row.compare).toBe('function');
  });

  it('should preserve DOM identity when re-rendered with logically-equal bead', () => {
    const bead1 = makeBead({ id: 'mem-1', title: 'identity test' });
    const bead2 = makeBead({ id: 'mem-1', title: 'identity test' });

    const { rerender, getByText } = render(
      <table><tbody>
        <BeadRow bead={bead1} cost={null} highlightQuery="" isMenuOpen={false} />
      </tbody></table>,
    );
    const titleEl = getByText('identity test');

    for (let i = 0; i < 50; i++) {
      rerender(
        <table><tbody>
          <BeadRow bead={bead2} cost={null} highlightQuery="" isMenuOpen={false} />
        </tbody></table>,
      );
    }
    expect(getByText('identity test')).toBe(titleEl);
  });

  it('should re-render when status changes', () => {
    const { rerender, getByText, queryByText } = render(
      <table><tbody>
        <BeadRow bead={makeBead({ id: 'st-1', status: 'open' })} cost={null} highlightQuery="" isMenuOpen={false} />
      </tbody></table>,
    );
    expect(getByText('OPEN')).toBeTruthy();

    rerender(
      <table><tbody>
        <BeadRow bead={makeBead({ id: 'st-1', status: 'in_progress' })} cost={null} highlightQuery="" isMenuOpen={false} />
      </tbody></table>,
    );
    expect(queryByText('OPEN')).toBeNull();
    expect(getByText('ACTIVE')).toBeTruthy();
  });
});
