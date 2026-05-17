import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Virtuoso } from 'react-virtuoso';

afterEach(() => {
  cleanup();
});

/**
 * Smoke test for react-virtuoso install.
 * Verifies the package imports cleanly and renders without throwing.
 * Detailed virtualization behavior is covered in per-component tests.
 */
describe('react-virtuoso smoke test', () => {
  it('should import Virtuoso component without throwing', () => {
    expect(Virtuoso).toBeDefined();
    // Virtuoso is a forwardRef'd component → typeof === 'object'
    expect(['function', 'object']).toContain(typeof Virtuoso);
  });

  it('should render a Virtuoso list without crashing', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, label: `Item ${i}` }));
    const { container } = render(
      <div style={{ height: 200 }}>
        <Virtuoso
          data={items}
          itemContent={(_index, item) => <div data-testid="vrow">{item.label}</div>}
          style={{ height: '100%' }}
        />
      </div>,
    );
    expect(container.firstChild).not.toBeNull();
  });
});
