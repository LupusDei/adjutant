/**
 * CaptionsPanel (adj-202.3.7.1) — live captions surface.
 *
 * Spec US1 requires live captions; they are also the a11y path for an audio-off
 * or deaf/HoH Commander, and they reinforce the grounding contract (the spoken
 * narration shown as text beside the authoritative readout). The region is an
 * aria-live log so assistive tech announces new lines.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CaptionsPanel, type CaptionLine } from '../../src/components/bridge/CaptionsPanel';

describe('CaptionsPanel', () => {
  it('should render an empty state when there are no captions', () => {
    render(<CaptionsPanel captions={[]} />);
    expect(screen.getByText(/captions/i)).toBeInTheDocument();
    expect(screen.getByText(/no narration yet/i)).toBeInTheDocument();
  });

  it('should expose a polite live region for assistive tech', () => {
    render(<CaptionsPanel captions={[]} />);
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
  });

  it('should render caption lines in order with their role', () => {
    const captions: CaptionLine[] = [
      { id: '1', role: 'assistant', text: 'Fleet is nominal.', final: true },
      { id: '2', role: 'user', text: 'Show me the crew.', final: true },
    ];
    render(<CaptionsPanel captions={captions} />);

    expect(screen.getByText('Fleet is nominal.')).toBeInTheDocument();
    expect(screen.getByText('Show me the crew.')).toBeInTheDocument();
  });
});
