/**
 * AuthoritativeResultPanel (adj-202.3.7) — the grounding contract.
 *
 * This panel renders the STRUCTURED tool result verbatim — it is the source of
 * truth the avatar's voice only narrates. The test pins the contract: the exact
 * structured data is present in the DOM, and a structured error is surfaced as
 * its code + message (never silently dropped).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AuthoritativeResultPanel } from '../../src/components/bridge/AuthoritativeResultPanel';
import type { BridgeToolRunResult } from '../../src/types/bridge';

describe('AuthoritativeResultPanel', () => {
  it('should render an empty invitation when there is no result yet', () => {
    render(<AuthoritativeResultPanel result={null} />);
    expect(screen.getByText(/no readout/i)).toBeInTheDocument();
  });

  it('should render the structured tool result verbatim', () => {
    const result: BridgeToolRunResult = {
      ok: true,
      tool: 'list_agents',
      projectId: '0e578d15',
      data: { agents: [{ id: 'a1', name: 'fenix', status: 'working' }], count: 1 },
    };
    render(<AuthoritativeResultPanel result={result} />);

    // The tool name + scope are labelled.
    expect(screen.getByText('list_agents')).toBeInTheDocument();

    // The verbatim block contains the exact serialized data (source of truth).
    const verbatim = screen.getByTestId('authoritative-readout');
    const expected = JSON.stringify(result.data, null, 2);
    expect(verbatim).toHaveTextContent('fenix');
    expect(verbatim.textContent).toBe(expected);
  });

  it('should surface a structured error as its code and message', () => {
    const result: BridgeToolRunResult = {
      ok: false,
      error: { code: 'TOOL_NOT_ALLOWED', message: "Tool 'close_bead' is not in the read-only Bridge whitelist." },
    };
    render(<AuthoritativeResultPanel result={result} />);

    expect(screen.getByText('TOOL_NOT_ALLOWED')).toBeInTheDocument();
    expect(screen.getByText(/not in the read-only Bridge whitelist/i)).toBeInTheDocument();
  });
});
