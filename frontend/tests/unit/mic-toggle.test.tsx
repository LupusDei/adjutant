/**
 * MicToggle (adj-202.3.7.2) — mic control + state indicator in the panel chrome.
 *
 * Spec US1 requires a mic toggle the Commander can see and reach without diving
 * into the sandboxed avatar iframe. The control is a toggle button that reflects
 * mic state via aria-pressed and reports clicks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MicToggle } from '../../src/components/bridge/MicToggle';

describe('MicToggle', () => {
  it('should reflect the enabled state via aria-pressed', () => {
    render(<MicToggle enabled onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('should reflect the muted state via aria-pressed', () => {
    render(<MicToggle enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('should call onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<MicToggle enabled onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('should not call onToggle when disabled', async () => {
    const onToggle = vi.fn();
    render(<MicToggle enabled={false} disabled onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
