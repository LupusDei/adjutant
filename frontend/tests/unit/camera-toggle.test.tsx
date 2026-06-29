/**
 * CameraToggle (adj-202.5.1) — front-camera control + state indicator in the
 * panel chrome. Mirrors MicToggle: a toggle button whose aria-pressed reflects
 * camera state, reachable without diving into the sandboxed avatar iframe. The
 * actual camera enable/disable is relayed by BridgePanel to the avatar iframe.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CameraToggle } from '../../src/components/bridge/CameraToggle';

describe('CameraToggle', () => {
  it('should reflect the enabled state via aria-pressed', () => {
    render(<CameraToggle enabled onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('should reflect the off state via aria-pressed', () => {
    render(<CameraToggle enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('should call onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<CameraToggle enabled={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('should not call onToggle when disabled', async () => {
    const onToggle = vi.fn();
    render(<CameraToggle enabled={false} disabled onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('should expose an accessible label that reflects the action', () => {
    const { rerender } = render(<CameraToggle enabled onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/turn off camera/i);
    rerender(<CameraToggle enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/turn on camera/i);
  });
});
