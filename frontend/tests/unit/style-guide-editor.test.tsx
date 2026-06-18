/**
 * StyleGuideEditor (adj-201.2.2) — per-project brand-color editor panel.
 *
 * The editor renders the project's brand color(s) for editing: a required
 * primary and an optional secondary, each a color-swatch picker paired with a
 * monospace hex text field. It validates hex client-side (parity with the
 * backend: `#RGB` / `#RRGGBB`), shows an inline error for an invalid value,
 * disables Save until the form is dirty AND valid, and offers a clear path
 * (empties primary → clears the whole guide on save).
 *
 * The data layer (load/save/error) is the `useProjectStyleGuide` hook's job, so
 * it is mocked here; these tests own the editor's render + validation + wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { StyleGuideEditor } from '../../src/components/dashboard/StyleGuideEditor';
import type { UseProjectStyleGuideResult } from '../../src/hooks/useProjectStyleGuide';
import type { ProjectStyleGuide } from '../../src/types';

const { mockUseHook } = vi.hoisted(() => ({
  mockUseHook: vi.fn(),
}));

vi.mock('../../src/hooks/useProjectStyleGuide', () => ({
  useProjectStyleGuide: (projectId: string) => mockUseHook(projectId),
}));

const PROJECT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function guide(
  primary: string | null,
  secondary: string | null = null,
): ProjectStyleGuide {
  return { brandColorPrimary: primary, brandColorSecondary: secondary };
}

function hookResult(
  over: Partial<UseProjectStyleGuideResult> = {},
): UseProjectStyleGuideResult {
  return {
    guide: guide(null, null),
    loading: false,
    saving: false,
    error: null,
    save: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

/** The hex text input for a given field label ("Primary" / "Secondary"). */
function hexInput(label: 'Primary' | 'Secondary'): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(new RegExp(`${label} hex`, 'i'));
}

describe('StyleGuideEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHook.mockReturnValue(hookResult());
  });

  it('should render primary and optional secondary color inputs', () => {
    render(<StyleGuideEditor projectId={PROJECT_ID} />);

    expect(hexInput('Primary')).toBeInTheDocument();
    expect(hexInput('Secondary')).toBeInTheDocument();
    // Save is disabled when nothing has changed.
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('should show a loading state while the guide is loading', () => {
    mockUseHook.mockReturnValue(hookResult({ loading: true, guide: null }));
    render(<StyleGuideEditor projectId={PROJECT_ID} />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('should hydrate inputs from the loaded guide', () => {
    mockUseHook.mockReturnValue(hookResult({ guide: guide('#00ff00', '#00aa00') }));
    render(<StyleGuideEditor projectId={PROJECT_ID} />);

    expect(hexInput('Primary').value).toBe('#00ff00');
    expect(hexInput('Secondary').value).toBe('#00aa00');
  });

  it('should show an inline error and keep Save disabled for invalid primary hex', () => {
    render(<StyleGuideEditor projectId={PROJECT_ID} />);

    fireEvent.change(hexInput('Primary'), { target: { value: '#zzz' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/invalid/i);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('should accept a valid #RGB and a valid #RRGGBB and enable Save when dirty', () => {
    render(<StyleGuideEditor projectId={PROJECT_ID} />);

    fireEvent.change(hexInput('Primary'), { target: { value: '#0f0' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();

    fireEvent.change(hexInput('Primary'), { target: { value: '#00FF00' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
  });

  it('should reject an invalid secondary hex while primary is valid', () => {
    render(<StyleGuideEditor projectId={PROJECT_ID} />);

    fireEvent.change(hexInput('Primary'), { target: { value: '#00ff00' } });
    fireEvent.change(hexInput('Secondary'), { target: { value: 'nope' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/invalid/i);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('should call save with the trimmed primary and null secondary when secondary is empty', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    mockUseHook.mockReturnValue(hookResult({ save }));
    render(<StyleGuideEditor projectId={PROJECT_ID} />);

    fireEvent.change(hexInput('Primary'), { target: { value: '#00ff00' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ primary: '#00ff00', secondary: null });
  });

  it('should call save with both colors when secondary is provided', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    mockUseHook.mockReturnValue(hookResult({ save }));
    render(<StyleGuideEditor projectId={PROJECT_ID} />);

    fireEvent.change(hexInput('Primary'), { target: { value: '#00ff00' } });
    fireEvent.change(hexInput('Secondary'), { target: { value: '#00aa00' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(save).toHaveBeenCalledWith({ primary: '#00ff00', secondary: '#00aa00' });
  });

  it('should clear the guide (save empty primary) via the clear control', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    mockUseHook.mockReturnValue(hookResult({ guide: guide('#00ff00', '#00aa00'), save }));
    render(<StyleGuideEditor projectId={PROJECT_ID} />);

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(save).toHaveBeenCalledWith({ primary: '', secondary: null });
  });

  it('should disable Save while a save is in flight', () => {
    mockUseHook.mockReturnValue(hookResult({ saving: true, guide: guide('#00ff00') }));
    render(<StyleGuideEditor projectId={PROJECT_ID} />);

    // Make the form dirty so the only reason Save is disabled is the in-flight save.
    fireEvent.change(hexInput('Primary'), { target: { value: '#00ffff' } });
    expect(screen.getByRole('button', { name: /sav/i })).toBeDisabled();
  });

  it('should surface a hook-level error to the user', () => {
    mockUseHook.mockReturnValue(hookResult({ error: 'save failed' }));
    render(<StyleGuideEditor projectId={PROJECT_ID} />);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/save failed/i)).toBeInTheDocument();
  });
});
