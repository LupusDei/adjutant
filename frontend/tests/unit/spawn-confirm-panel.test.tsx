/**
 * SpawnConfirmPanel (adj-202.5.3) — the VISIBLE confirm gate for the avatar's
 * spawn_worker read-back. spawn_worker is heavy (a session slot + real money) and
 * confirm-gated; voice assent alone is too easy to mis-hear ("no" vs "go"), so the
 * Commander gets an explicit on-screen "Confirm spawn" button reflecting the
 * read-back. Pure presentation: it renders the plan and reports the decision.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SpawnConfirmPanel } from '../../src/components/bridge/SpawnConfirmPanel';
import type { AvatarSpawnConfirmMessage } from '../../src/components/bridge/avatar-bridge';

const PENDING: AvatarSpawnConfirmMessage = {
  type: 'bridge:spawn-confirm',
  summary: "I'll spawn a QA engineer on adjutant to triage flaky tests — confirm?",
  agentType: 'QA engineer',
  projectRef: 'adjutant',
  task: 'triage flaky tests',
};

describe('SpawnConfirmPanel', () => {
  it('should show the read-back summary so assent is grounded in what will happen', () => {
    render(<SpawnConfirmPanel pending={PENDING} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(PENDING.summary)).toBeInTheDocument();
  });

  it('should surface the structured plan fields (role, project, task) when present', () => {
    render(<SpawnConfirmPanel pending={PENDING} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('QA engineer')).toBeInTheDocument();
    expect(screen.getByText('adjutant')).toBeInTheDocument();
  });

  it('should call onConfirm when the Confirm spawn button is pressed', async () => {
    const onConfirm = vi.fn();
    render(<SpawnConfirmPanel pending={PENDING} onConfirm={onConfirm} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /confirm spawn/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when the Cancel button is pressed', async () => {
    const onCancel = vi.fn();
    render(<SpawnConfirmPanel pending={PENDING} onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('should expose itself as an alert/dialog so it is not missed', () => {
    render(<SpawnConfirmPanel pending={PENDING} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    // role=alertdialog — an assertive, focusable confirmation surface.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('should still render with only a summary (optional fields absent)', () => {
    render(
      <SpawnConfirmPanel
        pending={{ type: 'bridge:spawn-confirm', summary: 'Spawn an engineer?' }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Spawn an engineer?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm spawn/i })).toBeInTheDocument();
  });
});
