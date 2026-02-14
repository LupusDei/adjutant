import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecipientSelector } from '../../../../src/components/mail/RecipientSelector';
import { api } from '../../../../src/services/api';
import type { CrewMember } from '../../../../src/types';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('../../../../src/services/api', () => ({
  api: {
    agents: {
      list: vi.fn(),
    },
  },
}));

vi.mock('../../../../src/contexts/ModeContext', () => ({
  useMode: vi.fn(() => ({
    mode: 'gastown',
    features: [],
    availableModes: [],
    loading: false,
    error: null,
    isGasTown: true,
    isStandalone: false,
    isSwarm: false,
    hasFeature: () => false,
    switchMode: vi.fn(),
  })),
}));

const mockAgentsList = api.agents.list as ReturnType<typeof vi.fn>;

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockAgent(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: 'greenplace/Toast',
    name: 'Toast',
    type: 'crew',
    rig: 'greenplace',
    status: 'idle',
    unreadMail: 0,
    ...overrides,
  };
}

const mockAgents: CrewMember[] = [
  createMockAgent({ id: 'greenplace/Toast', name: 'Toast', type: 'crew' }),
  createMockAgent({ id: 'greenplace/Wolf', name: 'Wolf', type: 'polecat' }),
  createMockAgent({ id: 'beads/Chunk', name: 'Chunk', type: 'crew' }),
];

// =============================================================================
// Tests
// =============================================================================

describe('RecipientSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentsList.mockResolvedValue(mockAgents);
  });

  // ===========================================================================
  // Rendering
  // ===========================================================================

  describe('rendering', () => {
    it('should render loading state initially', () => {
      mockAgentsList.mockReturnValue(new Promise(() => {})); // Never resolves
      render(<RecipientSelector value="" onChange={() => {}} />);

      expect(screen.getByText(/LOADING/i)).toBeInTheDocument();
    });

    it('should render input and dropdown button after loading', async () => {
      render(<RecipientSelector value="" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      expect(screen.getByLabelText(/close recipient list|open recipient list/i)).toBeInTheDocument();
    });

    it('should render error state when API fails', async () => {
      mockAgentsList.mockRejectedValue(new Error('Network error'));
      render(<RecipientSelector value="" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText(/Network error/i)).toBeInTheDocument();
      });
    });

    it('should include special recipients (Mayor and Overseer)', async () => {
      render(<RecipientSelector value="" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.click(screen.getByLabelText(/open recipient list/i));

      expect(screen.getByText('Mayor')).toBeInTheDocument();
      expect(screen.getByText('Overseer (Human)')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Dropdown Behavior
  // ===========================================================================

  describe('dropdown behavior', () => {
    it('should open dropdown when input is focused', async () => {
      render(<RecipientSelector value="" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      fireEvent.focus(screen.getByRole('textbox'));

      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('should open dropdown when button is clicked', async () => {
      render(<RecipientSelector value="" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByLabelText(/open recipient list/i));

      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('should close dropdown on Escape key', async () => {
      render(<RecipientSelector value="" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.focus(screen.getByRole('textbox'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // Press Escape
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Selection
  // ===========================================================================

  describe('selection', () => {
    it('should call onChange when an agent is selected', async () => {
      const onChange = vi.fn();
      render(<RecipientSelector value="" onChange={onChange} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.click(screen.getByLabelText(/open recipient list/i));

      // Click on Toast
      fireEvent.click(screen.getByText('Toast'));

      expect(onChange).toHaveBeenCalledWith('greenplace/Toast');
    });

    it('should display selected recipient name in input', async () => {
      render(<RecipientSelector value="greenplace/Toast" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByDisplayValue('Toast')).toBeInTheDocument();
      });
    });

    it('should display address if no matching agent found', async () => {
      render(<RecipientSelector value="unknown/agent" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByDisplayValue('unknown/agent')).toBeInTheDocument();
      });
    });
  });

  // ===========================================================================
  // Filtering
  // ===========================================================================

  describe('filtering', () => {
    it('should filter agents based on input', async () => {
      render(<RecipientSelector value="" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      // Open dropdown and type
      fireEvent.focus(screen.getByRole('textbox'));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Toast' } });

      // Should show Toast but not Wolf
      expect(screen.getByText('Toast')).toBeInTheDocument();
      expect(screen.queryByText('Wolf')).not.toBeInTheDocument();
    });

    it('should show empty message when no matches', async () => {
      render(<RecipientSelector value="" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      // Open dropdown and type non-matching text
      fireEvent.focus(screen.getByRole('textbox'));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'xyz123' } });

      expect(screen.getByText('No matching recipients')).toBeInTheDocument();
    });

    it('should select single match on Enter', async () => {
      const onChange = vi.fn();
      render(<RecipientSelector value="" onChange={onChange} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      // Type to filter to single result
      fireEvent.focus(screen.getByRole('textbox'));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Toast' } });
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

      expect(onChange).toHaveBeenCalledWith('greenplace/Toast');
    });
  });

  // ===========================================================================
  // Disabled State
  // ===========================================================================

  describe('disabled state', () => {
    it('should disable input when disabled prop is true', async () => {
      render(<RecipientSelector value="" onChange={() => {}} disabled />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('should disable dropdown button when disabled', async () => {
      render(<RecipientSelector value="" onChange={() => {}} disabled />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      expect(screen.getByLabelText(/open recipient list/i)).toBeDisabled();
    });

    it('should not open dropdown when disabled and focused', async () => {
      render(<RecipientSelector value="" onChange={() => {}} disabled />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      fireEvent.focus(screen.getByRole('textbox'));

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Accessibility
  // ===========================================================================

  describe('accessibility', () => {
    it('should have proper ARIA attributes on input', async () => {
      render(<RecipientSelector value="" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('aria-expanded', 'false');
      expect(input).toHaveAttribute('aria-haspopup', 'listbox');
    });

    it('should update aria-expanded when dropdown opens', async () => {
      render(<RecipientSelector value="" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('aria-expanded', 'false');

      fireEvent.focus(input);

      expect(input).toHaveAttribute('aria-expanded', 'true');
    });

    it('should have label for input', async () => {
      render(<RecipientSelector value="" onChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      expect(screen.getByLabelText('TO:')).toBeInTheDocument();
    });
  });
});
