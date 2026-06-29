/**
 * ScreenShareToggle (adj-202.5.2) — screen-share control + state indicator in
 * the panel chrome. Lets the Commander share a surface into the Bridge session
 * without diving into the sandboxed avatar iframe. The actual publish/unpublish
 * (getDisplayMedia → LiveKit ScreenShare track) is relayed by BridgePanel.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ScreenShareToggle } from '../../src/components/bridge/ScreenShareToggle';

describe('ScreenShareToggle', () => {
  it('should reflect the sharing state via aria-pressed', () => {
    render(<ScreenShareToggle enabled onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('should reflect the not-sharing state via aria-pressed', () => {
    render(<ScreenShareToggle enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('should call onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<ScreenShareToggle enabled={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('should not call onToggle when disabled', async () => {
    const onToggle = vi.fn();
    render(<ScreenShareToggle enabled={false} disabled onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('should expose an accessible label that reflects the action', () => {
    const { rerender } = render(<ScreenShareToggle enabled onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/stop sharing/i);
    rerender(<ScreenShareToggle enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/share screen/i);
  });
});
